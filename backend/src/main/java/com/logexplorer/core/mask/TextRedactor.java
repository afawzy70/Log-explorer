package com.logexplorer.core.mask;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Function;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

/**
 * Legacy Remediation Slice 7 — conservative, high-confidence free-text
 * redaction (see {@code docs/verification/LEGACY_REMEDIATION_SLICE_7_REPORT.md}).
 *
 * <p><b>This is NOT a general-purpose DLP engine.</b> {@link MaskingService}
 * already masks the five named structured sensitive fields
 * (cif/UserName/CustomerId/deviceId/deviceIp); this class addresses the
 * separate, narrower gap of similar-looking values appearing inside
 * unstructured free text (a log message, an exception/stack-trace string,
 * a malformed raw line, or an unknown field's string value) — patterns a
 * developer might type by hand, never a scan for arbitrary secrets.
 *
 * <p><b>Pipeline (fixed order, five sequential passes)</b>: Bearer/Basic
 * authorization header values → labeled auth/secret key=value pairs →
 * contextual identifier key=value pairs (customer/user/device/IP/email
 * aliases) → standalone JWT-shaped tokens (never label-prefixed ones,
 * already consumed by the Bearer pass) → Luhn-validated card-like numbers.
 * Order matters only in that Bearer/secret/identifier passes run before
 * the standalone-JWT pass, so a labeled "Bearer &lt;jwt&gt;" is redacted as one
 * unit ("Bearer [REDACTED]") rather than twice.
 *
 * <p><b>Markers</b> — exactly three, deterministic, never carrying length
 * or a hash of the original value: {@code [REDACTED]} (every label=value
 * redaction — contextual identifiers, email, auth secrets, Bearer/Basic),
 * {@code [REDACTED_CARD]} (a Luhn-valid card-like number), {@code
 * [REDACTED_TOKEN]} (a standalone, unlabeled JWT-shaped token).
 *
 * <p><b>Idempotence</b>: every marker is stable under re-redaction — none
 * of the five patterns can ever match a string already containing only a
 * marker (no digit run for the card pattern, no dot for the JWT pattern,
 * and a labeled value of exactly {@code [REDACTED]} simply reproduces the
 * same {@code label=[REDACTED]} output on a second pass). Covered by
 * dedicated idempotence tests.
 *
 * <p><b>Performance</b>: every {@link Pattern} is compiled exactly once, as
 * a {@code static final} field, at class-load time — never per call, never
 * per event. Each pass short-circuits to the original string reference
 * (zero allocation) when its pattern finds no match, which is the common
 * case for the overwhelming majority of ordinary log text. No pattern uses
 * nested variable-length quantifiers, so none is vulnerable to catastrophic
 * backtracking. See {@code TextRedactorPerformanceTest} and
 * {@code docs/verification/SLICE_7_REDACTION_PERFORMANCE_REPORT.md}.
 *
 * <p><b>Scope decisions</b> (documented here, not just in the report):
 * <ul>
 *   <li>No blanket email redaction — only when explicitly labeled
 *       ({@code email}/{@code userEmail}/{@code customerEmail}/...). An
 *       unlabeled email mentioned for legitimate operational reasons (e.g.
 *       "contact support@example.com") is left untouched.</li>
 *   <li>No blanket IP redaction — only when explicitly labeled as a
 *       user/device/client IP ({@code deviceIp}/{@code clientIp}/{@code
 *       customerIp}/{@code userIp} and separator variants). {@code
 *       serverIp}/{@code serverHost} are dedicated structured fields on
 *       {@code CanonicalLogEvent}, never touched by this free-text scan at
 *       all — server/source infrastructure IPs remain visible, matching
 *       the mission's own "server IPs may be valuable operational
 *       evidence" instruction.</li>
 *   <li>No bare/unlabeled "token="/"secret=" catch-all beyond the mission's
 *       own explicit 8-item label list (password, passwd, pwd,
 *       client_secret, api_key, apikey, access_token, refresh_token) — a
 *       broader generic label would risk exactly the false-positive
 *       destructiveness the mission explicitly forbids.</li>
 *   <li>Patterns are fixed, compiled-once constants — not externally
 *       configurable in this slice. A configurable pattern set would let a
 *       future misconfiguration reintroduce a catastrophic-backtracking
 *       risk; a small fixed conservative set is safer and simpler.</li>
 * </ul>
 */
@Component
public class TextRedactor {

  private static final String REDACTED = "[REDACTED]";
  private static final String REDACTED_CARD = "[REDACTED_CARD]";
  private static final String REDACTED_TOKEN = "[REDACTED_TOKEN]";

