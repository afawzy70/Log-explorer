package com.logexplorer.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.SourceCapabilities;
import com.logexplorer.source.StubLogSource;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.http.MediaType;
import org.springframework.test.web.reactive.server.WebTestClient;
import reactor.core.publisher.Flux;

/**
 * Real HTTP-level tests for the {@code queryPlan} response field (Legacy
 * Remediation Slice 2, {@code docs/LEGACY_TO_NEW_REMEDIATION_PLAN.md}
 * §"Slice 2"): resolved-query rendering, honest push-down/post-filter
 * classification, and raw-LogQL-mode reporting, through the real
 * controller/{@code SearchService} — not just the {@code
 * core.query.QueryPlanBuilder} unit tests.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class QueryPlanApiIntegrationTest {

  @TestConfiguration
  static class TestSourceConfig {
    @Bean
    StubLogSource queryPlanNoPushDownSource() {
      StubLogSource stub = new StubLogSource("query-plan-no-pushdown-source", "No Pushdown Source",
          new SourceCapabilities(true, false, false, false, false, false));
      stub.withSearchFlux(Flux.just(
          CanonicalLogEvent.builder().timestamp(Instant.parse("2026-01-01T00:00:30Z")).service("gateway").message("ok").build()));
      return stub;
    }

    @Bean
    StubLogSource queryPlanPushDownSource() {
      StubLogSource stub = new StubLogSource("query-plan-pushdown-source", "Pushdown Source",
          new SourceCapabilities(true, false, true, false, false, false));
      stub.withSearchFlux(Flux.just(
          CanonicalLogEvent.builder().timestamp(Instant.parse("2026-01-01T00:00:30Z")).service("gateway").message("ok").build()));
      stub.withPushDown(List.of("namespace = \"prod\" (Loki stream label, from source configuration)"));
      return stub;
    }
  }

  @Autowired
  private WebTestClient webTestClient;

  @Test
  void everySearchResponseCarriesAQueryPlan() {
    String body = """
        {"sourceId":"query-plan-no-pushdown-source","start":"2026-01-01T00:00:00Z","end":"2026-01-01T01:00:00Z"}
        """;
    webTestClient.post().uri("/api/v1/logs/search")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue(body)
        .exchange()
        .expectStatus().isOk()
        .expectBody()
        .jsonPath("$.queryPlan.resolvedQuery").isEqualTo("(no query)")
        .jsonPath("$.queryPlan.rawLogQlMode").isEqualTo(false)
        .jsonPath("$.queryPlan.pushedDownConditions").isArray()
        .jsonPath("$.queryPlan.postFilterConditions").isArray();
  }

  @Test
  void aDslQueryIsReflectedInTheResolvedQueryAndPostFilterConditionsWithLiteralsRedacted() {
    String body = """
        {"sourceId":"query-plan-no-pushdown-source","start":"2026-01-01T00:00:00Z","end":"2026-01-01T01:00:00Z",
         "query":"service = \\"gateway\\" and level = \\"ERROR\\""}
        """;
    webTestClient.post().uri("/api/v1/logs/search")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue(body)
        .exchange()
        .expectStatus().isOk()
        .expectBody()
        .jsonPath("$.queryPlan.resolvedQuery").isEqualTo("(service = *** AND level = ***)")
        .jsonPath("$.queryPlan.postFilterConditions[0]").isEqualTo("(service = *** AND level = ***)");
  }

  @Test
  void pushedDownConditionsReflectExactlyWhatTheSourceReportedNeverFabricated() {
    String body = """
        {"sourceId":"query-plan-pushdown-source","start":"2026-01-01T00:00:00Z","end":"2026-01-01T01:00:00Z"}
        """;
    webTestClient.post().uri("/api/v1/logs/search")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue(body)
        .exchange()
        .expectStatus().isOk()
        .expectBody()
        .jsonPath("$.queryPlan.pushedDownConditions[0]").isEqualTo("namespace = \"prod\" (Loki stream label, from source configuration)");
  }

  @Test
  void aSourceThatReportsNoPushDownShowsAnEmptyPushedDownListNeverAGuessedOne() {
    String body = """
        {"sourceId":"query-plan-no-pushdown-source","start":"2026-01-01T00:00:00Z","end":"2026-01-01T01:00:00Z",
         "services":["gateway"]}
        """;
    webTestClient.post().uri("/api/v1/logs/search")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue(body)
        .exchange()
        .expectStatus().isOk()
        .expectBody()
        .jsonPath("$.queryPlan.pushedDownConditions").isEqualTo(List.of())
        .jsonPath("$.queryPlan.postFilterConditions[0]").isEqualTo("service in [gateway]");
  }

  @Test
  void rawLogQlModeIsReportedTrueAndNeverEchoesTheLogQlText() {
    String body = """
        {"sourceId":"query-plan-pushdown-source","start":"2026-01-01T00:00:00Z","end":"2026-01-01T01:00:00Z",
         "rawLogQl":"{namespace=\\"prod\\"}"}
        """;
    webTestClient.post().uri("/api/v1/logs/search")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue(body)
        .exchange()
        .expectStatus().isOk()
        .expectBody(String.class)
        .value(json -> {
          assertThat(json).contains("\"rawLogQlMode\":true");
          assertThat(json).doesNotContain("{namespace=");
        });
  }
}
