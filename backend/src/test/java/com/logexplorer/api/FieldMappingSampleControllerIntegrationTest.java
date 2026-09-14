package com.logexplorer.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.logexplorer.api.dto.FieldMappingSampleResponseDto;
import com.logexplorer.core.mapping.sample.FieldMappingSampleService;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.SourceCapabilities;
import com.logexplorer.source.StubLogSource;
import java.time.Instant;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.test.web.reactive.server.WebTestClient;
import reactor.core.publisher.Flux;

/**
 * Real HTTP-level tests for {@code POST /sources/{id}/field-mapping/samples}
 * (mission §5/§27) — bounded sample retrieval, limit enforcement, no
 * unbounded read, zero-event source, source-neutral behavior.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class FieldMappingSampleControllerIntegrationTest {

  @TestConfiguration
  static class TestSourceConfig {
    @Bean
    StubLogSource sampleTestSourceWith100Events() {
      StubLogSource stub = new StubLogSource("sample-test-source-100", "Sample Test Source (100 events)",
          new SourceCapabilities(true, false, false, false, false, false, false, true));
      CanonicalLogEvent[] events = IntStream.range(0, 100)
          .mapToObj(i -> CanonicalLogEvent.builder()
              .timestamp(Instant.parse("2026-01-01T00:00:00Z").plusSeconds(i))
              .sourceTimestamp(Instant.parse("2026-01-01T00:00:00Z").plusSeconds(i))
              .message("event " + i)
              .originalRawJson("{\"cif\":\"" + i + "\"}")
              .build())
          .toArray(CanonicalLogEvent[]::new);
      stub.withSearchFlux(Flux.fromArray(events));
      return stub;
    }

    @Bean
    StubLogSource emptySampleTestSource() {
      StubLogSource stub = new StubLogSource("sample-test-source-empty", "Sample Test Source (empty)",
          new SourceCapabilities(true, false, false, false, false, false, false, true));
      stub.withSearchFlux(Flux.empty());
      return stub;
    }
  }

  @Autowired
  private WebTestClient webTestClient;

  @Test
  void defaultLimitReturnsExactlyTwentySamples() {
    FieldMappingSampleResponseDto dto = webTestClient.post()
        .uri("/api/v1/sources/sample-test-source-100/field-mapping/samples")
        .exchange().expectStatus().isOk().expectBody(FieldMappingSampleResponseDto.class).returnResult().getResponseBody();

    assertThat(dto).isNotNull();
    assertThat(dto.actualCount()).isEqualTo(FieldMappingSampleService.DEFAULT_LIMIT);
    assertThat(dto.samples()).hasSize(FieldMappingSampleService.DEFAULT_LIMIT);
    assertThat(dto.samples().get(0)).contains("cif");
  }

  @Test
  void explicitLimitIsHonored() {
    FieldMappingSampleResponseDto dto = webTestClient.post()
        .uri("/api/v1/sources/sample-test-source-100/field-mapping/samples?limit=5")
        .exchange().expectStatus().isOk().expectBody(FieldMappingSampleResponseDto.class).returnResult().getResponseBody();

    assertThat(dto).isNotNull();
    assertThat(dto.requestedLimit()).isEqualTo(5);
    assertThat(dto.actualCount()).isEqualTo(5);
  }

  @Test
  void limitAboveTheSafeMaximumIsClamped_neverUnbounded() {
    FieldMappingSampleResponseDto dto = webTestClient.post()
        .uri("/api/v1/sources/sample-test-source-100/field-mapping/samples?limit=10000")
        .exchange().expectStatus().isOk().expectBody(FieldMappingSampleResponseDto.class).returnResult().getResponseBody();

    assertThat(dto).isNotNull();
    assertThat(dto.actualCount()).isEqualTo(FieldMappingSampleService.MAX_LIMIT);
  }

  @Test
  void zeroOrNegativeLimitIsClampedToOne() {
    FieldMappingSampleResponseDto dto = webTestClient.post()
        .uri("/api/v1/sources/sample-test-source-100/field-mapping/samples?limit=0")
        .exchange().expectStatus().isOk().expectBody(FieldMappingSampleResponseDto.class).returnResult().getResponseBody();

    assertThat(dto).isNotNull();
    assertThat(dto.actualCount()).isEqualTo(1);
  }

  @Test
  void sourceWithZeroEventsReturnsAnEmptyListTruthfully_notAnError() {
    FieldMappingSampleResponseDto dto = webTestClient.post()
        .uri("/api/v1/sources/sample-test-source-empty/field-mapping/samples")
        .exchange().expectStatus().isOk().expectBody(FieldMappingSampleResponseDto.class).returnResult().getResponseBody();

    assertThat(dto).isNotNull();
    assertThat(dto.actualCount()).isZero();
    assertThat(dto.samples()).isEmpty();
  }

  @Test
  void unknownSourceReturns4xx() {
    webTestClient.post().uri("/api/v1/sources/does-not-exist/field-mapping/samples")
        .exchange().expectStatus().is4xxClientError();
  }
}
