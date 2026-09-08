package com.logexplorer.core.model;

/**
 * The single shared counts type (IMPLEMENTATION_PLAN.md §4) — prevents
 * contradictory count copy by construction: every caller uses these exact
 * fields, nothing free-floats as ad-hoc text.
 */
public record ResultCounts(
    Integer estimatedTotal,
    int returned,
    int visible,
    int limit,
    boolean truncated
) {
}
