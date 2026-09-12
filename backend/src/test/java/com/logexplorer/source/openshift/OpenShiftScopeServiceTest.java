package com.logexplorer.source.openshift;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

import com.logexplorer.core.model.RawToken;
import com.logexplorer.source.openshift.MockOpenShiftScopeServer.KindStatus;
import com.logexplorer.source.openshift.MockOpenShiftScopeServer.PodFixture;
import com.logexplorer.source.openshift.MockOpenShiftScopeServer.WorkloadFixture;
import com.logexplorer.source.openshift.OpenShiftApiException.Kind;
import com.logexplorer.source.openshift.WorkloadDiscovery.KindOutcome;
import java.io.IOException;
import java.net.URI;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * OS-1B Layer 2 - workload/pod/container discovery against a deterministic
 * fake OpenShift/Kubernetes API ({@link MockOpenShiftScopeServer}).
 *
 * <p>Covers OS-1B §7 (namespace-scoped, per-kind-independent workload
 * discovery), §8 (DeploymentConfig truthfulness), §9 (selector-based
 * workload→pod resolution), §10/§11 (pod/container discovery), §13
 * (selection validation), §14 (cascading resets), §15 (stale-response
 * protection one level deeper than OS-1A), and §17 (partial RBAC).
 *
 * <h2>OS-1B review recovery — "All workloads" scope truthfulness</h2>
 *
 * <p>The block below headed "All workloads pod union" is new. It proves
 * the corrected invariant: {@code Workload = All} means "the union of
 * pods belonging to a currently-discovered <b>supported</b> workload",
 * never "every pod in the namespace". The original
 * {@code discoversAllPodsInTheNamespaceWhenNoWorkloadIsSelected} test
 * asserted the defective behaviour directly and has been replaced, not
 * weakened, by {@code
 * noSupportedWorkloadsMeansAnEmptyPodResultNeverEveryPodInTheNamespace}
 * and the tests after it - see the OS-1B verification report for the
 * full defect writeup.
 */
class OpenShiftScopeServiceTest {

  private static final String NAMESPACE = "payments";
  private static final RawToken TOKEN = RawToken.of("sha256~scope-test-token-0123456789");

  private MockOpenShiftScopeServer server;
  private OpenShiftApiClient client;
  private OpenShiftSession session;
  private OpenShiftScopeService scopeService;
  private URI base;

  @BeforeEach
  void setUp() throws IOException {
    server = new MockOpenShiftScopeServer(NAMESPACE);
    base = URI.create(server.baseUrl());
    client = new OpenShiftApiClient(Map.of());
    session = new OpenShiftSession();
    scopeService = new OpenShiftScopeService(client, session);
    connectAndSelectProject();
  }

  @AfterEach
  void tearDown() {
    if (server != null) {
      server.close();
    }
  }

  private void connectAndSelectProject() {
    OcLoginCommand command = new OcLoginCommand(base, TOKEN, null);
    long generation = session.connect(command, "Test", "developer", List.of(NAMESPACE),
        ProjectDiscovery.Api.PROJECTS, null);
    assertThat(session.selectProject(NAMESPACE, generation)).isTrue();
  }

  private static Map<String, String> labels(String... kv) {
    Map<String, String> map = new java.util.LinkedHashMap<>();
    for (int i = 0; i < kv.length; i += 2) {
      map.put(kv[i], kv[i + 1]);
    }
    return map;
  }

  /** Discovers a single supported Deployment and selects it - the setup most pod/container-mechanic tests need. */
  private WorkloadRef discoverAndSelectDeployment(String name, Map<String, String> selector) {
    server.setWorkloads(WorkloadKind.DEPLOYMENT, List.of(new WorkloadFixture(name, 1, 1, selector)));
    scopeService.discoverWorkloads().block();
    WorkloadRef ref = new WorkloadRef(WorkloadKind.DEPLOYMENT, name, NAMESPACE);
    assertThat(scopeService.selectWorkload(ref)).isTrue();
    return ref;
  }

