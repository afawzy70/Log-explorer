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
import com.logexplorer.core.search.PageCursor;
import com.logexplorer.core.search.PageCursorCodec;
import com.logexplorer.source.LogSource;
import com.logexplorer.source.LogSourceRegistry;
import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * Orchestrates one bounded search: resolve the source, validate/derive
 * guardrails, apply the concurrency cap, decode/validate any pagination
 * cursor and narrow the query window accordingly, enforce the request
 * timeout, and turn the result into a truthful {@link SearchResult}
 * (Legacy Remediation Slice 1, {@code
 * docs/LEGACY_TO_NEW_REMEDIATION_PLAN.md} §"Slice 1 — Result-set
 * completeness").
 *
 * <p><b>Pagination model.</b> None of the three {@code LogSource}
 * implementations offer a native "resume after this row" cursor - Docker's
 * log API and Loki's {@code query_range} both only ever support "the
 * newest N entries within [start, end]" (their own {@code tail}/{@code
 * limit} parameters). So a continuation page is obtained by re-issuing the
 * exact same search with {@code end} narrowed to the previous page's oldest
 * (boundary) timestamp, +1ns so that timestamp is included rather than
 * excluded (every source's own filtering already treats {@code end} as
 * exclusive - see {@code core.search.EventFilters} - narrowing this way
 * needs no change to that shared, heavily-depended-on rule). Events at
 * exactly the boundary timestamp that the previous page already returned
 * are then filtered back out using {@link PageCursor#boundaryKeys()},
 * which is exactly what makes it safe for two different events to share a
 * timestamp at a page boundary (mandatory architecture correction #3 -
 * "Loki duplicate-timestamp safety"): nothing is ever skipped (a re-fetched
 * event either matches a boundary key, in which case it is a real
 * duplicate and dropped, or it doesn't, in which case it is genuinely new
 * and kept) and nothing is ever duplicated in what the caller sees.
 *
 * <p><b>Totals.</b> Mandatory architecture correction #4 ("truthful
 * totals"): {@code estimatedTotal} is populated with an exact count only
 * when page 1 (no cursor yet) turns out not to be truncated - i.e. every
 * matching event within the whole committed search window was seen in one
 * bounded scan, so the count is genuinely complete, not an undercount
 * hidden by this source's own per-request read bound. Every other case
 * (page 1 truncated, or any later page) reports {@code null} - explicit
 * UNKNOWN, never a fabricated or silently-reused number, and never Loki's
 * own separate, expensive count query.
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
      // LogSource at all (mandatory architecture correction #1).
      PageCursor cursor = cursorCodec.decodeAndValidate(request);
      Instant queryEnd = cursor == null ? request.end() : cursor.boundaryTimestamp().plusNanos(1);
      SearchRequest scoped = cursor == null ? request : request.withEnd(queryEnd);

      Flux<CanonicalLogEvent> guarded = concurrencyGuard.guard(source.search(scoped));

      // Every LogSource implementation already fully materializes its own
      // per-request-bounded result set before this Flux emits anything
      // (Docker: one blocking read per relevant container, each already
      // capped at DockerProperties#defaultTailLines; Loki: one query_range
      // call capped at LokiProperties#maxResultsPerQuery; fixture: its
      // fixed, small in-memory corpus) - collecting the whole thing here
      // adds no new unbounded-memory risk beyond what each adapter already
      // accepts today (mandatory architecture correction #5 - "preserve
      // bounds"), and is what makes a truthful, non-guessed truncation
      // signal and (on an unpaginated first page) an exact total possible.
      return guarded
          .collectList()
          .timeout(validated.timeout())
          .map(list -> toResult(list, validated.effectiveLimit(), request, cursor));
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

  private SearchResult toResult(List<CanonicalLogEvent> fetched, int effectiveLimit, SearchRequest originalRequest, PageCursor incoming) {
    List<CanonicalLogEvent> deduped = incoming == null
        ? fetched
        : fetched.stream().filter(e -> !isAlreadySeenAtBoundary(e, incoming)).toList();

    boolean moreWithinThisFetch = deduped.size() > effectiveLimit;
    List<CanonicalLogEvent> page = moreWithinThisFetch ? deduped.subList(0, effectiveLimit) : deduped;

    // A next cursor can fail to be derivable even when moreWithinThisFetch
    // is true (every event on this page has no parsed timestamp - see
    // findBoundary's javadoc; a real scenario, not just a theoretical
    // one - found via this slice's own real-Docker verification against
    // containers whose log lines don't parse to the expected schema, so
    // every event on the page is a malformed fallback). In that rare edge
    // case, offering a cursor could skip or duplicate on the next call,
    // so pagination honestly stops there - but `truncated` must still
    // reflect reality (more data exists, it just cannot be safely paged
    // to) rather than silently claiming the page was complete, which
    // would be exactly the "malformed lines... never silently dropped"
    // violation this whole slice exists to close.
    String nextCursor = moreWithinThisFetch ? buildNextCursor(page, originalRequest, incoming) : null;
    boolean truncated = moreWithinThisFetch;

    // Exact only for a genuinely complete, unpaginated single-page result
    // (see class javadoc "Totals"). Never returned=total, never null=zero.
    Integer estimatedTotal = (incoming == null && !truncated) ? page.size() : null;

    ResultCounts counts = new ResultCounts(estimatedTotal, page.size(), page.size(), effectiveLimit, truncated);
    return new SearchResult(page, counts, nextCursor);
  }

  private boolean isAlreadySeenAtBoundary(CanonicalLogEvent e, PageCursor incoming) {
    return e.timestamp() != null
        && e.timestamp().equals(incoming.boundaryTimestamp())
        && incoming.boundaryKeys().contains(PageCursorCodec.eventFingerprint(e));
  }

  /**
   * Never {@code null} unless every event on {@code page} has no parsed
   * timestamp (malformed events sort last but are never dropped -
   * CLAUDE.md §4 "Parsing" - so a page can, in principle, be nothing but
   * malformed events at the very tail of a source's bounded history). In
   * that rare edge case there is no safe timestamp to narrow the next
   * query by, so pagination stops there rather than risk an incorrect
   * boundary - correctness over completeness.
   */
  private String buildNextCursor(List<CanonicalLogEvent> page, SearchRequest originalRequest, PageCursor incoming) {
    Optional<Instant> boundary = findBoundary(page);
    if (boundary.isEmpty()) {
      return null;
    }
    Instant boundaryTimestamp = boundary.get();
    Set<String> boundaryKeys = new LinkedHashSet<>();
    for (CanonicalLogEvent e : page) {
      if (boundaryTimestamp.equals(e.timestamp())) {
        boundaryKeys.add(PageCursorCodec.eventFingerprint(e));
      }
    }
    int nextPageIndex = (incoming == null ? 1 : incoming.pageIndex() + 1);
    return cursorCodec.encode(originalRequest, boundaryTimestamp, boundaryKeys, nextPageIndex);
  }

  /** The last (oldest, since every source sorts newest-first) event on the page that actually has a parsed timestamp. */
  private Optional<Instant> findBoundary(List<CanonicalLogEvent> page) {
    for (int i = page.size() - 1; i >= 0; i--) {
      Instant ts = page.get(i).timestamp();
      if (ts != null) {
        return Optional.of(ts);
      }
    }
    return Optional.empty();
  }
}
