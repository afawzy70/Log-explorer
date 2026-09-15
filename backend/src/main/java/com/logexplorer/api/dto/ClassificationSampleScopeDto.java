package com.logexplorer.api.dto;

import java.time.Instant;
import java.util.List;

/**
 * The search scope a bounded classification sample is read from — the
 * user's current source, project, time range, services, and severities.
 * Sampling runs through the normal search pipeline (guardrails, mapping
 * gate, concurrency limits); sampled events are never retained.
 */
public record ClassificationSampleScopeDto(
    String sourceId,
    String composeProject,
    Instant start,
    Instant end,
    List<String> services,
    String serviceFilterMode,
    List<String> levels
) {
}
