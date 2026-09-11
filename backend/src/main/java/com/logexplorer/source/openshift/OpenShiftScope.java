package com.logexplorer.source.openshift;

import com.logexplorer.source.openshift.WorkloadDiscovery.KindOutcome;
import java.util.List;

/**
 * The workload/pod/container half of the connection's current scope
 * (OS-1B §12/§14) — deliberately a separate immutable value nested inside
 * {@link OpenShiftSession}'s own snapshot, rather than more loose fields,
 * so every cascading-reset rule in OS-1B §14 is one small, testable method
 * here instead of scattered field-clearing at every call site.
 *
 * <h2>Cascading resets</h2>
 *
 * <p>Each {@code with*} method below clears exactly the levels below the
 * one it changes: selecting a workload clears pod and container;
 * selecting a pod clears container; replacing the workload list clears the
 * selected workload (and everything below it) if that workload is no
 * longer present, and leaves it untouched otherwise. {@link
 * OpenShiftSession} is responsible for replacing this whole value with
 * {@link #EMPTY} on project change, disconnect, reconnect and expiry
 * (OS-1B §14) — this type only knows about workload/pod/container, never
 * about the project/namespace above it.
 *
 * <h2>{@code workloadKindOutcomes} (OS-1B review recovery)</h2>
 *
 * <p>Carried alongside {@link #workloads()} — never independently
 * updatable — so that a later "All workloads" pod resolution can tell
 * whether the workload list it is about to build pod scope from was
 * genuinely complete (every kind {@code AVAILABLE} or truthfully
 * {@code UNAVAILABLE_RESOURCE_TYPE}) or only partially known (a kind was
 * {@code FORBIDDEN} or {@code ERROR}). Without this, a forbidden
 * {@code DaemonSet} listing would silently and indistinguishably look
 * identical to a namespace that genuinely has zero DaemonSets.
 */
public record OpenShiftScope(
    List<WorkloadSummary> workloads,
    List<KindOutcome> workloadKindOutcomes,
    WorkloadRef selectedWorkload,
    List<PodSummary> pods,
    String selectedPod,
    List<String> containers,
    String selectedContainer) {

  public static final OpenShiftScope EMPTY =
      new OpenShiftScope(List.of(), List.of(), null, List.of(), null, List.of(), null);

  /**
   * Replaces the discovered workload list and the per-kind outcomes it was
   * built from. If the currently-selected workload is no longer in it, the
   * selection (and everything below it) is cleared truthfully rather than
   * kept pointing at a workload that disappeared (OS-1B §14 "Workload
   * disappears").
   */
  public OpenShiftScope withWorkloads(List<WorkloadSummary> newWorkloads, List<KindOutcome> newKindOutcomes) {
    boolean stillPresent = selectedWorkload != null
        && newWorkloads.stream().anyMatch(w -> w.ref().equals(selectedWorkload));
    if (stillPresent) {
      return new OpenShiftScope(List.copyOf(newWorkloads), List.copyOf(newKindOutcomes), selectedWorkload, pods,
          selectedPod, containers, selectedContainer);
    }
    return new OpenShiftScope(List.copyOf(newWorkloads), List.copyOf(newKindOutcomes), null, List.of(), null,
        List.of(), null);
  }

  /** Selects a workload (or clears it with {@code null}), clearing pod and container below it. */
  public OpenShiftScope withSelectedWorkload(WorkloadRef ref) {
    return new OpenShiftScope(workloads, workloadKindOutcomes, ref, List.of(), null, List.of(), null);
  }

  /**
   * Replaces the discovered pod list. If the currently-selected pod is no
   * longer in it, the selection (and its container) is cleared truthfully
   * (OS-1B §14 "Pod disappears").
   */
  public OpenShiftScope withPods(List<PodSummary> newPods) {
    boolean stillPresent = selectedPod != null && newPods.stream().anyMatch(p -> p.name().equals(selectedPod));
    if (stillPresent) {
      return new OpenShiftScope(workloads, workloadKindOutcomes, selectedWorkload, List.copyOf(newPods), selectedPod,
          containers, selectedContainer);
    }
    return new OpenShiftScope(workloads, workloadKindOutcomes, selectedWorkload, List.copyOf(newPods), null,
        List.of(), null);
  }

  /** Selects a pod (or clears it with {@code null}), clearing the container below it. */
  public OpenShiftScope withSelectedPod(String podName) {
    return new OpenShiftScope(workloads, workloadKindOutcomes, selectedWorkload, pods, podName, List.of(), null);
  }

  /** Replaces the discovered container list, clearing the selection if it is no longer present. */
  public OpenShiftScope withContainers(List<String> newContainers) {
    String kept = selectedContainer != null && newContainers.contains(selectedContainer) ? selectedContainer : null;
    return new OpenShiftScope(workloads, workloadKindOutcomes, selectedWorkload, pods, selectedPod,
        List.copyOf(newContainers), kept);
  }

  public OpenShiftScope withSelectedContainer(String containerName) {
    return new OpenShiftScope(workloads, workloadKindOutcomes, selectedWorkload, pods, selectedPod, containers,
        containerName);
  }

  /** The cached pod matching {@code podName}, if it is part of the last discovered pod list. */
  public PodSummary findPod(String podName) {
    return pods.stream().filter(p -> p.name().equals(podName)).findFirst().orElse(null);
  }

  public boolean hasWorkload(WorkloadRef ref) {
    return workloads.stream().anyMatch(w -> w.ref().equals(ref));
  }

  /**
   * Whether the current {@link #workloads()} list is known to be the
   * *complete* set of supported workloads in this project, or only a
   * partial view because at least one kind could not be listed (OS-1B
   * review recovery §5). A kind that is genuinely {@code
   * UNAVAILABLE_RESOURCE_TYPE} (the cluster does not expose that API at
   * all) does not make the scope partial — there is nothing missing to
   * account for. A kind that is {@code FORBIDDEN} or {@code ERROR} does:
   * workloads of that kind may exist and simply could not be seen.
   */
  public boolean workloadScopeComplete() {
    return workloadKindOutcomes.stream()
        .allMatch(o -> o.status() == KindOutcome.Status.AVAILABLE
            || o.status() == KindOutcome.Status.UNAVAILABLE_RESOURCE_TYPE);
  }
}
