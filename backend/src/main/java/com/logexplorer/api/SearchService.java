package com.logexplorer.api;

import com.logexplorer.core.guard.ConcurrencyGuard;
import com.logexplorer.core.guard.GuardrailViolationException;
import com.logexplorer.core.guard.GuardrailViolationException.Reason;
import com.logexplorer.core.guard.SearchGuardrails;
import com.logexplorer.core.guard.ValidatedSearch;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.ResultCounts;
import com.logexplorer.core.model.SearchRequest;
import com.logexplorer.core.model.SearchResult;
import com.logexplorer.core.model.SourceSearchOutcome;
import com.logexplorer.core.query.QueryPlan;
import com.logexplorer.core.query.QueryPlanBuilder;
import com.logexplorer.core.search.PageCursor;
import com.logexplorer.core.search.PageCursorCodec;
import com.logexplorer.source.LogSource;
import com.logexplorer.source.LogSourceRegistry;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;

/**
 * Orchestrates one bounded search: resolve the source, validate/derive
 * guardrails, apply the concurrency cap, decode/validate any pagination
 * cursor and hand the source the decoded boundary, enforce the request
 * timeout, and turn the result into a truthful {@link SearchResult}
 * (Legacy Remediation Slice 1, {@code
 * docs/LEGACY_TO_NEW_REMEDIATION_PLAN.md} §"Slice 1 — Result-set
 * completeness"; recovered per the owner/reviewer's mandatory architecture
 * corrections after PR #18's first review).
 *
 * <p><b>Source-native pagination position (mandatory blocker #1).</b> The
 * parsed *application* timestamp ({@link CanonicalLogEvent#timestamp()})
 * is {@code null} for a malformed/non-JSON line, and can genuinely differ
 * from the source's own clock even when present (clock skew, a
 * backdated/forwarded log entry). Pagination continuation is instead keyed
 * on {@link CanonicalLogEvent#sourceTimestamp()} — Docker's own log-frame
 * receive time, Loki's stream-entry nanosecond timestamp, or fixture's own
 * deterministic per-index instant — which every adapter always knows,
 * malformed lines included. The displayed/canonical timestamp is entirely
 * unaffected by this; only pagination continuation uses the native clock.
 *
 * <p><b>Direction-aware continuation (mandatory blocker #2).</b> {@link
 * SearchRequest#direction()} is honored, not assumed: for {@code BACKWARD}
 * (the default — newest-first), continuation moves the boundary toward
 * *older* native timestamps; for {@code FORWARD} (oldest-first), toward
 * *newer* ones. Every {@code LogSource} implementation sorts its own
 * result by {@code sourceTimestamp} in the direction-of-travel order
 * (descending for BACKWARD, ascending for FORWARD) — this class trusts
 * that order (the last element of a page is always "farthest along in the
 * direction of travel") rather than re-deriving it, and never silently
 * treats FORWARD as BACKWARD.
 *
 * <p><b>Duplicate-native-timestamp safety.</b> Events at exactly the
 * boundary native timestamp that the previous page already returned are
 * filtered back out using {@link PageCursor#boundaryTieKeys()} (a keyed
 * HMAC per event, mandatory blocker #3 — never a plain/public hash),
 * which is what makes it safe for two different events to share a native
 * timestamp at a page boundary: nothing is ever skipped (a re-fetched
 * event either matches a tie key, in which case it is a real duplicate and
 * dropped, or it doesn't, in which case it is genuinely new and kept) and
 * nothing is ever duplicated in what the caller sees.
 *
 * <p><b>Totals.</b> {@code estimatedTotal} is populated with an exact
 * count only when page 1 (no cursor yet) turns out not to be truncated -
 * i.e. every matching event within the whole committed search window was
 * seen in one bounded scan, so the count is genuinely complete, not an
 * undercount hidden by this source's own per-request read bound. Every
 * other case (page 1 truncated, or any later page) reports {@code null} -
 * explicit UNKNOWN, never a fabricated or silently-reused number, and
 * never Loki's own separate, expensive count query.
 */
@Component
public class SearchService {

  private final LogSourceRegistry registry;
  private final SearchGuardrails guardrails;
  private final ConcurrencyGuard concurrencyGuard;
  private final PageCursorCodec cursorCodec;

  public SearchService(
      LogSourceRegistry registry, SearchGuardrails guardrails, ConcurrencyGuard concurrencyGuard, PageCursorCodec cursorCodec) {
    this.registry = registry;
    this.guardrails = guardrails;
    this.concurrencyGuard = concurrencyGuard;
    this.cursorCodec = cursorCodec;
  }

