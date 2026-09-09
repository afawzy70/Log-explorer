package com.logexplorer.core.search;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.logexplorer.core.guard.GuardrailViolationException;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.SearchRequest;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.Set;

import org.junit.jupiter.api.Test;

/**
 * Legacy Remediation Slice 1, mandatory architecture correction #1
 * ("cursor must be opaque, integrity-protected and search-bound") and
 * mandatory blocker #3 from the recovery round ("keyed cursor
 * fingerprints — replace deterministic public hashes with keyed HMAC").
 * These tests are the concrete proof behind those requirements - not the
 * production behavior of {@code SearchService} (see {@code
 * SearchServicePaginationTest}/adapter-level pagination tests for that).
 */
class PageCursorCodecTest {

  private final PageCursorCodec codec = new PageCursorCodec(new ObjectMapper());
  private static final Instant BOUNDARY = Instant.parse("2026-01-01T12:00:00Z");

  private SearchRequest.Builder baseRequest() {
    return SearchRequest.builder()
        .sourceId("local-docker")
        .start(Instant.parse("2026-01-01T11:00:00Z"))
        .end(Instant.parse("2026-01-01T13:00:00Z"));
  }

  @Test
  void aBlankOrMissingCursorDecodesToNull() {
    assertThat(codec.decodeAndValidate(baseRequest().build())).isNull();
    assertThat(codec.decodeAndValidate(baseRequest().cursor("").build())).isNull();
  }

  @Test
  void encodeThenDecodeRoundTripsExactly() {
    SearchRequest request = baseRequest().build();
    String cursor = codec.encode(request, BOUNDARY, Set.of("key-a", "key-b"), 1);

    PageCursor decoded = codec.decodeAndValidate(baseRequest().cursor(cursor).build());

    assertThat(decoded.sourceId()).isEqualTo("local-docker");
    assertThat(decoded.boundarySourceTimestamp()).isEqualTo(BOUNDARY);
    assertThat(decoded.boundaryTieKeys()).containsExactlyInAnyOrder("key-a", "key-b");
    assertThat(decoded.pageIndex()).isEqualTo(1);
  }

  @Test
  void isOpaqueAndNeverContainsAnyRawSensitiveValueVerbatim() {
    SearchRequest request = baseRequest()
        .sensitiveFilters("12345678", "jane.doe", "CUST-9999", "device-abc", "10.20.30.40")
        .build();
    String cursor = codec.encode(request, BOUNDARY, Set.of(), 1);

    assertThat(cursor).doesNotContain("12345678", "jane.doe", "CUST-9999", "device-abc", "10.20.30.40");
  }

  @Test
  void aTamperedPayloadIsRejectedWithASanitized400StyleException() {
    SearchRequest request = baseRequest().build();
    String cursor = codec.encode(request, BOUNDARY, Set.of("key-a"), 1);
    int dot = cursor.indexOf('.');
    // Flip a character in the middle of the payload segment - a byte-level
    // edit, exactly what a client could do to a plain, unsigned cursor.
    // (Deliberately not the very last character: base64's own padding-free
    // encoding can leave a couple of "don't care" bits there for some
    // lengths, which could coincidentally decode unchanged.)
    String payload = cursor.substring(0, dot);
    String signature = cursor.substring(dot);
    int mid = payload.length() / 2;
    char midChar = payload.charAt(mid);
    char replacement = midChar == 'A' ? 'B' : 'A';
    String tampered = payload.substring(0, mid) + replacement + payload.substring(mid + 1) + signature;

    SearchRequest withTamperedCursor = baseRequest().cursor(tampered).build();
    assertThatThrownBy(() -> codec.decodeAndValidate(withTamperedCursor))
        .isInstanceOf(GuardrailViolationException.class)
        .satisfies(e -> assertThat(((GuardrailViolationException) e).reason())
            .isEqualTo(GuardrailViolationException.Reason.INVALID_CURSOR));
  }

  @Test
  void aTamperedSignatureIsRejected() {
    SearchRequest request = baseRequest().build();
    String cursor = codec.encode(request, BOUNDARY, Set.of("key-a"), 1);
    int mid = cursor.length() - 3;
    char midChar = cursor.charAt(mid);
    char replacement = midChar == 'A' ? 'B' : 'A';
    String tampered = cursor.substring(0, mid) + replacement + cursor.substring(mid + 1);

    SearchRequest withTamperedCursor = baseRequest().cursor(tampered).build();
    assertThatThrownBy(() -> codec.decodeAndValidate(withTamperedCursor))
        .isInstanceOf(GuardrailViolationException.class);
  }

  @Test
  void aMalformedCursorIsRejectedNotSilentlyTreatedAsPage1() {
    SearchRequest withGarbageCursor = baseRequest().cursor("not-a-real-cursor").build();
    assertThatThrownBy(() -> codec.decodeAndValidate(withGarbageCursor))
        .isInstanceOf(GuardrailViolationException.class)
        .satisfies(e -> assertThat(((GuardrailViolationException) e).reason())
            .isEqualTo(GuardrailViolationException.Reason.INVALID_CURSOR));
  }

