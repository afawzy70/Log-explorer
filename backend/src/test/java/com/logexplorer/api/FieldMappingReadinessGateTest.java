package com.logexplorer.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.logexplorer.config.SearchGuardrailsProperties;
import com.logexplorer.config.SourcesProperties;
import com.logexplorer.core.guard.ConcurrencyGuard;
import com.logexplorer.core.guard.GuardrailViolationException;
import com.logexplorer.core.guard.GuardrailViolationException.Reason;
import com.logexplorer.core.guard.SearchGuardrails;
import com.logexplorer.core.mapping.CanonicalField;
import com.logexplorer.core.mapping.FieldMappingProfileService;
import com.logexplorer.core.mapping.JsonPath;
import com.logexplorer.core.model.SearchRequest;
import com.logexplorer.core.search.PageCursorCodec;
import com.logexplorer.source.LogSourceRegistry;
import com.logexplorer.source.StubLogSource;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Mission §15/§28 — Search must never silently run against an
 * un-validated, edited mapping profile. Covers every required transition:
 * default→ready, invalid-edit→blocked, fixed→ready-again, reset→ready,
 * source-change is irrelevant (the gate is global, not per-source, in this
 * mission's minimum-viable scope — see {@code FieldMappingProfileService}'s
 * own javadoc §13 scope note).
 */
class FieldMappingReadinessGateTest {

  private SearchService buildService(FieldMappingProfileService mappingService) {
    SearchGuardrailsProperties properties = new SearchGuardrailsProperties();
    SearchGuardrails guardrails = new SearchGuardrails(properties);
    ConcurrencyGuard concurrencyGuard = new ConcurrencyGuard(properties);
    StubLogSource source = new StubLogSource("stub-source");
    LogSourceRegistry registry = new LogSourceRegistry(List.of(source), new SourcesProperties());
    return new SearchService(registry, guardrails, concurrencyGuard, new PageCursorCodec(new ObjectMapper()), mappingService);
  }

  private SearchRequest.Builder baseRequest() {
    Instant now = Instant.parse("2026-01-01T12:00:00Z");
    return SearchRequest.builder().sourceId("stub-source").start(now.minusSeconds(3600)).end(now);
  }

  @Test
  void compatibleDefaultProfile_searchIsReady() {
    FieldMappingProfileService mappingService = new FieldMappingProfileService();
    SearchService service = buildService(mappingService);

    // Does not throw MAPPING_NOT_READY - reaches real search execution.
    service.search(baseRequest().build()).block();
  }

  @Test
  void invalidRequiredMapping_searchIsBlocked_withAnExplicitReason() {
    FieldMappingProfileService mappingService = new FieldMappingProfileService();
    mappingService.updateCandidates(CanonicalField.CIF, List.of(JsonPath.parse("cif")));
    // Deliberately not confirmed/validated yet.
    SearchService service = buildService(mappingService);

    assertThatThrownBy(() -> service.search(baseRequest().build()).block())
        .isInstanceOf(GuardrailViolationException.class)
        .satisfies(e -> assertThat(((GuardrailViolationException) e).reason()).isEqualTo(Reason.MAPPING_NOT_READY))
        .hasMessageContaining("Configure and validate log field mapping");
  }

  @Test
  void mappingFixed_searchEnabledAgain() {
    FieldMappingProfileService mappingService = new FieldMappingProfileService();
    mappingService.updateCandidates(CanonicalField.CIF, List.of(JsonPath.parse("cif")));
    mappingService.confirmSave(true);
    SearchService service = buildService(mappingService);

    service.search(baseRequest().build()).block(); // does not throw
    assertThat(mappingService.isSearchReady()).isTrue();
  }

  @Test
  void profileReset_readinessRecalculatedCorrectly() {
    FieldMappingProfileService mappingService = new FieldMappingProfileService();
    mappingService.updateCandidates(CanonicalField.CIF, List.of(JsonPath.parse("cif")));
    assertThat(mappingService.isSearchReady()).isFalse();

    mappingService.resetToDefault();

    assertThat(mappingService.isSearchReady()).isTrue();
    SearchService service = buildService(mappingService);
    service.search(baseRequest().build()).block(); // does not throw
  }

  @Test
  void failedValidationKeepsSearchBlockedEvenAfterConfirmSaveIsCalled() {
    FieldMappingProfileService mappingService = new FieldMappingProfileService();
    mappingService.updateCandidates(CanonicalField.CIF, List.of(JsonPath.parse("cif")));
    mappingService.confirmSave(false); // the frontend's own validate call failed
    SearchService service = buildService(mappingService);

    assertThatThrownBy(() -> service.search(baseRequest().build()).block())
        .isInstanceOf(GuardrailViolationException.class);
  }
}
