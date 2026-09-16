package com.logexplorer.api;

import com.logexplorer.api.dto.ClassificationSampleScopeDto;
import com.logexplorer.core.classify.ClassificationLimits;
import com.logexplorer.core.classify.ClassificationRulesException;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.SearchRequest;
import java.util.List;
import java.util.Locale;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;

/**
 * Reads a bounded, real sample of canonical events for pattern detection
 * and rule testing, through the normal {@link SearchService} pipeline — so
 * the same source abstraction, readiness gate, guardrails, and concurrency
 * limits apply to every source (never a Docker-only path). The sample is
 * returned to the caller for one operation and never retained.
 */
@Component
public class ClassificationSampleCollector {

  private final SearchService searchService;

  public ClassificationSampleCollector(SearchService searchService) {
    this.searchService = searchService;
  }

  /** {@code limitReached} is true when the source had more matching events than were sampled. */
  public record Sample(List<CanonicalLogEvent> events, boolean limitReached) {
  }

  public Mono<Sample> collect(ClassificationSampleScopeDto scope, Integer requestedSize) {
    if (scope == null || scope.sourceId() == null || scope.sourceId().isBlank() || scope.start() == null
        || scope.end() == null) {
      return Mono.error(ClassificationRulesException.badRequest("SAMPLE_SCOPE_REQUIRED",
          "Choose a source and time range to sample events from"));
    }
    int size = requestedSize == null ? ClassificationLimits.DEFAULT_SAMPLE_SIZE : requestedSize;
    if (size < 1 || size > ClassificationLimits.MAX_SAMPLE_SIZE) {
      return Mono.error(ClassificationRulesException.badRequest("SAMPLE_SIZE_OUT_OF_RANGE",
          "Sample size must be between 1 and " + ClassificationLimits.MAX_SAMPLE_SIZE));
    }
    SearchRequest request = SearchRequest.builder()
        .sourceId(scope.sourceId())
        .start(scope.start())
        .end(scope.end())
        .direction(SearchRequest.Direction.BACKWARD)
        .limit(size)
        .services(scope.services())
        .serviceFilterMode(parseMode(scope.serviceFilterMode()))
        .levels(scope.levels())
        .composeProject(scope.composeProject())
        .build();
    return searchService.search(request)
        .map(result -> new Sample(result.events(),
            result.counts().truncated() || result.events().size() >= size));
  }

  private static SearchRequest.ServiceFilterMode parseMode(String mode) {
    if (mode == null) {
      return null;
    }
    try {
      return SearchRequest.ServiceFilterMode.valueOf(mode.trim().toUpperCase(Locale.ROOT));
    } catch (IllegalArgumentException e) {
      return null;
    }
  }
}