  public Mono<SearchResult> search(SearchRequest request) {
    return Mono.defer(() -> {
      LogSource source = registry.require(request.sourceId());
      rejectRawLogQlIfUnsupported(request, source);
      ValidatedSearch validated = guardrails.validate(request);

      // Decoded/verified before the source is ever queried - an invalid
      // cursor must never silently fall back to "page 1" or reach a
      // LogSource at all. request.start()/end() (the canonical committed
      // window) are left completely untouched here - only the new,
      // separate pageBoundary field carries the decoded native-clock
      // continuation point, so EventFilters' canonical-timestamp
      // filtering can never be corrupted by a native-clock value.
      PageCursor cursor = cursorCodec.decodeAndValidate(request);
      SearchRequest scoped = cursor == null ? request : request.withPageBoundary(cursor.boundarySourceTimestamp());

      // Query-plan transparency (Legacy Remediation Slice 2) - computed
      // from the same source/request the actual fetch below uses, so the
      // disclosure can never drift from what was really queried.
      QueryPlan queryPlan = QueryPlanBuilder.build(request, source.describePushDown(scoped), source.describeScopeWarnings(scoped));

      // OS-1C review recovery - searchWithOutcome() (default: delegates to
      // search()/collectList(), reporting no runtime warnings) replaces a
      // bare source.search(scoped).collectList() so a source can also
      // report runtime completeness metadata for this exact invocation
      // (see SourceSearchOutcome's own javadoc) - request-scoped by
      // construction, never a shared/mutable side channel, so two
      // overlapping concurrent searches on the same source can never leak
      // a warning into each other's result. ConcurrencyGuard's own
      // contract is a Flux<T>; .flux()/.single() round-trips through it
      // unchanged (still exactly the same acquire-before-subscribe/
      // release-on-terminal-signal semantics), never bypassed.
      Mono<SourceSearchOutcome> guarded = concurrencyGuard.guard(source.searchWithOutcome(scoped).flux()).single();

      // Every LogSource implementation already fully materializes its own
      // per-request-bounded result set before this Mono emits anything
      // (Docker: one blocking read per relevant container, each already
      // capped at DockerProperties#defaultTailLines; Loki: one query_range
      // call capped at LokiProperties#maxResultsPerQuery; fixture: its
      // fixed, small in-memory corpus; OpenShift: one bounded per-target
      // byte/line fetch fanned out and merged, capped again at
      // DirectPodLogProperties#maxEventsOverall) - collecting the whole
      // thing here adds no new unbounded-memory risk beyond what each
      // adapter already accepts today, and is what makes a truthful,
      // non-guessed truncation signal and (on an unpaginated first page)
      // an exact total possible.
      return guarded
          .timeout(validated.timeout())
          .map(outcome -> toResult(outcome, validated.effectiveLimit(), request, cursor, queryPlan));
    });
  }

  /**
   * Raw LogQL is Loki-only, config-enabled (IMPLEMENTATION_PLAN.md "Phase
   * E" scope item 8: "never advertised for Docker") — this one honest
   * capability check ({@link com.logexplorer.core.model.SourceCapabilities#rawLogQL()},
   * which itself reflects real per-source configuration, never assumed
   * true) covers both "wrong source type" and "not enabled by config" in
   * one place, rather than two separate special cases.
   */
  private void rejectRawLogQlIfUnsupported(SearchRequest request, LogSource source) {
    boolean requestsRawLogQl = request.rawLogQl() != null && !request.rawLogQl().isBlank();
    if (requestsRawLogQl && !source.capabilities().rawLogQL()) {
      throw new GuardrailViolationException(
          Reason.RAW_LOGQL_NOT_SUPPORTED, "Raw LogQL is not supported for source " + request.sourceId());
    }
  }

  private SearchResult toResult(
      SourceSearchOutcome outcome, int effectiveLimit, SearchRequest originalRequest, PageCursor incoming, QueryPlan queryPlan) {
    List<CanonicalLogEvent> fetched = outcome.events();
    boolean backward = originalRequest.direction() != SearchRequest.Direction.FORWARD;

    List<CanonicalLogEvent> deduped = incoming == null
        ? fetched
        : fetched.stream().filter(e -> keepForContinuation(e, incoming, backward)).toList();

    boolean moreWithinThisFetch = deduped.size() > effectiveLimit;
    List<CanonicalLogEvent> page = moreWithinThisFetch ? deduped.subList(0, effectiveLimit) : deduped;

    // A next cursor can fail to be derivable only if every event on this
    // page somehow has no source-native timestamp at all (should not
    // happen - every adapter always sets one, even for malformed/non-JSON
    // lines - defensive only). In that rare edge case, offering a cursor
    // could skip or duplicate on the next call, so pagination honestly
    // stops there - but `truncated` must still reflect reality (more data
    // exists, it just cannot be safely paged to) rather than silently
    // claiming the page was complete.
    String nextCursor = moreWithinThisFetch ? buildNextCursor(page, originalRequest, incoming) : null;

    // OS-1C review recovery - a source-reported runtime warning (a target
    // could not be read, a byte/line/event cap was actually hit) makes
    // this result exactly as untrustworthy-as-complete as ordinary
    // pagination truncation does: in both cases, more matching events may
    // exist than what is shown, and estimatedTotal must not be reported as
    // exact. Reusing the same ResultCounts#truncated() flag (rather than a
    // new, source-specific field) is deliberate - it is the one existing,
    // already-rendered-everywhere signal for "this may not be the complete
    // picture," and the two conditions share that exact meaning even
    // though their root causes differ.
    boolean runtimeIncomplete = !outcome.runtimeWarnings().isEmpty();
    boolean truncated = moreWithinThisFetch || runtimeIncomplete;

    // Exact only for a genuinely complete, unpaginated single-page result
    // (see class javadoc "Totals"). Never returned=total, never null=zero.
    Integer estimatedTotal = (incoming == null && !truncated) ? page.size() : null;

    ResultCounts counts = new ResultCounts(estimatedTotal, page.size(), page.size(), effectiveLimit, truncated);
    QueryPlan effectivePlan = runtimeIncomplete ? withAppendedNotes(queryPlan, outcome.runtimeWarnings()) : queryPlan;
    return new SearchResult(page, counts, nextCursor, effectivePlan);
  }