  /**
   * Section 1 + 5 + 6 — CIF/customerId/username/deviceId aliases, plus IP
   * aliases scoped to user/device/client context (never bare "ip"), plus
   * email aliases (labeled-only, conservative policy — see class javadoc).
   */
  private static final String CONTEXTUAL_ID_LABELS = String.join("|",
      "CIF",
      "customerId", "customer_id", "customer-id",
      "username", "user_name",
      "deviceId", "device_id", "device-id",
      "deviceIp", "device_ip", "device-ip",
      "clientIp", "client_ip", "client-ip",
      "customerIp", "customer_ip", "customer-ip",
      "userIp", "user_ip", "user-ip",
      "email", "userEmail", "user_email", "customerEmail", "customer_email", "accountEmail", "account_email");

  /**
   * A label, then a value in one of four shapes: {@code label=value},
   * {@code label: "value"}, {@code "label":"value"} (a quoted JSON key -
   * the optional {@code "?} right after the label consumes the key's own
   * closing quote), {@code label [value]}, or a bare {@code label value}
   * with no separator at all (only when the value itself contains a
   * digit, e.g. "CIF 99887766 failed authentication" - the digit
   * requirement keeps ordinary prose like "username is required" from
   * ever being mistaken for a value). Only the label is captured - the
   * exact value never needs to be, since every replacement is the fixed
   * marker. The value char class deliberately does NOT exclude {@code [}/
   * {@code ]} - excluding them would break idempotence, since a
   * previously-redacted "label=[REDACTED]" must itself be re-captured as
   * a stable fixed point on a second pass.
   */
  private static final Pattern CONTEXTUAL_ID_PATTERN = Pattern.compile(
      "\\b(" + CONTEXTUAL_ID_LABELS + ")\\b\"?\\s*(?:"
          + "[:=]\\s*\"?[^\\s,;\"]{1,64}\"?"
          + "|\\[[^\\]]{1,64}\\]"
          + "|\\s+(?=\\S*\\d)[^\\s,;\"\\[\\]{}]{2,64}"
          + ")",
      Pattern.CASE_INSENSITIVE);

  /** Section 3 — the mission's own explicit 8-alias list, deliberately not broadened (see class javadoc). Values may be much longer than an identifier (a real token/secret). */
  private static final String SECRET_LABELS = String.join("|",
      "password", "passwd", "pwd", "client_secret", "api_key", "apikey", "access_token", "refresh_token");

  private static final Pattern SECRET_KV_PATTERN = Pattern.compile(
      "\\b(" + SECRET_LABELS + ")\\b\\s*[:=]\\s*\"?[^\\s,;\"]{1,512}\"?",
      Pattern.CASE_INSENSITIVE);

  /** Section 3 — "Authorization: Bearer ..."/"Basic ..." - the label itself (word 1) is preserved verbatim in the output, matching the mission's own literal example "Authorization: Bearer [REDACTED]". */
  private static final Pattern BEARER_BASIC_PATTERN = Pattern.compile(
      "\\b(Bearer|Basic)\\s+[A-Za-z0-9\\-_.+/=]{8,}",
      Pattern.CASE_INSENSITIVE);

  /**
   * Section 4 — a standalone (unlabeled) JWT-shaped token: exactly three
   * base64url segments, each at least 10 characters (real JWT
   * header/payload/signature segments are always well over this in
   * practice; short segments are far more likely a version string or a
   * dotted package/class name than a real token - conservative by
   * design). The boundary lookaround on both sides also excludes a 4th
   * adjacent dot-segment, so a longer dotted chain (e.g. a fully-qualified
   * class name with 4+ segments) never partially matches. Runs after the
   * Bearer/Basic pass, so a "Bearer &lt;jwt&gt;" is already fully consumed by
   * then and this only ever fires on a genuinely unlabeled token.
   */
  private static final Pattern JWT_PATTERN = Pattern.compile(
      "(?<![A-Za-z0-9_.+/=-])[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}(?![A-Za-z0-9_.+/=-])");

  /**
   * Section 2 — a plausible card-number candidate: a digit, then 11-18
   * more digits each optionally preceded by a single space or hyphen
   * (common PAN grouping), bounded on both sides so it can never match
   * inside a longer alphanumeric token (a UUID/hex trace ID fragment).
   * This alone only bounds the RAW match to 12-19 digits - {@link
   * #redactCards} additionally requires the stripped digit count to be
   * 13-19 (the real PAN range) and a passing Luhn check before ever
   * replacing anything; an invalid candidate is left completely
   * untouched, verbatim.
   */
  private static final Pattern CARD_CANDIDATE_PATTERN = Pattern.compile(
      "(?<![A-Za-z0-9])(\\d(?:[ -]?\\d){11,18})(?![A-Za-z0-9])");

