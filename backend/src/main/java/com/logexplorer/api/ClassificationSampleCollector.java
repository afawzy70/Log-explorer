package com.logexplorer.api;

import com.logexplorer.api.dto.ClassificationSampleScopeDto;
import com.logexplorer.core.classify.ClassificationLimits;
import com.logexplorer.core.classify.ClassificationRulesException;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.SearchRequest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;

/**
 * Reads a bounded, real sample of canonical events for pattern detection
 * and rule testing, through the normal {@link SearchService} pipeline — so
 * the same source abstraction, readiness gate, guardrails, and concurrency
 * limits apply to every source (never a Docker-only path). The sample is
 * returned to the caller for one operation and never retained.
 *
 * <p><b>Search-scope correctness</b> (owner mission "Classification real
 * search scope, assisted extraction, and visual tagging"): the sample is
 * read from the user's <i>committed search scope</i> — the same population
 * the selected event is visible in — by building the request through the
 * one real {@link RequestMapper}, so every supported filter (free text, the
 * parsed query DSL, raw LogQL, identifiers, mapped advanced fields, the
 * five sensitive filters, services and their include/exclude mode,
 * severities, compose project, time range) behaves exactly as it does for
 * Search. Only three things are the sample's own: direction and limit (one
 * bounded newest-first page) and the classification tag filter.
 *
 * <p><b>Tag-filter policy.</b> A classification tag filter is deliberately
 * NOT carried into a sample. Tags exist only after server-side
 * classification by the <i>saved</i> rules, so sampling through them while
 * the user is creating or editing an unsaved rule would make the evidence
 * depend on the very classification being authored — a circular, silently
 * tiny sample (and, while testing an edit of the same rule, self-fulfilling
 * counts). Every other committed filter is preserved; the UI states this
 * where the sample scope is shown.
 *
 * <p><b>Anchor guarantee.</b> The selected event defines the pattern, so it
 * must participate even when the bounded page stopped short of it (ordering
 * or volume). When {@code anchorTimestamp} is given and no sampled event
 * carries it, one extra, strictly bounded read of that single millisecond —
 * with the identical filters — is merged in, de-duplicated, so the anchor is
 * never counted twice. Counts stay truthful: the returned list is exactly
 * what was evaluated.
 */
@Component
public class ClassificationSampleCollector {

  /** Events read by the anchor top-up: one millisecond of the same filtered population. */
  static final int ANCHOR_FETCH_LIMIT = 5;

  private final SearchService searchService;
  private final RequestMapper requestMapper;

  public ClassificationSampleCollector(SearchService searchService, RequestMapper requestMapper) {
    this.searchService = searchService;
    this.requestMapper = requestMapper;
  }

  /**
   * {@code limitReached} is true when the source had more matching events than were sampled;
   * {@code anchorAdded} is true when the selected event had to be merged in by the anchor guarantee.
   */
  public record Sample(List<CanonicalLogEvent> events, boolean limitReached, boolean anchorAdded) {
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
    SearchRequest request = requestMapper.toDomain(
        scope.toSearchRequest(SearchRequest.Direction.BACKWARD.name(), size, List.of()));
    return searchService.search(request)
        .flatMap(result -> {
          List<CanonicalLogEvent> events = result.events();
          boolean limitReached = result.counts().truncated() || events.size() >= size;
          Instant anchor = scope.anchorTimestamp();
          if (anchor == null || events.stream().anyMatch(e -> anchor.equals(e.timestamp()))) {
            return Mono.just(new Sample(events, limitReached, false));
          }
          return anchorEvents(scope, anchor)
              .map(extra -> extra.isEmpty()
                  ? new Sample(events, limitReached, false)
                  : new Sample(merge(extra, events), limitReached, true));
        });
  }

  /** One extra bounded read of the anchor's own millisecond, with the identical filters. */
  private Mono<List<CanonicalLogEvent>> anchorEvents(ClassificationSampleScopeDto scope, Instant anchor) {
    ClassificationSampleScopeDto window = new ClassificationSampleScopeDto(scope.sourceId(), scope.composeProject(),
        anchor, anchor.plusMillis(1), scope.services(), scope.serviceFilterMode(), scope.levels(), scope.text(),
        scope.traceId(), scope.spanId(), scope.correlationId(), scope.journeyId(), scope.journeyName(),
        scope.eventId(), scope.errorCode(), scope.businessStep(), scope.uiIdentifier(), scope.loggerContains(),
        scope.devicePlatform(), scope.language(), scope.cif(), scope.userName(), scope.customerId(), scope.deviceId(),
        scope.deviceIp(), scope.query(), scope.rawLogQl(), null);
    SearchRequest request = requestMapper.toDomain(
        window.toSearchRequest(SearchRequest.Direction.BACKWARD.name(), ANCHOR_FETCH_LIMIT, List.of()));
    return searchService.search(request)
        .map(result -> result.events().stream().filter(e -> anchor.equals(e.timestamp())).toList())
        .onErrorReturn(List.of());
  }

  /**
   * Newest-first order is preserved and an event already in the page is never added twice. A missing anchor is
   * always older than every event on the newest-first page it fell off the end of, so it is appended, not prepended.
   */
  private static List<CanonicalLogEvent> merge(List<CanonicalLogEvent> anchorEvents, List<CanonicalLogEvent> page) {
    Set<String> seen = new LinkedHashSet<>();
    List<CanonicalLogEvent> merged = new ArrayList<>(anchorEvents.size() + page.size());
    for (CanonicalLogEvent event : page) {
      if (seen.add(identity(event))) {
        merged.add(event);
      }
    }
    for (CanonicalLogEvent event : anchorEvents) {
      if (seen.add(identity(event))) {
        merged.add(event);
      }
    }
    return List.copyOf(merged);
  }

  private static String identity(CanonicalLogEvent event) {
    return event.timestamp() + "|" + event.service() + "|" + event.severity() + "|" + event.message();
  }
}
