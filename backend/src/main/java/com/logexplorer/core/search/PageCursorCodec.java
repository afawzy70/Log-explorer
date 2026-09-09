package com.logexplorer.core.search;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.logexplorer.core.guard.GuardrailViolationException;
import com.logexplorer.core.guard.GuardrailViolationException.Reason;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.RawSensitiveFields;
import com.logexplorer.core.model.SearchRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Component;

/**
 * Encodes/decodes the opaque {@code SearchRequest#cursor()} used for
 * bounded historical-search pagination (Legacy Remediation Slice 1, {@code
 * docs/LEGACY_TO_NEW_REMEDIATION_PLAN.md} §"Slice 1"; recovered per the
 * owner/reviewer's mandatory architecture corrections after PR #18's first
 * review). Mandatory correction #1 (from Slice 1's original approval): the
 * cursor must be opaque, integrity-protected, and bound to the exact
 * search it was issued for. Mandatory blocker #3 (from the recovery
 * round): every fingerprint embedded in the cursor must be a *keyed* HMAC,
 * never a plain/public deterministic hash — a public SHA-256 of a
 * low-entropy raw value (e.g. a CIF) is offline-guessable by anyone who
 * can compute SHA-256 and sees the cursor, without ever needing this
 * process's key; a keyed HMAC is not.
 *
 * <p><b>Signing key and subkeys.</b> A single master key is generated
 * once, in memory, at process start via {@link SecureRandom} — not
 * configured, not persisted, never logged. A cursor is a short-lived,
 * single-pagination-session artifact, so a fresh random key per boot gives
 * real tamper-evidence without a new long-lived secret to operate or
 * rotate. Two independent subkeys are derived from it via HMAC-SHA256
 * (RFC 2104-style key derivation — {@code HMAC(masterKey, label)}), so a
 * key used for one purpose can never be reused to attack the other:
 * <ul>
 *   <li>{@code request-binding} — signs {@link #requestBindingFingerprint},
 *   the fingerprint of "what this search means" (source, time range,
 *   filters, including the five raw sensitive values fed into the keyed
 *   digest, never stored verbatim).
 *   <li>{@code boundary-event} — signs {@link #boundaryTieKey}, the
 *   fingerprint identifying one specific already-returned event at a
 *   shared native-timestamp boundary.
 * </ul>
 * The outer cursor envelope itself (payload + signature) is still signed
 * with the master key directly, exactly as before.
 *
 * <p><b>What the request-binding fingerprint covers.</b> Every field of
 * the {@link SearchRequest} that defines "what this search means" - source,
 * time range, direction, limit, and every structured/text/DSL/raw-LogQL
 * filter, including the five raw sensitive values. A cursor decoded
 * against a request whose recomputed fingerprint differs, or whose {@code
 * sourceId} differs, is rejected — a cursor from search A can never be
 * replayed to widen or change search B.
 *
 * <p><b>Source-native pagination position (mandatory blocker #1).</b> The
 * boundary carried in the cursor is {@link CanonicalLogEvent#sourceTimestamp()}
 * — the adapter's own native clock — never {@link CanonicalLogEvent#timestamp()}
 * (the parsed application timestamp, which is {@code null} for a
 * malformed/non-JSON line even though the source-native clock is always
 * known). {@code boundarySourceEpochNanos} is a plain, non-sensitive
 * position marker (comparable to a timestamp) and is never hashed.
 * {@link #boundaryTieKey} is a second, keyed fingerprint used only to
 * recognize "the exact same event, already returned" when multiple events
 * share that exact native instant (mandatory blocker #1's tests: "multiple
 * Docker events share application timestamp but have different engine
 * timestamps", "multiple Loki events share identical source-native
 * timestamp"). It never touches {@link CanonicalLogEvent#sensitive()}.
 *
 * <p>The boundary instant round-trips through the cursor as epoch
 * nanoseconds ({@link PageCursorPayload}), not {@code java.time.Instant} -
 * deliberately, so this codec's correctness never depends on Jackson's
 * {@code JavaTimeModule} being registered on whatever {@code ObjectMapper}
 * is injected.
 */
@Component
public class PageCursorCodec {