  // ------------------------------------------------- workload discovery

  @Test
  void discoversTwoDeploymentsOneStatefulSetOneDaemonSetSortedByKindThenName() {
    server.setWorkloads(WorkloadKind.DEPLOYMENT, List.of(
        new WorkloadFixture("payment-worker", 1, 1, labels("app", "payment-worker")),
        new WorkloadFixture("payment-api", 2, 2, labels("app", "payment-api"))));
    server.setWorkloads(WorkloadKind.STATEFUL_SET, List.of(
        new WorkloadFixture("payment-db", 1, 1, labels("app", "payment-db"))));
    server.setWorkloads(WorkloadKind.DAEMON_SET, List.of(
        new WorkloadFixture("log-agent", 3, 3, labels("app", "log-agent"))));
    server.setKindStatus(WorkloadKind.DEPLOYMENT_CONFIG, KindStatus.NOT_FOUND);

    WorkloadDiscovery discovery = scopeService.discoverWorkloads().block();

    assertThat(discovery.status()).isEqualTo(WorkloadDiscovery.Status.PARTIAL);
    assertThat(discovery.workloads()).extracting(w -> w.ref().kind() + ":" + w.ref().name())
        .containsExactly(
            "DEPLOYMENT:payment-api", "DEPLOYMENT:payment-worker", // kind order, then name order
            "STATEFUL_SET:payment-db",
            "DAEMON_SET:log-agent");
    KindOutcome dcOutcome = discovery.kindOutcomes().stream()
        .filter(o -> o.kind() == WorkloadKind.DEPLOYMENT_CONFIG).findFirst().orElseThrow();
    assertThat(dcOutcome.status()).isEqualTo(KindOutcome.Status.UNAVAILABLE_RESOURCE_TYPE);
  }

  @Test
  void aDeploymentConfigThatIsAvailableMakesTheOverallStatusSuccess() {
    server.setWorkloads(WorkloadKind.DEPLOYMENT_CONFIG, List.of(
        new WorkloadFixture("legacy-billing", 1, 1, labels("app", "legacy-billing"))));

    WorkloadDiscovery discovery = scopeService.discoverWorkloads().block();

    assertThat(discovery.status()).isEqualTo(WorkloadDiscovery.Status.SUCCESS);
    assertThat(discovery.workloads()).extracting(w -> w.ref().name()).contains("legacy-billing");
  }

  @Test
  void everyKindAvailableButGenuinelyEmptyIsStillSuccess() {
    WorkloadDiscovery discovery = scopeService.discoverWorkloads().block();

    assertThat(discovery.status()).isEqualTo(WorkloadDiscovery.Status.SUCCESS);
    assertThat(discovery.workloads()).isEmpty();
  }

  @Test
  void aForbiddenKindIsRecordedAsForbiddenNotAsNoWorkloads() {
    server.setKindStatus(WorkloadKind.STATEFUL_SET, KindStatus.FORBIDDEN);

    WorkloadDiscovery discovery = scopeService.discoverWorkloads().block();

    assertThat(discovery.status()).isEqualTo(WorkloadDiscovery.Status.PARTIAL);
    KindOutcome outcome = discovery.kindOutcomes().stream()
        .filter(o -> o.kind() == WorkloadKind.STATEFUL_SET).findFirst().orElseThrow();
    assertThat(outcome.status()).isEqualTo(KindOutcome.Status.FORBIDDEN);
  }

  @Test
  void everyKindForbiddenMakesTheOverallStatusForbidden() {
    for (WorkloadKind kind : WorkloadKind.values()) {
      server.setKindStatus(kind, KindStatus.FORBIDDEN);
    }

    WorkloadDiscovery discovery = scopeService.discoverWorkloads().block();

    assertThat(discovery.status()).isEqualTo(WorkloadDiscovery.Status.FORBIDDEN);
    assertThat(discovery.workloads()).isEmpty();
  }

