package com.logexplorer.source.loki;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Builds a LogQL stream selector safely (IMPLEMENTATION_PLAN.md "Phase D"
 * scope item 3: "safe LogQL selector escaping; push down safe filters;
 * exact post-filtering when pushdown is unsafe or lossy").
 *
 * <p>Deliberately uses only the {@code =} exact-match operator, never
 * {@code =~} regex matching, for any value that ultimately comes from
 * configuration or a single unambiguous request field — this sidesteps
 * regex-injection risk entirely rather than trying to safely escape
 * arbitrary text into a regex. Exact match means no character in the
 * value needs regex-metacharacter escaping (LogQL's {@code =} does plain
 * string equality); only the LogQL string-literal syntax characters
 * themselves (quote, backslash) need escaping.
 *
 * <p>{@code namespace} is always pushed down (it comes from fixed source
 * configuration, not user input). {@code service} is pushed down only
 * when the request names exactly one service — with zero or more than one
 * requested, that isn't a safe single exact-match pushdown, so nothing is
 * pushed for it and {@code core.search.EventFilters} applies it as an
 * exact post-filter instead, same as every other structured field.
 */
public final class LogQlSelectorBuilder {

  private LogQlSelectorBuilder() {
  }

  public static String build(String namespaceLabelKey, String namespaceValue,
      String serviceLabelKey, List<String> requestedServices) {
    Map<String, String> exact = new LinkedHashMap<>();
    if (notBlank(namespaceValue)) {
      exact.put(namespaceLabelKey, namespaceValue);
    }
    if (requestedServices != null && requestedServices.size() == 1 && notBlank(requestedServices.get(0))) {
      exact.put(serviceLabelKey, requestedServices.get(0));
    }

    if (exact.isEmpty()) {
      // Loki requires at least one matcher in a stream selector. ".+" is a
      // fixed constant, never user input, so this is not a regex-injection
      // concern - it just means "any stream with this label present".
      return "{" + namespaceLabelKey + "=~\".+\"}";
    }

    StringBuilder sb = new StringBuilder("{");
    boolean first = true;
    for (Map.Entry<String, String> entry : exact.entrySet()) {
      if (!first) {
        sb.append(',');
      }
      sb.append(entry.getKey()).append("=\"").append(escape(entry.getValue())).append('"');
      first = false;
    }
    return sb.append('}').toString();
  }

  static String escape(String value) {
    // Order matters: backslash first, so we don't double-escape the
    // backslashes just introduced by the quote-escaping step.
    return value.replace("\\", "\\\\").replace("\"", "\\\"");
  }

  private static boolean notBlank(String s) {
    return s != null && !s.isBlank();
  }
}
