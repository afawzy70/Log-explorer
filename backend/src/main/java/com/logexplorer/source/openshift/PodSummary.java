package com.logexplorer.source.openshift;

import java.util.List;

/**
 * One discovered pod (OS-1B §10/§29) — safe scope metadata only. No pod
 * environment variables, no annotations/labels, no manifest — just enough
 * to let an investigator pick a pod and, later, a container.
 *
 * @param name pod name — OS-1B §9 deliberately does not treat this as
 *     stable across rollouts; it is a point-in-time discovery result
 * @param phase Kubernetes pod phase (Pending/Running/Succeeded/Failed/Unknown)
 * @param readySummary e.g. {@code "1/1"} — ready container count over total,
 *     from the pod's own {@code status.containerStatuses}
 * @param restartCount sum of every container's restart count on this pod
 * @param containerNames runtime container names only — {@code
 *     spec.initContainers} are deliberately excluded (OS-1B §11: DEFERRED,
 *     not silently merged)
 * @param workload which workload this pod resolved from, or {@code null}
 *     when discovered as part of an unscoped ("All workloads") namespace-wide listing
 */
public record PodSummary(
    String name,
    String phase,
    String readySummary,
    int restartCount,
    List<String> containerNames,
    WorkloadRef workload) {}