  @Test
  void aRealErrorOnOneKindIsRecordedAsErrorAndDoesNotFailTheOthers() {
    server.setKindStatus(WorkloadKind.DAEMON_SET, KindStatus.ERROR);
    server.setWorkloads(WorkloadKind.DEPLOYMENT, List.of(
        new WorkloadFixture("payment-api", 1, 1, labels("app", "payment-api"))));

    WorkloadDiscovery discovery = scopeService.discoverWorkloads().block();

    assertThat(discovery.status()).isEqualTo(WorkloadDiscovery.Status.PARTIAL);
    assertThat(discovery.workloads()).extracting(w -> w.ref().name()).containsExactly("payment-api");
    KindOutcome outcome = discovery.kindOutcomes().stream()
        .filter(o -> o.kind() == WorkloadKind.DAEMON_SET).findFirst().orElseThrow();
    assertThat(outcome.status()).isEqualTo(KindOutcome.Status.ERROR);
  }

  @Test
  void a401OnAnyKindAbortsTheWholeDiscoveryAndExpiresTheSession() {
    server.setUnauthorized(true);

    OpenShiftApiException e = catchThrowableOfType(
        () -> scopeService.discoverWorkloads().block(), OpenShiftApiException.class);

    assertThat(e.kind()).isEqualTo(Kind.UNAUTHORIZED);
    assertThat(session.state()).isEqualTo(OpenShiftConnectionState.EXPIRED);
  }

  // ------------------------------------------------------ workload select

  @Test
  void selectingAWorkloadTheDiscoveryReturnedSucceeds() {
    server.setWorkloads(WorkloadKind.DEPLOYMENT, List.of(
        new WorkloadFixture("payment-api", 2, 2, labels("app", "payment-api"))));
    scopeService.discoverWorkloads().block();
    WorkloadRef ref = new WorkloadRef(WorkloadKind.DEPLOYMENT, "payment-api", NAMESPACE);

    assertThat(scopeService.selectWorkload(ref)).isTrue();
    assertThat(session.scope().selectedWorkload()).isEqualTo(ref);
  }

  @Test
  void selectingAWorkloadDiscoveryNeverReturnedIsRejected() {
    scopeService.discoverWorkloads().block(); // empty discovery
    WorkloadRef fabricated = new WorkloadRef(WorkloadKind.DEPLOYMENT, "does-not-exist", NAMESPACE);

    assertThat(scopeService.selectWorkload(fabricated)).isFalse();
    assertThat(session.scope().selectedWorkload()).isNull();
  }

  @Test
  void clearingTheWorkloadSelectionWithNullAlwaysSucceeds() {
    assertThat(scopeService.selectWorkload(null)).isTrue();
  }

  // ------------------------------------------------- pods (selected workload)

  @Test
  void resolvesPodsForASelectedWorkloadViaItsSelectorOnly() {
    WorkloadRef ref = discoverAndSelectDeployment("payment-api", labels("app", "payment-api"));

    server.setPods(List.of(
        new PodFixture("payment-api-abc", "Running", 1, 1, 0, List.of("application"), labels("app", "payment-api")),
        new PodFixture("payment-api-def", "Running", 1, 1, 0, List.of("application"), labels("app", "payment-api")),
        // A pod belonging to a completely different workload must never leak in.
        new PodFixture("payment-worker-xyz", "Running", 1, 1, 0, List.of("application"),
            labels("app", "payment-worker"))));

    PodDiscovery discovery = scopeService.discoverPods().block();

    assertThat(discovery.status()).isEqualTo(PodDiscovery.Status.COMPLETE);
    assertThat(discovery.pods()).extracting(PodSummary::name).containsExactly("payment-api-abc", "payment-api-def");
    assertThat(discovery.pods()).allMatch(p -> p.workload().equals(ref));
  }

