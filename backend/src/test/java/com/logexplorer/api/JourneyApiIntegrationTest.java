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
 * Real HTTP-level tests for {@code POST /api/v1/logs/journey}
 * (IMPLEMENTATION_PLAN.md "Phase I", HANDOVER.md §17) - through the actual
 * controller/{@code RequestMapper}/{@code SearchService}, proving the
 * response is genuinely ascending by timestamp (not just that the mapper
 * builds the right filter, which {@code RequestMapperTest} already
 * covers) and that a malformed (no-timestamp) event never disappears.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class JourneyApiIntegrationTest {

  private static final Instant T1 = Instant.parse("2026-01-01T12:00:00Z");
  private static final Instant T2 = Instant.parse("2026-01-01T12:00:10Z");
  private static final Instant T3 = Instant.parse("2026-01-01T12:00:20Z");

  @TestConfiguration
  static class TestSourceConfig {
    @Bean
    StubLogSource journeyEmptyTestSource() {
      // A dedicated always-empty source for the genuine "no results"
      // case - `journeyTestSource` below always returns its fixed set
      // regardless of filters (see StubLogSource's own javadoc: it never
      // applies EventFilters itself), so it cannot honestly demonstrate
      // an empty result.
      return new StubLogSource("journey-empty-test-source", "Journey Empty Test Source",
          new SourceCapabilities(true, false, false, false, false, false));
    }

    @Bean
    StubLogSource journeyTruncationTestSource() {
      // A dedicated source for the truncation test below - kept separate
      // from journeyTestSource so this doesn't need to mutate (and then
      // restore) that shared singleton's flux.
      StubLogSource stub = new StubLogSource("journey-truncation-test-source", "Journey Truncation Test Source",
          new SourceCapabilities(true, false, false, false, false, false));
      java.util.List<CanonicalLogEvent> many = new java.util.ArrayList<>();
      for (int i = 0; i < 201; i++) {
        many.add(CanonicalLogEvent.builder()
            .timestamp(T1.plusSeconds(i))
            .service("gateway")
            .message("event " + i)
            .journeyId("j-many")
            .build());
      }
      stub.withSearchFlux(Flux.fromIterable(many));
      return stub;
    }

    @Bean
    StubLogSource journeyTestSource() {
      StubLogSource stub = new StubLogSource("journey-test-source", "Journey Test Source",
          new SourceCapabilities(true, false, false, false, false, false));
      // Deliberately out of order (newest first, like every real source
      // this project has - FixtureLogSource/DockerLogSource both always
      // sort that way regardless of `direction`) plus one malformed event
      // with no timestamp at all - the endpoint itself must produce
      // ascending order and never drop the malformed one.
      stub.withSearchFlux(Flux.just(
          CanonicalLogEvent.builder().timestamp(T3).service("c-service").message("third").journeyId("j-1").build(),
          CanonicalLogEvent.builder().malformed(true).rawLine("garbage").journeyId("j-1").build(),
          CanonicalLogEvent.builder().timestamp(T1).service("a-service").message("first").journeyId("j-1").build(),
          CanonicalLogEvent.builder().timestamp(T2).service("b-service").message("second").journeyId("j-1").build()));
      return stub;
    }
  }

  @Autowired
  private WebTestClient webTestClient;

  @Test
  void resultsAreAscendingByTimestampWithMalformedEventsLast() {
    String body = """
        {"sourceId":"journey-test-source","start":"2026-01-01T00:00:00Z","end":"2026-01-02T00:00:00Z","field":"journeyId","value":"j-1"}
        """;
    webTestClient.post().uri("/api/v1/logs/journey")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue(body)
        .exchange()
        .expectStatus().isOk()
        .expectBody()
        .jsonPath("$.events.length()").isEqualTo(4)
        .jsonPath("$.events[0].message").isEqualTo("first")
        .jsonPath("$.events[1].message").isEqualTo("second")
        .jsonPath("$.events[2].message").isEqualTo("third")
        .jsonPath("$.events[3].malformed").isEqualTo(true);
  }

  @Test
  void filtersByCorrelationTraceAndEventIdToo() {
    for (String field : new String[] {"correlationId", "traceId", "eventId"}) {
      String body = """
          {"sourceId":"journey-test-source","start":"2026-01-01T00:00:00Z","end":"2026-01-02T00:00:00Z","field":"%s","value":"whatever"}
          """.formatted(field);
      // The stub ignores structured filters (see StubLogSource's own
      // javadoc), so this just proves the endpoint accepts and routes
      // each of the three other fields without error - REQUESTMAPPERTEST
      // already proves each maps to the correct, and only that, filter.
      webTestClient.post().uri("/api/v1/logs/journey")
          .contentType(MediaType.APPLICATION_JSON)
          .bodyValue(body)
          .exchange()
          .expectStatus().isOk();
    }
  }

  @Test
  void aSensitiveOrUnknownFieldIsRejectedWith400() {
    String body = """
        {"sourceId":"journey-test-source","start":"2026-01-01T00:00:00Z","end":"2026-01-02T00:00:00Z","field":"cif","value":"whatever"}
        """;
    webTestClient.post().uri("/api/v1/logs/journey")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue(body)
        .exchange()
        .expectStatus().isBadRequest()
        .expectBody()
        .jsonPath("$.reason").isEqualTo("INVALID_JOURNEY_FIELD");
  }

  @Test
  void missingRequiredFieldsAreRejectedWith400() {
    String body = """
        {"sourceId":"journey-test-source"}
        """;
    webTestClient.post().uri("/api/v1/logs/journey")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue(body)
        .exchange()
        .expectStatus().isBadRequest();
  }

  @Test
  void unknownSourceIsRejectedWith404() {
    String body = """
        {"sourceId":"does-not-exist","start":"2026-01-01T00:00:00Z","end":"2026-01-02T00:00:00Z","field":"journeyId","value":"j-1"}
        """;
    webTestClient.post().uri("/api/v1/logs/journey")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue(body)
        .exchange()
        .expectStatus().isNotFound();
  }

  /**
   * Legacy Remediation Slice 6 - "context/journey incomplete metadata
   * where backend-owned": a journey whose real matching events exceed the
   * guardrail limit must honestly report {@code truncated: true} through
   * the real HTTP endpoint, the same truncation computation {@code
   * /search}/{@code /context} already share.
   */
  @Test
  void aJourneyExceedingTheGuardrailLimitHonestlyReportsTruncated() {
    String body = """
        {"sourceId":"journey-truncation-test-source","start":"2026-01-01T00:00:00Z","end":"2026-01-02T00:00:00Z","field":"journeyId","value":"j-many"}
        """;
    webTestClient.post().uri("/api/v1/logs/journey")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue(body)
        .exchange()
        .expectStatus().isOk()
        .expectBody()
        .jsonPath("$.counts.truncated").isEqualTo(true)
        .jsonPath("$.counts.limit").isEqualTo(200);
  }

  @Test
  void noResultsProducesAnEmptyEventsListNotAnError() {
    String body = """
        {"sourceId":"journey-empty-test-source","start":"2026-01-01T00:00:00Z","end":"2026-01-02T00:00:00Z","field":"journeyId","value":"missing-journey"}
        """;
    webTestClient.post().uri("/api/v1/logs/journey")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue(body)
        .exchange()
        .expectStatus().isOk()
        .expectBody()
        .jsonPath("$.events.length()").isEqualTo(0);
  }
}
