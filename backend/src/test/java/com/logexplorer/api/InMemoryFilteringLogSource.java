package com.logexplorer.api;

import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.FollowRequest;
import com.logexplorer.core.model.SearchRequest;
import com.logexplorer.core.model.ServiceInfo;
import com.logexplorer.core.model.SourceCapabilities;
import com.logexplorer.core.model.SourceHealth;
import com.logexplorer.core.search.EventFilters;
import com.logexplorer.source.LogSource;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * Test-only {@link LogSource} double that, unlike {@code StubLogSource},
 * genuinely applies {@link EventFilters} (in particular {@code start}/
 * {@code end}) to a fixed in-memory corpus — exactly what every real
 * adapter (Docker/Loki/fixture) already does. Used to test {@link
 * SearchService}'s pagination orchestration (Legacy Remediation Slice 1)
 * against precisely-controlled event timestamps — including exact
 * timestamp duplicates at a page boundary — without needing to mock
 * Docker/Loki I/O for every scenario (those get their own dedicated
 * pagination tests against the real adapters).
 */
class InMemoryFilteringLogSource implements LogSource {

  private final String id;
  private final List<CanonicalLogEvent> corpus;

  InMemoryFilteringLogSource(String id, List<CanonicalLogEvent> corpus) {
    this.id = id;
    this.corpus = corpus;
  }

  @Override
  public String id() {
    return id;
  }

  @Override
  public String displayName() {
    return id;
  }

  @Override
  public SourceCapabilities capabilities() {
    return new SourceCapabilities(true, false, false, false, false, false);
  }

  @Override
  public Mono<SourceHealth> health() {
    return Mono.just(new SourceHealth(SourceHealth.Status.UP, "ok", Instant.now()));
  }

  @Override
  public Flux<ServiceInfo> discoverServices() {
    return Flux.empty();
  }

  @Override
  public Flux<CanonicalLogEvent> search(SearchRequest request) {
    List<CanonicalLogEvent> matched = corpus.stream()
        .filter(e -> EventFilters.matches(e, request))
        .sorted(Comparator.comparing(CanonicalLogEvent::timestamp, Comparator.nullsLast(Comparator.reverseOrder())))
        .toList();
    return Flux.fromIterable(matched);
  }

  @Override
  public Flux<CanonicalLogEvent> follow(FollowRequest request) {
    return Flux.empty();
  }
}