  @Test
  void rollingDeploymentOldAndNewReplicaSetPodsBothMatchTheSameSelectorForASelectedWorkload() {
    // Both the old and new ReplicaSet's pods carry the Deployment's own
    // selector labels during a rollout - selector-based matching correctly
    // includes both, which is the desired behaviour (see the OS-A
    // architecture assessment §8: old-replica visibility during a bad
    // rollout is desirable for log investigation, not a bug).
    discoverAndSelectDeployment("payment-api", labels("app", "payment-api"));

    server.setPods(List.of(
        new PodFixture("payment-api-oldrs-1", "Running", 1, 1, 0, List.of("application"),
            labels("app", "payment-api")),
        new PodFixture("payment-api-newrs-1", "Running", 1, 1, 0, List.of("application"),
            labels("app", "payment-api"))));

    PodDiscovery discovery = scopeService.discoverPods().block();

    assertThat(discovery.pods()).extracting(PodSummary::name)
        .containsExactlyInAnyOrder("payment-api-oldrs-1", "payment-api-newrs-1");
  }

  @Test
  void aPodWithMultipleContainersReportsAnAccurateReadySummaryAndContainerList() {
    discoverAndSelectDeployment("payment-api", labels("app", "payment-api"));
    server.setPods(List.of(
        new PodFixture("payment-api-abc", "Running", 2, 1, 3, List.of("application", "sidecar"),
            labels("app", "payment-api"))));

    PodDiscovery discovery = scopeService.discoverPods().block();

    PodSummary pod = discovery.pods().get(0);
    assertThat(pod.readySummary()).isEqualTo("1/2");
    assertThat(pod.containerNames()).containsExactly("application", "sidecar");
    assertThat(pod.restartCount()).isEqualTo(3);
  }

  @Test
  void deploymentConfigSelectorIsReadAsAFlatMapNotNestedUnderMatchLabels() {
    server.setWorkloads(WorkloadKind.DEPLOYMENT_CONFIG, List.of(
        new WorkloadFixture("legacy-billing", 1, 1, labels("deploymentconfig", "legacy-billing"))));
    scopeService.discoverWorkloads().block();
    WorkloadRef ref = new WorkloadRef(WorkloadKind.DEPLOYMENT_CONFIG, "legacy-billing", NAMESPACE);
    scopeService.selectWorkload(ref);
    server.setPods(List.of(
        new PodFixture("legacy-billing-1", "Running", 1, 1, 0, List.of("application"),
            labels("deploymentconfig", "legacy-billing"))));

    PodDiscovery discovery = scopeService.discoverPods().block();

    assertThat(discovery.pods()).extracting(PodSummary::name).containsExactly("legacy-billing-1");
  }

  @Test
  void aPodThatDisappearsBetweenDiscoveryCallsIsClearedFromTheSelectionTruthfully() {
    discoverAndSelectDeployment("payment-api", labels("app", "payment-api"));
    server.setPods(List.of(
        new PodFixture("payment-api-abc", "Running", 1, 1, 0, List.of("application"), labels("app", "payment-api"))));
    scopeService.discoverPods().block();
    assertThat(scopeService.selectPod("payment-api-abc")).isTrue();

    server.setPods(List.of()); // the pod is gone
    scopeService.discoverPods().block();

    assertThat(session.scope().selectedPod()).isNull();
  }

  @Test
  void selectingAPodDiscoveryNeverReturnedIsRejected() {
    discoverAndSelectDeployment("payment-api", labels("app", "payment-api"));
    scopeService.discoverPods().block(); // empty
    assertThat(scopeService.selectPod("fabricated-pod")).isFalse();
  }

  // -------------------------------------------------------- containers

  @Test
  void containerDiscoveryReturnsTheSelectedPodsCachedContainersWithNoExtraNetworkCall() {
    discoverAndSelectDeployment("payment-api", labels("app", "payment-api"));
    server.setPods(List.of(
        new PodFixture("payment-api-abc", "Running", 2, 2, 0, List.of("application", "sidecar"),
            labels("app", "payment-api"))));
    scopeService.discoverPods().block();
    scopeService.selectPod("payment-api-abc");
    int requestsBefore = server.podsRequestCount();

    List<String> containers = scopeService.discoverContainers();

    assertThat(containers).containsExactly("application", "sidecar");
    assertThat(server.podsRequestCount()).isEqualTo(requestsBefore); // no extra call
  }

