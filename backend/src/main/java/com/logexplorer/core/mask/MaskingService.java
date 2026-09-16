package com.logexplorer.core.mask;

import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.RawSensitiveFields;
import org.springframework.stereotype.Service;

/**
 * The single masking boundary (CLAUDE.md §2 rule 1, HANDOVER.md §6.1).
 *
 * <p>{@code mask(CanonicalLogEvent)} is the only entry point — it extracts
 * {@link RawSensitiveFields} from the event internally, so callers in the
 * {@code api} package never need to name or import that type themselves
 * (see the {@code arch} test package for the rule this enables).
 *
 * <p>Masking rules (HANDOVER.md §6.1) — applied only when {@link
 * MaskingPolicyService} says the field is currently masked (pre-closure
 * functional recovery §12: masked by default, individually configurable):
 * <ul>
 *   <li>{@code cif} — strongly masked: a fixed-length mask, never reveals length.</li>
 *   <li>{@code customerId}, {@code userName}, {@code deviceId} — partially masked:
 *       first two and last two characters shown, middle replaced; fully masked
 *       if too short to partially reveal safely.</li>
 *   <li>{@code deviceIp} — final portion masked, for both IPv4 and IPv6.</li>
 * </ul>
 * {@code null} (no value) and {@code ""} (present but empty) are both
 * preserved as-is — neither is treated as something to mask, and the
 * policy is never even consulted for them (nothing to reveal either way).
 *
 * <p>When a field's policy says unmasked, the RAW value is returned as-is
 * — this is the one, single, server-side place that decision is made
 * (§16: "Masking must remain server-side... If explicitly configured as
 * unmasked, the server may return the raw value"). The ArchUnit rule that
 * only this class may read {@link RawSensitiveFields} is unchanged by
 * this — the policy check happens entirely inside this same boundary.
 */
@Service
public class MaskingService {

  private static final String STRONG_MASK = "****";
  private static final int PARTIAL_MIN_LENGTH = 5; // below this, nothing safe to reveal

  private final MaskingPolicyService policy;

  public MaskingService(MaskingPolicyService policy) {
    this.policy = policy;
  }

  public MaskedSensitiveFields mask(CanonicalLogEvent event) {
    RawSensitiveFields raw = event.sensitive();
    return new MaskedSensitiveFields(
        policy.isMasked(ProtectedField.CIF) ? maskStrong(raw.cif()) : raw.cif(),
        policy.isMasked(ProtectedField.USER_NAME) ? maskPartial(raw.userName()) : raw.userName(),
        policy.isMasked(ProtectedField.CUSTOMER_ID) ? maskPartial(raw.customerId()) : raw.customerId(),
        policy.isMasked(ProtectedField.DEVICE_ID) ? maskPartial(raw.deviceId()) : raw.deviceId(),
        policy.isMasked(ProtectedField.DEVICE_IP) ? maskIp(raw.deviceIp()) : raw.deviceIp());
  }

  /**
   * Owner mission "Event Classification, Extraction, and Portable Rules" —
   * replaces every occurrence of this event's own raw protected values
   * inside free text (for example a classification rule's extracted request
   * body) with the same masked form {@link #mask} produces, whenever the
   * current policy masks that field. Values shorter than 3 characters are
   * left alone to avoid corrupting unrelated text.
   */
  public String maskOccurrences(CanonicalLogEvent event, String text) {
    if (text == null || text.isEmpty()) {
      return text;
    }
    RawSensitiveFields raw = event.sensitive();
    MaskedSensitiveFields masked = mask(event);
    String result = text;
    result = replaceAll(result, raw.cif(), masked.cif());
    result = replaceAll(result, raw.userName(), masked.userName());
    result = replaceAll(result, raw.customerId(), masked.customerId());
    result = replaceAll(result, raw.deviceId(), masked.deviceId());
    result = replaceAll(result, raw.deviceIp(), masked.deviceIp());
    return result;
  }

  private static String replaceAll(String text, String rawValue, String maskedValue) {
    if (rawValue == null || rawValue.length() < 3 || rawValue.equals(maskedValue)) {
      return text;
    }
    return text.replace(rawValue, maskedValue == null ? STRONG_MASK : maskedValue);
  }

  private String maskStrong(String value) {
    if (value == null || value.isEmpty()) {
      return value;
    }
    return STRONG_MASK;
  }

  private String maskPartial(String value) {
    if (value == null || value.isEmpty()) {
      return value;
    }
    if (value.length() < PARTIAL_MIN_LENGTH) {
      return STRONG_MASK;
    }
    return value.substring(0, 2) + "***" + value.substring(value.length() - 2);
  }

  private String maskIp(String value) {
    if (value == null || value.isEmpty()) {
      return value;
    }
    if (value.contains(".")) {
      return maskIpv4(value);
    }
    if (value.contains(":")) {
      return maskIpv6(value);
    }
    // Not a shape we recognize as an IP at all — never return the raw value.
    return maskPartial(value);
  }

  private String maskIpv4(String value) {
    String[] parts = value.split("\\.", -1);
    if (parts.length != 4) {
      return maskPartial(value);
    }
    parts[3] = "***";
    return String.join(".", parts);
  }

  private String maskIpv6(String value) {
    String[] parts = value.split(":", -1);
    int lastNonEmpty = -1;
    for (int i = parts.length - 1; i >= 0; i--) {
      if (!parts[i].isEmpty()) {
        lastNonEmpty = i;
        break;
      }
    }
    if (lastNonEmpty == -1) {
      return STRONG_MASK;
    }
    parts[lastNonEmpty] = "****";
    return String.join(":", parts);
  }
}
