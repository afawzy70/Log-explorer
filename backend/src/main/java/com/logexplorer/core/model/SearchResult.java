package com.logexplorer.core.model;

import java.util.List;

/** Result of a bounded historical search — one page, plus an opaque cursor for the next. */
public record SearchResult(
    List<CanonicalLogEvent> events,
    ResultCounts counts,
    String nextCursor
) {
  public SearchResult {
    events = events == null ? List.of() : List.copyOf(events);
  }
}
