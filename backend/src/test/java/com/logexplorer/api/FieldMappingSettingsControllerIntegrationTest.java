package com.logexplorer.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.logexplorer.api.dto.FieldMappingCandidatesUpdateRequestDto;
import com.logexplorer.api.dto.FieldMappingProfileDto;
import com.logexplorer.api.dto.FieldMappingSaveRequestDto;
import com.logexplorer.api.dto.FieldMappingValidationReportDto;
import com.logexplorer.api.dto.FieldMappingValidationRequestDto;
import com.logexplorer.api.dto.FieldMappingVerifyRequestDto;
import com.logexplorer.core.mapping.FieldMappingProfileService;
import com.logexplorer.core.mapping.MappingScopeKey;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.test.web.reactive.server.WebTestClient;

/**
 * Real HTTP-level tests for {@code /api/v1/settings/field-mapping} (mission
 * "Configurable Log Field Mapping + Original JSON Sampling" §14) — through
 * the actual controller and shared {@link FieldMappingProfileService}
 * singleton, proving the exact workflow the mapping settings UI drives:
 * view → edit → validate → save → (search readiness reflects it) → reset.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class FieldMappingSettingsControllerIntegrationTest {

  @Autowired
  private WebTestClient webTestClient;

  @Autowired
  private FieldMappingProfileService profileService;

  @AfterEach
  void resetProfile() {
    profileService.resetToDefault();
  }

  @Test
  void getReturnsTheBuiltInDefaultProfile_searchReady() {
    FieldMappingProfileDto dto = webTestClient.get().uri("/api/v1/settings/field-mapping")
        .exchange().expectStatus().isOk().expectBody(FieldMappingProfileDto.class).returnResult().getResponseBody();

    assertThat(dto).isNotNull();
    assertThat(dto.modifiedFromDefault()).isFalse();
    assertThat(dto.searchReady()).isTrue();
    assertThat(dto.fields()).extracting(FieldMappingProfileDto.CanonicalFieldMappingDto::field).contains("cif", "journeyId");
    var cif = dto.fields().stream().filter(f -> f.field().equals("cif")).findFirst().orElseThrow();
    assertThat(cif.sensitive()).isTrue();
    assertThat(cif.candidatePaths()).containsExactly("cif");
    // Journey ID is the owner-approved "intentionally unmapped" field (§C) - Journey Name now HAS a default.
    var journeyId = dto.fields().stream().filter(f -> f.field().equals("journeyId")).findFirst().orElseThrow();
    assertThat(journeyId.candidatePaths()).isEmpty();
  }

  @Test
  void puttingNewCandidatesUpdatesTheProfileAndUnReadiesSearch() {
    FieldMappingProfileDto dto = webTestClient.put().uri("/api/v1/settings/field-mapping/fields/cif")
        .bodyValue(new FieldMappingCandidatesUpdateRequestDto(List.of("mdc.cif", "cif", "cifId")))
        .exchange().expectStatus().isOk().expectBody(FieldMappingProfileDto.class).returnResult().getResponseBody();

    assertThat(dto).isNotNull();
    assertThat(dto.modifiedFromDefault()).isTrue();
    assertThat(dto.searchReady()).isFalse();
    var cif = dto.fields().stream().filter(f -> f.field().equals("cif")).findFirst().orElseThrow();
    assertThat(cif.candidatePaths()).containsExactly("mdc.cif", "cif", "cifId");
  }

  @Test
  void puttingAnInvalidPathReturns400_neverSilentlyAccepted() {
    webTestClient.put().uri("/api/v1/settings/field-mapping/fields/cif")
        .bodyValue(new FieldMappingCandidatesUpdateRequestDto(List.of("mdc..cif")))
        .exchange().expectStatus().isEqualTo(HttpStatus.BAD_REQUEST);
  }

  @Test
  void puttingAnUnknownFieldReturns400() {
    webTestClient.put().uri("/api/v1/settings/field-mapping/fields/notAField")
        .bodyValue(new FieldMappingCandidatesUpdateRequestDto(List.of("cif")))
        .exchange().expectStatus().isEqualTo(HttpStatus.BAD_REQUEST);
  }

  @Test
  void validateReportsFoundAndAbsentFieldsAgainstRealSamples() {
    FieldMappingValidationRequestDto request = new FieldMappingValidationRequestDto(
        Map.of("cif", List.of("cif")),
        List.of("{\"cif\":\"2449\"}", "{\"other\":\"x\"}"));

    FieldMappingValidationReportDto report = webTestClient.post().uri("/api/v1/settings/field-mapping/validate")
        .bodyValue(request)
        .exchange().expectStatus().isOk().expectBody(FieldMappingValidationReportDto.class).returnResult().getResponseBody();

    assertThat(report).isNotNull();
    assertThat(report.passed()).isTrue();
    assertThat(report.sampleCount()).isEqualTo(2);
    var cif = report.fields().stream().filter(f -> f.field().equals("cif")).findFirst().orElseThrow();
    assertThat(cif.foundInAnySample()).isTrue();
    assertThat(cif.exampleValues()).containsExactly("2449");
  }

  @Test
  void fullWorkflow_editValidateSave_restoresSearchReadiness() {
    webTestClient.put().uri("/api/v1/settings/field-mapping/fields/cif")
        .bodyValue(new FieldMappingCandidatesUpdateRequestDto(List.of("cif")))
        .exchange().expectStatus().isOk();
    assertThat(profileService.isSearchReady()).isFalse();

    FieldMappingValidationReportDto report = webTestClient.post().uri("/api/v1/settings/field-mapping/validate")
        .bodyValue(new FieldMappingValidationRequestDto(Map.of("cif", List.of("cif")), List.of("{\"cif\":\"2449\"}")))
        .exchange().expectStatus().isOk().expectBody(FieldMappingValidationReportDto.class).returnResult().getResponseBody();
    assertThat(report.passed()).isTrue();

    FieldMappingProfileDto afterSave = webTestClient.post().uri("/api/v1/settings/field-mapping/save")
        .bodyValue(new FieldMappingSaveRequestDto(report.passed()))
        .exchange().expectStatus().isOk().expectBody(FieldMappingProfileDto.class).returnResult().getResponseBody();

    assertThat(afterSave).isNotNull();
    assertThat(afterSave.searchReady()).isTrue();
    assertThat(profileService.isSearchReady()).isTrue();
  }

  @Test
  void aSourceIdAndProjectQueryParamScopeTheProfileAndAreEchoedBack() {
    // Owner mission "Project-Scoped Schema Scan" §7/§8.
    FieldMappingProfileDto projectA = webTestClient.put()
        .uri("/api/v1/settings/field-mapping/fields/cif?sourceId=local-docker&project=project-a")
        .bodyValue(new FieldMappingCandidatesUpdateRequestDto(List.of("cif")))
        .exchange().expectStatus().isOk().expectBody(FieldMappingProfileDto.class).returnResult().getResponseBody();

    assertThat(projectA).isNotNull();
    assertThat(projectA.sourceId()).isEqualTo("local-docker");
    assertThat(projectA.scopeLabel()).isEqualTo("project-a");
    assertThat(projectA.searchReady()).isFalse();

    // A different project on the SAME source is completely unaffected.
    FieldMappingProfileDto projectB = webTestClient.get()
        .uri("/api/v1/settings/field-mapping?sourceId=local-docker&project=project-b")
        .exchange().expectStatus().isOk().expectBody(FieldMappingProfileDto.class).returnResult().getResponseBody();

    assertThat(projectB).isNotNull();
    assertThat(projectB.scopeLabel()).isEqualTo("project-b");
    assertThat(projectB.searchReady())
        .as("mission: never reuse a mapping from another project silently")
        .isTrue();
    var cif = projectB.fields().stream().filter(f -> f.field().equals("cif")).findFirst().orElseThrow();
    assertThat(cif.candidatePaths()).containsExactly("cif");

    // Cleanup: this test's own scope is unique to it, but the shared
    // singleton FieldMappingProfileService bean must never leak edited
    // scope state into a later test in the same Spring context.
    webTestClient.post().uri("/api/v1/settings/field-mapping/reset?sourceId=local-docker&project=project-a")
        .exchange().expectStatus().isOk();
  }

  @Test
  void anUnrecognizedSourceIdNeverFailsTheReadinessCheck_realRegressionFoundByE2E() {
    // A source id the backend genuinely doesn't know about (e.g. one an
    // E2E test mocks entirely client-side, never registered here) must
    // never make this endpoint throw/404 - that would make Search look
    // permanently "mapping not ready" for a reason that has nothing to do
    // with the mapping itself.
    FieldMappingProfileDto dto = webTestClient.get()
        .uri("/api/v1/settings/field-mapping?sourceId=totally-unknown-source&project=whatever")
        .exchange().expectStatus().isOk().expectBody(FieldMappingProfileDto.class).returnResult().getResponseBody();

    assertThat(dto).isNotNull();
    assertThat(dto.sourceId()).isEqualTo("totally-unknown-source");
    assertThat(dto.scopeLabel()).isEqualTo("whatever");
    assertThat(dto.searchReady()).isTrue();
  }

  @Test
  void omittingSourceIdAndProjectFallsBackToTheLegacyUnscopedProfile() {
    FieldMappingProfileDto dto = webTestClient.get().uri("/api/v1/settings/field-mapping")
        .exchange().expectStatus().isOk().expectBody(FieldMappingProfileDto.class).returnResult().getResponseBody();

    assertThat(dto).isNotNull();
    assertThat(dto.sourceId()).isNull();
    assertThat(dto.scopeLabel()).isNull();
  }

  @Test
  void resetRestoresTheBuiltInDefaultAndSearchReadiness() {
    webTestClient.put().uri("/api/v1/settings/field-mapping/fields/cif")
        .bodyValue(new FieldMappingCandidatesUpdateRequestDto(List.of("cif")))
        .exchange().expectStatus().isOk();
    assertThat(profileService.isSearchReady()).isFalse();

    FieldMappingProfileDto reset = webTestClient.post().uri("/api/v1/settings/field-mapping/reset")
        .exchange().expectStatus().isOk().expectBody(FieldMappingProfileDto.class).returnResult().getResponseBody();

    assertThat(reset).isNotNull();
    assertThat(reset.modifiedFromDefault()).isFalse();
    assertThat(reset.searchReady()).isTrue();
    var cif = reset.fields().stream().filter(f -> f.field().equals("cif")).findFirst().orElseThrow();
    assertThat(cif.candidatePaths()).containsExactly("cif");
    assertThat(cif.verificationStatus())
        .as("RESET_TO_DEFAULTS_RESTORES_VERIFIED_STATUS")
        .isEqualTo("VERIFIED");
  }

  // =====================================================================
  // Owner mission "Mapping Verification and Investigation Workspace"
  // =====================================================================

  /**
   * Superseded by owner mission "Service Filter, Docker Performance, and
   * Verified Default Mapping" §C (CLAUDE.md §5 named conflict, applied):
   * the built-in default's own CIF candidate is now owner-approved and
   * starts {@code VERIFIED}; {@code journeyId} is the genuinely unmapped
   * field this test now uses to prove the surviving half of the original
   * rule.
   */
  @Test
  void freshOwnerApprovedDefaultStartsVerified_unmappedFieldStartsUnverified() {
    FieldMappingProfileDto dto = webTestClient.get().uri("/api/v1/settings/field-mapping")
        .exchange().expectStatus().isOk().expectBody(FieldMappingProfileDto.class).returnResult().getResponseBody();

    assertThat(dto).isNotNull();
    var cif = dto.fields().stream().filter(f -> f.field().equals("cif")).findFirst().orElseThrow();
    assertThat(cif.verificationStatus())
        .as("BUILT_IN_DEFAULT_PROFILE_STATUS=VERIFIED")
        .isEqualTo("VERIFIED");
    var journeyId = dto.fields().stream().filter(f -> f.field().equals("journeyId")).findFirst().orElseThrow();
    assertThat(journeyId.verificationStatus())
        .as("JOURNEY_ID_DEFAULT_STATUS - no default candidate, never auto-verified")
        .isEqualTo("UNVERIFIED");
  }

  @Test
  void verifyingAnEditedFieldWithRealEvidenceSucceedsAndPersistsTheStatus() {
    // CIF already starts VERIFIED (the untouched owner-approved default) -
    // edit it first so this test exercises the real "custom edit -> verify
    // against evidence" lifecycle, not a redundant re-verify of something
    // already verified.
    webTestClient.put().uri("/api/v1/settings/field-mapping/fields/cif")
        .bodyValue(new FieldMappingCandidatesUpdateRequestDto(List.of("mdc.cif")))
        .exchange().expectStatus().isOk();

    FieldMappingProfileDto verified = webTestClient.post().uri("/api/v1/settings/field-mapping/fields/cif/verify")
        .bodyValue(new FieldMappingVerifyRequestDto(List.of("{\"mdc\":{\"cif\":\"2449\"}}")))
        .exchange().expectStatus().isOk().expectBody(FieldMappingProfileDto.class).returnResult().getResponseBody();

    assertThat(verified).isNotNull();
    var cif = verified.fields().stream().filter(f -> f.field().equals("cif")).findFirst().orElseThrow();
    assertThat(cif.verificationStatus()).isEqualTo("VERIFIED");

    // Persisted - a fresh GET still reports VERIFIED.
    FieldMappingProfileDto again = webTestClient.get().uri("/api/v1/settings/field-mapping")
        .exchange().expectStatus().isOk().expectBody(FieldMappingProfileDto.class).returnResult().getResponseBody();
    assertThat(again.fields().stream().filter(f -> f.field().equals("cif")).findFirst().orElseThrow().verificationStatus())
        .isEqualTo("VERIFIED");
  }

  @Test
  void verifyingAnEditedFieldWithoutEvidenceIsRejected_neverSilentlyMarkedVerified() {
    // Edit CIF away from its VERIFIED default first (reverts to UNVERIFIED),
    // then prove a rejected verify attempt never silently promotes it.
    webTestClient.put().uri("/api/v1/settings/field-mapping/fields/cif")
        .bodyValue(new FieldMappingCandidatesUpdateRequestDto(List.of("mdc.cif")))
        .exchange().expectStatus().isOk();

    webTestClient.post().uri("/api/v1/settings/field-mapping/fields/cif/verify")
        .bodyValue(new FieldMappingVerifyRequestDto(List.of("{\"noCif\":true}")))
        .exchange().expectStatus().isEqualTo(HttpStatus.BAD_REQUEST);

    FieldMappingProfileDto dto = webTestClient.get().uri("/api/v1/settings/field-mapping")
        .exchange().expectStatus().isOk().expectBody(FieldMappingProfileDto.class).returnResult().getResponseBody();
    assertThat(dto.fields().stream().filter(f -> f.field().equals("cif")).findFirst().orElseThrow().verificationStatus())
        .isEqualTo("UNVERIFIED");
  }

  @Test
  void aRejectedVerifyAttemptNeverChangesAnAlreadyVerifiedFieldsStatus() {
    // CIF starts VERIFIED (owner-approved default, untouched). A verify
    // call against evidence that doesn't actually support it must be
    // rejected AND must leave the existing VERIFIED status alone - a
    // failed re-verification is not the same thing as "never verified."
    webTestClient.post().uri("/api/v1/settings/field-mapping/fields/cif/verify")
        .bodyValue(new FieldMappingVerifyRequestDto(List.of("{\"noCif\":true}")))
        .exchange().expectStatus().isEqualTo(HttpStatus.BAD_REQUEST);

    FieldMappingProfileDto dto = webTestClient.get().uri("/api/v1/settings/field-mapping")
        .exchange().expectStatus().isOk().expectBody(FieldMappingProfileDto.class).returnResult().getResponseBody();
    assertThat(dto.fields().stream().filter(f -> f.field().equals("cif")).findFirst().orElseThrow().verificationStatus())
        .isEqualTo("VERIFIED");
  }

  @Test
  void verifyingAnUnmappedFieldIsRejected() {
    // journeyId - the owner-approved "intentionally unmapped" field (§C); journeyName now has a default.
    webTestClient.post().uri("/api/v1/settings/field-mapping/fields/journeyId/verify")
        .bodyValue(new FieldMappingVerifyRequestDto(List.of("{\"anything\":true}")))
        .exchange().expectStatus().isEqualTo(HttpStatus.BAD_REQUEST);
  }

  @Test
  void markingNeedsChangeSetsTheStatusWithNoEvidenceRequired() {
    FieldMappingProfileDto dto = webTestClient.post().uri("/api/v1/settings/field-mapping/fields/cif/needs-change")
        .exchange().expectStatus().isOk().expectBody(FieldMappingProfileDto.class).returnResult().getResponseBody();

    assertThat(dto).isNotNull();
    assertThat(dto.fields().stream().filter(f -> f.field().equals("cif")).findFirst().orElseThrow().verificationStatus())
        .isEqualTo("NEEDS_CHANGE");
  }

  @Test
  void editingAVerifiedFieldRevertsItToUnverified_viaTheRealHttpEndpoints() {
    // CIF already starts VERIFIED (the untouched owner-approved default) -
    // no explicit verify call needed first.
    FieldMappingProfileDto afterEdit = webTestClient.put().uri("/api/v1/settings/field-mapping/fields/cif")
        .bodyValue(new FieldMappingCandidatesUpdateRequestDto(List.of("mdc.cif")))
        .exchange().expectStatus().isOk().expectBody(FieldMappingProfileDto.class).returnResult().getResponseBody();

    assertThat(afterEdit).isNotNull();
    assertThat(afterEdit.fields().stream().filter(f -> f.field().equals("cif")).findFirst().orElseThrow().verificationStatus())
        .isEqualTo("UNVERIFIED");
  }

  @Test
  void verificationStatusIsProjectScoped_neverLeaksAcrossProjects() {
    // journeyId - the owner-approved "intentionally unmapped" field (§C):
    // its fresh-scope baseline (UNVERIFIED) is meaningfully different from
    // an explicit custom verification, unlike CIF which now starts
    // VERIFIED in every fresh scope regardless of cross-project leakage.
    webTestClient.put().uri("/api/v1/settings/field-mapping/fields/journeyId?sourceId=local-docker&project=project-a")
        .bodyValue(new FieldMappingCandidatesUpdateRequestDto(List.of("mdc.customJourneyId")))
        .exchange().expectStatus().isOk();
    webTestClient.post().uri("/api/v1/settings/field-mapping/fields/journeyId/verify?sourceId=local-docker&project=project-a")
        .bodyValue(new FieldMappingVerifyRequestDto(List.of("{\"mdc\":{\"customJourneyId\":\"j-1\"}}")))
        .exchange().expectStatus().isOk();

    FieldMappingProfileDto projectB = webTestClient.get()
        .uri("/api/v1/settings/field-mapping?sourceId=local-docker&project=project-b")
        .exchange().expectStatus().isOk().expectBody(FieldMappingProfileDto.class).returnResult().getResponseBody();

    assertThat(projectB).isNotNull();
    assertThat(projectB.fields().stream().filter(f -> f.field().equals("journeyId")).findFirst().orElseThrow().verificationStatus())
        .as("CROSS_PROJECT_VERIFICATION_LEAK=NO")
        .isEqualTo("UNVERIFIED");

    profileService.resetToDefault(MappingScopeKey.of("local-docker", "project-a"));
  }

  // =====================================================================
  // Recovery mission "Field Mapping Verification Workflow Recovery" -
  // owner-observed defect: "Quick Schema Scan finds real paths... owner
  // selects the correct discovered path... field remains UNVERIFIED...
  // Verify... 'candidate path was not found in any of the given samples'."
  // ROOT CAUSE (confirmed by reading `FieldMappingWorkspace.tsx` before
  // editing): the frontend's Save action never called `PUT
  // /fields/{field}` - it validated the draft (stateless) and then only
  // confirmed a "validated and saved" flag (`POST /save`, which itself
  // never mutates candidates either - see `FieldMappingProfileService
  // #confirmSave`'s own javadoc). The draft the owner reviewed was
  // therefore NEVER actually persisted; Verify (which reads the real
  // saved/active profile by design) correctly rejected the still-old,
  // unobserved candidate. Fixed in `FieldMappingWorkspace.tsx#runSave`.
  //
  // These tests prove the BACKEND side of the contract the fixed frontend
  // now relies on: first-usable-candidate-wins verification semantics
  // were already correct here (`FieldMappingResolver`/
  // `FieldMappingValidationService`, both already covered by
  // `FieldMappingResolverTest`/`FieldMappingValidationServiceTest`) - this
  // class proves the SAME semantics hold through the real HTTP `/verify`
  // endpoint end to end, which is what the owner's browser actually calls.
  // =====================================================================

  @Test
  void firstUsableCandidateWinsVerification_stackTracePresentExceptionFallbackAbsent() {
    // The owner's own exact real scenario: Exception's built-in default is
    // just ["exception"]; the owner's real source instead uses
    // "stack_trace" - adding it ahead of the unobserved "exception"
    // fallback must still verify successfully, never require BOTH to be
    // observed.
    webTestClient.put().uri("/api/v1/settings/field-mapping/fields/exception")
        .bodyValue(new FieldMappingCandidatesUpdateRequestDto(List.of("stack_trace", "exception")))
        .exchange().expectStatus().isOk();

    FieldMappingProfileDto verified = webTestClient.post().uri("/api/v1/settings/field-mapping/fields/exception/verify")
        .bodyValue(new FieldMappingVerifyRequestDto(List.of("{\"stack_trace\":\"java.lang.RuntimeException: boom\"}")))
        .exchange().expectStatus().isOk().expectBody(FieldMappingProfileDto.class).returnResult().getResponseBody();

    assertThat(verified).isNotNull();
    assertThat(verified.fields().stream().filter(f -> f.field().equals("exception")).findFirst().orElseThrow().verificationStatus())
        .as("FIRST_USABLE_CANDIDATE_WINS_VERIFICATION / STACK_TRACE_PRESENT_EXCEPTION_FALLBACK_ABSENT")
        .isEqualTo("VERIFIED");
  }

  /**
   * Superseded by owner mission "Service Filter, Docker Performance, and
   * Verified Default Mapping" §C: the built-in default for Correlation ID
   * is now a single owner-approved candidate (no more two-candidate
   * fallback precedence) - this test now proves the mission example's
   * exact scenario ({@code [X-Correlation-id, event.correlationId]},
   * mission text verbatim) via an explicit PUT, since it is no longer the
   * built-in default shape.
   */
  @Test
  void firstCandidateAbsentSecondCandidatePresent_verifiesAgainstAnExplicitlyConfiguredFallback() {
    webTestClient.put().uri("/api/v1/settings/field-mapping/fields/correlationId")
        .bodyValue(new FieldMappingCandidatesUpdateRequestDto(List.of("mdc.X-Correlation-id", "mdc[\"event.correlationId\"]")))
        .exchange().expectStatus().isOk();

    FieldMappingProfileDto verified = webTestClient.post()
        .uri("/api/v1/settings/field-mapping/fields/correlationId/verify")
        .bodyValue(new FieldMappingVerifyRequestDto(List.of("{\"mdc\":{\"event.correlationId\":\"corr-1\"}}")))
        .exchange().expectStatus().isOk().expectBody(FieldMappingProfileDto.class).returnResult().getResponseBody();

    assertThat(verified).isNotNull();
    assertThat(verified.fields().stream().filter(f -> f.field().equals("correlationId")).findFirst().orElseThrow().verificationStatus())
        .as("FIRST_CANDIDATE_ABSENT_SECOND_CANDIDATE_PRESENT")
        .isEqualTo("VERIFIED");
  }

  @Test
  void allCandidatesAbsent_verifyFails() {
    webTestClient.put().uri("/api/v1/settings/field-mapping/fields/exception")
        .bodyValue(new FieldMappingCandidatesUpdateRequestDto(List.of("stack_trace", "exception")))
        .exchange().expectStatus().isOk();

    webTestClient.post().uri("/api/v1/settings/field-mapping/fields/exception/verify")
        .bodyValue(new FieldMappingVerifyRequestDto(List.of("{\"unrelated\":\"value\"}")))
        .exchange().expectStatus().isEqualTo(HttpStatus.BAD_REQUEST);

    FieldMappingProfileDto dto = webTestClient.get().uri("/api/v1/settings/field-mapping")
        .exchange().expectStatus().isOk().expectBody(FieldMappingProfileDto.class).returnResult().getResponseBody();
    assertThat(dto.fields().stream().filter(f -> f.field().equals("exception")).findFirst().orElseThrow().verificationStatus())
        .as("ALL_CANDIDATES_ABSENT=VERIFY_FAIL")
        .isEqualTo("UNVERIFIED");
  }

  @Test
  void invalidJsonPathSyntaxIsRejectedAtThePutStep_neverSilentlyReachesTheSavedProfile() {
    // INVALID_JSON_PATH=VERIFY_FAIL: an invalid path can never even become
    // a saved candidate to verify in the first place - rejected with a
    // specific reason at the one place candidates are ever mutated.
    webTestClient.put().uri("/api/v1/settings/field-mapping/fields/exception")
        .bodyValue(new FieldMappingCandidatesUpdateRequestDto(List.of("mdc..bad")))
        .exchange().expectStatus().isEqualTo(HttpStatus.BAD_REQUEST)
        .expectBody().jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("mdc..bad"));

    FieldMappingProfileDto dto = webTestClient.get().uri("/api/v1/settings/field-mapping")
        .exchange().expectStatus().isOk().expectBody(FieldMappingProfileDto.class).returnResult().getResponseBody();
    assertThat(dto.fields().stream().filter(f -> f.field().equals("exception")).findFirst().orElseThrow().candidatePaths())
        .as("the rejected PUT never touched the saved profile - still the untouched owner-approved default")
        .containsExactly("stack_trace");
  }

  @Test
  void foundSampleAndVerifyNeverContradict_theOwnerScenarioEndToEnd() {
    // The exact owner-reported workflow at the real HTTP layer, in a real
    // project scope: pick a discovered path (PUT) -> validate it (which
    // shows "Found: <value>", exactly what the owner saw) -> confirm save
    // -> Verify. All four calls share the SAME scope and the SAME sample -
    // Verify must never contradict what Validate already proved.
    webTestClient.put().uri("/api/v1/settings/field-mapping/fields/exception?sourceId=local-docker&project=proj-a")
        .bodyValue(new FieldMappingCandidatesUpdateRequestDto(List.of("stack_trace", "exception")))
        .exchange().expectStatus().isOk();

    String sample = "{\"stack_trace\":\"java.lang.RuntimeException: boom\"}";
    FieldMappingValidationReportDto report = webTestClient.post()
        .uri("/api/v1/settings/field-mapping/validate?sourceId=local-docker&project=proj-a")
        .bodyValue(new FieldMappingValidationRequestDto(Map.of(), List.of(sample)))
        .exchange().expectStatus().isOk().expectBody(FieldMappingValidationReportDto.class).returnResult().getResponseBody();
    assertThat(report).isNotNull();
    var validated = report.fields().stream().filter(f -> f.field().equals("exception")).findFirst().orElseThrow();
    assertThat(validated.foundInAnySample())
        .as("REAL_SAMPLE_FOUND_AND_VERIFY_CONTRADICTION=NO - precondition: Validate must show Found first")
        .isTrue();

    webTestClient.post().uri("/api/v1/settings/field-mapping/save?sourceId=local-docker&project=proj-a")
        .bodyValue(new FieldMappingSaveRequestDto(true))
        .exchange().expectStatus().isOk();

    FieldMappingProfileDto verified = webTestClient.post()
        .uri("/api/v1/settings/field-mapping/fields/exception/verify?sourceId=local-docker&project=proj-a")
        .bodyValue(new FieldMappingVerifyRequestDto(List.of(sample)))
        .exchange().expectStatus().isOk().expectBody(FieldMappingProfileDto.class).returnResult().getResponseBody();

    assertThat(verified).isNotNull();
    assertThat(verified.fields().stream().filter(f -> f.field().equals("exception")).findFirst().orElseThrow().verificationStatus())
        .as("PROJECT_SCOPE_PRESERVED / NO_CROSS_PROJECT_SAMPLE_MISMATCH / FOUND_SAMPLE_VERIFY_CONTRADICTION=NO")
        .isEqualTo("VERIFIED");

    profileService.resetToDefault(MappingScopeKey.of("local-docker", "proj-a"));
  }

  @Test
  void validMappingCanBeSavedWithUnverifiedFields_verificationNeverGatesSave() {
    // VALID_MAPPING_CAN_BE_SAVED_WITH_UNVERIFIED_FIELDS=YES: saving is
    // gated on technical validity (no invalid path syntax), never on
    // every field's verification status - many fields legitimately never
    // appear in a given sample window.
    webTestClient.put().uri("/api/v1/settings/field-mapping/fields/cif")
        .bodyValue(new FieldMappingCandidatesUpdateRequestDto(List.of("cif")))
        .exchange().expectStatus().isOk();

    FieldMappingValidationReportDto report = webTestClient.post().uri("/api/v1/settings/field-mapping/validate")
        .bodyValue(new FieldMappingValidationRequestDto(Map.of("cif", List.of("cif")), List.of("{\"cif\":\"2449\"}")))
        .exchange().expectStatus().isOk().expectBody(FieldMappingValidationReportDto.class).returnResult().getResponseBody();
    assertThat(report.passed())
        .as("OPTIONAL_FIELD_NOT_OBSERVED_DOES_NOT_BLOCK_SAVE - every other field is absent from this one-key sample, yet validation still passes")
        .isTrue();

    FieldMappingProfileDto afterSave = webTestClient.post().uri("/api/v1/settings/field-mapping/save")
        .bodyValue(new FieldMappingSaveRequestDto(report.passed()))
        .exchange().expectStatus().isOk().expectBody(FieldMappingProfileDto.class).returnResult().getResponseBody();

    assertThat(afterSave).isNotNull();
    assertThat(afterSave.searchReady()).isTrue();
    // cif was just edited (reverted to UNVERIFIED by the edit itself,
    // regardless of the save); journeyId/uiIdentifier have no default and
    // were never touched, so they remain UNVERIFIED too - but every OTHER
    // field still carries its untouched, owner-approved VERIFIED default.
    // None of this was REQUIRED for the save above to succeed.
    var cif = afterSave.fields().stream().filter(f -> f.field().equals("cif")).findFirst().orElseThrow();
    assertThat(cif.verificationStatus()).isEqualTo("UNVERIFIED");
    long unverifiedCount = afterSave.fields().stream()
        .filter(f -> f.verificationStatus().equals("UNVERIFIED"))
        .count();
    // cif (just edited) + journeyId + uiIdentifier (no owner-approved default) = 3.
    assertThat(unverifiedCount).isEqualTo(3);
    // Every other field still carries its untouched VERIFIED default - never required to save.
    long verifiedCount = afterSave.fields().stream()
        .filter(f -> f.verificationStatus().equals("VERIFIED"))
        .count();
    assertThat(verifiedCount).isEqualTo(afterSave.fields().size() - 3);
  }
}