  @Test
  void noContainersWhenNoPodIsSelected() {
    assertThat(scopeService.discoverContainers()).isEmpty();
  }

  @Test
  void selectingAContainerThePodDoesNotHaveIsRejected() {
    discoverAndSelectDeployment("payment-api", labels("app", "payment-api"));
    server.setPods(List.of(
        new PodFixture("payment-api-abc", "Running", 1, 1, 0, List.of("application"), labels("app", "payment-api"))));
    scopeService.discoverPods().block();
    scopeService.selectPod("payment-api-abc");
    scopeService.discoverContainers();

    assertThat(scopeService.selectContainer("does-not-exist")).isFalse();
    assertThat(scopeService.selectContainer("application")).isTrue();
  }

  // ============================================================
  // OS-1B review recovery — "All workloads" pod union truthfulness
  // ============================================================

  @Test
  void noSupportedWorkloadsMeansAnEmptyPodResultNeverEveryPodInTheNamespace() {
    // O. No supported workloads -> successful empty pod result. Even
    // though the fake server has pods sitting in the namespace, "All
    // workloads" must not fetch them at all, because zero supported
    // workloads were discovered to justify including any of them.
    scopeService.discoverWorkloads().block(); // genuinely nothing discovered
    server.setPods(List.of(
        new PodFixture("some-pod-that-must-never-appear", "Running", 1, 1, 0, List.of("application"), Map.of())));

    PodDiscovery discovery = scopeService.discoverPods().block();

    assertThat(discovery.status()).isEqualTo(PodDiscovery.Status.COMPLETE);
    assertThat(discovery.pods()).isEmpty();
    assertThat(server.podsRequestCount()).isZero(); // no unfiltered fetch ever happened
  }

  @Test
  void allWorkloadsUnionIncludesOnlyPodsProvenToBelongToASupportedDiscoveredWorkload() {
    // A: Deployment pod, B: StatefulSet pod, C: DaemonSet pod, D: DeploymentConfig pod - all INCLUDED.
    server.setWorkloads(WorkloadKind.DEPLOYMENT, List.of(
        new WorkloadFixture("payment-api", 1, 1, labels("app", "payment-api"))));
    server.setWorkloads(WorkloadKind.STATEFUL_SET, List.of(
        new WorkloadFixture("payment-db", 1, 1, labels("app", "payment-db"))));
    server.setWorkloads(WorkloadKind.DAEMON_SET, List.of(
        new WorkloadFixture("log-agent", 1, 1, labels("app", "log-agent"))));
    server.setWorkloads(WorkloadKind.DEPLOYMENT_CONFIG, List.of(
        new WorkloadFixture("legacy-billing", 1, 1, labels("deploymentconfig", "legacy-billing"))));
    scopeService.discoverWorkloads().block();

    server.setPods(List.of(
        new PodFixture("payment-api-abc", "Running", 1, 1, 0, List.of("application"), labels("app", "payment-api")),
        new PodFixture("payment-db-0", "Running", 1, 1, 0, List.of("application"), labels("app", "payment-db")),
        new PodFixture("log-agent-xyz", "Running", 1, 1, 0, List.of("application"), labels("app", "log-agent")),
        new PodFixture("legacy-billing-1", "Running", 1, 1, 0, List.of("application"),
            labels("deploymentconfig", "legacy-billing")),
        // E/F: a Job/CronJob-owned pod - carries batch-specific labels that
        // match none of the four supported workloads' selectors above.
        new PodFixture("nightly-batch-job-abc", "Running", 1, 1, 0, List.of("application"),
            labels("job-name", "nightly-batch")),
        new PodFixture("cronjob-run-xyz", "Running", 1, 1, 0, List.of("application"),
            labels("job-name", "cronjob-run-xyz")),
        // G: a standalone pod with no owning workload's selector at all.
        new PodFixture("standalone-debug-pod", "Running", 1, 1, 0, List.of("application"), Map.of()),
        // H: a pod from an unsupported/unknown custom controller.
        new PodFixture("custom-operator-managed-pod", "Running", 1, 1, 0, List.of("application"),
            labels("app.kubernetes.io/managed-by", "my-custom-operator"))));

    PodDiscovery discovery = scopeService.discoverPods().block();

    assertThat(discovery.status()).isEqualTo(PodDiscovery.Status.COMPLETE);
    // J: union of exactly the supported-workload pods, no duplicates, and
    // none of the excluded (Job/CronJob/standalone/unknown-controller) pods.
    assertThat(discovery.pods()).extracting(PodSummary::name).containsExactlyInAnyOrder(
        "payment-api-abc", "payment-db-0", "log-agent-xyz", "legacy-billing-1");
  }

