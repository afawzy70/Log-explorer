package com.logexplorer.api.dto;

import jakarta.validation.constraints.Size;

/**
 * Commits a workload selection (OS-1B §13). Both fields {@code null}
 * means "All workloads". {@code kind} is the {@code WorkloadKind} enum
 * name (e.g. {@code "DEPLOYMENT"}).
 */
public record OpenShiftWorkloadSelectionDto(@Size(max = 40) String kind, @Size(max = 253) String name) {}