  @Test
  void errorMessageNeverEchoesTheCursorValueOrDecodedContents() {
    SearchRequest withGarbageCursor = baseRequest()
        .sensitiveFilters("12345678", null, null, null, null)
        .cursor("garbage-cursor-value-that-must-never-appear-in-the-error")
        .build();
    assertThatThrownBy(() -> codec.decodeAndValidate(withGarbageCursor))
        .isInstanceOf(GuardrailViolationException.class)
        .hasMessageNotContaining("garbage-cursor-value-that-must-never-appear-in-the-error")
        .hasMessageNotContaining("12345678");
  }

  @Test
  void aCursorIssuedForOneSourceIsRejectedWhenReplayedAgainstAnotherSource() {
    SearchRequest original = baseRequest().sourceId("local-docker").build();
    String cursor = codec.encode(original, BOUNDARY, Set.of(), 1);

    SearchRequest differentSource = baseRequest().sourceId("openshift-loki").cursor(cursor).build();
    assertThatThrownBy(() -> codec.decodeAndValidate(differentSource))
        .isInstanceOf(GuardrailViolationException.class);
  }

  @Test
  void aCursorIssuedForOneFilterSetIsRejectedWhenReplayedAgainstAWidenedSearch() {
    // Mandatory architecture correction #1: "A cursor from search A MUST
    // NOT be usable to widen/change search B." Widening here means adding
    // a service filter the original search didn't have - a materially
    // different search, even though the source/time-range are identical.
    SearchRequest original = baseRequest().services(java.util.List.of("gateway")).build();
    String cursor = codec.encode(original, BOUNDARY, Set.of(), 1);

    SearchRequest widened = baseRequest().services(java.util.List.of()).cursor(cursor).build();
    assertThatThrownBy(() -> codec.decodeAndValidate(widened))
        .isInstanceOf(GuardrailViolationException.class);
  }

  @Test
  void aCursorIssuedForOneTimeWindowIsRejectedWhenReplayedAgainstADifferentCommittedWindow() {
    SearchRequest original = baseRequest().build();
    String cursor = codec.encode(original, BOUNDARY, Set.of(), 1);

    SearchRequest differentWindow = SearchRequest.builder()
        .sourceId("local-docker")
        .start(Instant.parse("2020-01-01T00:00:00Z"))
        .end(Instant.parse("2020-01-02T00:00:00Z"))
        .cursor(cursor)
        .build();
    assertThatThrownBy(() -> codec.decodeAndValidate(differentWindow))
        .isInstanceOf(GuardrailViolationException.class);
  }

  @Test
  void aValidCursorForTheExactSameSearchDecodesSuccessfully() {
    SearchRequest original = baseRequest()
        .services(java.util.List.of("gateway"))
        .levels(java.util.List.of("ERROR"))
        .text("timeout")
        .build();
    String cursor = codec.encode(original, BOUNDARY, Set.of("k1"), 2);

    SearchRequest continuation = baseRequest()
        .services(java.util.List.of("gateway"))
        .levels(java.util.List.of("ERROR"))
        .text("timeout")
        .cursor(cursor)
        .build();

    PageCursor decoded = codec.decodeAndValidate(continuation);
    assertThat(decoded).isNotNull();
    assertThat(decoded.boundarySourceTimestamp()).isEqualTo(BOUNDARY);
    assertThat(decoded.pageIndex()).isEqualTo(2);
  }

  @Test
  void boundaryTieKeyNeverReadsSensitiveFields() {
    CanonicalLogEvent event = CanonicalLogEvent.builder()
        .timestamp(BOUNDARY)
        .sourceTimestamp(BOUNDARY)
        .message("hello")
        .sensitive(new com.logexplorer.core.model.RawSensitiveFields(
            "should-not-matter-1", "should-not-matter-2", "should-not-matter-3", "should-not-matter-4", "should-not-matter-5"))
        .build();
    CanonicalLogEvent sameButDifferentSensitiveValues = event.toBuilder()
        .sensitive(new com.logexplorer.core.model.RawSensitiveFields("x", "y", "z", "a", "b"))
        .build();

    assertThat(codec.boundaryTieKey(event))
        .isEqualTo(codec.boundaryTieKey(sameButDifferentSensitiveValues));
  }

  @Test
  void boundaryTieKeyDistinguishesGenuinelyDifferentEvents() {
    CanonicalLogEvent a = CanonicalLogEvent.builder().timestamp(BOUNDARY).sourceTimestamp(BOUNDARY).message("a").build();
    CanonicalLogEvent b = CanonicalLogEvent.builder().timestamp(BOUNDARY).sourceTimestamp(BOUNDARY).message("b").build();
    assertThat(codec.boundaryTieKey(a)).isNotEqualTo(codec.boundaryTieKey(b));
  }

