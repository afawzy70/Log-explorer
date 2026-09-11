package com.logexplorer.api.dto;

/**
 * The current workload/pod/container selection (OS-1B §12) — returned by
 * every scope-selection endpoint, mirroring how {@code
 * OpenShiftConnectionSummaryDto} already reports the project selection.
 * A {@code null} field genuinely means "All" at that level (OS-1B §22),
 * not "unknown".
 */
public record OpenShiftScopeSummaryDto(
    String selectedProject,
    String discoveryApi,
    String selectedWorkloadKind,
    String selectedWorkloadName,
    String selectedPod,
    String selectedContainer) {}
