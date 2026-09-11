package com.logexplorer.api.dto;

import java.util.List;

/**
 * {@code GET /api/v1/sources/openshift/workloads} response (OS-1B §7/§16).
 *
 * @param status overall {@code SUCCESS}/{@code PARTIAL}/{@code FORBIDDEN},
 *     derived from {@code kindOutcomes} — never a generic "failed" when
 *     the evidence supports a precise state
 */
public record OpenShiftWorkloadDiscoveryDto(
    String status, List<OpenShiftWorkloadDto> workloads, List<OpenShiftWorkloadKindOutcomeDto> kindOutcomes) {}
