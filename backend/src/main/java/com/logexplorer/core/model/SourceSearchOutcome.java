package com.logexplorer.core.model;

import java.util.List;

/**
 * OS-1C review recovery — the result of one {@code LogSource} search
 * invocation, plus any runtime completeness/warning metadata discovered
 * <em>while executing that exact invocation</em> (a specific target could
 * not be read, an internal byte/line/event cap was actually reached — as
 * opposed to {@code LogSource#describeScopeWarnings}, which can only
 * report what is known before any network call is made).
 *
 * <p>Carried entirely by this record's own value — never a shared/mutable
 * "last search" field on a source instance — so it is safe by
 * construction for two overlapping concurrent searches on the same
 * source: each invocation produces its own {@code Mono<SourceSearchOutcome>}
 * and its own outcome; nothing is ever shared between them.
 *
 * <p>{@code runtimeWarnings} uses the exact same human-readable,
 * already-safe (identity only, never a raw response body or credential)
 * shape {@link com.logexplorer.core.query.QueryPlan#notes()} already
 * uses for pre-search scope warnings — {@code api.SearchService} appends
 * these into that same {@code notes} list rather than inventing a
 * second, parallel channel, so pre-search and runtime reasons coexist in
 * one place a caller only has to read once.
 */
public record SourceSearchOutcome(
    List<CanonicalLogEvent> events,
    List<String> runtimeWarnings
) {
  public SourceSearchOutcome {
    events = events == null ? List.of() : List.copyOf(events);
    runtimeWarnings = runtimeWarnings == null ? List.of() : List.copyOf(runtimeWarnings);
  }

  /** Every source that reports nothing wrong with this exact invocation reaches for this constant. */
  public static SourceSearchOutcome of(List<CanonicalLogEvent> events) {
    return new SourceSearchOutcome(events, List.of());
  }
}
