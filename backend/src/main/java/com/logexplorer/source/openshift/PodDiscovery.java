package com.logexplorer.source.openshift;

import java.util.List;

/**
 * The outcome of one pod-resolution pass (OS-1B review recovery — "All
 * workloads" scope truthfulness).
 *
 * <p>For a specifically-selected workload, resolution is always {@link
 * Status#COMPLETE}: either the single workload's pods resolve, or the
 * call fails outright — there is no partial-RBAC ambiguity at that level.
 *
 * <p>For "All workloads" (no workload selected), {@link #status()}
 * reflects whether the workload set this pod list was built from is
 * itself known to be complete ({@link OpenShiftScope#workloadScopeComplete()}
 * at the time of resolution) and whether every individual supported
 * workload's own pod-selector fetch succeeded. {@code PARTIAL} means:
 * pods belonging to at least one supported workload could not be proven
 * or included — never that the returned list is wrong, only that it may
 * be incomplete. The pod list itself is never widened to "every pod in
 * the namespace" to compensate for a gap; that would silently reintroduce
 * exactly the defect this recovery fixes.
 */
public record PodDiscovery(List<PodSummary> pods, Status status) {

  public enum Status {
    COMPLETE,
    PARTIAL
  }
}
