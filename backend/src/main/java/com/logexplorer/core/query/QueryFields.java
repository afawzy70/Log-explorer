package com.logexplorer.core.query;

import com.logexplorer.core.model.CanonicalLogEvent;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;

/**
 * The fixed DSL alias vocabulary (HANDOVER.md §9's exact list — 17
 * aliases). {@code deviceId}/{@code deviceIp} are deliberately <b>not</b>
 * included — the handover's own alias list omits them (they remain
 * queryable only via the existing structured {@code SearchRequest} filter
 * fields), a documented boundary, not an oversight.
 *
 * <p>Aliases are matched case-insensitively against this canonical
 * (lowercased) key set. {@code userName}, {@code customerId}, {@code cif}
 * are the DSL's three sensitive aliases — flagged in {@link
 * #SENSITIVE_ALIASES} so {@code QueryPlanExplainer} and any future
 * consumer can treat them specially if needed, though in practice every
 * literal value is already unconditionally redacted regardless of which
 * alias it belongs to (CLAUDE.md "never log search values", applied
 * uniformly, not just to the five named sensitive fields).
 */
final class QueryFields {

  private QueryFields() {
  }

  static final Set<String> SENSITIVE_ALIASES = Set.of("username", "customerid", "cif");

  private static final Map<String, Function<CanonicalLogEvent, String>> ACCESSORS = Map.ofEntries(
      Map.entry("service", CanonicalLogEvent::service),
      Map.entry("level", CanonicalLogEvent::severity),
      Map.entry("message", CanonicalLogEvent::message),
      Map.entry("logger", CanonicalLogEvent::logger),
      Map.entry("traceid", CanonicalLogEvent::traceId),
      Map.entry("spanid", CanonicalLogEvent::spanId),
      Map.entry("correlationid", CanonicalLogEvent::correlationId),
      Map.entry("journeyid", CanonicalLogEvent::journeyId),
      Map.entry("eventid", CanonicalLogEvent::eventId),
      Map.entry("errorcode", CanonicalLogEvent::errorCode),
      Map.entry("businessstep", CanonicalLogEvent::businessStep),
      Map.entry("uiidentifier", CanonicalLogEvent::uiIdentifier),
      Map.entry("device.platform", CanonicalLogEvent::devicePlatformType),
      Map.entry("language", CanonicalLogEvent::language),
      Map.entry("username", event -> event.sensitive().userName()),
      Map.entry("customerid", event -> event.sensitive().customerId()),
      Map.entry("cif", event -> event.sensitive().cif()));

  static boolean isKnown(String alias) {
    return ACCESSORS.containsKey(normalize(alias));
  }

  static String value(String alias, CanonicalLogEvent event) {
    return ACCESSORS.get(normalize(alias)).apply(event);
  }

  static String normalize(String alias) {
    return alias.toLowerCase(Locale.ROOT);
  }
}
