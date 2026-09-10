package com.logexplorer.api.dto;

import com.logexplorer.core.model.SourceCapabilities;
import com.logexplorer.core.model.SourceHealth;
import java.time.Instant;
import java.util.List;

/**
 * {@code GET /api/v1/sources/{id}/health} response (Legacy Remediation
 * Slice 6) — the richer health model. A small, explicit, stable wire shape
 * rather than leaking any internal adapter object; {@code capabilities}
 * carries no sensitive data (same type already returned verbatim by {@code
 * GET /api/v1/sources}). {@code latencyMs} is measured by {@link
 * com.logexplorer.api.SourcesController} itself, generically for every
 * source, via {@code Mono#elapsed()} — the actual wall-clock time from
 * subscribing to {@link com.logexplorer.source.LogSource#health()} to its
 * result, never a fabricated/estimated number.
 */
public record SourceHealthDto(
    SourceHealth.Status status,
    String message,
    Instant checkedAt,
    Long latencyMs,
    List<String> warnings,
    SourceCapabilities capabilities
) {
  public static SourceHealthDto of(SourceHealth health, long latencyMs, SourceCapabilities capabilities) {
    return new SourceHealthDto(
        health.status(), health.message(), health.checkedAt(), latencyMs, health.warnings(), capabilities);
  }
}
