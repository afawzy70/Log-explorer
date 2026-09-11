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

  // ------------------------------------------------------------- pods

  @Test
  void discoversAllPodsInTheNamespaceWhenNoWorkloadIsSelected() {
    server.setPods(List.of(
        new PodFixture("payment-api-abc", "Running", 1, 1, 0, List.of("application"), labels("app", "payment-api")),
        new PodFixture("payment-worker-xyz", "Running", 1, 1, 0, List.of("application"),
            labels("app", "payment-worker"))));

    List<PodSummary> pods = scopeService.discoverPods().block();

    assertThat(pods).extracting(PodSummary::name).containsExactly("payment-api-abc", "payment-worker-xyz");
    assertThat(server.lastPodsQuery()).isNull(); // unscoped listing sends no labelSelector at all
  }

  @Test
  void resolvesPodsForASelectedWorkloadViaItsSelectorOnly() {
    server.setWorkloads(WorkloadKind.DEPLOYMENT, List.of(
        new WorkloadFixture("payment-api", 2, 2, labels("app", "payment-api"))));
    scopeService.discoverWorkloads().block();
    WorkloadRef ref = new WorkloadRef(WorkloadKind.DEPLOYMENT, "payment-api", NAMESPACE);
    scopeService.selectWorkload(ref);

    server.setPods(List.of(
        new PodFixture("payment-api-abc", "Running", 1, 1, 0, List.of("application"), labels("app", "payment-api")),
        new PodFixture("payment-api-def", "Running", 1, 1, 0, List.of("application"), labels("app", "payment-api")),
        // A pod belonging to a completely different workload must never leak in.
        new PodFixture("payment-worker-xyz", "Running", 1, 1, 0, List.of("application"),
            labels("app", "payment-worker"))));

    List<PodSummary> pods = scopeService.discoverPods().block();

    assertThat(pods).extracting(PodSummary::name).containsExactly("payment-api-abc", "payment-api-def");
    assertThat(pods).allMatch(p -> p.workload().equals(ref));
  }

  @Test
  void rollingDeploymentOldAndNewReplicaSetPodsBothMatchTheSameSelector() {
    // Both the old and new ReplicaSet's pods carry the Deployment's own
    // selector labels during a rollout - selector-based matching correctly
    // includes both, which is the desired behaviour (see the OS-A
    // architecture assessment §8: old-replica visibility during a bad
    // rollout is desirable for log investigation, not a bug).
    server.setWorkloads(WorkloadKind.DEPLOYMENT, List.of(
        new WorkloadFixture("payment-api", 2, 1, labels("app", "payment-api"))));
    scopeService.discoverWorkloads().block();
    scopeService.selectWorkload(new WorkloadRef(WorkloadKind.DEPLOYMENT, "payment-api", NAMESPACE));

    server.setPods(List.of(
        new PodFixture("payment-api-oldrs-1", "Running", 1, 1, 0, List.of("application"),
            labels("app", "payment-api")),
        new PodFixture("payment-api-newrs-1", "Running", 1, 1, 0, List.of("application"),
            labels("app", "payment-api"))));

    List<PodSummary> pods = scopeService.discoverPods().block();

    assertThat(pods).extracting(PodSummary::name)
        .containsExactlyInAnyOrder("payment-api-oldrs-1", "payment-api-newrs-1");
  }

  @Test
  void aPodWithMultipleContainersReportsAnAccurateReadySummaryAndContainerList() {
    server.setPods(List.of(
        new PodFixture("payment-api-abc", "Running", 2, 1, 3, List.of("application", "sidecar"), Map.of())));

    List<PodSummary> pods = scopeService.discoverPods().block();

    PodSummary pod = pods.get(0);
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

    List<PodSummary> pods = scopeService.discoverPods().block();

    assertThat(pods).extracting(PodSummary::name).containsExactly("legacy-billing-1");
  }

  @Test
  void aPodThatDisappearsBetweenDiscoveryCallsIsClearedFromTheSelectionTruthfully() {
    server.setPods(List.of(new PodFixture("payment-api-abc", "Running", 1, 1, 0, List.of("application"), Map.of())));
    scopeService.discoverPods().block();
    assertThat(scopeService.selectPod("payment-api-abc")).isTrue();

    server.setPods(List.of()); // the pod is gone
    scopeService.discoverPods().block();

    assertThat(session.scope().selectedPod()).isNull();
  }

  @Test
  void selectingAPodDiscoveryNeverReturnedIsRejected() {
    scopeService.discoverPods().block(); // empty
    assertThat(scopeService.selectPod("fabricated-pod")).isFalse();
  }

  // -------------------------------------------------------- containers

  @Test
  void containerDiscoveryReturnsTheSelectedPodsCachedContainersWithNoExtraNetworkCall() {
    server.setPods(List.of(
        new PodFixture("payment-api-abc", "Running", 2, 2, 0, List.of("application", "sidecar"), Map.of())));
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
    server.setPods(List.of(new PodFixture("payment-api-abc", "Running", 1, 1, 0, List.of("application"), Map.of())));
    scopeService.discoverPods().block();
    scopeService.selectPod("payment-api-abc");
    scopeService.discoverContainers();

    assertThat(scopeService.selectContainer("does-not-exist")).isFalse();
    assertThat(scopeService.selectContainer("application")).isTrue();
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
        List.of(new WorkloadSummary(new WorkloadRef(WorkloadKind.DEPLOYMENT, "payment-api", "other-namespace"), 1, 1)),
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
        apiRef, generation);

    assertThat(applied).isFalse();
    assertThat(session.scope().pods()).isEmpty();
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

    boolean applied = session.updateWorkloads(List.of(), NAMESPACE, staleGeneration);

    assertThat(applied).isFalse();
  }
}