  @Test
  void rollingDeploymentPodsAreBothIncludedInTheAllWorkloadsUnion() {
    // I, for the "All workloads" (union) path specifically - not just the selected-workload path.
    server.setWorkloads(WorkloadKind.DEPLOYMENT, List.of(
        new WorkloadFixture("payment-api", 2, 1, labels("app", "payment-api"))));
    scopeService.discoverWorkloads().block();

    server.setPods(List.of(
        new PodFixture("payment-api-oldrs-1", "Running", 1, 1, 0, List.of("application"),
            labels("app", "payment-api")),
        new PodFixture("payment-api-newrs-1", "Running", 1, 1, 0, List.of("application"),
            labels("app", "payment-api"))));

    PodDiscovery discovery = scopeService.discoverPods().block();

    assertThat(discovery.pods()).extracting(PodSummary::name)
        .containsExactlyInAnyOrder("payment-api-oldrs-1", "payment-api-newrs-1");
  }

  @Test
  void aPodMatchingTwoSupportedWorkloadsSelectorsIsIncludedOnlyOnce() {
    // J (no duplicates edge case): a pod whose labels happen to satisfy
    // more than one discovered workload's selector - a rare but possible
    // situation - must still appear exactly once in the union.
    server.setWorkloads(WorkloadKind.DEPLOYMENT, List.of(
        new WorkloadFixture("payment-api", 1, 1, labels("app", "payment-api"))));
    server.setWorkloads(WorkloadKind.STATEFUL_SET, List.of(
        new WorkloadFixture("payment-api-shared", 1, 1, labels("app", "payment-api"))));
    scopeService.discoverWorkloads().block();
    server.setPods(List.of(
        new PodFixture("payment-api-ambiguous", "Running", 1, 1, 0, List.of("application"),
            labels("app", "payment-api"))));

    PodDiscovery discovery = scopeService.discoverPods().block();

    assertThat(discovery.pods()).extracting(PodSummary::name).containsExactly("payment-api-ambiguous");
  }

  @Test
  void aForbiddenWorkloadKindMakesAllWorkloadsPartialWithoutWideningToNamespacePods() {
    // K: DaemonSet forbidden. Deployment still available and its pods are
    // included; the DaemonSet's own (undiscoverable) pods are correctly
    // absent, and the result is marked PARTIAL rather than confidently complete.
    server.setWorkloads(WorkloadKind.DEPLOYMENT, List.of(
        new WorkloadFixture("payment-api", 1, 1, labels("app", "payment-api"))));
    server.setKindStatus(WorkloadKind.DAEMON_SET, KindStatus.FORBIDDEN);
    scopeService.discoverWorkloads().block();

    server.setPods(List.of(
        new PodFixture("payment-api-abc", "Running", 1, 1, 0, List.of("application"), labels("app", "payment-api")),
        // A pod that would have belonged to the forbidden DaemonSet - the
        // old defective behaviour would have swept this in via an
        // unfiltered namespace listing; it must NOT appear now.
        new PodFixture("log-agent-forbidden-xyz", "Running", 1, 1, 0, List.of("application"),
            labels("app", "log-agent"))));

    PodDiscovery discovery = scopeService.discoverPods().block();

    assertThat(discovery.status()).isEqualTo(PodDiscovery.Status.PARTIAL);
    assertThat(discovery.pods()).extracting(PodSummary::name).containsExactly("payment-api-abc");
  }

