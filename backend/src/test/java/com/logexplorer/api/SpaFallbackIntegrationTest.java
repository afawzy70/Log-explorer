package com.logexplorer.api;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.reactive.server.WebTestClient;

/**
 * IMPLEMENTATION_PLAN.md "Phase K" scope item 1: "SPA fallback that does
 * not swallow {@code /api/**} or {@code /actuator/**}." Uses {@code
 * src/test/resources/static/index.html} - a small test-only fixture, never
 * shipped in the real jar - standing in for the real Vite build the
 * repo-root {@code Dockerfile} copies into {@code
 * backend/src/main/resources/static/} before packaging.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class SpaFallbackIntegrationTest {

  @org.springframework.beans.factory.annotation.Autowired
  private WebTestClient webTestClient;

  @Test
  void rootServesTheAppShell() {
    webTestClient.get().uri("/")
        .exchange()
        .expectStatus().isOk()
        .expectHeader().contentTypeCompatibleWith(MediaType.TEXT_HTML)
        .expectBody(String.class)
        .value(body -> assertThat(body).contains("Log Explorer app shell"));
  }

  @Test
  void anUnknownPathWithNoFileExtensionFallsBackToTheAppShell() {
    // Stands in for a future client-side route - today's frontend has none,
    // but the fallback must already work correctly for one.
    webTestClient.get().uri("/some/unknown/client-route")
        .exchange()
        .expectStatus().isOk()
        .expectHeader().contentTypeCompatibleWith(MediaType.TEXT_HTML)
        .expectBody(String.class)
        .value(body -> assertThat(body).contains("Log Explorer app shell"));
  }

  @Test
  void apiRoutesAreNeverSwallowedByTheSpaFallback() {
    webTestClient.get().uri("/api/v1/sources")
        .exchange()
        .expectStatus().isOk()
        .expectHeader().contentTypeCompatibleWith(MediaType.APPLICATION_JSON);
  }

  @Test
  void anUnmappedApiPathIsAnHonest404NotASwallowedFallbackOrA500() {
    // Also the regression test for the real bug found this phase:
    // NoResourceFoundException (a ResponseStatusException) was previously
    // caught by GlobalExceptionHandler's generic Exception handler and
    // reported as a fabricated 500 "An internal error occurred" instead of
    // its own real 404.
    webTestClient.get().uri("/api/v1/logs/sources")
        .exchange()
        .expectStatus().isNotFound()
        .expectBody()
        .jsonPath("$.status").isEqualTo(404);
  }

  @Test
  void actuatorRoutesAreNeverSwallowedByTheSpaFallback() {
    // Actuator's own content type (application/vnd.spring-boot.actuator...)
    // is not literally "compatible with" plain application/json under
    // strict MediaType matching - the invariant that actually matters here
    // is that it's real actuator JSON, never the HTML app shell.
    webTestClient.get().uri("/actuator/health")
        .exchange()
        .expectStatus().isOk()
        .expectBody()
        .jsonPath("$.status").isEqualTo("UP");
  }
}
