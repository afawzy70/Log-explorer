package com.logexplorer.core.search;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.logexplorer.core.guard.GuardrailViolationException;
import com.logexplorer.core.guard.GuardrailViolationException.Reason;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.RawSensitiveFields;
import com.logexplorer.core.model.SearchRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
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
 * bounded historical-search pagination (Legacy Remediation Slice 1,
 * {@code docs/LEGACY_TO_NEW_REMEDIATION_PLAN.md} §"Slice 1"). Mandatory
 * architecture correction #1 from that plan's owner-approved scope: the
 * cursor must be opaque, integrity-protected, and bound to the exact
 * search it was issued for - never a plain, editable value.
 *
 * <p><b>Signing key.</b> Generated once, in memory, at process start via
 * {@link SecureRandom} - not configured, not persisted, never logged. A
 * cursor is a short-lived, single-pagination-session artifact (its whole
 * purpose ends the moment the investigator's search changes or the process
 * restarts), so a fresh random key per boot gives real tamper-evidence
 * without adding a new long-lived secret to operate or rotate - simpler and
 * safer than reusing/inventing a persistent shared secret for this.
 *
 * <p><b>What it binds.</b> {@link #requestFingerprint} hashes (SHA-256,
 * one-way) every field of the {@link SearchRequest} that defines "what this
 * search means" - source, time range, direction, limit, and every
 * structured/text/DSL/raw-LogQL filter, including the five raw sensitive
 * values. Per the plan's explicit instruction ("do not put raw sensitive
 * search values inside the cursor; prefer a canonical request fingerprint
 * rather than embedding raw filters") the raw values are fed into the
 * one-way digest and never appear in the cursor's own payload - only the
 * digest does. {@code cursor} itself is excluded (it is the pagination
 * position, not part of "what this search means"). A cursor decoded
 * against a request whose recomputed fingerprint differs is rejected - a
 * cursor from search A can never be replayed to widen or change search B.
 *
 * <p><b>Boundary dedup keys.</b> {@link #eventFingerprint} is a second,
 * separate, non-cryptographic content fingerprint used only to recognize
 * "the exact same event, already returned" across a page boundary - see
 * {@link PageCursor}'s own javadoc for why that is necessary. It never
 * touches {@link CanonicalLogEvent#sensitive()}.
 *
 * <p>The boundary timestamp round-trips through the cursor as epoch
 * milliseconds ({@link PageCursorPayload}), not {@code java.time.Instant} -
 * deliberately, so this codec's correctness never depends on Jackson's
 * {@code JavaTimeModule} being registered on whatever {@code ObjectMapper}
 * is injected. Every timestamp {@link com.logexplorer.core.parse.LogLineParser}
 * produces already has at most millisecond precision (parsed from JSON
 * timestamp strings), so this loses no real information in practice.
 */
@Component
public class PageCursorCodec {

  private static final int VERSION = 1;
  private static final String HMAC_ALGORITHM = "HmacSHA256";
  private static final Base64.Encoder URL_ENCODER = Base64.getUrlEncoder().withoutPadding();
  private static final Base64.Decoder URL_DECODER = Base64.getUrlDecoder();

  private final ObjectMapper objectMapper;
  private final SecretKeySpec signingKey;

  public PageCursorCodec(ObjectMapper objectMapper) {
    this.objectMapper = objectMapper;
    byte[] keyBytes = new byte[32];
    new SecureRandom().nextBytes(keyBytes);
    this.signingKey = new SecretKeySpec(keyBytes, HMAC_ALGORITHM);
  }

  /**
   * Builds the next page's cursor from the request that just ran, the
   * timestamp of the oldest event on the page just returned ("boundary"),
   * and the fingerprints of every event on that page which shares that
   * exact timestamp ("boundary keys" - see {@link PageCursor}).
   */
  public String encode(SearchRequest request, Instant boundaryTimestamp, Set<String> boundaryKeys, int pageIndex) {
    PageCursorPayload payload = new PageCursorPayload(
        VERSION,
        request.sourceId(),
        boundaryTimestamp.toEpochMilli(),
        new TreeSet<>(boundaryKeys),
        request.direction().name(),
        pageIndex,
        requestFingerprint(request));
    byte[] payloadBytes = writePayload(payload);
    String payloadPart = URL_ENCODER.encodeToString(payloadBytes);
    String signaturePart = URL_ENCODER.encodeToString(hmac(payloadBytes));
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
    if (!payload.requestFingerprint().equals(requestFingerprint(request))) {
      throw invalid();
    }
    return new PageCursor(
        payload.version(), payload.sourceId(), Instant.ofEpochMilli(payload.boundaryEpochMillis()),
        Set.copyOf(payload.boundaryKeys()), payload.direction(), payload.pageIndex(), payload.requestFingerprint());
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
    byte[] expectedSignature = hmac(payloadBytes);
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
      // types (int/String/Instant/Set<String>) - this cannot happen in
      // practice, but never surface a raw Jackson exception (which could
      // echo field values) if it somehow did.
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
    return new GuardrailViolationException(Reason.INVALID_CURSOR, "The pagination cursor is invalid or expired");
  }

  /**
   * SHA-256 over every field that defines "what this search means" (see
   * class javadoc). Raw sensitive filter values are fed into the digest,
   * never stored verbatim anywhere in the cursor.
   */
  String requestFingerprint(SearchRequest r) {
    RawSensitiveFields sf = r.sensitiveFilters();
    String basis = String.join("",
        n(r.sourceId()), n(r.start()), n(r.end()), n(r.direction()), n(r.limit()),
        joinSorted(r.services()), joinSorted(r.levels()), n(r.text()),
        n(r.traceId()), n(r.spanId()), n(r.correlationId()), n(r.journeyId()), n(r.eventId()),
        n(r.errorCode()), n(r.businessStep()), n(r.uiIdentifier()), n(r.loggerContains()),
        n(r.devicePlatform()), n(r.language()), n(r.containerId()), n(r.pod()),
        n(sf.cif()), n(sf.userName()), n(sf.customerId()), n(sf.deviceId()), n(sf.deviceIp()),
        n(r.query()), n(r.rawLogQl()));
    return sha256Hex(basis);
  }

  /**
   * A stable, non-sensitive content fingerprint for one event - used only
   * to recognize an exact duplicate at a page boundary (see
   * {@link PageCursor}'s javadoc). Deliberately never reads {@link
   * CanonicalLogEvent#sensitive()}.
   */
  public static String eventFingerprint(CanonicalLogEvent e) {
    String basis = String.join("",
        n(e.sourceId()), n(e.containerId()), n(e.pod()), n(e.stream()), n(e.timestampRaw()),
        n(e.rawLine()), n(e.message()), n(e.logger()), n(e.thread()),
        n(e.traceId()), n(e.spanId()), n(e.correlationId()), n(e.journeyId()), n(e.eventId()));
    return sha256Hex(basis);
  }

  private static String joinSorted(List<String> values) {
    return values.stream().sorted().reduce((a, b) -> a + "," + b).orElse("");
  }

  private static String n(Object value) {
    return value == null ? " " : value.toString();
  }

  private static String sha256Hex(String input) {
    try {
      byte[] digest = MessageDigest.getInstance("SHA-256").digest(input.getBytes(StandardCharsets.UTF_8));
      StringBuilder hex = new StringBuilder(digest.length * 2);
      for (byte b : digest) {
        hex.append(String.format("%02x", b));
      }
      return hex.toString();
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException("SHA-256 not available", e);
    }
  }
}
