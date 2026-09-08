package com.logexplorer.source;

import com.logexplorer.core.model.CanonicalLogEvent;
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
}
