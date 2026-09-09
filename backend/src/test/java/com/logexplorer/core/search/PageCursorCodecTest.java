package com.logexplorer.core.search;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.logexplorer.core.guard.GuardrailViolationException;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.SearchRequest;
import java.time.Instant;
import java.util.Set;
import org.junit.jupiter.api.Test;

/**
 * Legacy Remediation Slice 1, mandatory architecture correction #1
 * ("cursor must be opaque, integrity-protected and search-bound"). These
 * tests are the concrete proof behind that requirement - not the
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
    assertThat(decoded.boundaryTimestamp()).isEqualTo(BOUNDARY);
    assertThat(decoded.boundaryKeys()).containsExactlyInAnyOrder("key-a", "key-b");
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
    assertThat(decoded.boundaryTimestamp()).isEqualTo(BOUNDARY);
    assertThat(decoded.pageIndex()).isEqualTo(2);
  }

  @Test
  void eventFingerprintNeverReadsSensitiveFields() {
    CanonicalLogEvent event = CanonicalLogEvent.builder()
        .timestamp(BOUNDARY)
        .message("hello")
        .sensitive(new com.logexplorer.core.model.RawSensitiveFields(
            "should-not-matter-1", "should-not-matter-2", "should-not-matter-3", "should-not-matter-4", "should-not-matter-5"))
        .build();
    CanonicalLogEvent sameButDifferentSensitiveValues = event.toBuilder()
        .sensitive(new com.logexplorer.core.model.RawSensitiveFields("x", "y", "z", "a", "b"))
        .build();

    assertThat(PageCursorCodec.eventFingerprint(event))
        .isEqualTo(PageCursorCodec.eventFingerprint(sameButDifferentSensitiveValues));
  }

  @Test
  void eventFingerprintDistinguishesGenuinelyDifferentEvents() {
    CanonicalLogEvent a = CanonicalLogEvent.builder().timestamp(BOUNDARY).message("a").build();
    CanonicalLogEvent b = CanonicalLogEvent.builder().timestamp(BOUNDARY).message("b").build();
    assertThat(PageCursorCodec.eventFingerprint(a)).isNotEqualTo(PageCursorCodec.eventFingerprint(b));
  }
}
