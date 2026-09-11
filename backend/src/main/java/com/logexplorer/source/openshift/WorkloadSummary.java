package com.logexplorer.source.openshift;

/**
 * One discovered workload (OS-1B §6/§7) — replica counts only, never the
 * full manifest, labels or annotations (OS-1B §29).
 *
 * @param desiredReplicas the workload's own declared/scheduled count (a
 *     {@code Deployment}/{@code StatefulSet}/{@code DeploymentConfig}'s
 *     {@code spec.replicas}, a {@code DaemonSet}'s {@code
 *     status.desiredNumberScheduled} — DaemonSets have no {@code
 *     spec.replicas} at all, replica count is scheduler-determined)
 * @param readyReplicas how many are currently ready, from the workload's
 *     own status — never resolved by counting pods separately, which
 *     would risk disagreeing with the workload's own reported state
 */
public record WorkloadSummary(WorkloadRef ref, int desiredReplicas, int readyReplicas) {}
