package com.logexplorer.source.openshift;

import java.util.Map;

/**
 * One discovered workload (OS-1B §6/§7) — replica counts and its pod
 * label selector, never the full manifest, a pod's own labels/annotations,
 * or anything else (OS-1B §29).
 *
 * @param desiredReplicas the workload's own declared/scheduled count (a
 *     {@code Deployment}/{@code StatefulSet}/{@code DeploymentConfig}'s
 *     {@code spec.replicas}, a {@code DaemonSet}'s {@code
 *     status.desiredNumberScheduled} — DaemonSets have no {@code
 *     spec.replicas} at all, replica count is scheduler-determined)
 * @param readyReplicas how many are currently ready, from the workload's
 *     own status — never resolved by counting pods separately, which
 *     would risk disagreeing with the workload's own reported state
 * @param selector the workload's own equality-based pod label selector
 *     (OS-1B review recovery — "All workloads" scope truthfulness),
 *     captured once from the same list response {@link
 *     OpenShiftApiClient#fetchWorkloads} already makes — never a second
 *     network call. Backend-internal only: never serialized to the
 *     frontend (see {@code api.dto.OpenShiftWorkloadDto}, which omits it).
 *     Kubernetes enforces {@code Deployment}/{@code StatefulSet}/{@code
 *     DaemonSet} selectors as immutable after creation, and OpenShift's
 *     {@code DeploymentConfig} selector is conventionally never changed
 *     post-creation either (changing it would orphan its own pods) - so a
 *     selector captured at discovery time is not a staleness risk the way
 *     the workload's replica counts would be.
 */
public record WorkloadSummary(WorkloadRef ref, int desiredReplicas, int readyReplicas, Map<String, String> selector) {

  public WorkloadSummary {
    selector = selector == null ? Map.of() : Map.copyOf(selector);
  }
}
