package com.logexplorer.core.mapping;

import java.util.EnumMap;
import java.util.List;
import java.util.Map;

/**
 * Resolves every {@link CanonicalField} for one raw source event against a
 * {@link FieldMappingProfile} (mission §10: ordered candidate precedence,
 * "first usable non-null value wins").
 *
 * <p><b>Precedence rule</b> — for a field with candidates {@code [c0, c1,
 * ..., cN]}: try {@code c0..cN-1} in order, returning the first one that
 * resolves to a non-null, non-empty string; if none of those qualify,
 * return whatever the <em>last</em> candidate {@code cN} resolves to,
 * as-is — {@code null} if absent, or an empty string if the value is
 * genuinely present but empty. This is not an arbitrary choice: it is the
 * exact generalization of {@code core.parse.LogLineParser}'s two pre-existing
 * precedence behaviors, verified equivalent for both:
 * <ul>
 *   <li>A single-candidate field (every field except Correlation ID in the
 *       built-in default profile) — the one candidate is always "last," so
 *       its value is always returned as-is, exactly matching the old
 *       {@code asString(mdc.get(x))} behavior (including preserving an
 *       explicit empty string rather than treating it as absent).</li>
 *   <li>Correlation ID's two-candidate precedence — {@code
 *       resolveCorrelationId} skipped the header key only if null-or-empty,
 *       then returned the literal-dotted-key fallback unconditionally
 *       (even if that, too, was empty) — exactly this rule with N=2.</li>
 * </ul>
 * A zero-candidate field (e.g. {@link CanonicalField#JOURNEY_NAME} in the
 * built-in default) always resolves to {@code null}.
 */
public final class FieldMappingResolver {

  private FieldMappingResolver() {
  }

  /** Resolves every canonical field for this one event's already-parsed JSON root. */
  public static Map<CanonicalField, String> resolveAll(Map<String, Object> root, FieldMappingProfile profile) {
    Map<CanonicalField, String> resolved = new EnumMap<>(CanonicalField.class);
    for (CanonicalField field : CanonicalField.values()) {
      resolved.put(field, resolve(root, profile.candidates(field)));
    }
    return resolved;
  }

  /** Resolves one canonical field's value given its ordered candidate list. */
  public static String resolve(Map<String, Object> root, List<JsonPath> candidates) {
    if (candidates == null || candidates.isEmpty()) {
      return null;
    }
    for (int i = 0; i < candidates.size() - 1; i++) {
      String value = JsonPathResolver.resolveAsString(root, candidates.get(i));
      if (value != null && !value.isEmpty()) {
        return value;
      }
    }
    return JsonPathResolver.resolveAsString(root, candidates.get(candidates.size() - 1));
  }

  /**
   * Like {@link #resolve}, but also reports which candidate (if any)
   * actually supplied the value — used by the mapping validation preview
   * (mission §16) to show the user exactly which path won.
   */
  public static ResolvedField resolveWithProvenance(Map<String, Object> root, List<JsonPath> candidates) {
    if (candidates == null || candidates.isEmpty()) {
      return new ResolvedField(null, null);
    }
    for (int i = 0; i < candidates.size() - 1; i++) {
      JsonPath candidate = candidates.get(i);
      String value = JsonPathResolver.resolveAsString(root, candidate);
      if (value != null && !value.isEmpty()) {
        return new ResolvedField(value, candidate);
      }
    }
    JsonPath last = candidates.get(candidates.size() - 1);
    String value = JsonPathResolver.resolveAsString(root, last);
    return new ResolvedField(value, value != null ? last : null);
  }

  /** @param value the resolved value (may be null/empty). @param sourcePath which candidate supplied it, or null if none did. */
  public record ResolvedField(String value, JsonPath sourcePath) {
  }
}
