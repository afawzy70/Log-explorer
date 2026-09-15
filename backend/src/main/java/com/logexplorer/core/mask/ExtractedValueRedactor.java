package com.logexplorer.core.mask;

import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.ExtractedField;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

/**
 * The masking boundary for classification output: every extracted value
 * and every rule-test/detection preview value passes through here before a
 * browser can see it. Extends the existing server-side protections instead
 * of replacing them:
 *
 * <ol>
 *   <li>values of extraction definitions marked {@code sensitive}, or whose
 *       name/label is credential-like (authorization, cookie, token,
 *       secret, password, api key, session id, ...), are never shown —
 *       {@code [REDACTED]} only;
 *   <li>credential headers are redacted wherever they appear in the text —
 *       {@code Authorization}, {@code Proxy-Authorization}, {@code Cookie},
 *       {@code Set-Cookie}, and common API-key/token headers — both as
 *       {@code Name: value} header text and as JSON properties;
 *   <li>this event's own protected identifiers (CIF, username, customer
 *       ID, device ID, device IP) are replaced with their masked form when
 *       the masking policy masks them ({@link MaskingService#maskOccurrences});
 *   <li>the existing {@link TextRedactor} (bearer/basic credentials, secret
 *       key-values, contextual identifiers, JWTs, card numbers).
 * </ol>
 *
 * <p>All patterns here are fixed, server-authored, and use possessive
 * quantifiers — never user-supplied.
 */
@Component
public class ExtractedValueRedactor {

  public static final String REDACTED = "[REDACTED]";

  private static final Pattern CREDENTIAL_NAME = Pattern.compile(
      "(?i)(authori[sz]ation|cookie|password|passwd|pwd|secret|token|api[-_ ]?key|credential|session[-_ ]?id|jsessionid"
          + "|private[-_ ]?key)");

  private static final String HEADER_NAMES = "proxy-authorization|authorization|set-cookie|cookie|x-api-key|api-key"
      + "|apikey|x-auth-token|x-access-token|x-refresh-token|x-csrf-token|x-xsrf-token|x-amz-security-token";

  private static final Pattern JSON_CREDENTIAL = Pattern.compile(
      "(?i)(\"(?:" + HEADER_NAMES + "|access_token|refresh_token|id_token|password|client_secret|token|secret)\"\\s*+:\\s*+)"
          + "(\"(?:[^\"\\\\]++|\\\\.)*+\"|[^,}\\]\\s]++)");

  private static final Pattern HEADER_VALUE = Pattern.compile(
      "(?i)(?<![A-Za-z0-9-])(" + HEADER_NAMES + ")(\\s*+[:=]\\s*+)(?!\\[REDACTED)([^,}\\]\\r\\n\"]++)");

  private final MaskingService maskingService;
  private final TextRedactor textRedactor;

  public ExtractedValueRedactor(MaskingService maskingService, TextRedactor textRedactor) {
    this.maskingService = maskingService;
    this.textRedactor = textRedactor;
  }

  /** A value ready for a browser, with whether redaction changed it and whether it was cut to the length limit. */
  public record Presented(String value, boolean redacted, boolean truncated) {
  }

  public Presented present(CanonicalLogEvent event, ExtractedField field, int maxLength) {
    if (field == null || field.status() != ExtractedField.Status.PRESENT || field.value() == null) {
      return new Presented(null, false, false);
    }
    if (field.sensitive() || isCredentialName(field.name()) || isCredentialName(field.label())) {
      return new Presented(REDACTED, true, false);
    }
    String redacted = redactText(event, field.value());
    return truncate(redacted, !redacted.equals(field.value()), maxLength);
  }

  /** Redacts free text taken from an event (for previews), then cuts it to {@code maxLength}. */
  public Presented presentText(CanonicalLogEvent event, String value, int maxLength) {
    if (value == null) {
      return new Presented(null, false, false);
    }
    String redacted = redactText(event, value);
    return truncate(redacted, !redacted.equals(value), maxLength);
  }

  public String redactText(CanonicalLogEvent event, String value) {
    if (value == null || value.isEmpty()) {
      return value;
    }
    String result = JSON_CREDENTIAL.matcher(value).replaceAll("$1\"" + REDACTED + "\"");
    result = HEADER_VALUE.matcher(result).replaceAll("$1$2" + REDACTED);
    if (event != null) {
      result = maskingService.maskOccurrences(event, result);
    }
    return textRedactor.redact(result);
  }

  public boolean isCredentialName(String name) {
    return name != null && CREDENTIAL_NAME.matcher(name).find();
  }

  private static Presented truncate(String value, boolean redacted, int maxLength) {
    if (value.length() <= maxLength) {
      return new Presented(value, redacted, false);
    }
    return new Presented(value.substring(0, maxLength), redacted, true);
  }
}
