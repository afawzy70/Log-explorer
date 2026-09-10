package com.logexplorer.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.SourceCapabilities;
import com.logexplorer.source.StubLogSource;
import java.time.Instant;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.http.MediaType;
import org.springframework.test.web.reactive.server.WebTestClient;
import reactor.core.publisher.Flux;

/**
 * Legacy Remediation Slice 7 — endpoint-level proof (section 20/23 of the
 * mission) that {@code /search}, {@code /context}, and {@code /journey}
 * can never expose a sensitive substring embedded in free-text
 * {@code message}/{@code exception} content, through the real HTTP layer
 * (not just the unit-level {@code EventMapper} call {@link
 * SerializationLeakTest} already covers). The Live SSE path has its own
 * dedicated equivalent in {@code LiveTailServiceTest}, matching the
 * existing masking-boundary test for the five structured fields.
 *
 * <p>Sentinel values are injected via {@link StubLogSource} — the exact
 * same test-double injection path {@code LogLeakTest}/{@code
 * LiveTailServiceTest} already use, since the real fixture corpus
 * generator has no override hook for arbitrary test-controlled content
 * (see {@code FixtureCorpusGenerator}'s own fixed-vocabulary design).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class TextRedactionEndpointLeakTest {

  private static final Instant EVENT_TIME = Instant.parse("2026-01-01T12:00:00Z");
  private static final String SENSITIVE_CIF_SENTINEL = "RAW-ENDPOINT-CIF-SENTINEL-4d18";
  private static final String SENSITIVE_TOKEN_SENTINEL = "RawEndpointTokenSentinel4d18Value";
  private static final String SENSITIVE_CARD_SENTINEL = "4111111111111111"; // Luhn-valid

  private static String sensitiveMessage() {
    return "Login failed for customerId=" + SENSITIVE_CIF_SENTINEL
        + " card " + SENSITIVE_CARD_SENTINEL + " declined"
        + " Authorization: Bearer " + SENSITIVE_TOKEN_SENTINEL;
  }

  @TestConfiguration
  static class TestSourceConfig {
    @Bean
    StubLogSource redactionEndpointTestSource() {
      return new StubLogSource("redaction-endpoint-test-source", "Redaction Endpoint Test Source",
          new SourceCapabilities(true, false, false, false, false, true));
    }
  }

  @Autowired
  private WebTestClient webTestClient;

  @Autowired
  private StubLogSource redactionEndpointTestSource;

  @BeforeEach
  void resetStubEvents() {
    redactionEndpointTestSource.withSearchFlux(Flux.just(
        CanonicalLogEvent.builder()
            .timestamp(EVENT_TIME)
            .service("accounts-api")
            .severity("ERROR")
            .message(sensitiveMessage())
            .journeyId("redaction-journey-1")
            .traceId("redaction-trace-1")
            .build()));
  }

  private void assertResponseBodyIsClean(String body) {
    assertThat(body).doesNotContain(SENSITIVE_CIF_SENTINEL, SENSITIVE_TOKEN_SENTINEL, SENSITIVE_CARD_SENTINEL);
    assertThat(body).contains("customerId=[REDACTED]").contains("[REDACTED_CARD]").contains("Authorization: Bearer [REDACTED]");
  }

  @Test
  void searchResponseNeverExposesTheRawSentinels() {
    String body = """
        {"sourceId":"redaction-endpoint-test-source","start":"2026-01-01T00:00:00Z","end":"2026-01-02T00:00:00Z"}
        """;
    byte[] responseBody = webTestClient.post().uri("/api/v1/logs/search")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue(body)
        .exchange()
        .expectStatus().isOk()
        .expectBody()
        .returnResult()
        .getResponseBody();
    assertResponseBodyIsClean(new String(responseBody, java.nio.charset.StandardCharsets.UTF_8));
  }

  @Test
  void contextResponseNeverExposesTheRawSentinels() {
    String body = """
        {"sourceId":"redaction-endpoint-test-source","timestamp":"2026-01-01T12:00:00Z"}
        """;
    byte[] responseBody = webTestClient.post().uri("/api/v1/logs/context")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue(body)
        .exchange()
        .expectStatus().isOk()
        .expectBody()
        .returnResult()
        .getResponseBody();
    assertResponseBodyIsClean(new String(responseBody, java.nio.charset.StandardCharsets.UTF_8));
  }

  @Test
  void journeyResponseNeverExposesTheRawSentinels() {
    String body = """
        {"sourceId":"redaction-endpoint-test-source","start":"2026-01-01T00:00:00Z","end":"2026-01-02T00:00:00Z","field":"journeyId","value":"redaction-journey-1"}
        """;
    byte[] responseBody = webTestClient.post().uri("/api/v1/logs/journey")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue(body)
        .exchange()
        .expectStatus().isOk()
        .expectBody()
        .returnResult()
        .getResponseBody();
    assertResponseBodyIsClean(new String(responseBody, java.nio.charset.StandardCharsets.UTF_8));
  }

  /**
   * Section 14 — search semantics: the raw (unredacted) message is what
   * the server-side text filter actually matches against, since
   * EventFilters runs before EventMapper's redaction boundary. Searching
   * for a substring of the message that survives redaction (a word
   * outside any sensitive pattern) must still find the event.
   */
  @Test
  void freeTextSearchStillMatchesAgainstTheRealUnredactedMessageContent() {
    String body = """
        {"sourceId":"redaction-endpoint-test-source","start":"2026-01-01T00:00:00Z","end":"2026-01-02T00:00:00Z","text":"Login failed"}
        """;
    webTestClient.post().uri("/api/v1/logs/search")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue(body)
        .exchange()
        .expectStatus().isOk()
        .expectBody()
        .jsonPath("$.events.length()").isEqualTo(1);
  }
}
