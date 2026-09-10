package com.logexplorer.api;

import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.SourceCapabilities;
import com.logexplorer.source.StubLogSource;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.http.MediaType;
import org.springframework.test.web.reactive.server.WebTestClient;
import reactor.core.publisher.Flux;

/**
 * Real HTTP-level tests for the DSL query engine and raw-LogQL gating
 * (IMPLEMENTATION_PLAN.md "Phase E") — through the actual controller,
 * {@code GlobalExceptionHandler}, and {@code SearchService}, not just unit
 * tests of the individual pieces.
 *
 * <p>{@link StubLogSource} deliberately does not call {@code
 * EventFilters.matches()} itself (see its own javadoc: "purely to exercise
 * the registry/guardrail/search-orchestration plumbing") — every real
 * adapter (fixture, Docker, Loki) does, and that per-event filtering
 * (including the DSL) is already thoroughly proven at the adapter level by
 * {@code EventFiltersTest}/{@code LokiLogSourceTest}/etc. This class proves
 * the parts that are genuinely {@code SearchService}/HTTP-layer concerns:
 * request parsing (success and syntax-error mapping) and raw-LogQL
 * capability gating — neither of which depends on adapter-internal
 * filtering behavior.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class QueryApiIntegrationTest {

  private static final String SENTINEL = "RAW-DSL-SENTINEL-4f8c";

  @TestConfiguration
  static class TestSourceConfig {
    @Bean
    StubLogSource dslTestSource() {
      StubLogSource stub = new StubLogSource("dsl-test-source", "DSL Test Source",
          new SourceCapabilities(true, false, false, false, false, false, false));
      stub.withSearchFlux(Flux.just(
          CanonicalLogEvent.builder()
              .timestamp(Instant.parse("2026-01-01T00:00:30Z"))
              .service("gateway")
              .severity("ERROR")
              .message("connection timeout")
              .build(),
          CanonicalLogEvent.builder()
              .timestamp(Instant.parse("2026-01-01T00:00:40Z"))
              .service("auth")
              .severity("INFO")
              .message("login ok")
              .build()));
      return stub;
    }

    @Bean
    StubLogSource rawLogQlCapableSource() {
      StubLogSource stub = new StubLogSource("raw-logql-capable-source", "Raw LogQL Capable",
          new SourceCapabilities(true, false, true, false, false, false, false));
      stub.withSearchFlux(Flux.just(
          CanonicalLogEvent.builder().timestamp(Instant.parse("2026-01-01T00:00:30Z")).message("ok").build()));
      return stub;
    }
  }

  @Autowired
  private WebTestClient webTestClient;

  private String bodyWithQuery(String sourceId, String query) {
    return """
        {"sourceId":"%s","start":"2026-01-01T00:00:00Z","end":"2026-01-01T01:00:00Z","query":"%s"}
        """.formatted(sourceId, query.replace("\"", "\\\""));
  }

  @Test
  void validDslQueryParsesAndTheRequestSucceedsThroughTheRealHttpEndpoint() {
    webTestClient.post().uri("/api/v1/logs/search")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue(bodyWithQuery("dsl-test-source", "(service = \"gateway\" or service = \"auth\") and level = \"ERROR\""))
        .exchange()
        .expectStatus().isOk()
        .expectBody()
        .jsonPath("$.events.length()").isEqualTo(2);
  }

  @Test
  void invalidDslQuerySyntaxReturns400WithAPositionAndNeverLeaksTheLiteral() {
    String responseBody = webTestClient.post().uri("/api/v1/logs/search")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue(bodyWithQuery("dsl-test-source", "bogusField = \"" + SENTINEL + "\""))
        .exchange()
        .expectStatus().isBadRequest()
        .expectBody()
        .jsonPath("$.position").exists()
        .returnResult()
        .getResponseBody() instanceof byte[] bytes ? new String(bytes) : "";

    org.assertj.core.api.Assertions.assertThat(responseBody).doesNotContain(SENTINEL);
  }

  @Test
  void unterminatedStringLiteralReturns400() {
    webTestClient.post().uri("/api/v1/logs/search")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue(bodyWithQuery("dsl-test-source", "service = \"never-closed"))
        .exchange()
        .expectStatus().isBadRequest();
  }

  @Test
  void rawLogQlIsRejectedWith400ForASourceThatDoesNotSupportIt() {
    String body = """
        {"sourceId":"dsl-test-source","start":"2026-01-01T00:00:00Z","end":"2026-01-01T01:00:00Z",
         "rawLogQl":"{namespace=\\"x\\"}"}
        """;
    webTestClient.post().uri("/api/v1/logs/search")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue(body)
        .exchange()
        .expectStatus().isBadRequest()
        .expectBody()
        .jsonPath("$.reason").isEqualTo("RAW_LOGQL_NOT_SUPPORTED");
  }

  @Test
  void rawLogQlIsAcceptedForASourceThatAdvertisesTheCapability() {
    String body = """
        {"sourceId":"raw-logql-capable-source","start":"2026-01-01T00:00:00Z","end":"2026-01-01T01:00:00Z",
         "rawLogQl":"{namespace=\\"x\\"}"}
        """;
    webTestClient.post().uri("/api/v1/logs/search")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue(body)
        .exchange()
        .expectStatus().isOk();
  }
}
