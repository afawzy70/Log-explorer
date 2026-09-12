package com.logexplorer.core.search;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.logexplorer.core.guard.GuardrailViolationException;
import org.junit.jupiter.api.Test;

/**
 * OS-1D review recovery — unit-level coverage of {@link
 * ContextTargetProofCodec} in isolation, complementing the integration-
 * level authorization tests in {@code DirectPodLogProviderTest} (mission
 * §14). Mirrors {@link PageCursorCodecTest}'s own conventions.
 */
class ContextTargetProofCodecTest {

  private final ContextTargetProofCodec codec = new ContextTargetProofCodec(new ObjectMapper());

  @Test
  void aProofIssuedForExactlyTheExpectedTargetVerifiesWithoutThrowing() {
    String proof = codec.encode("openshift", 7L, "payments", "pod-a", "app");
    codec.verify(proof, "openshift", 7L, "payments", "pod-a", "app"); // must not throw
  }

  @Test
  void aMissingOrBlankProofIsRejected() {
    assertRejected(() -> codec.verify(null, "openshift", 7L, "payments", "pod-a", "app"));
    assertRejected(() -> codec.verify("", "openshift", 7L, "payments", "pod-a", "app"));
    assertRejected(() -> codec.verify("   ", "openshift", 7L, "payments", "pod-a", "app"));
  }

  @Test
  void aStructurallyMalformedProofIsRejected() {
    assertRejected(() -> codec.verify("not-even-a-dotted-value", "openshift", 7L, "payments", "pod-a", "app"));
    assertRejected(() -> codec.verify(".", "openshift", 7L, "payments", "pod-a", "app"));
    assertRejected(() -> codec.verify("!!!not-base64!!!.!!!also-not!!!", "openshift", 7L, "payments", "pod-a", "app"));
  }

  @Test
  void aTamperedPayloadFailsSignatureVerification() {
    String proof = codec.encode("openshift", 7L, "payments", "pod-a", "app");
    int dot = proof.indexOf('.');
    // Flip the first payload character - the signature no longer matches.
    String tampered = flipFirstChar(proof.substring(0, dot)) + proof.substring(dot);
    assertRejected(() -> codec.verify(tampered, "openshift", 7L, "payments", "pod-a", "app"));
  }

  @Test
  void aTamperedSignatureFailsVerification() {
    String proof = codec.encode("openshift", 7L, "payments", "pod-a", "app");
    int dot = proof.indexOf('.');
    String tampered = proof.substring(0, dot + 1) + flipFirstChar(proof.substring(dot + 1));
    assertRejected(() -> codec.verify(tampered, "openshift", 7L, "payments", "pod-a", "app"));
  }

  @Test
  void aProofFromADifferentCodecInstanceIsAlwaysRejected() {
    // Two independent instances never share key material - simulates a
    // proof forged without ever knowing this process's own signing key.
    ContextTargetProofCodec other = new ContextTargetProofCodec(new ObjectMapper());
    String proof = other.encode("openshift", 7L, "payments", "pod-a", "app");
    assertRejected(() -> codec.verify(proof, "openshift", 7L, "payments", "pod-a", "app"));
  }

  @Test
  void everyFieldMustMatchExactly_sourceId() {
    String proof = codec.encode("openshift", 7L, "payments", "pod-a", "app");
    assertRejected(() -> codec.verify(proof, "openshift-loki", 7L, "payments", "pod-a", "app"));
  }

  @Test
  void everyFieldMustMatchExactly_connectionGeneration() {
    String proof = codec.encode("openshift", 7L, "payments", "pod-a", "app");
    assertRejected(() -> codec.verify(proof, "openshift", 8L, "payments", "pod-a", "app"));
  }

  @Test
  void everyFieldMustMatchExactly_namespace() {
    String proof = codec.encode("openshift", 7L, "payments", "pod-a", "app");
    assertRejected(() -> codec.verify(proof, "openshift", 7L, "project-b", "pod-a", "app"));
  }

  @Test
  void everyFieldMustMatchExactly_pod() {
    String proof = codec.encode("openshift", 7L, "payments", "pod-a", "app");
    assertRejected(() -> codec.verify(proof, "openshift", 7L, "payments", "pod-b", "app"));
  }

  @Test
  void everyFieldMustMatchExactly_container() {
    String proof = codec.encode("openshift", 7L, "payments", "pod-a", "app");
    assertRejected(() -> codec.verify(proof, "openshift", 7L, "payments", "pod-a", "privileged-sidecar"));
  }

  @Test
  void theRejectionMessageIsAlwaysTheSameFixedStringAndNeverEchoesFieldValues() {
    // Mission §8 - never leak which check failed or whether a named
    // pod/container exists, so every distinct failure mode must produce
    // byte-identical, generic message text.
    String proof = codec.encode("openshift", 7L, "payments", "pod-a", "app");
    String missing = messageOf(() -> codec.verify(null, "openshift", 7L, "payments", "pod-a", "app"));
    String malformed = messageOf(() -> codec.verify("garbage", "openshift", 7L, "payments", "pod-a", "app"));
    String wrongPod = messageOf(() -> codec.verify(proof, "openshift", 7L, "payments", "attacker-pod", "app"));
    String wrongGeneration = messageOf(() -> codec.verify(proof, "openshift", 99L, "payments", "pod-a", "app"));

    assertThat(missing).isEqualTo(malformed).isEqualTo(wrongPod).isEqualTo(wrongGeneration);
    assertThat(missing).doesNotContain("attacker-pod").doesNotContain("pod-a").doesNotContain("99");
  }

  private void assertRejected(Runnable action) {
    assertThatThrownBy(action::run)
        .isInstanceOf(GuardrailViolationException.class)
        .satisfies(e -> assertThat(((GuardrailViolationException) e).reason())
            .isEqualTo(GuardrailViolationException.Reason.INVALID_CONTEXT_TARGET));
  }

  private String messageOf(Runnable action) {
    try {
      action.run();
      throw new AssertionError("expected GuardrailViolationException");
    } catch (GuardrailViolationException e) {
      return e.getMessage();
    }
  }

  private static String flipFirstChar(String s) {
    char[] chars = s.toCharArray();
    chars[0] = chars[0] == 'A' ? 'B' : 'A';
    return new String(chars);
  }
}