  // ---------------------------------------------------------------------
  // Mandatory blocker #3 — "keyed cursor fingerprints"
  // ---------------------------------------------------------------------

  @Test
  void sameInputAndSameKeyProduceAStableRequestBindingFingerprint() {
    SearchRequest request = baseRequest().sensitiveFilters("12345678", null, null, null, null).build();
    assertThat(codec.requestBindingFingerprint(request)).isEqualTo(codec.requestBindingFingerprint(request));
  }

  @Test
  void sameInputAndSameKeyProduceAStableBoundaryTieKey() {
    CanonicalLogEvent event = CanonicalLogEvent.builder().timestamp(BOUNDARY).sourceTimestamp(BOUNDARY).message("hello").build();
    assertThat(codec.boundaryTieKey(event)).isEqualTo(codec.boundaryTieKey(event));
  }

  @Test
  void sameInputWithADifferentProcessKeyProducesADifferentRequestBindingFingerprint() {
    // A second codec instance = a second process boot = a different
    // randomly-generated master key (PageCursorCodec's own constructor).
    PageCursorCodec otherProcessCodec = new PageCursorCodec(new ObjectMapper());
    SearchRequest request = baseRequest().sensitiveFilters("12345678", null, null, null, null).build();

    assertThat(codec.requestBindingFingerprint(request))
        .isNotEqualTo(otherProcessCodec.requestBindingFingerprint(request));
  }

  @Test
  void sameInputWithADifferentProcessKeyProducesADifferentBoundaryTieKey() {
    PageCursorCodec otherProcessCodec = new PageCursorCodec(new ObjectMapper());
    CanonicalLogEvent event = CanonicalLogEvent.builder().timestamp(BOUNDARY).sourceTimestamp(BOUNDARY).message("hello").build();

    assertThat(codec.boundaryTieKey(event)).isNotEqualTo(otherProcessCodec.boundaryTieKey(event));
  }

  @Test
  void aCursorFromOneProcessIsRejectedWhenDecodedByAnotherProcesssCodec() {
    // The practical consequence of keyed (not plain) fingerprints: a
    // cursor is bound to the process/key that issued it, not just to the
    // logical search - restarting the process invalidates every
    // outstanding cursor, which is intended (see PageCursorCodec's own
    // "Signing key and subkeys" javadoc).
    PageCursorCodec otherProcessCodec = new PageCursorCodec(new ObjectMapper());
    SearchRequest request = baseRequest().build();
    String cursorFromThisProcess = codec.encode(request, BOUNDARY, Set.of(), 1);

    SearchRequest withCursor = baseRequest().cursor(cursorFromThisProcess).build();
    assertThatThrownBy(() -> otherProcessCodec.decodeAndValidate(withCursor))
        .isInstanceOf(GuardrailViolationException.class);
  }

  @Test
  void theRequestBindingFingerprintIsNeverAPlainUnkeyedSha256OfTheBasisString() {
    // A regression guard specifically against reintroducing mandatory
    // blocker #3's exact defect: a plain, public SHA-256 (computable by
    // anyone, without this process's key) would make a low-entropy raw
    // sensitive value (e.g. a CIF) offline-guessable by hashing candidates
    // and comparing to what's embedded in the cursor. The keyed HMAC must
    // never coincide with an independently-computed plain SHA-256 of any
    // reasonable representation of the same request.
    SearchRequest request = baseRequest().sensitiveFilters("12345678", null, null, null, null).build();
    String keyed = codec.requestBindingFingerprint(request);

    String plainShaOfCif = sha256Hex("12345678");
    String plainShaOfSourceId = sha256Hex("local-docker");
    assertThat(keyed).isNotEqualTo(plainShaOfCif).isNotEqualTo(plainShaOfSourceId);
  }

  @Test
  void aCursorContainsNoDeterministicPublicHashRepresentationOfTheBoundaryEvent() {
    CanonicalLogEvent event = CanonicalLogEvent.builder()
        .timestamp(BOUNDARY).sourceTimestamp(BOUNDARY).message("secret-looking-content").build();
    String plainShaOfMessage = sha256Hex("secret-looking-content");

    Set<String> tieKeys = Set.of(codec.boundaryTieKey(event));
    String cursor = codec.encode(baseRequest().build(), BOUNDARY, tieKeys, 1);

    assertThat(cursor).doesNotContain(plainShaOfMessage);
    assertThat(tieKeys.iterator().next()).isNotEqualTo(plainShaOfMessage);
  }

  private static String sha256Hex(String input) {
    try {
      byte[] digest = MessageDigest.getInstance("SHA-256").digest(input.getBytes(java.nio.charset.StandardCharsets.UTF_8));
      StringBuilder hex = new StringBuilder(digest.length * 2);
      for (byte b : digest) {
        hex.append(String.format("%02x", b));
      }
      return hex.toString();
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }
}
