package com.logexplorer.core.model;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Owner mission "Service Filter, Docker Performance, and Verified Default
 * Mapping" §A — direct coverage for the new {@code serviceFilterMode}
 * field's default, builder round-trip, and {@link SearchRequest#withPageBoundary}
 * carry-through. Every {@code SearchRequest} copy point ({@code
 * withPageBoundary}, the {@code Builder}, the compact constructor) hand-
 * copies each field by name, so a field this easy to miss deserves its own
 * direct test rather than relying only on indirect coverage elsewhere.
 */
class SearchRequestTest {

  private SearchRequest.Builder baseRequest() {
    return SearchRequest.builder()
        .sourceId("local-docker")
        .start(Instant.parse("2026-01-01T00:00:00Z"))
        .end(Instant.parse("2026-01-02T00:00:00Z"));
  }

  @Test
  void serviceFilterModeDefaultsToIncludeWhenNeverSet() {
    SearchRequest request = baseRequest().build();
    assertThat(request.serviceFilterMode()).isEqualTo(SearchRequest.ServiceFilterMode.INCLUDE);
  }

  @Test
  void serviceFilterModeDefaultsToIncludeWhenExplicitlySetToNull() {
    SearchRequest request = baseRequest().serviceFilterMode(null).build();
    assertThat(request.serviceFilterMode()).isEqualTo(SearchRequest.ServiceFilterMode.INCLUDE);
  }

  @Test
  void builderRoundTripsExcludeMode() {
    SearchRequest request = baseRequest()
        .services(List.of("audit"))
        .serviceFilterMode(SearchRequest.ServiceFilterMode.EXCLUDE)
        .build();
    assertThat(request.serviceFilterMode()).isEqualTo(SearchRequest.ServiceFilterMode.EXCLUDE);
    assertThat(request.services()).containsExactly("audit");
  }

  @Test
  void withPageBoundaryPreservesServiceFilterModeAndServicesUnchanged() {
    SearchRequest original = baseRequest()
        .services(List.of("audit", "gateway"))
        .serviceFilterMode(SearchRequest.ServiceFilterMode.EXCLUDE)
        .build();

    SearchRequest paged = original.withPageBoundary(Instant.parse("2026-01-01T12:00:00Z"));

    assertThat(paged.serviceFilterMode()).isEqualTo(SearchRequest.ServiceFilterMode.EXCLUDE);
    assertThat(paged.services()).containsExactly("audit", "gateway");
    assertThat(paged.pageBoundary()).isEqualTo(Instant.parse("2026-01-01T12:00:00Z"));
    // Every other field carried through byte-for-byte unchanged, exactly
    // the contract withPageBoundary's own javadoc requires.
    assertThat(paged.sourceId()).isEqualTo(original.sourceId());
    assertThat(paged.start()).isEqualTo(original.start());
    assertThat(paged.end()).isEqualTo(original.end());
  }

  @Test
  void toStringIncludesServiceFilterModeAsAStructuralNonSensitiveField() {
    SearchRequest request = baseRequest().serviceFilterMode(SearchRequest.ServiceFilterMode.EXCLUDE).build();
    assertThat(request.toString()).contains("serviceFilterMode=EXCLUDE");
  }
}
