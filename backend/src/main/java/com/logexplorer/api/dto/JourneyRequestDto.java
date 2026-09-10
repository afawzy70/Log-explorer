package com.logexplorer.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.Instant;

/**
 * Inbound {@code POST /api/v1/logs/journey} body - "Click actions on
 * non-sensitive IDs: Find this trace / correlation / journey / event"
 * (IMPLEMENTATION_PLAN.md "Phase I", HANDOVER.md §17). {@code field} is a
 * closed choice of exactly the four non-sensitive identifiers ({@link
 * com.logexplorer.api.RequestMapper#toJourneyDomain} rejects anything
 * else) - structurally impossible to request a raw customer-identifier
 * click-search through this endpoint, the same "never" CLAUDE.md §2 rule
 * 1 states in words. {@code start}/{@code end} are the caller's own
 * currently-committed search window ("bounded time window",
 * HANDOVER.md §17) - this endpoint never invents or widens one.
 */
public record JourneyRequestDto(
    @NotBlank String sourceId,
    @NotNull Instant start,
    @NotNull Instant end,
    @NotBlank String field,
    @NotBlank String value,
    /** UX-R3 §9 — request-scoped Docker Compose project selection, never sensitive. */
    String composeProject
) {
}