  @Test
  void anUnavailableResourceTypeDoesNotMakeAllWorkloadsPartial() {
    // L: DeploymentConfig 404 (genuinely absent) is not treated as
    // forbidden - the remaining supported workload scope stays COMPLETE.
    server.setWorkloads(WorkloadKind.DEPLOYMENT, List.of(
        new WorkloadFixture("payment-api", 1, 1, labels("app", "payment-api"))));
    server.setKindStatus(WorkloadKind.DEPLOYMENT_CONFIG, KindStatus.NOT_FOUND);
    scopeService.discoverWorkloads().block();
    server.setPods(List.of(
        new PodFixture("payment-api-abc", "Running", 1, 1, 0, List.of("application"), labels("app", "payment-api"))));

    PodDiscovery discovery = scopeService.discoverPods().block();

    assertThat(discovery.status()).isEqualTo(PodDiscovery.Status.COMPLETE);
    assertThat(discovery.pods()).extracting(PodSummary::name).containsExactly("payment-api-abc");
  }

  @Test
  void aPerWorkloadPodFetchFailureMarksTheUnionPartialWithoutFailingTheWholeRequest() {
    // A supported workload was discovered successfully, but resolving its
    // own pods independently fails (e.g. a pod-scoped RBAC gap distinct
    // from listing the workload object itself) - the union still returns
    // what it could prove, marked PARTIAL.
    server.setWorkloads(WorkloadKind.DEPLOYMENT, List.of(
        new WorkloadFixture("payment-api", 1, 1, labels("app", "payment-api")),
        new WorkloadFixture("payment-worker", 1, 1, labels("app", "payment-worker"))));
    scopeService.discoverWorkloads().block();
    server.setPods(List.of(
        new PodFixture("payment-worker-xyz", "Running", 1, 1, 0, List.of("application"),
            labels("app", "payment-worker"))));
    server.setPodsForbiddenForSelector(labels("app", "payment-api"));

    PodDiscovery discovery = scopeService.discoverPods().block();

    assertThat(discovery.status()).isEqualTo(PodDiscovery.Status.PARTIAL);
    assertThat(discovery.pods()).extracting(PodSummary::name).containsExactly("payment-worker-xyz");
  }

  // -------------------------------------------------- stale-response protection

  @Test
  void aWorkloadDiscoveryResponseForAProjectTheUserHasSinceLeftIsDiscarded() {
    server.setWorkloads(WorkloadKind.DEPLOYMENT, List.of(
        new WorkloadFixture("payment-api", 1, 1, labels("app", "payment-api"))));

    // Apply the update as if it were still in flight for a DIFFERENT
    // project than the one currently selected - simulates the response
    // arriving after the user switched projects.
    long generation = session.generation();
    boolean applied = session.updateWorkloads(
        List.of(new WorkloadSummary(new WorkloadRef(WorkloadKind.DEPLOYMENT, "payment-api", "other-namespace"), 1, 1,
            labels("app", "payment-api"))),
        List.of(),
        "other-namespace", generation);

    assertThat(applied).isFalse();
    assertThat(session.scope().workloads()).isEmpty();
  }