  private static final int VERSION = 2;
  private static final String HMAC_ALGORITHM = "HmacSHA256";
  private static final String REQUEST_BINDING_SUBKEY_LABEL = "request-binding";
  private static final String BOUNDARY_EVENT_SUBKEY_LABEL = "boundary-event";
  private static final Base64.Encoder URL_ENCODER = Base64.getUrlEncoder().withoutPadding();
  private static final Base64.Decoder URL_DECODER = Base64.getUrlDecoder();

  private final ObjectMapper objectMapper;
  private final SecretKeySpec requestBindingSubkey;
  private final SecretKeySpec boundaryEventSubkey;
  private final SecretKeySpec envelopeSigningKey;

  public PageCursorCodec(ObjectMapper objectMapper) {
    this.objectMapper = objectMapper;
    byte[] masterKeyBytes = new byte[32];
    new SecureRandom().nextBytes(masterKeyBytes);
    SecretKeySpec masterKey = new SecretKeySpec(masterKeyBytes, HMAC_ALGORITHM);
    this.envelopeSigningKey = masterKey;
    this.requestBindingSubkey = deriveSubkey(masterKey, REQUEST_BINDING_SUBKEY_LABEL);
    this.boundaryEventSubkey = deriveSubkey(masterKey, BOUNDARY_EVENT_SUBKEY_LABEL);
  }

  /**
   * Builds the next page's cursor from the request that just ran, the
   * *source-native* timestamp of the boundary event on the page just
   * returned, and the tie-break keys of every event on that page which
   * shares that exact native instant (see {@link PageCursor}).
   */
  public String encode(SearchRequest request, Instant boundarySourceTimestamp, Set<String> boundaryTieKeys, int pageIndex) {
    long nanos = boundarySourceTimestamp.getEpochSecond() * 1_000_000_000L + boundarySourceTimestamp.getNano();
    PageCursorPayload payload = new PageCursorPayload(
        VERSION,
        request.sourceId(),
        nanos,
        new TreeSet<>(boundaryTieKeys),
        request.direction().name(),
        pageIndex,
        requestBindingFingerprint(request));
    byte[] payloadBytes = writePayload(payload);
    String payloadPart = URL_ENCODER.encodeToString(payloadBytes);
    String signaturePart = URL_ENCODER.encodeToString(hmac(envelopeSigningKey, payloadBytes));
    return payloadPart + "." + signaturePart;
  }

  /**
   * Returns {@code null} if {@code request.cursor()} is blank (page 1 - no
   * pagination in progress). Throws {@link GuardrailViolationException}
   * with {@link Reason#INVALID_CURSOR} for anything else that fails to
   * verify: malformed shape, bad signature (tampered or forged), or a
   * fingerprint/source mismatch against the rest of {@code request} (the
   * cursor was issued for a materially different search). The exception
   * message is always the same fixed string - it never echoes the cursor
   * value or any decoded field, so a 400 response can never leak cursor
   * internals.
   */
  public PageCursor decodeAndValidate(SearchRequest request) {
    String cursor = request.cursor();
    if (cursor == null || cursor.isBlank()) {
      return null;
    }
    PageCursorPayload payload = decodeVerified(cursor);
    if (payload.version() != VERSION) {
      throw invalid();
    }
    if (!payload.sourceId().equals(request.sourceId())) {
      throw invalid();
    }
    if (!payload.requestBindingHmac().equals(requestBindingFingerprint(request))) {
      throw invalid();
    }
    Instant boundary = Instant.ofEpochSecond(
        Math.floorDiv(payload.boundarySourceEpochNanos(), 1_000_000_000L),
        Math.floorMod(payload.boundarySourceEpochNanos(), 1_000_000_000L));
    return new PageCursor(
        payload.version(), payload.sourceId(), boundary,
        Set.copyOf(payload.boundaryTieKeys()), payload.direction(), payload.pageIndex(), payload.requestBindingHmac());
  }

  private PageCursorPayload decodeVerified(String cursor) {
    int dot = cursor.indexOf('.');
    if (dot <= 0 || dot == cursor.length() - 1) {
      throw invalid();
    }
    byte[] payloadBytes;
    byte[] signature;
    try {
      payloadBytes = URL_DECODER.decode(cursor.substring(0, dot));
      signature = URL_DECODER.decode(cursor.substring(dot + 1));
    } catch (IllegalArgumentException e) {
      throw invalid();
    }
    byte[] expectedSignature = hmac(envelopeSigningKey, payloadBytes);
    if (!MessageDigest.isEqual(signature, expectedSignature)) {
      throw invalid();
    }
    try {
      return objectMapper.readValue(payloadBytes, PageCursorPayload.class);
    } catch (Exception e) {
      throw invalid();
    }
  }

