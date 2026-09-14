package com.logexplorer.core.mapping.scan;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Deterministic, bounded, non-executable walker over one parsed JSON object
 * tree, producing every discovered {@code (JsonPath string, ObservedType)}
 * pair (owner mission §A4/§A7 — "generate a union/catalog of observed JSON
 * paths," "for each discovered path, provide... observed type(s)").
 *
 * <p><b>Object traversal only</b> — {@code core.mapping.JsonPath} itself
 * has no array-index syntax (see its own javadoc: bare segments and
 * {@code ["literal.key"]} segments only), so this walker treats a JSON
 * array as a single leaf value of type {@link ObservedType#ARRAY} rather
 * than descending into its elements. This keeps every path this walker
 * ever reports directly usable as a real {@code core.mapping.JsonPath},
 * never a path the mapping engine couldn't itself resolve.
 *
 * <p>Bounded by {@link SchemaScanBounds#MAX_WALK_DEPTH} (object nesting)
 * and {@link SchemaScanBounds#MAX_PATHS_PER_EVENT} (total paths recorded)
 * so one pathological document can never make a scan unbounded.
 */
public final class JsonSchemaWalker {

  private JsonSchemaWalker() {
  }

  /** Path-string → observed type, in first-seen (stable, deterministic) order. */
  public static Map<String, ObservedType> walk(Map<String, Object> root) {
    Map<String, ObservedType> out = new LinkedHashMap<>();
    if (root == null) {
      return out;
    }
    walkInto(root, new ArrayList<>(), out, 0);
    return out;
  }

  @SuppressWarnings("unchecked")
  private static void walkInto(Map<String, Object> node, List<String> pathSoFar,
      Map<String, ObservedType> out, int depth) {
    for (Map.Entry<String, Object> entry : node.entrySet()) {
      if (out.size() >= SchemaScanBounds.MAX_PATHS_PER_EVENT) {
        return;
      }
      List<String> childPath = new ArrayList<>(pathSoFar);
      childPath.add(entry.getKey());
      Object value = entry.getValue();
      ObservedType type = classify(value);
      out.put(toPathString(childPath), type);

      if (type == ObservedType.OBJECT && depth + 1 < SchemaScanBounds.MAX_WALK_DEPTH) {
        walkInto((Map<String, Object>) value, childPath, out, depth + 1);
      }
    }
  }

  private static ObservedType classify(Object value) {
    if (value == null) {
      return ObservedType.NULL;
    }
    if (value instanceof Map) {
      return ObservedType.OBJECT;
    }
    if (value instanceof List) {
      return ObservedType.ARRAY;
    }
    if (value instanceof Boolean) {
      return ObservedType.BOOLEAN;
    }
    if (value instanceof Number) {
      return ObservedType.NUMBER;
    }
    return ObservedType.STRING;
  }

  /**
   * Renders {@code segments} in exactly the syntax {@code
   * core.mapping.JsonPath#parse} accepts — a bare segment joined by
   * {@code .}, or a {@code ["literal"]} bracket segment whenever the real
   * key itself contains a {@code .}, {@code [}, or {@code ]} and would
   * otherwise be mis-split by the parser (the same case {@code
   * mdc["event.correlationId"]} already exists for).
   */
  static String toPathString(List<String> segments) {
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < segments.size(); i++) {
      String segment = segments.get(i);
      boolean needsBracket = segment.isEmpty()
          || segment.indexOf('.') >= 0
          || segment.indexOf('[') >= 0
          || segment.indexOf(']') >= 0;
      if (needsBracket) {
        sb.append("[\"").append(segment).append("\"]");
      } else {
        if (i > 0) {
          sb.append('.');
        }
        sb.append(segment);
      }
    }
    return sb.toString();
  }
}
