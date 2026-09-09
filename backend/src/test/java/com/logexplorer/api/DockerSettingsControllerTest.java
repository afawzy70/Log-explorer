package com.logexplorer.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.logexplorer.config.DockerProperties;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.reactive.server.WebTestClient;

/**
 * Real HTTP-level tests for Docker connection settings (Legacy
 * Remediation Slice 3, {@code docs/LEGACY_TO_NEW_REMEDIATION_PLAN.md}
 * §"Slice 3"): the sanitized connection summary and Test Connection, both
 * against the real {@link DockerProperties} bean/{@code
 * source.docker.DockerClientFactory} the running application actually
 * uses — not a stub.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class DockerSettingsControllerTest {

  @Autowired
  private WebTestClient webTestClient;

  @Autowired
  private DockerProperties dockerProperties;

  private DockerProperties.Mode originalMode;
  private String originalHost;
  private Integer originalPort;
  private boolean originalTls;
  private String originalComposeFilter;

  @org.junit.jupiter.api.BeforeEach
  void captureOriginalConfig() {
    originalMode = dockerProperties.getMode();
    originalHost = dockerProperties.getHost();
    originalPort = dockerProperties.getPort();
    originalTls = dockerProperties.isTls();
    originalComposeFilter = dockerProperties.getComposeProjectFilter();
  }

  @AfterEach
  void restoreOriginalConfig() {
    // Defensive - no test in this class is expected to actually mutate
    // this singleton bean (that is precisely what is being proven), but
    // restoring regardless keeps this class's own test order-independence
    // bulletproof even if a future test is added carelessly.
    dockerProperties.setMode(originalMode);
    dockerProperties.setHost(originalHost);
    dockerProperties.setPort(originalPort);
    dockerProperties.setTls(originalTls);
    dockerProperties.setComposeProjectFilter(originalComposeFilter);
  }

  @Test
  void connectionSummaryReflectsTheRealConfiguredMode() {
    webTestClient.get().uri("/api/v1/sources/docker/connection")
        .exchange()
        .expectStatus().isOk()
        .expectBody()
        .jsonPath("$.mode").isEqualTo(originalMode.name())
        .jsonPath("$.tlsEnabled").isEqualTo(originalTls)
        .jsonPath("$.runtimeMutationSupported").isEqualTo(false)
        .jsonPath("$.settingsNote").exists();
  }

  @Test
  void connectionSummaryOmitsHostAndPortForLocalMode() {
    // The default test profile runs LOCAL mode - host/port are REMOTE-only
    // concepts and must be null, never a stale/default value implying a
    // remote connection that isn't actually configured.
    if (originalMode != DockerProperties.Mode.LOCAL) {
      return; // this specific assertion only applies to the LOCAL baseline
    }
    webTestClient.get().uri("/api/v1/sources/docker/connection")
        .exchange()
        .expectStatus().isOk()
        .expectBody()
        .jsonPath("$.host").doesNotExist()
        .jsonPath("$.port").doesNotExist();
  }

  @Test
  void testConnectionRejectsAnInvalidMode() {
    webTestClient.post().uri("/api/v1/sources/docker/test-connection")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue("""
            {"mode":"NOT_A_REAL_MODE"}
            """)
        .exchange()
        .expectStatus().isBadRequest();
  }

  @Test
  void testConnectionRejectsRemoteModeWithNoHost() {
    webTestClient.post().uri("/api/v1/sources/docker/test-connection")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue("""
            {"mode":"REMOTE"}
            """)
        .exchange()
        .expectStatus().isBadRequest();
  }

  @Test
  void testConnectionRejectsRemoteModeWithTlsEnabledButNoCertPath() {
    webTestClient.post().uri("/api/v1/sources/docker/test-connection")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue("""
            {"mode":"REMOTE","host":"203.0.113.5","tls":true}
            """)
        .exchange()
        .expectStatus().isBadRequest();
  }

  @Test
  void testConnectionReportsDownForALoopbackHostWithASanitizedPolicyMessageNeverAStackTrace() {
    webTestClient.post().uri("/api/v1/sources/docker/test-connection")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue("""
            {"mode":"REMOTE","host":"127.0.0.1","port":2375}
            """)
        .exchange()
        .expectStatus().isOk()
        .expectBody()
        .jsonPath("$.status").isEqualTo("DOWN")
        .jsonPath("$.message").value(msg -> {
          String message = String.valueOf(msg);
          assertThat(message).containsIgnoringCase("polic");
          assertThat(message).doesNotContain("Exception").doesNotContain("\tat ").doesNotContain("127.0.0.1");
        });
  }

  @Test
  void testConnectionReportsDownForAnUnreachablePublicHostWithSanitizedDiagnosticsAndAppliesAStrictTimeout() {
    long start = System.currentTimeMillis();
    webTestClient.post().uri("/api/v1/sources/docker/test-connection")
        .contentType(MediaType.APPLICATION_JSON)
        // TEST-NET-1 (RFC 5737) - guaranteed to exist on no real network,
        // so this deterministically times out/refuses regardless of the
        // environment running this test, without depending on real
        // external infrastructure.
        .bodyValue("""
            {"mode":"REMOTE","host":"192.0.2.1","port":2375}
            """)
        .exchange()
        .expectStatus().isOk()
        .expectBody()
        .jsonPath("$.status").isEqualTo("DOWN")
        .jsonPath("$.message").value(msg -> {
          String message = String.valueOf(msg);
          assertThat(message).doesNotContain("Exception").doesNotContain("\tat ");
        });
    long elapsedMs = System.currentTimeMillis() - start;
    assertThat(elapsedMs).isLessThan(15_000); // strict bound - a UI action must never hang indefinitely
  }

  @Test
  void testConnectionNeverMutatesTheRunningApplicationsActualDockerConfiguration() {
    webTestClient.post().uri("/api/v1/sources/docker/test-connection")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue("""
            {"mode":"REMOTE","host":"192.0.2.1","port":19999,"tls":false}
            """)
        .exchange()
        .expectStatus().isOk();

    assertThat(dockerProperties.getMode()).isEqualTo(originalMode);
    assertThat(dockerProperties.getHost()).isEqualTo(originalHost);
    assertThat(dockerProperties.getPort()).isEqualTo(originalPort);
    assertThat(dockerProperties.isTls()).isEqualTo(originalTls);

    webTestClient.get().uri("/api/v1/sources/docker/connection")
        .exchange()
        .expectStatus().isOk()
        .expectBody()
        .jsonPath("$.mode").isEqualTo(originalMode.name());
  }

  @Test
  void testConnectionResponseNeverContainsTheSubmittedHostLiteralEvenOnFailure() {
    String hostSentinel = "sentinel-host-should-never-be-echoed.invalid";
    String responseBody = webTestClient.post().uri("/api/v1/sources/docker/test-connection")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue("""
            {"mode":"REMOTE","host":"%s","port":2375}
            """.formatted(hostSentinel))
        .exchange()
        .expectStatus().isOk()
        .expectBody(String.class)
        .returnResult()
        .getResponseBody();

    assertThat(responseBody).doesNotContain(hostSentinel);
  }
}
