package com.logexplorer.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.Instant;

/**
 * Inbound {@code POST /api/v1/logs/context} body — "Show ±30 seconds"
 * (HANDOVER.md §16.7, IMPLEMENTATION_PLAN.md "Phase H"). {@code timestamp}
 * is the event the investigator is centering on; {@code service}/{@code
 * containerId}/{@code pod} scope the surrounding window "where possible"
 * — all three are optional, and whichever are present are ANDed together.
 * There is no client-supplied window size: exactly ±30 seconds is
 * enforced server-side by {@link com.logexplorer.api.RequestMapper#toContextDomain},
 * never trusted from the request.
 */
public record ContextRequestDto(
    @NotBlank String sourceId,
    @NotNull Instant timestamp,
    String service,
    String containerId,
    String pod
) {
}
