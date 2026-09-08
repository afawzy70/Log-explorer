package com.logexplorer.core.search;

import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.RawSensitiveFields;
import com.logexplorer.core.model.SearchRequest;
import com.logexplorer.core.query.QueryEvaluator;

/**
 * Shared structured-filter predicate for every {@code LogSource}
 * implementation's {@code search()} (fixture, Docker, Loki). Extracted in
 * Phase D after the third near-identical copy was about to be written (the
 * Rule of Three) — and while extracting it, found that {@code
 * DockerLogSource} (Phase C) only ever filtered at the container/service
 * level and never applied any of these structured filters (traceId,
 * correlationId, text, sensitive filters, ...) to individual events at
 * all. That was a real correctness gap, not a style issue; this extraction
 * fixes it for Docker at the same time it gives Loki the same behavior
 * from day one.
 *
 * <p>Time-range filtering is included here and applied uniformly by every
 * source, even ones (Docker, Loki) that also push {@code start}/{@code
 * end} down to their own API — that server-side bound is approximate
 * (Docker's is the container stream's receive time, not the parsed content
 * timestamp; Loki's nanosecond bounds could differ subtly from a
 * source-clock-skewed content timestamp), so this acts as a cheap,
 * correct safety net on top, not a redundant no-op.
 *
 * <p>Phase E's DSL query ({@link SearchRequest#query()}, already parsed
 * once by {@code SearchRequest.Builder#query}) is ANDed with every
 * structured filter here (HANDOVER.md §9: "Structured filters are ANDed
 * with parsed expression") — the single call site every adapter already
 * uses. Because the exact same {@link QueryEvaluator} runs here regardless
 * of which source produced the event, predicate-path/planner-path result
 * equivalence ({@code source.loki.plan.LogQlDslPlanner} only ever narrows
 * what Loki fetches as an optimization) is structural, not incidental.
 */
public final class EventFilters {

  private EventFilters() {
  }

  public static boolean matches(CanonicalLogEvent event, SearchRequest request) {
    // Malformed lines have no parsed timestamp by definition (LogLineParser
    // never fabricates one). Excluding them from every time-bounded search
    // would silently drop them from virtually all real usage - the
    // opposite of "malformed lines become raw fallback events, never
    // dropped" (HANDOVER.md §5.4).
    if (event.timestamp() != null) {
      if (request.start() != null && event.timestamp().isBefore(request.start())) {
        return false;
      }
      if (request.end() != null && !event.timestamp().isBefore(request.end())) {
        return false;
      }
    }
    if (!request.services().isEmpty()
        && (event.service() == null || !request.services().contains(event.service()))) {
      return false;
    }
    // A real, previously-shipped bug found via Phase M's real-browser UX
    // acceptance testing: a malformed line has no parsed severity by
    // definition (same as the timestamp case above), but this condition
    // excluded any null-severity event outright the moment ANY level
    // filter was active - which is always, since Info/Warn/Error are the
    // frontend's own default selection. Every malformed event was being
    // silently dropped from virtually all real searches, the opposite of
    // "malformed lines... never dropped" (HANDOVER.md §5.4) - the exact
    // same principle this file already applies to the timestamp filter
    // just above. A malformed event now passes through this filter
    // unconditionally (there is no severity to check against), exactly
    // like it already does for the timestamp bound.
    if (!request.levels().isEmpty()
        && event.severity() != null
        && !containsIgnoreCase(request.levels(), event.severity())) {
      return false;
    }
    if (notBlank(request.text()) && (event.message() == null
        || !event.message().toLowerCase().contains(request.text().toLowerCase()))) {
      return false;
    }
    if (!fieldMatches(request.traceId(), event.traceId())) {
      return false;
    }
    if (!fieldMatches(request.spanId(), event.spanId())) {
      return false;
    }
    if (!fieldMatches(request.correlationId(), event.correlationId())) {
      return false;
    }
    if (!fieldMatches(request.journeyId(), event.journeyId())) {
      return false;
    }
    if (!fieldMatches(request.eventId(), event.eventId())) {
      return false;
    }
    if (!fieldMatches(request.errorCode(), event.errorCode())) {
      return false;
    }
    if (!fieldMatches(request.businessStep(), event.businessStep())) {
      return false;
    }
    if (!fieldMatches(request.uiIdentifier(), event.uiIdentifier())) {
      return false;
    }
    // loggerContains arrives on SearchRequest/the DTO and was never
    // actually checked anywhere - a real, previously-shipped no-op filter
    // bug found while touching this file for Phase E, fixed here.
    if (notBlank(request.loggerContains()) && (event.logger() == null
        || !event.logger().toLowerCase().contains(request.loggerContains().toLowerCase()))) {
      return false;
    }
    if (!fieldMatches(request.devicePlatform(), event.devicePlatformType())) {
      return false;
    }
    if (!fieldMatches(request.language(), event.language())) {
      return false;
    }
    // containerId/pod only ever come from api.SearchController's /context
    // endpoint (HANDOVER.md 16.7: "scope context to service/container/pod
    // where possible") - never from the general SearchRequestDto, which
    // has no UI-facing filter for either.
    if (!fieldMatches(request.containerId(), event.containerId())) {
      return false;
    }
    if (!fieldMatches(request.pod(), event.pod())) {
      return false;
    }
    // Source-side filtering against raw sensitive values is exactly the
    // allowance IMPLEMENTATION_PLAN.md Phase B item 8 describes: adapters
    // may hold raw values for this purpose; they never leave via search().
    RawSensitiveFields filters = request.sensitiveFilters();
    RawSensitiveFields raw = event.sensitive();
    if (!fieldMatches(filters.cif(), raw.cif())) {
      return false;
    }
    if (!fieldMatches(filters.userName(), raw.userName())) {
      return false;
    }
    if (!fieldMatches(filters.customerId(), raw.customerId())) {
      return false;
    }
    if (!fieldMatches(filters.deviceId(), raw.deviceId())) {
      return false;
    }
    if (!fieldMatches(filters.deviceIp(), raw.deviceIp())) {
      return false;
    }
    return QueryEvaluator.evaluate(request.query(), event);
  }

  private static boolean fieldMatches(String requested, String actual) {
    return !notBlank(requested) || requested.equals(actual);
  }

  private static boolean notBlank(String s) {
    return s != null && !s.isBlank();
  }

  private static boolean containsIgnoreCase(java.util.List<String> values, String candidate) {
    return values.stream().anyMatch(v -> v.equalsIgnoreCase(candidate));
  }
}
