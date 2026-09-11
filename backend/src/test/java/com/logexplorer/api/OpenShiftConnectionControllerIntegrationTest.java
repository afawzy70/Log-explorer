package com.logexplorer.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.logexplorer.core.model.RawToken;
import com.logexplorer.source.openshift.OcLoginCommand;
import com.logexplorer.source.openshift.OpenShiftConnectionState;
import com.logexplorer.source.openshift.OpenShiftSession;
import com.logexplorer.source.openshift.ProjectDiscovery;
import java.net.URI;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.reactive.server.WebTestClient;

/**
 * OS-1A review recovery #2, Defect A, at the controller boundary - the
 * actual observable symptom: every {@code OpenShiftConnectionController}
 * endpoint except {@code refresh} called {@code summarize(null)}, and
 * {@code summarize} had no fallback source for the discovery mode, so
 * {@code GET /connection} could never truthfully report {@code
 * NAMESPACES} even once the session itself already knew it.
 *
 * <p>The real {@code POST /connect} endpoint cannot be driven end-to-end
 * here: {@code OcLoginCommandParser} requires an {@code https://} server,
 * and this repository's deterministic fake OpenShift API (like {@code
 * MockLokiServer}) is a plain {@code http} {@code HttpServer} - see
 * {@code OpenShiftConnectionServiceFallbackTest}'s javadoc for the same
 * constraint. Instead, the shared {@link OpenShiftSession} bean is seeded
 * directly to the post-connect state a namespaces-fallback connection
 * would have produced, and the real HTTP surface
 * (`GET /connection`, `PUT /project`, `DELETE /connect`) is exercised
 * against it - proving the controller's own {@code summarize} logic, not
 * just the session it reads from.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestPropertySource(properties = "server.address=127.0.0.1")
class OpenShiftConnectionControllerIntegrationTest {

  private static final OcLoginCommand COMMAND = new OcLoginCommand(
      URI.create("https://api.controller-test.example.com:6443"),
      RawToken.of("sha256~controller-test-token-0123456"),
      null);

  @Autowired
  private WebTestClient webTestClient;

  @Autowired
  private OpenShiftSession session;

  @AfterEach
  void tearDown() {
    session.disconnect();
  }

  @Test
  void connectionSummaryAfterNamespaceFallbackStillReportsNamespaces() {
    session.connect(
        COMMAND, "Prod", "developer", List.of("fallback-ns-a", "fallback-ns-b"), ProjectDiscovery.Api.NAMESPACES,
        null);

    webTestClient
        .get()
        .uri("/api/v1/sources/openshift/connection")
        .exchange()
        .expectStatus()
        .isOk()
        .expectBody()
        .jsonPath("$.state")
        .isEqualTo("CONNECTED")
        .jsonPath("$.projectApi")
        .isEqualTo("NAMESPACES")
        .jsonPath("$.projects[0]")
        .isEqualTo("fallback-ns-a");
  }

  @Test
  void getConnectionAfterNamespaceFallbackStillReportsNamespacesOnARepeatedIndependentRead() {
    session.connect(
        COMMAND, "Prod", "developer", List.of("fallback-ns-a"), ProjectDiscovery.Api.NAMESPACES, null);

    // Two independent reads, as a UI reconnect/poll would issue - neither
    // is the call that performed discovery, so both rely entirely on the
    // session's persisted mode (the fix for Defect A).
    for (int i = 0; i < 2; i++) {
      webTestClient
          .get()
          .uri("/api/v1/sources/openshift/connection")
          .exchange()
          .expectStatus()
          .isOk()
          .expectBody()
          .jsonPath("$.projectApi")
          .isEqualTo("NAMESPACES");
    }
  }

  @Test
  void connectionSummaryWhenDiscoveryWasProjectsReportsProjects() {
    session.connect(COMMAND, "Prod", "developer", List.of("payments"), ProjectDiscovery.Api.PROJECTS, null);

    webTestClient
        .get()
        .uri("/api/v1/sources/openshift/connection")
        .exchange()
        .expectStatus()
        .isOk()
        .expectBody()
        .jsonPath("$.projectApi")
        .isEqualTo("PROJECTS");
  }

  @Test
  void selectingAProjectPreservesTheNamespacesDiscoveryModeInTheResponse() {
    session.connect(
        COMMAND, "Prod", "developer", List.of("fallback-ns-a", "fallback-ns-b"), ProjectDiscovery.Api.NAMESPACES,
        null);

    webTestClient
        .put()
        .uri("/api/v1/sources/openshift/project")
        .bodyValue(new SelectionBody("fallback-ns-a"))
        .exchange()
        .expectStatus()
        .isOk()
        .expectBody()
        .jsonPath("$.selectedProject")
        .isEqualTo("fallback-ns-a")
        // Selecting a scope must never change what API it came from.
        .jsonPath("$.projectApi")
        .isEqualTo("NAMESPACES");
  }

  @Test
  void disconnectClearsTheDiscoveryModeInTheResponse() {
    session.connect(COMMAND, "Prod", "developer", List.of("fallback-ns-a"), ProjectDiscovery.Api.NAMESPACES, null);

    webTestClient
        .delete()
        .uri("/api/v1/sources/openshift/connect")
        .exchange()
        .expectStatus()
        .isOk()
        .expectBody()
        .jsonPath("$.state")
        .isEqualTo("DISCONNECTED")
        .jsonPath("$.projectApi")
        .doesNotExist();

    assertThat(session.discoveryApi()).isNull();
    assertThat(session.state()).isEqualTo(OpenShiftConnectionState.DISCONNECTED);
  }

  private record SelectionBody(String project) {}
}
