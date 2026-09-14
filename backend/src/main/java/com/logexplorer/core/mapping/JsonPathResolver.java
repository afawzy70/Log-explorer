package com.logexplorer.core.mapping;

import java.util.List;
import java.util.Map;

/**
 * Resolves a {@link JsonPath} against an already-parsed JSON object tree
 * (a {@code Map<String,Object>} produced by Jackson, exactly what {@code
 * core.parse.LogLineParser} already works with). Pure data traversal — no
 * expression evaluation, no reflection, no code execution of any kind
 * (mission §21).
 *
 * <p>Traversal is defensive at every step: a missing key, a {@code null}
 * intermediate value, or an intermediate value that is not itself a
 * {@code Map} (e.g. the path expects to descend into an object but finds a
 * string, number, or array) all resolve to {@code null} rather than
 * throwing — the same "never let one field's shape break the rest of the
 * event" discipline {@code LogLineParser} already applies (CLAUDE.md §4
 * "Parsing").
 */
public final class JsonPathResolver {

  private JsonPathResolver() {
  }

  /** Resolves the raw value at {@code path} — may be a String, Number, Boolean, Map, List, or null. */
  @SuppressWarnings("unchecked")
  public static Object resolveRaw(Map<String, Object> root, JsonPath path) {
    if (root == null || path == null) {
      return null;
    }
    List<String> segments = path.segments();
    Object current = root;
    for (String segment : segments) {
      if (!(current instanceof Map<?, ?> map)) {
        return null;
      }
      current = ((Map<String, Object>) map).get(segment);
      if (current == null) {
        return null;
      }
    }
    return current;
  }

  /**
   * Resolves and converts to {@code String} the same way {@code
   * LogLineParser#asString} always has: {@code null} stays {@code null}; a
   * {@code String} value passes through unchanged (including an explicitly
   * empty string); any other scalar is {@code String.valueOf}'d. A resolved
   * {@code Map}/{@code List} (the path pointed at a nested object/array, not
   * a scalar) is also stringified via {@code String.valueOf} rather than
   * silently discarded — callers doing field-mapping resolution treat that
   * as a type-incompatibility signal (see {@code FieldMappingValidation}),
   * not a crash.
   */
  public static String resolveAsString(Map<String, Object> root, JsonPath path) {
    Object value = resolveRaw(root, path);
    if (value == null) {
      return null;
    }
    if (value instanceof String s) {
      return s;
    }
    return String.valueOf(value);
  }

  /** True when the resolved value is present but is a {@code Map} or {@code List} rather than a scalar. */
  public static boolean isStructuredValue(Map<String, Object> root, JsonPath path) {
    Object value = resolveRaw(root, path);
    return value instanceof Map<?, ?> || value instanceof List<?>;
  }
}
