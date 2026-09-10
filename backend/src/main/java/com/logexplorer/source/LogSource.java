package com.logexplorer.source;

import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.FollowRequest;
import com.logexplorer.core.model.SearchRequest;
import com.logexplorer.core.model.ServiceInfo;
import com.logexplorer.core.model.SourceCapabilities;
import com.logexplorer.core.model.SourceHealth;
import java.util.List;
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
   * UX-R3 — service discovery scoped to one Docker Compose project, for
   * sources where {@link SourceCapabilities#composeProjectScoping()} is
   * true. The default delegates to the unscoped {@link #discoverServices()}
   * unchanged, so every existing source (Fixture, Loki) needs no override
   * at all — only {@code DockerLogSource} genuinely has a project concept.
   * {@code composeProject} being {@code null}/blank means "no project
   * scope requested," identical to calling {@link #discoverServices()}.
   */
  default Flux<ServiceInfo> discoverServices(String composeProject) {
    return discoverServices();
  }

  /**
   * UX-R3 — real Docker Compose projects currently visible on this
   * source's own connection, keyed by the canonical {@code
   * com.docker.compose.project} label (never inferred from container
   * names, never fabricated). Empty for every source that doesn't have a
   * real Compose-project concept at all ({@link
   * SourceCapabilities#composeProjectScoping()} false) - the frontend
   * relies on that capability flag, not this list's emptiness alone, to
   * decide whether to show project selection UI (a Docker engine that is
   * reachable but genuinely has zero Compose projects also returns an
   * empty list here, and capability-gating is what keeps that
   * indistinguishable-by-list-alone case from being shown as "unsupported"
   * instead of "supported, currently empty").
   */
  default List<String> discoverComposeProjects() {
    return List.of();
  }

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

  /**
   * Query-plan transparency (Legacy Remediation Slice 2): a human-readable,
   * already-safe (never a raw sensitive/free-text value — see {@code
   * core.query.QueryPlanBuilder}'s own javadoc for the exact redaction
   * boundary) account of what this source genuinely narrowed its own
   * native query by for {@code request}, as an optimization only. The
   * default — "nothing genuinely known to be pushed down" — is the honest
   * answer for every source that doesn't override this (fixture, Docker,
   * any test double): {@code core.search.EventFilters} still applies every
   * condition to every fetched event regardless, so an empty list here
   * never affects correctness, only how much detail the query-plan
   * disclosure can honestly show. Never fabricate an entry here just to
   * have something to show.
   */
  default List<String> describePushDown(SearchRequest request) {
    return List.of();
  }
}
