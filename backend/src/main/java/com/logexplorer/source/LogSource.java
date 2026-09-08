package com.logexplorer.source;

import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.FollowRequest;
import com.logexplorer.core.model.SearchRequest;
import com.logexplorer.core.model.ServiceInfo;
import com.logexplorer.core.model.SourceCapabilities;
import com.logexplorer.core.model.SourceHealth;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * Source-neutral log access contract (HANDOVER.md §7). Implementations:
 * Docker (Phase C), OpenShift Loki (Phase D), the deterministic fixture
 * source (Phase A2b, dev/test profiles only). Every implementation must be
 * strictly read-only — nothing in this interface can mutate anything.
 */
public interface LogSource {

  /** Stable, unique identifier — never changes once assigned. */
  String id();

  String displayName();

  SourceCapabilities capabilities();

  Mono<SourceHealth> health();

  /** Empty if {@link SourceCapabilities#serviceDiscovery()} is false. */
  Flux<ServiceInfo> discoverServices();

  /**
   * Bounded historical search. Implementations do their own source-side
   * filtering where possible, but callers (the search orchestrator) apply
   * guardrails (limit, timeout, cancellation) regardless — an
   * implementation must never assume it is the only line of defense.
   */
  Flux<CanonicalLogEvent> search(SearchRequest request);

  /**
   * Live tail (IMPLEMENTATION_PLAN.md "Phase J", HANDOVER.md §18) - an
   * unbounded stream of new events from "now" forward. Callers must check
   * {@link SourceCapabilities#liveTail()} first; this default rejects the
   * call outright for every source that doesn't override it, so "Do not
   * fake it" (HANDOVER.md §18.3) holds even if a caller forgets to check.
   */
  default Flux<CanonicalLogEvent> follow(FollowRequest request) {
    return Flux.error(new UnsupportedOperationException("Live tail is not supported by source " + id()));
  }
}
