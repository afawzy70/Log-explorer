package com.logexplorer.api;

import com.logexplorer.core.model.RawToken;
import com.logexplorer.source.openshift.MockOpenShiftScopeServer;
import com.logexplorer.source.openshift.MockOpenShiftScopeServer.PodFixture;
import com.logexplorer.source.openshift.MockOpenShiftScopeServer.WorkloadFixture;
import com.logexplorer.source.openshift.OcLoginCommand;
import com.logexplorer.source.openshift.OpenShiftSession;
import com.logexplorer.source.openshift.ProjectDiscovery;
import com.logexplorer.source.openshift.WorkloadKind;
import java.io.IOException;
import java.net.URI;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.reactive.server.WebTestClient;

/**
 * OS-1B - the workload/pod/container scope endpoints, exercised over real
 * HTTP against a real dev-mode Spring context, with a deterministic fake
 * OpenShift/Kubernetes API standing in for the real cluster (same
 * constraint as {@code OpenShiftConnectionControllerIntegrationTest}:
 * {@code OcLoginCommandParser} requires {@code https://}, so the session
 * is seeded directly with an {@link OcLoginCommand} pointing at the
 * plain-http fake server rather than driven through {@code POST
 * /connect}).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestPropertySource(properties = "server.address=127.0.0.1")
class OpenShiftScopeControllerIntegrationTest {

  private static final String NAMESPACE = "payments";
  private static final RawToken TOKEN = RawToken.of("sha256~scope-controller-test-token-01");

  @Autowired
  private WebTestClient webTestClient;

  @Autowired
  private OpenShiftSession session;

  private MockOpenShiftScopeServer fixtureServer;

  @AfterEach
  void tearDown() {
    session.disconnect();
    if (fixtureServer != null) {
      fixtureServer.close();
    }
  }

  private void connectTo(String baseUrl) {
    OcLoginCommand command = new OcLoginCommand(URI.create(baseUrl), TOKEN, null);
    long generation = session.connect(command, "Test", "developer", List.of(NAMESPACE),
        ProjectDiscovery.Api.PROJECTS, null);
    session.selectProject(NAMESPACE, generation);
  }

  @Test
  void getWorkloadsReturnsAnEmptyButSuccessfulDiscoveryAgainstAFreshFixture() throws IOException {
    fixtureServer = new MockOpenShiftScopeServer(NAMESPACE);
    connectTo(fixtureServer.baseUrl());

    webTestClient.get().uri("/api/v1/sources/openshift/workloads")
        .exchange()
        .expectStatus().isOk()
        .expectBody()
        .jsonPath("$.status").isEqualTo("SUCCESS")
        .jsonPath("$.workloads").isEmpty();
  }

  @Test
  void selectingAWorkloadNotYetDiscoveredIsRejectedWith400() throws IOException {
    fixtureServer = new MockOpenShiftScopeServer(NAMESPACE);
    connectTo(fixtureServer.baseUrl());

    webTestClient.put().uri("/api/v1/sources/openshift/workload")
        .bodyValue(new WorkloadSelectionBody("DEPLOYMENT", "does-not-exist"))
        .exchange()
        .expectStatus().isBadRequest();
  }

  @Test
  void clearingTheWorkloadSelectionAlwaysSucceeds() throws IOException {
    fixtureServer = new MockOpenShiftScopeServer(NAMESPACE);
    connectTo(fixtureServer.baseUrl());

    webTestClient.put().uri("/api/v1/sources/openshift/workload")
        .bodyValue(new WorkloadSelectionBody(null, null))
        .exchange()
        .expectStatus().isOk()
        .expectBody()
        .jsonPath("$.selectedWorkloadKind").doesNotExist()
        .jsonPath("$.selectedWorkloadName").doesNotExist();
  }

  @Test
  void getPodsWithNoWorkloadSelectedUnionsOnlyPodsBelongingToADiscoveredSupportedWorkload() throws IOException {
    // OS-1B review recovery: "All workloads" must never mean "every pod
    // in the namespace" - a pod is included only once its owning
    // workload has actually been discovered as supported.
    fixtureServer = new MockOpenShiftScopeServer(NAMESPACE);
    fixtureServer.setWorkloads(WorkloadKind.DEPLOYMENT, List.of(
        new WorkloadFixture("payment-api", 1, 1, Map.of("app", "payment-api"))));
    fixtureServer.setPods(List.of(
        new PodFixture("payment-api-abc", "Running", 1, 1, 0, List.of("application"), Map.of("app", "payment-api")),
        // Never discovered as belonging to any supported workload - must be excluded.
        new PodFixture("unowned-standalone-pod", "Running", 1, 1, 0, List.of("application"), Map.of())));
    connectTo(fixtureServer.baseUrl());
    webTestClient.get().uri("/api/v1/sources/openshift/workloads").exchange().expectStatus().isOk();

    webTestClient.get().uri("/api/v1/sources/openshift/pods")
        .exchange()
        .expectStatus().isOk()
        .expectBody()
        .jsonPath("$.status").isEqualTo("COMPLETE")
        .jsonPath("$.pods.length()").isEqualTo(1)
        .jsonPath("$.pods[0].name").isEqualTo("payment-api-abc");
  }

  @Test
  void getPodsWithNoSupportedWorkloadsDiscoveredReturnsAnEmptyResultNeverEveryNamespacePod() throws IOException {
    fixtureServer = new MockOpenShiftScopeServer(NAMESPACE);
    fixtureServer.setPods(List.of(
        new PodFixture("some-pod-that-must-never-appear", "Running", 1, 1, 0, List.of("application"), Map.of())));
    connectTo(fixtureServer.baseUrl());
    webTestClient.get().uri("/api/v1/sources/openshift/workloads").exchange().expectStatus().isOk();

    webTestClient.get().uri("/api/v1/sources/openshift/pods")
        .exchange()
        .expectStatus().isOk()
        .expectBody()
        .jsonPath("$.status").isEqualTo("COMPLETE")
        .jsonPath("$.pods").isEmpty();
  }

  @Test
  void getContainersWithNoPodSelectedReturnsAnEmptyList() throws IOException {
    fixtureServer = new MockOpenShiftScopeServer(NAMESPACE);
    connectTo(fixtureServer.baseUrl());

    webTestClient.get().uri("/api/v1/sources/openshift/containers")
        .exchange()
        .expectStatus().isOk()
        .expectBody()
        .jsonPath("$").isEmpty();
  }

  private record WorkloadSelectionBody(String kind, String name) {}
}