  private byte[] writePayload(PageCursorPayload payload) {
    try {
      return objectMapper.writeValueAsBytes(payload);
    } catch (Exception e) {
      // PageCursorPayload's fields are all plain, already-serializable
      // types (int/long/String/Set<String>) - this cannot happen in
      // practice, but never surface a raw Jackson exception (which could
      // echo field values) if it somehow did.
      throw invalid();
    }
  }

  private static SecretKeySpec deriveSubkey(SecretKeySpec masterKey, String label) {
    return new SecretKeySpec(hmac(masterKey, label.getBytes(StandardCharsets.UTF_8)), HMAC_ALGORITHM);
  }

  private static byte[] hmac(SecretKeySpec key, byte[] data) {
    try {
      Mac mac = Mac.getInstance(HMAC_ALGORITHM);
      mac.init(key);
      return mac.doFinal(data);
    } catch (Exception e) {
      throw new IllegalStateException("HMAC computation failed", e);
    }
  }

  private static GuardrailViolationException invalid() {
    return new GuardrailViolationException(Reason.INVALID_CURSOR, "The pagination cursor is invalid or expired");
  }

  /**
   * Keyed HMAC-SHA256 (never a plain/public hash — mandatory blocker #3)
   * over every field that defines "what this search means" (see class
   * javadoc). Raw sensitive filter values are fed into the keyed digest,
   * never stored verbatim anywhere in the cursor. Package-private so
   * {@code SearchService} never needs to import a crypto primitive itself
   * and {@code PageCursorCodecTest} can assert on it directly.
   */
  String requestBindingFingerprint(SearchRequest r) {
    RawSensitiveFields sf = r.sensitiveFilters();
    String basis = String.join("",
        n(r.sourceId()), n(r.start()), n(r.end()), n(r.direction()), n(r.limit()),
        joinSorted(r.services()), joinSorted(r.levels()), n(r.text()),
        n(r.traceId()), n(r.spanId()), n(r.correlationId()), n(r.journeyId()), n(r.eventId()),
        n(r.errorCode()), n(r.businessStep()), n(r.uiIdentifier()), n(r.loggerContains()),
        n(r.devicePlatform()), n(r.language()), n(r.containerId()), n(r.pod()),
        n(sf.cif()), n(sf.userName()), n(sf.customerId()), n(sf.deviceId()), n(sf.deviceIp()),
        n(r.query()), n(r.rawLogQl()));
    return hmacHex(requestBindingSubkey, basis);
  }

  /**
   * Keyed HMAC-SHA256 (never a plain/public hash — mandatory blocker #3)
   * content fingerprint for one event, used only to recognize "the exact
   * same event, already returned" when two events share the same {@link
   * CanonicalLogEvent#sourceTimestamp()} at a page boundary. Deliberately
   * never reads {@link CanonicalLogEvent#sensitive()}.
   */
  public String boundaryTieKey(CanonicalLogEvent e) {
    String basis = String.join("",
        n(e.sourceId()), n(e.containerId()), n(e.pod()), n(e.stream()), n(e.timestampRaw()),
        n(e.rawLine()), n(e.message()), n(e.logger()), n(e.thread()),
        n(e.traceId()), n(e.spanId()), n(e.correlationId()), n(e.journeyId()), n(e.eventId()));
    return hmacHex(boundaryEventSubkey, basis);
  }

  private static String joinSorted(List<String> values) {
    return values.stream().sorted().reduce((a, b) -> a + "," + b).orElse("");
  }

  private static String n(Object value) {
    return value == null ? " " : value.toString();
  }

  private static String hmacHex(SecretKeySpec key, String input) {
    byte[] digest = hmac(key, input.getBytes(StandardCharsets.UTF_8));
    StringBuilder hex = new StringBuilder(digest.length * 2);
    for (byte b : digest) {
      hex.append(String.format("%02x", b));
    }
    return hex.toString();
  }
}
