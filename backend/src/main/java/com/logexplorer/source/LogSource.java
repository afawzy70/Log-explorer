package com.logexplorer.source;

import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.FollowRequest;
import com.logexplorer.core.model.LiveFollowResult;
import com.logexplorer.core.model.SearchRequest;
import com.logexplorer.core.model.ServiceInfo;
import com.logexplorer.core.model.SourceCapabilities;
import com.logexplorer.core.model.SourceHealth;
import com.logexplorer.core.model.SourceSearchOutcome;
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
   * OS-1C review recovery — the same historical search as {@link #search},
   * but also exposes any RUNTIME completeness/warning metadata discovered
   * while executing this exact invocation (a specific target could not be
   * read, an internal byte/line/event cap was actually reached while
   * fetching) — distinct from {@link #describeScopeWarnings}, which can
   * only ever report what is known <em>before</em> any network call is
   * made, since {@code api.SearchService} builds the query plan before
   * calling this method. The metadata is carried entirely by this call's
   * own return value ({@link SourceSearchOutcome}) — never a shared/
   * mutable "last search" field on the source instance — so it is safe by
   * construction for two overlapping concurrent searches on the same
   * source.
   *
   * <p>The default delegates to {@link #search} and reports no runtime
   * warnings, which is exactly correct for every source that doesn't
   * override this (Fixture, Docker, Loki): each of those sources' own
   * {@code search()} already either fully succeeds or fails the whole
   * reactive chain — there is no partial-target-failure case for them to
   * report today. Only {@code source.openshift.OpenShiftLogSource}
   * overrides this, because only OS-1C's own multi-target fan-out can
   * genuinely have some targets succeed while others fail.
   */
  default Mono<SourceSearchOutcome> searchWithOutcome(SearchRequest request) {
    return search(request).collectList().map(SourceSearchOutcome::of);
  }

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
   * OS-1E — the same live tail as {@link #follow}, plus a correlated
   * {@link LiveFollowResult#warnings()} channel truthfully surfacing any
   * partial-live-state condition discovered while THIS live session runs
   * (one target permanently stopped after exhausting its bounded
   * reconnect attempts, hit a permission/not-found wall, or the resolved
   * target set was capped) — the same "runtime truth belongs to this
   * call's own return value, never a shared field" discipline {@link
   * #searchWithOutcome} already established for search, extended to an
   * ongoing stream. See {@link LiveFollowResult}'s own javadoc for why
   * both parts must come from one correlated construction.
   *
   * <p>The default wraps {@link #follow} with an always-empty warnings
   * channel — correct for every source with no partial-live-state concept
   * (Docker, Fixture, Loki). Only {@code source.openshift.OpenShiftLogSource}
   * overrides this.
   */
  default Mono<LiveFollowResult> followWithWarnings(FollowRequest request) {
    return Mono.just(new LiveFollowResult(follow(request), Flux.empty()));
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

  /**
   * OS-1C — a human-readable, already-safe (pod/container/namespace
   * identity only, never a raw response body or credential) account of any
   * reason THIS search's result might be less than the complete truth:
   * scope resolved by an earlier slice was itself partial, an internal
   * fan-out/byte/line cap was reached, or one specific target could not be
   * read. Surfaced through the existing query-plan {@code notes} channel
   * ({@code core.query.QueryPlanBuilder}) rather than a new DTO field —
   * the same "reuse existing transparency, don't invent a new concept"
   * judgement {@link #describePushDown} already makes for a different
   * kind of search transparency. The default — nothing to warn about — is
   * correct for every source that doesn't override this (fixture, Docker,
   * Loki): {@link com.logexplorer.core.model.ResultCounts#truncated()}
   * already covers "more matching events existed than the requested
   * limit" for them; this exists for the OS-1C-specific case where scope
   * itself may be incomplete independently of how many events came back.
   */
  default List<String> describeScopeWarnings(SearchRequest request) {
    return List.of();
  }
}