  @Test
  void aPodDiscoveryResponseForAWorkloadTheUserHasSinceLeftIsDiscarded() {
    server.setWorkloads(WorkloadKind.DEPLOYMENT, List.of(
        new WorkloadFixture("payment-api", 1, 1, labels("app", "payment-api")),
        new WorkloadFixture("payment-worker", 1, 1, labels("app", "payment-worker"))));
    scopeService.discoverWorkloads().block();
    WorkloadRef apiRef = new WorkloadRef(WorkloadKind.DEPLOYMENT, "payment-api", NAMESPACE);
    WorkloadRef workerRef = new WorkloadRef(WorkloadKind.DEPLOYMENT, "payment-worker", NAMESPACE);
    scopeService.selectWorkload(apiRef);
    long generation = session.generation();

    // The user switches to a different workload before the (simulated,
    // already-captured) API-workload's pod response is applied.
    scopeService.selectWorkload(workerRef);
    boolean applied = session.updatePods(
        List.of(new PodSummary("payment-api-abc", "Running", "1/1", 0, List.of("application"), apiRef)),
        true, NAMESPACE, apiRef, generation);

    assertThat(applied).isFalse();
    assertThat(session.scope().pods()).isEmpty();
  }

  @Test
  void aStaleAllWorkloadsPodResponseForAnAbandonedProjectIsDiscarded() {
    // M: "All workloads" pod response arrives after the user switched
    // projects. Both the old and new project start with selectedWorkload
    // == null, so only an explicit project check (not a workload check)
    // can catch this - this is exactly the gap this recovery closed in
    // OpenShiftSession#updatePods.
    server.setWorkloads(WorkloadKind.DEPLOYMENT, List.of(
        new WorkloadFixture("payment-api", 1, 1, labels("app", "payment-api"))));
    scopeService.discoverWorkloads().block();
    long generation = session.generation();

    // "accounts" must already be a known, visible project before it can
    // be selected - added here without disturbing the current selection
    // or scope, exactly like a background project-list refresh would.
    assertThat(session.updateProjects(List.of(NAMESPACE, "accounts"), ProjectDiscovery.Api.PROJECTS, generation))
        .isTrue();
    assertThat(session.selectProject("accounts", generation)).isTrue();
    boolean applied = session.updatePods(
        List.of(new PodSummary("payment-api-abc", "Running", "1/1", 0, List.of("application"), null)),
        true, NAMESPACE, null, generation);

    assertThat(applied).isFalse();
    assertThat(session.scope().pods()).isEmpty();
  }

  @Test
  void aStaleAllWorkloadsPodResponseAfterReconnectIsDiscarded() {
    // N: reconnect (new generation) while an "All workloads" pod
    // resolution for the old connection is still in flight.
    server.setWorkloads(WorkloadKind.DEPLOYMENT, List.of(
        new WorkloadFixture("payment-api", 1, 1, labels("app", "payment-api"))));
    scopeService.discoverWorkloads().block();
    long staleGeneration = session.generation();

    OcLoginCommand second = new OcLoginCommand(base, TOKEN, null);
    session.connect(second, "Second", "someone-else", List.of(NAMESPACE), ProjectDiscovery.Api.PROJECTS, null);

    boolean applied = session.updatePods(
        List.of(new PodSummary("payment-api-abc", "Running", "1/1", 0, List.of("application"), null)),
        true, NAMESPACE, null, staleGeneration);

    assertThat(applied).isFalse();
  }

  @Test
  void aStaleWorkloadDiscoveryFromAReplacedConnectionThrowsRatherThanOverwriting() throws Exception {
    server.setWorkloads(WorkloadKind.DEPLOYMENT, List.of(
        new WorkloadFixture("payment-api", 1, 1, labels("app", "payment-api"))));
    server.setPodsDelayMs(500);

    long staleGeneration = session.generation();
    // Reconnect entirely - a new generation, a fresh (empty) scope.
    OcLoginCommand second = new OcLoginCommand(base, TOKEN, null);
    session.connect(second, "Second", "someone-else", List.of(NAMESPACE), ProjectDiscovery.Api.PROJECTS, null);

    boolean applied = session.updateWorkloads(List.of(), List.of(), NAMESPACE, staleGeneration);

    assertThat(applied).isFalse();
  }
}