  /**
   * OS-1C review recovery - runtime warnings are appended to the SAME
   * {@code notes} list {@code describeScopeWarnings} already populated
   * pre-search, never a second parallel list: a search can genuinely have
   * both a known-incomplete scope AND a runtime target failure at once,
   * and the reader should see both reasons together, in one place,
   * without needing to know two different channels exist.
   */
  private static QueryPlan withAppendedNotes(QueryPlan plan, List<String> extra) {
    List<String> notes = new ArrayList<>(plan.notes());
    notes.addAll(extra);
    return new QueryPlan(plan.resolvedQuery(), plan.rawLogQlMode(), plan.pushedDownConditions(), plan.postFilterConditions(), notes);
  }

  /**
   * Direction-aware: for BACKWARD, keep events whose native timestamp is
   * strictly older than the boundary, or exactly at it but not already
   * returned (tie key not in {@code incoming.boundaryTieKeys()}); for
   * FORWARD, the mirror image (strictly newer, or exactly-at-and-new).
   */
  private boolean keepForContinuation(CanonicalLogEvent e, PageCursor incoming, boolean backward) {
    Instant ts = e.sourceTimestamp();
    if (ts == null) {
      // No native timestamp at all - should never happen (every adapter
      // always sets one) but never silently drop an event we cannot prove
      // was already returned.
      return true;
    }
    int cmp = ts.compareTo(incoming.boundarySourceTimestamp());
    if (cmp == 0) {
      return !incoming.boundaryTieKeys().contains(cursorCodec.boundaryTieKey(e));
    }
    return backward ? cmp < 0 : cmp > 0;
  }

  private String buildNextCursor(List<CanonicalLogEvent> page, SearchRequest originalRequest, PageCursor incoming) {
    Optional<Instant> boundary = findBoundary(page);
    if (boundary.isEmpty()) {
      return null;
    }
    Instant boundaryTimestamp = boundary.get();
    Set<String> tieKeys = new LinkedHashSet<>();
    // A tied-timestamp group larger than one page (e.g. 5 events sharing
    // the exact same native instant, with a page size of 3) takes more
    // than one page to get through. If this page's boundary is still the
    // *same* native instant as the incoming cursor's, the events already
    // consumed from that group on earlier pages must stay excluded too -
    // carry their tie keys forward rather than starting a fresh, page-
    // local-only set (a real bug found and fixed while writing this
    // recovery's own tests: without this carry-forward, an earlier page's
    // already-returned event at the shared boundary could reappear once
    // the tie-key set "moved on" to a later page's own subset).
    if (incoming != null && boundaryTimestamp.equals(incoming.boundarySourceTimestamp())) {
      tieKeys.addAll(incoming.boundaryTieKeys());
    }
    for (CanonicalLogEvent e : page) {
      if (boundaryTimestamp.equals(e.sourceTimestamp())) {
        tieKeys.add(cursorCodec.boundaryTieKey(e));
      }
    }
    int nextPageIndex = (incoming == null ? 1 : incoming.pageIndex() + 1);
    return cursorCodec.encode(originalRequest, boundaryTimestamp, tieKeys, nextPageIndex);
  }

  /**
   * The last event on the page (in direction-of-travel order, as sorted by
   * the source) that actually has a source-native timestamp - in practice
   * always the very last element, since every adapter always sets one.
   */
  private Optional<Instant> findBoundary(List<CanonicalLogEvent> page) {
    for (int i = page.size() - 1; i >= 0; i--) {
      Instant ts = page.get(i).sourceTimestamp();
      if (ts != null) {
        return Optional.of(ts);
      }
    }
    return Optional.empty();
  }
}
