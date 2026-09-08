package com.logexplorer.core.search;

import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.RawSensitiveFields;
import com.logexplorer.core.model.SearchRequest;

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
    if (!request.levels().isEmpty()
        && (event.severity() == null || !containsIgnoreCase(request.levels(), event.severity()))) {
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
    if (!fieldMatches(request.devicePlatform(), event.devicePlatformType())) {
      return false;
    }
    if (!fieldMatches(request.language(), event.language())) {
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
    return fieldMatches(filters.deviceIp(), raw.deviceIp());
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
