package com.logexplorer.core.model;

import com.logexplorer.core.query.QueryPlan;
import java.util.List;

/**
 * Result of a bounded historical search — one page, plus an opaque cursor
 * for the next. {@code queryPlan} (Legacy Remediation Slice 2) is optional
 * transparency about what the search actually did — {@code null} only for
 * result shapes that predate/don't route through {@code
 * api.SearchService#toResult} (defensively; every real production path
 * populates it).
 */
public record SearchResult(
    List<CanonicalLogEvent> events,
    ResultCounts counts,
    String nextCursor,
    QueryPlan queryPlan
) {
  public SearchResult {
    events = events == null ? List.of() : List.copyOf(events);
  }
}
