package com.logexplorer.core.mask;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.RawSensitiveFields;
import java.util.Iterator;
import java.util.Map;
import java.util.Objects;
import org.springframework.beans.factory.annotation.Autowired;
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
  /** Owner report — "raw JSON" fallback marker for a key-name match this event's own mapping never resolved a value for (see {@link #maskRawJson}). */
  private static final String UNMAPPED_SENSITIVE_MASK = "[REDACTED]";
  /** Bounds the raw-JSON tree walk against a pathological/adversarial depth of nesting (CLAUDE.md §4 "Bounds") — ordinary log JSON is 1-3 levels deep. */
  private static final int MAX_RAW_JSON_MASK_DEPTH = 25;

  /** Key names (case-insensitive, `_`/`-` ignored) treated as holding one of the five protected fields wherever they appear in a raw JSON tree, regardless of whether the active field-mapping profile also resolves them — see {@link #maskRawJson}'s own javadoc for why this cannot rely on the resolved value alone. */
  private static final Map<String, ProtectedField> SENSITIVE_JSON_KEY_ALIASES = Map.of(
      "cif", ProtectedField.CIF,
      "username", ProtectedField.USER_NAME,
      "customerid", ProtectedField.CUSTOMER_ID,
      "deviceid", ProtectedField.DEVICE_ID,
      "deviceip", ProtectedField.DEVICE_IP);

  private final MaskingPolicyService policy;
  private final ObjectMapper objectMapper;
  private final TextRedactor textRedactor;

  /** Convenience constructor for unit tests that don't care about raw-JSON masking specifics — real Spring wiring always uses the three-arg constructor below, reusing the app's configured {@link ObjectMapper} bean. */
  public MaskingService(MaskingPolicyService policy) {
    this(policy, new ObjectMapper(), new TextRedactor());
  }

  @Autowired
  public MaskingService(MaskingPolicyService policy, ObjectMapper objectMapper, TextRedactor textRedactor) {
    this.policy = policy;
    this.objectMapper = objectMapper;
    this.textRedactor = textRedactor;
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

  /**
   * Owner report — the Inspector's existing "Canonical Event JSON"
   * disclosure ({@code AllFieldsSection.tsx}) is a re-serialization of this
   * app's own already-parsed/masked DTO, not the untouched line the source
   * actually sent; the owner asked to see the real thing to spot field-
   * mapping bugs (a wrong path, an unexpected extra field, a missing one)
   * more easily than a reconstructed view ever could. This produces a
   * SAFE rendering of {@link CanonicalLogEvent#originalRawJson()} — the
   * exact, untouched source line/JSON this event was parsed from, for
   * EVERY event, not just malformed ones — suitable to add to {@code
   * api.dto.EventDto} (unlike {@code originalRawJson} itself, which an
   * ArchUnit-enforced boundary keeps out of that DTO entirely; see that
   * field's own javadoc). Three layers, each independently sufficient for
   * the case it covers:
   *
   * <ol>
   *   <li>Whole-string exact-value substitution ({@link #maskOccurrences}) —
   *       catches this event's own resolved protected values wherever they
   *       literally appear in the source text, even under a different key
   *       than the one the active mapping profile actually used, and can
   *       never corrupt JSON syntax (a value swap between two quotes stays
   *       valid JSON).</li>
   *   <li>Key-name-driven tree walk ({@link #maskSensitiveByKeyName}) —
   *       the case (1) alone cannot cover: a field the active mapping
   *       profile never resolved at all (so {@link CanonicalLogEvent#sensitive()}
   *       has no value for it to substitute) still gets masked here, purely
   *       from its JSON key looking like one of the five protected fields
   *       — precisely the "the mapping missed a sensitive field" bug this
   *       feature exists to help surface, which must never mean the raw
   *       value leaks instead. Still respects the same per-field policy
   *       {@link #mask} does: a field whose policy is currently unmasked is
   *       left as the real value here too, exactly like everywhere else in
   *       the app that field appears unmasked by explicit owner choice.</li>
   *   <li>Per-leaf free-text scan ({@link TextRedactor#redact}) — the same
   *       narrower, high-confidence patterns (Bearer tokens, card numbers,
   *       labeled secrets/emails/IPs) already applied to every other
   *       free-text field this class's caller exposes, run against each
   *       remaining string leaf's own content only — never the surrounding
   *       JSON syntax, so it cannot mangle the structure the way running it
   *       over the whole raw string would (see this method's own tests for
   *       why that whole-string approach was rejected).</li>
   * </ol>
   *
   * <p>Falls back to treating the input as free text (layers 1 and 3 only —
   * there is no JSON structure for layer 2 to walk) whenever the source
   * text isn't a parseable JSON object/array at all, which is always true
   * for a malformed event ({@code originalRawJson} equals {@code rawLine}
   * for those) and possible even for a non-malformed one if a future
   * source ever populates it with something else. {@code null}/empty input
   * is returned unchanged.
   */
  public String maskRawJson(CanonicalLogEvent event) {
    String raw = event.originalRawJson();
    if (raw == null || raw.isEmpty()) {
      return raw;
    }
    String valueMasked = maskOccurrences(event, raw);
    JsonNode tree;
    try {
      tree = objectMapper.readTree(valueMasked);
    } catch (Exception e) {
      return textRedactor.redact(valueMasked);
    }
    if (tree == null || !(tree.isObject() || tree.isArray())) {
      return textRedactor.redact(valueMasked);
    }
    maskSensitiveByKeyName(tree, event, 0);
    try {
      return objectMapper.writeValueAsString(tree);
    } catch (Exception e) {
      return textRedactor.redact(valueMasked);
    }
  }

  /**
   * Mutates {@code node} in place: for every object field whose name,
   * normalized (lower-cased, {@code _}/{@code -} stripped), matches {@link
   * #SENSITIVE_JSON_KEY_ALIASES}, replaces a string value per the field's
   * current policy (the real value if unmasked, the SAME masked form
   * {@link #mask} would produce if the value is this event's own already-
   * resolved raw value for that field so both stay visually consistent, or
   * else a flat {@link #UNMAPPED_SENSITIVE_MASK} for a masked field whose
   * value the active profile never resolved at all — never the real value
   * in that case). Every other string leaf, matched or not, additionally
   * gets {@link TextRedactor#redact}, and every array/object element is
   * recursed into up to {@link #MAX_RAW_JSON_MASK_DEPTH}.
   */
  private void maskSensitiveByKeyName(JsonNode node, CanonicalLogEvent event, int depth) {
    if (depth >= MAX_RAW_JSON_MASK_DEPTH) {
      return;
    }
    if (node.isObject()) {
      ObjectNode object = (ObjectNode) node;
      RawSensitiveFields raw = event.sensitive();
      MaskedSensitiveFields masked = mask(event);
      Iterator<Map.Entry<String, JsonNode>> fields = object.fields();
      while (fields.hasNext()) {
        Map.Entry<String, JsonNode> field = fields.next();
        JsonNode value = field.getValue();
        if (!value.isTextual()) {
          if (value.isObject() || value.isArray()) {
            maskSensitiveByKeyName(value, event, depth + 1);
          }
          continue;
        }
        ProtectedField sensitiveField = SENSITIVE_JSON_KEY_ALIASES.get(normalizeKey(field.getKey()));
        if (sensitiveField == null) {
          object.put(field.getKey(), textRedactor.redact(value.textValue()));
          continue;
        }
        if (!policy.isMasked(sensitiveField)) {
          // Owner-configured unmasked: the real value is shown everywhere
          // else this field appears too - stay consistent, but still run
          // the free-text scan (an unmasked CIF value is still not a
          // bearer token or card number, so this is always safe/idempotent).
          object.put(field.getKey(), textRedactor.redact(value.textValue()));
          continue;
        }
        object.put(field.getKey(), maskedFormFor(sensitiveField, value.textValue(), raw, masked));
      }
    } else if (node.isArray()) {
      ArrayNode array = (ArrayNode) node;
      for (int i = 0; i < array.size(); i++) {
        JsonNode element = array.get(i);
        if (element.isObject() || element.isArray()) {
          maskSensitiveByKeyName(element, event, depth + 1);
        } else if (element.isTextual()) {
          array.set(i, objectMapper.getNodeFactory().textNode(textRedactor.redact(element.textValue())));
        }
      }
    }
  }

  private String maskedFormFor(ProtectedField field, String actualValue, RawSensitiveFields raw, MaskedSensitiveFields masked) {
    String resolvedMasked = switch (field) {
      case CIF -> masked.cif();
      case USER_NAME -> masked.userName();
      case CUSTOMER_ID -> masked.customerId();
      case DEVICE_ID -> masked.deviceId();
      case DEVICE_IP -> masked.deviceIp();
    };
    // Layer 1 (maskOccurrences, run over the whole raw string before this
    // tree walk even starts) already replaced this exact resolved value
    // wherever it appeared - if that is what is sitting at this key right
    // now, it is already correctly masked and must not be re-processed
    // into the flatter UNMAPPED_SENSITIVE_MASK below.
    if (actualValue.equals(resolvedMasked)) {
      return actualValue;
    }
    String resolvedRaw = switch (field) {
      case CIF -> raw.cif();
      case USER_NAME -> raw.userName();
      case CUSTOMER_ID -> raw.customerId();
      case DEVICE_ID -> raw.deviceId();
      case DEVICE_IP -> raw.deviceIp();
    };
    if (actualValue.equals(resolvedRaw)) {
      // Defensive fallback only - layer 1 should already have caught this
      // (a resolved raw value shorter than 3 characters is the one case
      // replaceAll's own guard deliberately skips).
      return resolvedMasked == null ? UNMAPPED_SENSITIVE_MASK : resolvedMasked;
    }
    // A key-name match whose value is neither the raw value nor the
    // already-masked value this event's own mapping resolved for that
    // field - either genuinely different data under a coincidentally-
    // similar key, or exactly the "mapping missed it" case this method
    // exists to guard. Either way, a flat redaction marker is the only
    // safe choice: there is no validated field boundary to apply a
    // field-specific partial-mask style to.
    return UNMAPPED_SENSITIVE_MASK;
  }

  private static String normalizeKey(String key) {
    return key.toLowerCase(java.util.Locale.ROOT).replace("_", "").replace("-", "");
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
