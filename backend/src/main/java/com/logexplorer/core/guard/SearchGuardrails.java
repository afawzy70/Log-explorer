package com.logexplorer.core.guard;

import com.logexplorer.config.SearchGuardrailsProperties;
import com.logexplorer.core.guard.GuardrailViolationException.Reason;
import com.logexplorer.core.model.SearchRequest;
import java.time.Duration;
import org.springframework.stereotype.Component;

/**
 * Validates a {@link SearchRequest} against the configured limits
 * (IMPLEMENTATION_PLAN.md "Phase B" item 10) and computes the effective,
 * enforced parameters to execute the search with.
 *
 * <p>A limit above the configured maximum is silently clamped down (never
 * rejected) — the caller gets a smaller-than-asked page rather than an
 * error, and {@code ResultCounts} reports the truth. A structurally invalid
 * request (non-positive limit, missing/inverted range, range wider than
 * allowed) is rejected outright.
 */
@Component
public class SearchGuardrails {

  private final SearchGuardrailsProperties properties;

  public SearchGuardrails(SearchGuardrailsProperties properties) {
    this.properties = properties;
  }

  public ValidatedSearch validate(SearchRequest request) {
    if (request.start() == null || request.end() == null) {
      throw new GuardrailViolationException(Reason.MISSING_RANGE, "both start and end are required");
    }
    if (!request.start().isBefore(request.end())) {
      throw new GuardrailViolationException(Reason.INVALID_RANGE, "start must be strictly before end");
    }

    Duration requestedRange = Duration.between(request.start(), request.end());
    Duration maxRange = properties.getPerSourceMaxTimeRange()
        .getOrDefault(request.sourceId(), properties.getMaxTimeRange());
    if (requestedRange.compareTo(maxRange) > 0) {
      throw new GuardrailViolationException(
          Reason.MAX_RANGE_EXCEEDED,
          "requested range " + requestedRange + " exceeds the maximum of " + maxRange
              + " for source " + request.sourceId());
    }

    Integer requestedLimit = request.limit();
    if (requestedLimit != null && requestedLimit <= 0) {
      throw new GuardrailViolationException(Reason.INVALID_LIMIT, "limit must be positive");
    }
    int effectiveLimit = requestedLimit == null
        ? properties.getDefaultLimit()
        : Math.min(requestedLimit, properties.getMaxLimit());

    return new ValidatedSearch(effectiveLimit, properties.getRequestTimeout());
  }
}
