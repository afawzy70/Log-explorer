package com.logexplorer.source.openshift;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * OS-1B §14 - the cascading-reset rules, tested directly against {@link
 * OpenShiftScope} in isolation from the session/generation machinery
 * around it (that machinery is covered by {@link OpenShiftSecurityBoundariesTest}
 * and {@link OpenShiftScopeServiceTest}).
 */
class OpenShiftScopeTest {

  private static final WorkloadRef DEPLOYMENT = new WorkloadRef(WorkloadKind.DEPLOYMENT, "payment-api", "payments");
  private static final WorkloadRef WORKER = new WorkloadRef(WorkloadKind.DEPLOYMENT, "payment-worker", "payments");
  private static final WorkloadSummary DEPLOYMENT_SUMMARY = new WorkloadSummary(DEPLOYMENT, 2, 2);
  private static final WorkloadSummary WORKER_SUMMARY = new WorkloadSummary(WORKER, 1, 1);

  @Test
  void selectingAWorkloadClearsPodAndContainer() {
    OpenShiftScope scope = OpenShiftScope.EMPTY
        .withWorkloads(List.of(DEPLOYMENT_SUMMARY))
        .withSelectedWorkload(DEPLOYMENT)
        .withPods(List.of(pod("payment-api-abc123")))
        .withSelectedPod("payment-api-abc123")
        .withContainers(List.of("application"))
        .withSelectedContainer("application");

    OpenShiftScope reselected = scope.withSelectedWorkload(WORKER);

    assertThat(reselected.selectedWorkload()).isEqualTo(WORKER);
    assertThat(reselected.pods()).isEmpty();
    assertThat(reselected.selectedPod()).isNull();
    assertThat(reselected.containers()).isEmpty();
    assertThat(reselected.selectedContainer()).isNull();
  }

  @Test
  void selectingAPodClearsContainer() {
    OpenShiftScope scope = OpenShiftScope.EMPTY
        .withPods(List.of(pod("a"), pod("b")))
        .withSelectedPod("a")
        .withContainers(List.of("application"))
        .withSelectedContainer("application");

    OpenShiftScope reselected = scope.withSelectedPod("b");

    assertThat(reselected.selectedPod()).isEqualTo("b");
    assertThat(reselected.containers()).isEmpty();
    assertThat(reselected.selectedContainer()).isNull();
  }

  @Test
  void aWorkloadThatDisappearsFromARefreshedListIsClearedWithEverythingBelowIt() {
    OpenShiftScope scope = OpenShiftScope.EMPTY
        .withWorkloads(List.of(DEPLOYMENT_SUMMARY, WORKER_SUMMARY))
        .withSelectedWorkload(DEPLOYMENT)
        .withPods(List.of(pod("payment-api-abc123")))
        .withSelectedPod("payment-api-abc123");

    OpenShiftScope refreshed = scope.withWorkloads(List.of(WORKER_SUMMARY)); // DEPLOYMENT is gone

    assertThat(refreshed.selectedWorkload()).isNull();
    assertThat(refreshed.pods()).isEmpty();
    assertThat(refreshed.selectedPod()).isNull();
    assertThat(refreshed.workloads()).containsExactly(WORKER_SUMMARY);
  }

  @Test
  void aWorkloadThatIsStillPresentAfterARefreshKeepsItsDeeperSelection() {
    OpenShiftScope scope = OpenShiftScope.EMPTY
        .withWorkloads(List.of(DEPLOYMENT_SUMMARY))
        .withSelectedWorkload(DEPLOYMENT)
        .withPods(List.of(pod("payment-api-abc123")))
        .withSelectedPod("payment-api-abc123");

    // A refresh that still returns the selected workload (perhaps with a
    // new ready-replica count) must not wipe pod/container beneath it.
    OpenShiftScope refreshed = scope.withWorkloads(List.of(new WorkloadSummary(DEPLOYMENT, 3, 3)));

    assertThat(refreshed.selectedWorkload()).isEqualTo(DEPLOYMENT);
    assertThat(refreshed.selectedPod()).isEqualTo("payment-api-abc123");
  }

  @Test
  void aPodThatDisappearsFromARefreshedListIsClearedWithItsContainer() {
    OpenShiftScope scope = OpenShiftScope.EMPTY
        .withPods(List.of(pod("a"), pod("b")))
        .withSelectedPod("a")
        .withContainers(List.of("application"))
        .withSelectedContainer("application");

    OpenShiftScope refreshed = scope.withPods(List.of(pod("b"))); // "a" is gone

    assertThat(refreshed.selectedPod()).isNull();
    assertThat(refreshed.containers()).isEmpty();
    assertThat(refreshed.selectedContainer()).isNull();
  }

  @Test
  void aContainerThatDisappearsFromARefreshedListIsCleared() {
    OpenShiftScope scope = OpenShiftScope.EMPTY
        .withContainers(List.of("application", "sidecar"))
        .withSelectedContainer("sidecar");

    OpenShiftScope refreshed = scope.withContainers(List.of("application")); // "sidecar" is gone

    assertThat(refreshed.selectedContainer()).isNull();
    assertThat(refreshed.containers()).containsExactly("application");
  }

  @Test
  void clearingAWorkloadSelectionWithNullMeansAllWorkloads() {
    OpenShiftScope scope = OpenShiftScope.EMPTY
        .withWorkloads(List.of(DEPLOYMENT_SUMMARY))
        .withSelectedWorkload(DEPLOYMENT)
        .withPods(List.of(pod("payment-api-abc123")))
        .withSelectedPod("payment-api-abc123");

    OpenShiftScope cleared = scope.withSelectedWorkload(null);

    assertThat(cleared.selectedWorkload()).isNull();
    assertThat(cleared.pods()).isEmpty();
    assertThat(cleared.workloads()).containsExactly(DEPLOYMENT_SUMMARY); // the discovered list itself is untouched
  }

  private static PodSummary pod(String name) {
    return new PodSummary(name, "Running", "1/1", 0, List.of("application"), DEPLOYMENT);
  }
}
