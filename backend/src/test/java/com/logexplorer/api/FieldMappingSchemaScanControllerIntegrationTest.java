package com.logexplorer.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.logexplorer.api.dto.SchemaScanResponseDto;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.SourceCapabilities;
import com.logexplorer.source.StubLogSource;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.test.web.reactive.server.WebTestClient;
import reactor.core.publisher.Flux;

/**
 * Real HTTP-level tests for {@code POST /sources/{id}/field-mapping/schema-scan}
 * (owner mission "Field Mapping Schema Scan + Masking Policy Extension" §A)
 * — proves the endpoint is actually wired end-to-end; the scan algorithm
 * itself is exhaustively covered at the unit level in {@code
 * core.mapping.scan.SchemaScanServiceTest}.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class FieldMappingSchemaScanControllerIntegrationTest {

  @TestConfiguration
  static class TestSourceConfig {
    @Bean
    StubLogSource schemaScanTestSource() {
      StubLogSource stub = new StubLogSource("schema-scan-test-source", "Schema Scan Test Source",
          new SourceCapabilities(true, false, false, false, false, false, false, true));
      stub.withSearchFlux(Flux.just(
          CanonicalLogEvent.builder().timestamp(Instant.parse("2026-01-01T00:00:00Z"))
              .sourceTimestamp(Instant.parse("2026-01-01T00:00:00Z")).severity("INFO")
              .originalRawJson("{\"cif\":\"1\",\"mdc\":{\"cif\":\"1\"}}").build(),
          CanonicalLogEvent.builder().timestamp(Instant.parse("2026-01-01T00:00:01Z"))
              .sourceTimestamp(Instant.parse("2026-01-01T00:00:01Z")).severity("ERROR")
              .originalRawJson("{\"errorCode\":\"E1\"}").build()));
      return stub;
    }

    @Bean
    StubLogSource emptySchemaScanTestSource() {
      StubLogSource stub = new StubLogSource("schema-scan-empty-source", "Schema Scan Empty Source",
          new SourceCapabilities(true, false, false, false, false, false, false, true));
      stub.withSearchFlux(Flux.empty());
      return stub;
    }
  }

  @Autowired
  private WebTestClient webTestClient;

  @Test
  void scanReturnsBothRepresentativeEventsAndTheDiscoveredSchemaUnion() {
    SchemaScanResponseDto dto = webTestClient.post()
        .uri("/api/v1/sources/schema-scan-test-source/field-mapping/schema-scan")
        .exchange().expectStatus().isOk().expectBody(SchemaScanResponseDto.class).returnResult().getResponseBody();

    assertThat(dto).isNotNull();
    assertThat(dto.totalEventsInspected()).isEqualTo(2);
    assertThat(dto.representativeEvents()).hasSize(2);
    assertThat(dto.discoveredSchema()).extracting(SchemaScanResponseDto.DiscoveredPathEntryDto::path)
        .contains("cif", "mdc.cif", "errorCode");
  }

  @Test
  void emptySourceScansTruthfullyWithoutError() {
    SchemaScanResponseDto dto = webTestClient.post()
        .uri("/api/v1/sources/schema-scan-empty-source/field-mapping/schema-scan")
        .exchange().expectStatus().isOk().expectBody(SchemaScanResponseDto.class).returnResult().getResponseBody();

    assertThat(dto).isNotNull();
    assertThat(dto.totalEventsInspected()).isZero();
    assertThat(dto.discoveredSchema()).isEmpty();
  }

  @Test
  void unknownSourceReturns4xx() {
    webTestClient.post().uri("/api/v1/sources/does-not-exist/field-mapping/schema-scan")
        .exchange().expectStatus().is4xxClientError();
  }
}
