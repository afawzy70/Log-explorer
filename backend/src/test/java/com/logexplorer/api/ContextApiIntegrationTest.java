package com.logexplorer.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.SourceCapabilities;
import com.logexplorer.source.StubLogSource;
import java.time.Duration;
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
 * Real HTTP-level tests for {@code POST /api/v1/logs/context} - "Show ±30
 * seconds" (IMPLEMENTATION_PLAN.md "Phase H", HANDOVER.md §16.7). Through
 * the actual controller/{@code RequestMapper}/{@code SearchService}, not
 * just the {@code RequestMapper} unit test - proves the endpoint is wired
 * up and its response is the same shape {@code /search} returns.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ContextApiIntegrationTest {

  private static final Instant EVENT_TIME = Instant.parse("2026-01-01T12:00:00Z");

  @TestConfiguration
  static class TestSourceConfig {
    @Bean
    StubLogSource contextTestSource() {
      StubLogSource stub = new StubLogSource("context-test-source", "Context Test Source",
          new SourceCapabilities(true, false, false, false, false, true));
      stub.withSearchFlux(Flux.just(
          CanonicalLogEvent.builder()
              .timestamp(EVENT_TIME)
              .service("gateway")
              .severity("INFO")
              .message("the anchor event")
              .build()));
      return stub;
    }
  }

  @Autowired
  private WebTestClient webTestClient;

  @Autowired
  private StubLogSource contextTestSource;

  @Test
  void requestsExactlyThirtySecondsOnEachSideOfTheGivenTimestampThroughTheRealHttpEndpoint() {
    String body = """
        {"sourceId":"context-test-source","timestamp":"2026-01-01T12:00:00Z","service":"gateway"}
        """;
    webTestClient.post().uri("/api/v1/logs/context")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue(body)
        .exchange()
        .expectStatus().isOk()
        .expectBody()
        .jsonPath("$.events.length()").isEqualTo(1)
        .jsonPath("$.events[0].message").isEqualTo("the anchor event");

    assertThat(contextTestSource.lastRequest.start()).isEqualTo(EVENT_TIME.minus(Duration.ofSeconds(30)));
    assertThat(contextTestSource.lastRequest.end()).isEqualTo(EVENT_TIME.plus(Duration.ofSeconds(30)));
    assertThat(contextTestSource.lastRequest.services()).containsExactly("gateway");
  }

  @Test
  void containerIdAndPodReachTheDomainRequestWhenSupplied() {
    String body = """
        {"sourceId":"context-test-source","timestamp":"2026-01-01T12:00:00Z","containerId":"c1","pod":"pod-abc"}
        """;
    webTestClient.post().uri("/api/v1/logs/context")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue(body)
        .exchange()
        .expectStatus().isOk();

    assertThat(contextTestSource.lastRequest.containerId()).isEqualTo("c1");
    assertThat(contextTestSource.lastRequest.pod()).isEqualTo("pod-abc");
  }

  @Test
  void missingSourceIdIsRejectedWith400() {
    String body = """
        {"timestamp":"2026-01-01T12:00:00Z"}
        """;
    webTestClient.post().uri("/api/v1/logs/context")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue(body)
        .exchange()
        .expectStatus().isBadRequest();
  }

  @Test
  void missingTimestampIsRejectedWith400() {
    String body = """
        {"sourceId":"context-test-source"}
        """;
    webTestClient.post().uri("/api/v1/logs/context")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue(body)
        .exchange()
        .expectStatus().isBadRequest();
  }

  @Test
  void unknownSourceIsRejectedWith404() {
    String body = """
        {"sourceId":"does-not-exist","timestamp":"2026-01-01T12:00:00Z"}
        """;
    webTestClient.post().uri("/api/v1/logs/context")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue(body)
        .exchange()
        .expectStatus().isNotFound();
  }
}
