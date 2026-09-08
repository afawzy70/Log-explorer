package com.logexplorer.api;

import com.logexplorer.core.model.ServiceInfo;
import com.logexplorer.core.model.SourceCapabilities;
import com.logexplorer.core.model.SourceHealth;
import com.logexplorer.source.StubLogSource;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.test.web.reactive.server.WebTestClient;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * Phase B's manual check ("Hit {@code /api/v1/sources} with fixture source
 * enabled; confirm capabilities JSON") — run here against a test-only stub
 * registered via {@link TestConfiguration}, since the real H3 fixture
 * source is Phase A2b's job (see IMPLEMENTATION_PLAN.md §2 "Verification
 * harness sequencing" and {@code docs/AUDIT.md}'s addendum for why).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class SourcesApiIntegrationTest {

  @TestConfiguration
  static class TestSourceConfig {
    @Bean
    StubLogSource testSource() {
      StubLogSource stub = new StubLogSource(
          "test-source",
          "Test Source",
          new SourceCapabilities(true, false, false, true, false, false));
      stub.withHealth(Mono.just(new SourceHealth(SourceHealth.Status.UP, "reachable", Instant.now())));
      stub.withServices(Flux.just(new ServiceInfo("gateway", 1, 1), new ServiceInfo("accounts-api", 2, 2)));
      return stub;
    }
  }

  @Autowired
  private WebTestClient webTestClient;

  @Test
  void sourcesEndpointReturnsExplicitCapabilitiesJson() {
    webTestClient.get().uri("/api/v1/sources")
        .exchange()
        .expectStatus().isOk()
        .expectBody()
        .jsonPath("$[0].id").isEqualTo("test-source")
        .jsonPath("$[0].displayName").isEqualTo("Test Source")
        .jsonPath("$[0].capabilities.historicalSearch").isEqualTo(true)
        .jsonPath("$[0].capabilities.liveTail").isEqualTo(false)
        .jsonPath("$[0].capabilities.rawLogQL").isEqualTo(false)
        .jsonPath("$[0].capabilities.serviceDiscovery").isEqualTo(true)
        .jsonPath("$[0].capabilities.queryStatistics").isEqualTo(false)
        .jsonPath("$[0].capabilities.contextView").isEqualTo(false);
  }

  @Test
  void healthEndpointReturnsTheSourcesReportedStatus() {
    webTestClient.get().uri("/api/v1/sources/test-source/health")
        .exchange()
        .expectStatus().isOk()
        .expectBody()
        .jsonPath("$.status").isEqualTo("UP")
        .jsonPath("$.message").isEqualTo("reachable");
  }

  @Test
  void healthEndpointReturns404ForAnUnknownSource() {
    webTestClient.get().uri("/api/v1/sources/does-not-exist/health")
        .exchange()
        .expectStatus().isNotFound();
  }

  @Test
  void servicesEndpointReturnsDiscoveredServicesWithCounts() {
    webTestClient.get().uri("/api/v1/sources/test-source/services")
        .exchange()
        .expectStatus().isOk()
        .expectBody()
        .jsonPath("$[0].name").isEqualTo("gateway")
        .jsonPath("$[0].runningCount").isEqualTo(1)
        .jsonPath("$[0].totalCount").isEqualTo(1)
        .jsonPath("$[1].name").isEqualTo("accounts-api");
  }

  @Test
  void servicesEndpointReturns404ForAnUnknownSource() {
    webTestClient.get().uri("/api/v1/sources/does-not-exist/services")
        .exchange()
        .expectStatus().isNotFound();
  }
}
