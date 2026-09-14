package com.logexplorer.core.mapping.sample;

import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.SearchRequest;
import com.logexplorer.source.LogSource;
import com.logexplorer.source.LogSourceRegistry;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * Bounded, stateless, source-neutral Original Source JSON sample fetch
 * (mission "Configurable Log Field Mapping + Original JSON Sampling" §3/§5).
 *
 * <p><b>Stateless by design</b> (mission §20 — "keep mapping samples
 * bounded and ephemeral... do not accidentally retain sensitive logs
 * indefinitely"): this service holds nothing in memory across requests.
 * Each call reuses the same, already-bounded {@link LogSource#search}
 * every real search request already goes through — nothing new is fetched
 * or read from the source that a normal search couldn't already read — and
 * returns the result directly. The frontend is the only place samples are
 * held at all (in-memory React state, cleared on navigation/reload — never
 * localStorage, per mission §4).
 *
 * <p><b>Never on the normal search response path</b> (mission §4 — {@code
 * ORIGINAL_MAPPING_SAMPLE != NORMAL_SEARCH_RESPONSE}): reads {@link
 * CanonicalLogEvent#originalRawJson()} directly, a field {@code
 * api.EventMapper} (the sole {@code CanonicalLogEvent}→DTO boundary) never
 * touches. This service, and its dedicated controller, are the only place
 * in the backend that ever returns this field to a caller.
 */
@Service
public class FieldMappingSampleService {

  /** Mission §5 — "Prefer a bounded set, for example 20-50 events." Default when the caller doesn't specify one. */
  public static final int DEFAULT_LIMIT = 20;
  /** Mission §5 — "a safe maximum," never an unbounded scan regardless of what a caller requests. */
  public static final int MAX_LIMIT = 50;

  private final LogSourceRegistry registry;

  public FieldMappingSampleService(LogSourceRegistry registry) {
    this.registry = registry;
  }

  /** Fetches up to {@code requestedLimit} (clamped to [1, {@link #MAX_LIMIT}]) real, unmasked, original-JSON samples from the source's own recent history. */
  public Mono<List<String>> fetchSamples(String sourceId, Integer requestedLimit) {
    LogSource source = registry.require(sourceId);
    int limit = clamp(requestedLimit);

    Instant now = Instant.now();
    SearchRequest request = SearchRequest.builder()
        .sourceId(sourceId)
        .start(now.minus(Duration.ofDays(30)))
        .end(now)
        .direction(SearchRequest.Direction.BACKWARD) // newest first - the most useful recent shapes
        .limit(limit)
        .build();

    return source.search(request)
        .take(limit) // never unbounded, regardless of what this source's own search() returns
        .map(CanonicalLogEvent::originalRawJson)
        .filter(java.util.Objects::nonNull)
        .collectList();
  }

  private int clamp(Integer requested) {
    int value = requested == null ? DEFAULT_LIMIT : requested;
    if (value < 1) {
      return 1;
    }
    return Math.min(value, MAX_LIMIT);
  }
}
