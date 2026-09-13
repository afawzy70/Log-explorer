package com.logexplorer.core.search;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.logexplorer.core.guard.GuardrailViolationException;
import com.logexplorer.core.guard.GuardrailViolationException.Reason;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Component;

/**
 * OS-1D review recovery — server-verifiable, non-forgeable proof that a
 * specific ({@code sourceId}, {@code connectionGeneration}, {@code
 * namespace}, {@code pod}, {@code container}) tuple was part of a search
 * result this backend itself produced, so "Show surrounding logs" can
 * still truthfully attempt a pod that has since disappeared from the
 * currently cached OS-1B scope (the mission's own valid requirement)
 * <em>without</em> letting a client-supplied {@code pod}/{@code
 * containerName} pair alone authorize retrieval of an arbitrary target
 * that was never legitimately resolved — e.g. a Job/CronJob/standalone/
 * operator pod {@code DirectPodLogProvider} never targets and therefore
 * never issues a proof for.
 *
 * <p>Deliberately modeled on {@link PageCursorCodec} (same opaque
 * "base64 payload . base64 HMAC signature" envelope, same in-memory-only
 * {@link SecureRandom} signing key generated once at process start, same
 * "one fixed rejection message, never reveal which check failed" — see
 * {@link #verify}) but kept as its own small codec with its own
 * independent key, rather than folded into {@code PageCursorCodec}: a
 * context-target proof answers "was this pod/container ever a real,
 * resolved target of a search this backend produced", which is a
 * completely different question from "is this the correct next page of
 * this exact search" — conflating the two would make each harder to
 * reason about and would let a bug in one leak into the other's own key
 * material.
 *
 * <p>Every field in the payload is structural (never sensitive) — the
 * signature exists to make the envelope non-forgeable, not to hide field
 * values that are already visible in the same request. The proof is
 * short-lived only in the sense that it is bound to one {@code
 * OpenShiftSession} connection generation ({@link #verify}'s {@code
 * expectedGeneration} parameter, checked against {@code
 * OpenShiftSession#generation()} at verification time) — reconnecting
 * invalidates every previously-issued proof, which is what the mission's
 * "proof from an old connection generation must be rejected" requirement
 * actually needs; there is no separate wall-clock expiry, because the
 * proof never grants access beyond what the requester's own current
 * OpenShift bearer token and connection already permit — it only ever
 * re-attempts a read the backend itself already resolved once before.
 */
@Component
public class ContextTargetProofCodec {

  private static final int VERSION = 1;
  private static final String HMAC_ALGORITHM = "HmacSHA256";
  private static final Base64.Encoder URL_ENCODER = Base64.getUrlEncoder().withoutPadding();
  private static final Base64.Decoder URL_DECODER = Base64.getUrlDecoder();

  private final ObjectMapper objectMapper;
  private final SecretKeySpec signingKey;

  public ContextTargetProofCodec(ObjectMapper objectMapper) {
    this.objectMapper = objectMapper;
    byte[] keyBytes = new byte[32];
    new SecureRandom().nextBytes(keyBytes);
    this.signingKey = new SecretKeySpec(keyBytes, HMAC_ALGORITHM);
  }

  /**
   * Issues a proof for one already-resolved (source, connection
   * generation, namespace, pod, container) target — called only while
   * building the {@link com.logexplorer.core.model.CanonicalLogEvent} for
   * a target this search actually, legitimately queried.
   */
  public String encode(String sourceId, long connectionGeneration, String namespace, String pod, String container) {
    ContextTargetProofPayload payload =
        new ContextTargetProofPayload(VERSION, sourceId, connectionGeneration, namespace, pod, container);
    byte[] payloadBytes = writePayload(payload);
    String payloadPart = URL_ENCODER.encodeToString(payloadBytes);
    String signaturePart = URL_ENCODER.encodeToString(hmac(payloadBytes));
    return payloadPart + "." + signaturePart;
  }

  /**
   * Decodes {@code proof} and verifies both its signature and that every
   * field matches exactly what this call site expects. Returns normally
   * only when all of that holds; throws {@link GuardrailViolationException}
   * ({@link Reason#INVALID_CONTEXT_TARGET}) for anything else — missing,
   * malformed, tampered/forged, wrong version, or any single field
   * mismatch (wrong source, stale connection generation, wrong namespace,
   * wrong pod, wrong container) alike. The message is always the same
   * fixed string: this can never be used as an oracle to learn which
   * specific check failed or whether the named pod/container actually
   * exists in the namespace (mission §8's own explicit requirement).
   */
  public void verify(
      String proof, String expectedSourceId, long expectedGeneration, String expectedNamespace,
      String expectedPod, String expectedContainer) {
    if (proof == null || proof.isBlank()) {
      throw invalid();
    }
    ContextTargetProofPayload payload = decodeVerified(proof);
    if (payload.version() != VERSION) {
      throw invalid();
    }
    if (!expectedSourceId.equals(payload.sourceId())) {
      throw invalid();
    }
    if (expectedGeneration != payload.connectionGeneration()) {
      throw invalid();
    }
    if (!expectedNamespace.equals(payload.namespace())) {
      throw invalid();
    }
    if (!expectedPod.equals(payload.pod())) {
      throw invalid();
    }
    if (!expectedContainer.equals(payload.container())) {
      throw invalid();
    }
  }

  private ContextTargetProofPayload decodeVerified(String proof) {
    int dot = proof.indexOf('.');
    if (dot <= 0 || dot == proof.length() - 1) {
      throw invalid();
    }
    byte[] payloadBytes;
    byte[] signature;
    try {
      payloadBytes = URL_DECODER.decode(proof.substring(0, dot));
      signature = URL_DECODER.decode(proof.substring(dot + 1));
    } catch (IllegalArgumentException e) {
      throw invalid();
    }
    byte[] expectedSignature = hmac(payloadBytes);
    if (!MessageDigest.isEqual(signature, expectedSignature)) {
      throw invalid();
    }
    try {
      return objectMapper.readValue(payloadBytes, ContextTargetProofPayload.class);
    } catch (Exception e) {
      throw invalid();
    }
  }

  private byte[] writePayload(ContextTargetProofPayload payload) {
    try {
      return objectMapper.writeValueAsBytes(payload);
    } catch (Exception e) {
      // Every field is a plain, already-serializable type (int/long/
      // String) - this cannot happen in practice, but never surface a raw
      // Jackson exception if it somehow did.
      throw invalid();
    }
  }

  private byte[] hmac(byte[] data) {
    try {
      Mac mac = Mac.getInstance(HMAC_ALGORITHM);
      mac.init(signingKey);
      return mac.doFinal(data);
    } catch (Exception e) {
      throw new IllegalStateException("HMAC computation failed", e);
    }
  }

  private static GuardrailViolationException invalid() {
    return new GuardrailViolationException(
        Reason.INVALID_CONTEXT_TARGET, "This log location could not be verified for surrounding-log retrieval.");
  }
}
