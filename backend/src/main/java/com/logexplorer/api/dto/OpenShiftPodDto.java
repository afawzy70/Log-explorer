package com.logexplorer.api.dto;

import java.util.List;

/**
 * One discovered pod (OS-1B §10/§29) — safe scope metadata only, never a
 * manifest, never environment variables, never labels/annotations.
 *
 * @param workloadKind / workloadName null when this pod was discovered as
 *     part of an unscoped "All workloads" namespace-wide listing
 */
public record OpenShiftPodDto(
    String name,
    String phase,
    String readySummary,
    int restartCount,
    List<String> containerNames,
    String workloadKind,
    String workloadName) {}
