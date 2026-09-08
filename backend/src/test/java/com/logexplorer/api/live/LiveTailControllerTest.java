package com.logexplorer.api.live;

import static org.assertj.core.api.Assertions.assertThat;

import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.RawSensitiveFields;
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
import org.springframework.test.web.reactive.server.FluxExchangeResult;
import org.springframework.test.web.reactive.server.WebTestClient;
import reactor.core.publisher.Flux;
import reactor.test.StepVerifier;

/**
 * Real HTTP-level tests for {@code GET /api/v1/logs/live}
 * (IMPLEMENTATION_PLAN.md "Phase J", HANDOVER.md §18.1: "Server-to-browser
 * live events use SSE") - through the actual controller/service/guard
 * chain, proving the wire format is genuine {@code text/event-stream} and
 * every emitted event is masked, not just that the underlying service
 * behaves correctly in isolation.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class LiveTailControllerTest {

  private static final Instant NOW = Instant.parse("2026-01-01T12:00:00Z");

  @TestConfiguration
  static class TestSourceConfig {
    @Bean
    StubLogSource liveCapableTestSource() {
      StubLogSource stub = new StubLogSource("live-capable-source", "Live Capable Source",
          new SourceCapabilities(true, true, false, false, false, false));
      stub.withFollowFlux(Flux.just(
          CanonicalLogEvent.builder()
              .timestamp(NOW)
              .service("gateway")
              .message("live event")
              .sensitive(new RawSensitiveFields("RAW-CIF", null, null, null, null))
              .build()));
      return stub;
    }

    @Bean
    StubLogSource liveIncapableTestSource() {
      return new StubLogSource("live-incapable-source", "Live Incapable Source",
          new SourceCapabilities(true, false, false, false, false, false));
    }
  }

  @Autowired
  private WebTestClient webTestClient;

  @Test
  void streamsRealMaskedLogEventsAsServerSentEvents() {
    FluxExchangeResult<String> result = webTestClient.get()
        .uri("/api/v1/logs/live?sourceId=live-capable-source")
        .accept(MediaType.TEXT_EVENT_STREAM)
        .exchange()
        .expectStatus().isOk()
        .expectHeader().contentTypeCompatibleWith(MediaType.TEXT_EVENT_STREAM)
        .returnResult(String.class);

    StepVerifier.create(result.getResponseBody())
        .assertNext(body -> {
          assertThat(body).contains("\"message\":\"live event\"");
          assertThat(body).doesNotContain("RAW-CIF"); // masked before it ever reached the wire
        })
        .thenCancel()
        .verify(Duration.ofSeconds(5));
  }

  @Test
  void aSourceThatDoesNotSupportLiveTailReturns400WithTheHonestReason() {
    // The error body itself arrives SSE-framed ("data:{...}") rather than
    // plain application/problem+json, since this endpoint's own mapping
    // declares `produces = TEXT_EVENT_STREAM_VALUE` even for its error
    // path - not itself a capability-honesty concern (a real browser
    // `EventSource` never gets to inspect a non-2xx response body in any
    // structured way regardless; it only ever sees `onerror`), so the
    // status code is what's actually load-bearing here. The reason string
    // reaching the client at all is proven directly against the service
    // layer in `LiveTailServiceTest`.
    String body = webTestClient.get()
        .uri("/api/v1/logs/live?sourceId=live-incapable-source")
        .accept(MediaType.TEXT_EVENT_STREAM)
        .exchange()
        .expectStatus().isBadRequest()
        .expectBody(String.class)
        .returnResult()
        .getResponseBody();
    assertThat(body).contains("LIVE_TAIL_NOT_SUPPORTED");
  }

  @Test
  void anUnknownSourceReturns404() {
    webTestClient.get()
        .uri("/api/v1/logs/live?sourceId=does-not-exist")
        .accept(MediaType.TEXT_EVENT_STREAM)
        .exchange()
        .expectStatus().isNotFound();
  }
}
