package com.logexplorer.core.model;

import java.time.Instant;

/**
 * Health/diagnostics for one source. {@code message} must already be
 * sanitized by the adapter before this is constructed — never a raw
 * exception message, stack trace, or credential (CLAUDE.md §2 rule 2).
 */
public record SourceHealth(
    Status status,
    String message,
    Instant checkedAt
) {
  public enum Status { UP, DOWN, DEGRADED }
}
