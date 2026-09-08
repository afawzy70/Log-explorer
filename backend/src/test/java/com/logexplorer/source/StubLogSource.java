package com.logexplorer.source;

import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.FollowRequest;
import com.logexplorer.core.model.SearchRequest;
import com.logexplorer.core.model.ServiceInfo;
import com.logexplorer.core.model.SourceCapabilities;
import com.logexplorer.core.model.SourceHealth;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * Test-only {@link LogSource} double. Not a Spring bean, not gated by any
 * profile — plain test code, purely to exercise the registry/guardrail/
 * search-orchestration plumbing Phase B builds. The real, richly-featured
 * deterministic fixture source (H3) is Phase A2b's job; this exists only so
 * this phase's own tests don't need it.
 */
public class StubLogSource implements LogSource {

  private final String id;
  private final String displayName;
  private final SourceCapabilities capabilities;

  private Flux<CanonicalLogEvent> searchFlux = Flux.empty();
  private Flux<CanonicalLogEvent> followFlux = Flux.empty();
  private Mono<SourceHealth> health = Mono.just(new SourceHealth(SourceHealth.Status.UP, "ok", Instant.now()));
  private Flux<ServiceInfo> services = Flux.empty();

  /** The most recent {@link FollowRequest} this source was asked to follow with (Phase J). */
  public volatile FollowRequest lastFollowRequest;

  public final AtomicBoolean cancelled = new AtomicBoolean(false);
  public final AtomicInteger subscriptions = new AtomicInteger(0);
  /** The most recent {@link SearchRequest} this source was asked to search with - lets tests assert what a controller/mapper actually built, since this stub never applies {@code EventFilters} itself. */
  public volatile SearchRequest lastRequest;

  public StubLogSource(String id) {
    this(id, id, new SourceCapabilities(true, false, false, true, false, false));
  }

  public StubLogSource(String id, String displayName, SourceCapabilities capabilities) {
    this.id = id;
    this.displayName = displayName;
    this.capabilities = capabilities;
  }

  public StubLogSource withSearchFlux(Flux<CanonicalLogEvent> flux) {
    this.searchFlux = flux;
    return this;
  }

  public StubLogSource withHealth(Mono<SourceHealth> health) {
    this.health = health;
    return this;
  }

  public StubLogSource withServices(Flux<ServiceInfo> services) {
    this.services = services;
    return this;
  }

  public StubLogSource withFollowFlux(Flux<CanonicalLogEvent> flux) {
    this.followFlux = flux;
    return this;
  }

  @Override
  public String id() {
    return id;
  }

  @Override
  public String displayName() {
    return displayName;
  }

  @Override
  public SourceCapabilities capabilities() {
    return capabilities;
  }

  @Override
  public Mono<SourceHealth> health() {
    return health;
  }

  @Override
  public Flux<ServiceInfo> discoverServices() {
    return services;
  }

  @Override
  public Flux<CanonicalLogEvent> search(SearchRequest request) {
    subscriptions.incrementAndGet();
    lastRequest = request;
    return searchFlux.doOnCancel(() -> cancelled.set(true));
  }

  @Override
  public Flux<CanonicalLogEvent> follow(FollowRequest request) {
    lastFollowRequest = request;
    return followFlux.doOnCancel(() -> cancelled.set(true));
  }
}
