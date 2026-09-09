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
   * javadoc), in a canonical, field-boundary-unambiguous encoding (see
   * {@link #appendField} — mandatory final blocker: "unambiguous HMAC
   * input encoding"). Raw sensitive filter values are fed into the keyed
   * digest, never stored verbatim anywhere in the cursor. Package-private
   * so {@code SearchService} never needs to import a crypto primitive
   * itself and {@code PageCursorCodecTest} can assert on it directly.
   */
  String requestBindingFingerprint(SearchRequest r) {
    RawSensitiveFields sf = r.sensitiveFilters();
    StringBuilder basis = new StringBuilder();
    appendField(basis, r.sourceId());
    appendField(basis, r.start());
    appendField(basis, r.end());
    appendField(basis, r.direction());
    appendField(basis, r.limit());
    appendOrderInsensitiveList(basis, r.services());
    appendOrderInsensitiveList(basis, r.levels());
    appendField(basis, r.text());
    appendField(basis, r.traceId());
    appendField(basis, r.spanId());
    appendField(basis, r.correlationId());
    appendField(basis, r.journeyId());
    appendField(basis, r.eventId());
    appendField(basis, r.errorCode());
    appendField(basis, r.businessStep());
    appendField(basis, r.uiIdentifier());
    appendField(basis, r.loggerContains());
    appendField(basis, r.devicePlatform());
    appendField(basis, r.language());
    appendField(basis, r.containerId());
    appendField(basis, r.pod());
    appendField(basis, sf.cif());
    appendField(basis, sf.userName());
    appendField(basis, sf.customerId());
    appendField(basis, sf.deviceId());
    appendField(basis, sf.deviceIp());
    appendField(basis, r.query());
    appendField(basis, r.rawLogQl());
    return hmacHex(requestBindingSubkey, basis.toString());
  }

  /**
   * Keyed HMAC-SHA256 (never a plain/public hash — mandatory blocker #3)
   * content fingerprint for one event, in the same canonical,
   * field-boundary-unambiguous encoding as {@link #requestBindingFingerprint}
   * (see {@link #appendField}), used only to recognize "the exact same
   * event, already returned" when two events share the same {@link
   * CanonicalLogEvent#sourceTimestamp()} at a page boundary. Deliberately
   * never reads {@link CanonicalLogEvent#sensitive()}.
   */
  public String boundaryTieKey(CanonicalLogEvent e) {
    StringBuilder basis = new StringBuilder();
    appendField(basis, e.sourceId());
    appendField(basis, e.containerId());
    appendField(basis, e.pod());
    appendField(basis, e.stream());
    appendField(basis, e.timestampRaw());
    appendField(basis, e.rawLine());
    appendField(basis, e.message());
    appendField(basis, e.logger());
    appendField(basis, e.thread());
    appendField(basis, e.traceId());
    appendField(basis, e.spanId());
    appendField(basis, e.correlationId());
    appendField(basis, e.journeyId());
    appendField(basis, e.eventId());
    return hmacHex(boundaryEventSubkey, basis.toString());
  }

  /**
   * Appends one field to a canonical HMAC-input basis in a
   * field-boundary-unambiguous ("netstring"-style) encoding: {@code
   * <UTF-8 byte length>:<value>} for a non-null value, or the literal
   * {@code N:} sentinel (never a valid length prefix - lengths are always
   * decimal digits) for {@code null}, so {@code null} can never collide
   * with an empty string (which encodes as {@code 0:}).
   *
   * <p>This is what makes concatenation safe: two different field-value
   * tuples can never produce the same basis string, because each field's
   * exact byte length is recorded immediately before it - unlike naive
   * concatenation (the previous implementation's real bug, e.g. {@code
   * ["ab","c"]} and {@code ["a","bc"]} both naively joining to {@code
   * "abc"}). Every field is always appended at the same fixed position in
   * the sequence (this method never reorders which field goes where), so
   * two fields swapping values (e.g. {@code sourceId="X", text=""} vs
   * {@code sourceId="", text="X"}) also never collides - their length
   * prefixes land in different places in the resulting basis string.
   */
  private static void appendField(StringBuilder sb, Object value) {
    if (value == null) {
      sb.append("N:");
      return;
    }
    String s = value.toString();
    sb.append(s.getBytes(StandardCharsets.UTF_8).length).append(':').append(s);
  }

  /**
   * Appends an order-insensitive collection (the filter semantics for
   * {@code services}/{@code levels}: a request naming the same set in a
   * different order means the identical search) as an explicit,
   * self-delimiting count followed by each element - canonically sorted
   * first, so two logically-identical sets always produce the same basis
   * regardless of the order the caller supplied them in - each element
   * itself going through {@link #appendField}, so element boundaries
   * within the list are exactly as unambiguous as any other field.
   */
  private static void appendOrderInsensitiveList(StringBuilder sb, List<String> values) {
    List<String> sorted = values.stream().sorted().toList();
    appendField(sb, String.valueOf(sorted.size()));
    for (String v : sorted) {
      appendField(sb, v);
    }
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
