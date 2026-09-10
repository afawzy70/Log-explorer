package com.logexplorer.core.model;

import java.time.Instant;
import java.util.List;

/**
 * Health/diagnostics for one source. {@code message} must already be
 * sanitized by the adapter before this is constructed — never a raw
 * exception message, stack trace, or credential (CLAUDE.md §2 rule 2).
 *
 * <p><b>Legacy Remediation Slice 6</b> adds {@code warnings} — zero or more
 * short, sanitized, fixed-vocabulary strings describing a degradation
 * reason (e.g. "no containers matched the configured Compose project
 * filter"), built the same way {@link
 * com.logexplorer.source.docker.DockerDiagnostics} already builds {@code
 * message} for a DOWN result: classified, pre-written text, never a raw
 * exception message or environment-specific detail. Empty (never {@code
 * null}) when there is nothing to warn about. {@code DEGRADED} is for a
 * source that is genuinely reachable but has a real, observable reason to
 * distrust completeness (e.g. zero matching containers) — never used
 * speculatively.
 *
 * <p>Latency and capability-availability are deliberately NOT fields of
 * this domain record — they are the API layer's own concern ({@code
 * api.dto.SourceHealthDto}), computed generically for every source
 * (latency via {@code Mono#elapsed()}, capabilities via {@code
 * LogSource#capabilities()}) rather than duplicated into every adapter.
 */
public record SourceHealth(
    Status status,
    String message,
    Instant checkedAt,
    List<String> warnings
) {
  public enum Status { UP, DOWN, DEGRADED }

  public SourceHealth {
    warnings = warnings == null ? List.of() : List.copyOf(warnings);
  }

  /** Convenience for the common case: nothing to warn about. */
  public SourceHealth(Status status, String message, Instant checkedAt) {
    this(status, message, checkedAt, List.of());
  }
}
