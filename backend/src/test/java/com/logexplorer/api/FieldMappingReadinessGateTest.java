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
import com.logexplorer.core.mapping.MappingScopeKey;
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
 * default→ready, invalid-edit→blocked, fixed→ready-again, reset→ready.
 *
 * <p><b>Superseded scope note (CLAUDE.md §5 named conflict, owner mission
 * "Project-Scoped Schema Scan" §8):</b> this file's own earlier comment
 * said "the gate is global, not per-source" — that is no longer true. The
 * readiness gate is now evaluated per {@link MappingScopeKey} (source +
 * selected project/namespace), exactly the same scope {@code
 * source.docker.DockerLogSource}/{@code source.openshift.OpenShiftLogSource}
 * resolve for real parsing (see {@code SearchService#resolveScopeKey}).
 * {@link StubLogSource} has no real project concept (its default {@link
 * com.logexplorer.source.LogSource#resolveMappingScopeLabel} echoes
 * {@link SearchRequest#composeProject()}, always {@code null} here), so
 * every test below resolves to the one stable scope {@link #SCOPE} — used
 * explicitly, not the {@code MappingScopeKey.UNSPECIFIED} no-arg
 * convenience, so this file proves the REAL production scope-resolution
 * path, not a test-only shortcut.
 */
class FieldMappingReadinessGateTest {

  private static final MappingScopeKey SCOPE = MappingScopeKey.of("stub-source", null);

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
    mappingService.updateCandidates(SCOPE, CanonicalField.CIF, List.of(JsonPath.parse("cif")));
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
    mappingService.updateCandidates(SCOPE, CanonicalField.CIF, List.of(JsonPath.parse("cif")));
    mappingService.confirmSave(SCOPE, true);
    SearchService service = buildService(mappingService);

    service.search(baseRequest().build()).block(); // does not throw
    assertThat(mappingService.isSearchReady(SCOPE)).isTrue();
  }

  @Test
  void profileReset_readinessRecalculatedCorrectly() {
    FieldMappingProfileService mappingService = new FieldMappingProfileService();
    mappingService.updateCandidates(SCOPE, CanonicalField.CIF, List.of(JsonPath.parse("cif")));
    assertThat(mappingService.isSearchReady(SCOPE)).isFalse();

    mappingService.resetToDefault(SCOPE);

    assertThat(mappingService.isSearchReady(SCOPE)).isTrue();
    SearchService service = buildService(mappingService);
    service.search(baseRequest().build()).block(); // does not throw
  }

  @Test
  void failedValidationKeepsSearchBlockedEvenAfterConfirmSaveIsCalled() {
    FieldMappingProfileService mappingService = new FieldMappingProfileService();
    mappingService.updateCandidates(SCOPE, CanonicalField.CIF, List.of(JsonPath.parse("cif")));
    mappingService.confirmSave(SCOPE, false); // the frontend's own validate call failed
    SearchService service = buildService(mappingService);

    assertThatThrownBy(() -> service.search(baseRequest().build()).block())
        .isInstanceOf(GuardrailViolationException.class);
  }

  @Test
  void aDifferentProjectOnTheSameSourceIsNotAffectedByAnEditedMapping() {
    // Owner mission "Project-Scoped Schema Scan" §7/§8 - "Do not reuse a
    // mapping from another project silently." A Docker-style source with
    // a real project concept would resolve a DIFFERENT MappingScopeKey
    // for a different composeProject; this proves the underlying gate
    // mechanism keyed on scope, not just source, using two explicit keys
    // on the same sourceId (StubLogSource itself has no composeProject
    // filtering of its own - the point here is the gate's own data
    // structure, not Docker-specific filtering, which is covered
    // separately in SchemaScanServiceTest).
    MappingScopeKey projectA = MappingScopeKey.of("stub-source", "project-a");
    MappingScopeKey projectB = MappingScopeKey.of("stub-source", "project-b");
    FieldMappingProfileService mappingService = new FieldMappingProfileService();

    mappingService.updateCandidates(projectA, CanonicalField.CIF, List.of(JsonPath.parse("cif")));

    assertThat(mappingService.isSearchReady(projectA)).isFalse();
    assertThat(mappingService.isSearchReady(projectB))
        .as("mission §7/§8: project B's own mapping is untouched by an edit to project A's")
        .isTrue();
  }
}