  private static final int CARD_MIN_DIGITS = 13;
  private static final int CARD_MAX_DIGITS = 19;

  /**
   * Redacts every high-confidence sensitive pattern found in {@code text}.
   * {@code null}/empty input is returned unchanged (nothing to scan).
   * Returns the exact same string reference when nothing matched at all -
   * the overwhelmingly common case - so this never allocates for ordinary,
   * non-sensitive log text.
   */
  public String redact(String text) {
    if (text == null || text.isEmpty()) {
      return text;
    }
    String result = text;
    result = applyLabeled(BEARER_BASIC_PATTERN, result, m -> m.group(1) + " " + REDACTED);
    result = applyLabeled(SECRET_KV_PATTERN, result, m -> m.group(1) + "=" + REDACTED);
    result = applyLabeled(CONTEXTUAL_ID_PATTERN, result, m -> m.group(1) + "=" + REDACTED);
    result = applyLabeled(JWT_PATTERN, result, m -> REDACTED_TOKEN);
    result = redactCards(result);
    return result;
  }

  /**
   * Section 9 — unknown/custom fields. Deliberately bounded to depth 0:
   * only immediate {@code String}-typed values are scanned; any other
   * value shape (number, boolean, nested map, list) is left completely
   * untouched, no recursion at all. This is the safest possible reading
   * of "bounded recursion depth OR known canonical string-bearing fields"
   * - zero additional depth beyond what is already known to be a string.
   */
  public Map<String, Object> redactStringValues(Map<String, Object> fields) {
    if (fields == null || fields.isEmpty()) {
      return fields;
    }
    Map<String, Object> result = new LinkedHashMap<>(fields.size());
    boolean changed = false;
    for (Map.Entry<String, Object> entry : fields.entrySet()) {
      Object value = entry.getValue();
      if (value instanceof String s) {
        String redacted = redact(s);
        result.put(entry.getKey(), redacted);
        changed = changed || redacted != s;
      } else {
        result.put(entry.getKey(), value);
      }
    }
    // Preserve the original map instance when nothing changed - same
    // zero-allocation-on-the-common-path discipline as redact() itself.
    return changed ? result : fields;
  }

  private String applyLabeled(Pattern pattern, String input, Function<Matcher, String> replacer) {
    Matcher matcher = pattern.matcher(input);
    if (!matcher.find()) {
      return input;
    }
    StringBuilder sb = new StringBuilder(input.length());
    int lastEnd = 0;
    do {
      sb.append(input, lastEnd, matcher.start());
      sb.append(replacer.apply(matcher));
      lastEnd = matcher.end();
    } while (matcher.find());
    sb.append(input, lastEnd, input.length());
    return sb.toString();
  }

  private String redactCards(String input) {
    Matcher matcher = CARD_CANDIDATE_PATTERN.matcher(input);
    if (!matcher.find()) {
      return input;
    }
    StringBuilder sb = new StringBuilder(input.length());
    int lastEnd = 0;
    do {
      String candidate = matcher.group(1);
      sb.append(input, lastEnd, matcher.start());
      sb.append(isValidCard(candidate) ? REDACTED_CARD : candidate);
      lastEnd = matcher.end();
    } while (matcher.find());
    sb.append(input, lastEnd, input.length());
    return sb.toString();
  }

  private boolean isValidCard(String candidate) {
    StringBuilder digitsOnly = new StringBuilder(candidate.length());
    for (int i = 0; i < candidate.length(); i++) {
      char c = candidate.charAt(i);
      if (c >= '0' && c <= '9') {
        digitsOnly.append(c);
      }
    }
    int length = digitsOnly.length();
    if (length < CARD_MIN_DIGITS || length > CARD_MAX_DIGITS) {
      return false;
    }
    return passesLuhn(digitsOnly);
  }

  /** Standard Luhn checksum, applied right to left over digits-only input. */
  private boolean passesLuhn(CharSequence digits) {
    int sum = 0;
    boolean doubleDigit = false;
    for (int i = digits.length() - 1; i >= 0; i--) {
      int digit = digits.charAt(i) - '0';
      if (doubleDigit) {
        digit *= 2;
        if (digit > 9) {
          digit -= 9;
        }
      }
      sum += digit;
      doubleDigit = !doubleDigit;
    }
    return sum % 10 == 0;
  }
}
