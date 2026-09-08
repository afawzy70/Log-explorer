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
 * <p>Masking rules (HANDOVER.md §6.1):
 * <ul>
 *   <li>{@code cif} — strongly masked: a fixed-length mask, never reveals length.</li>
 *   <li>{@code customerId}, {@code userName}, {@code deviceId} — partially masked:
 *       first two and last two characters shown, middle replaced; fully masked
 *       if too short to partially reveal safely.</li>
 *   <li>{@code deviceIp} — final portion masked, for both IPv4 and IPv6.</li>
 * </ul>
 * {@code null} (no value) and {@code ""} (present but empty) are both
 * preserved as-is — neither is treated as something to mask.
 */
@Service
public class MaskingService {

  private static final String STRONG_MASK = "****";
  private static final int PARTIAL_MIN_LENGTH = 5; // below this, nothing safe to reveal

  public MaskedSensitiveFields mask(CanonicalLogEvent event) {
    RawSensitiveFields raw = event.sensitive();
    return new MaskedSensitiveFields(
        maskStrong(raw.cif()),
        maskPartial(raw.userName()),
        maskPartial(raw.customerId()),
        maskPartial(raw.deviceId()),
        maskIp(raw.deviceIp()));
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
