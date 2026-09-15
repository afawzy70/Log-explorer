package com.logexplorer.core.mapping;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

/** Covers mission §15 (search readiness gate) and §12 (view/edit/reset/save operations). */
class FieldMappingProfileServiceTest {

  @Test
  void startsSearchReadyOnTheUntouchedBuiltInDefault() {
    FieldMappingProfileService service = new FieldMappingProfileService();
    assertThat(service.isSearchReady()).isTrue();
    assertThat(service.isModifiedFromDefault()).isFalse();
    assertThat(service.activeProfile().id()).isEqualTo(DefaultFieldMappingProfile.ID);
  }

  @Test
  void editingAFieldImmediatelyUnReadiesSearch() {
    FieldMappingProfileService service = new FieldMappingProfileService();
    service.updateCandidates(CanonicalField.CIF, List.of(JsonPath.parse("cif")));
    assertThat(service.isModifiedFromDefault()).isTrue();
    assertThat(service.isSearchReady())
        .as("mission §15: Search must not silently operate with an unverified mapping")
        .isFalse();
  }

  @Test
  void confirmSaveWithPassingValidationRestoresReadiness() {
    FieldMappingProfileService service = new FieldMappingProfileService();
    service.updateCandidates(CanonicalField.CIF, List.of(JsonPath.parse("cif")));
    assertThat(service.isSearchReady()).isFalse();

    boolean ready = service.confirmSave(true);

    assertThat(ready).isTrue();
    assertThat(service.isSearchReady()).isTrue();
  }

  @Test
  void confirmSaveWithFailingValidationKeepsSearchBlocked() {
    FieldMappingProfileService service = new FieldMappingProfileService();
    service.updateCandidates(CanonicalField.CIF, List.of(JsonPath.parse("cif")));

    boolean ready = service.confirmSave(false);

    assertThat(ready).isFalse();
    assertThat(service.isSearchReady()).isFalse();
  }

  @Test
  void anotherEditAfterASuccessfulSaveUnReadiesAgain() {
    FieldMappingProfileService service = new FieldMappingProfileService();
    service.updateCandidates(CanonicalField.CIF, List.of(JsonPath.parse("cif")));
    service.confirmSave(true);
    assertThat(service.isSearchReady()).isTrue();

    service.updateCandidates(CanonicalField.USERNAME, List.of(JsonPath.parse("userName")));

    assertThat(service.isSearchReady())
        .as("every edit re-blocks search until the next successful validate-and-save")
        .isFalse();
  }

  @Test
  void resetToDefaultAlwaysRestoresSearchReadiness() {
    FieldMappingProfileService service = new FieldMappingProfileService();
    service.updateCandidates(CanonicalField.CIF, List.of(JsonPath.parse("cif")));
    assertThat(service.isSearchReady()).isFalse();

    FieldMappingProfile reset = service.resetToDefault();

    assertThat(service.isSearchReady()).isTrue();
    assertThat(service.isModifiedFromDefault()).isFalse();
    assertThat(reset.candidates(CanonicalField.CIF)).extracting(JsonPath::raw).containsExactly("cif");
  }

  @Test
  void updateCandidatesActuallyChangesTheActiveProfile() {
    FieldMappingProfileService service = new FieldMappingProfileService();
    service.updateCandidates(CanonicalField.CIF, List.of(JsonPath.parse("cif"), JsonPath.parse("cifId")));
    assertThat(service.activeProfile().candidates(CanonicalField.CIF))
        .extracting(JsonPath::raw)
        .containsExactly("cif", "cifId");
  }

  // =====================================================================
  // Owner mission "Project-Scoped Schema Scan" §7/§8 - scope-aware API
  // =====================================================================

  @Test
  void eachScopeStartsSearchReadyOnItsOwnUntouchedBuiltInDefault() {
    FieldMappingProfileService service = new FieldMappingProfileService();
    MappingScopeKey scopeA = MappingScopeKey.of("local-docker", "project-a");
    MappingScopeKey scopeB = MappingScopeKey.of("local-docker", "project-b");

    assertThat(service.isSearchReady(scopeA)).isTrue();
    assertThat(service.isSearchReady(scopeB)).isTrue();
    assertThat(service.activeProfile(scopeA).id()).isEqualTo(DefaultFieldMappingProfile.ID);
  }

  @Test
  void editingOneScopeNeverAffectsAnotherScopeOnTheSameSource() {
    FieldMappingProfileService service = new FieldMappingProfileService();
    MappingScopeKey scopeA = MappingScopeKey.of("local-docker", "project-a");
    MappingScopeKey scopeB = MappingScopeKey.of("local-docker", "project-b");

    service.updateCandidates(scopeA, CanonicalField.CIF, List.of(JsonPath.parse("cif")));

    assertThat(service.isModifiedFromDefault(scopeA)).isTrue();
    assertThat(service.isSearchReady(scopeA)).isFalse();
    assertThat(service.isModifiedFromDefault(scopeB))
        .as("mission §7: do not force one global mapping across unrelated projects")
        .isFalse();
    assertThat(service.isSearchReady(scopeB)).isTrue();
  }

  @Test
  void twoDifferentSourcesWithTheSameProjectNameAreStillTwoDistinctScopes() {
    FieldMappingProfileService service = new FieldMappingProfileService();
    MappingScopeKey dockerScope = MappingScopeKey.of("local-docker", "shared-name");
    MappingScopeKey openshiftScope = MappingScopeKey.of("openshift", "shared-name");

    service.updateCandidates(dockerScope, CanonicalField.CIF, List.of(JsonPath.parse("cif")));

    assertThat(service.isModifiedFromDefault(dockerScope)).isTrue();
    assertThat(service.isModifiedFromDefault(openshiftScope)).isFalse();
  }

  @Test
  void confirmSaveAndResetAreFullyScoped() {
    FieldMappingProfileService service = new FieldMappingProfileService();
    MappingScopeKey scopeA = MappingScopeKey.of("local-docker", "project-a");
    MappingScopeKey scopeB = MappingScopeKey.of("local-docker", "project-b");

    service.updateCandidates(scopeA, CanonicalField.CIF, List.of(JsonPath.parse("cif")));
    service.updateCandidates(scopeB, CanonicalField.CIF, List.of(JsonPath.parse("cifId")));
    service.confirmSave(scopeA, true);

    assertThat(service.isSearchReady(scopeA)).isTrue();
    assertThat(service.isSearchReady(scopeB))
        .as("scope B's own save was never confirmed - it stays blocked regardless of scope A's save")
        .isFalse();

    FieldMappingProfile resetB = service.resetToDefault(scopeB);
    assertThat(service.isSearchReady(scopeB)).isTrue();
    assertThat(resetB.candidates(CanonicalField.CIF)).extracting(JsonPath::raw).containsExactly("cif");
    // Scope A's own already-saved, already-ready profile is untouched by resetting scope B.
    assertThat(service.activeProfile(scopeA).candidates(CanonicalField.CIF)).extracting(JsonPath::raw).containsExactly("cif");
  }

  @Test
  void theNoArgConvenienceMethodsOperateOnTheUnspecifiedScopeOnly() {
    FieldMappingProfileService service = new FieldMappingProfileService();
    service.updateCandidates(CanonicalField.CIF, List.of(JsonPath.parse("cif")));

    assertThat(service.isSearchReady()).isFalse();
    assertThat(service.isSearchReady(MappingScopeKey.UNSPECIFIED)).isFalse();
    // A real, named scope is completely unaffected by the no-arg convenience.
    assertThat(service.isSearchReady(MappingScopeKey.of("local-docker", "project-a"))).isTrue();
  }

  // =====================================================================
  // Owner mission "Mapping Verification and Investigation Workspace"
  // =====================================================================

  /**
   * Superseded by owner mission "Service Filter, Docker Performance, and
   * Verified Default Mapping" §C (CLAUDE.md §5 named conflict, applied):
   * the ORIGINAL rule this test proved — "DEFAULT_MAPPING != VERIFIED_MAPPING,
   * an untouched built-in default is never auto-VERIFIED merely because it
   * exists" — assumed no built-in default had ever been owner-reviewed
   * against real source JSON. The owner has since explicitly approved a
   * specific default mapping table; that approval itself is the evidence,
   * so an untouched owner-approved default candidate now starts {@code
   * VERIFIED} (BUILT_IN_DEFAULT_PROFILE_STATUS=VERIFIED). The general
   * principle survives for anything the owner did NOT approve a default
   * for: a field with zero default candidates ({@link
   * CanonicalField#JOURNEY_ID}/{@link CanonicalField#UI_IDENTIFIER}) still
   * starts {@code UNVERIFIED} (UNMAPPED_FIELDS_ARE_NOT_AUTO_VERIFIED=YES).
   */
  @Test
  void freshProfileOwnerApprovedDefaultsStartVerified_unmappedFieldsStartUnverified() {
    FieldMappingProfileService service = new FieldMappingProfileService();
    MappingScopeKey scope = MappingScopeKey.of("local-docker", "project-a");

    // Owner-approved defaults (non-empty candidate) - VERIFIED, no Quick Schema Scan required.
    assertThat(service.verificationStatus(scope, CanonicalField.CIF)).isEqualTo(FieldVerificationStatus.VERIFIED);
    assertThat(service.verificationStatus(scope, CanonicalField.CORRELATION_ID)).isEqualTo(FieldVerificationStatus.VERIFIED);
    assertThat(service.verificationStatus(scope, CanonicalField.TIMESTAMP)).isEqualTo(FieldVerificationStatus.VERIFIED);

    // Deliberately unmapped by default - UNVERIFIED, no candidate to have approved.
    assertThat(service.verificationStatus(scope, CanonicalField.JOURNEY_ID)).isEqualTo(FieldVerificationStatus.UNVERIFIED);
    assertThat(service.verificationStatus(scope, CanonicalField.UI_IDENTIFIER)).isEqualTo(FieldVerificationStatus.UNVERIFIED);

    // Every field is one or the other - never a third silent state.
    java.util.Map<CanonicalField, FieldVerificationStatus> all = service.allVerificationStatuses(scope);
    for (CanonicalField field : CanonicalField.values()) {
      boolean hasDefault = !DefaultFieldMappingProfile.build().candidates(field).isEmpty();
      assertThat(all.get(field))
          .as(field.name())
          .isEqualTo(hasDefault ? FieldVerificationStatus.VERIFIED : FieldVerificationStatus.UNVERIFIED);
    }
  }

  /** QUICK_SCAN_NOT_REQUIRED_FOR_DEFAULT_VERIFICATION=PASS — no scan, no edit, no save: the field is already VERIFIED the instant the scope is first touched. */
  @Test
  void ownerApprovedDefaultIsVerifiedWithNoScanNoEditNoSave() {
    FieldMappingProfileService service = new FieldMappingProfileService();
    MappingScopeKey scope = MappingScopeKey.of("local-docker", "fresh-project");
    assertThat(service.verificationStatus(scope, CanonicalField.SERVICE)).isEqualTo(FieldVerificationStatus.VERIFIED);
  }

  @Test
  void markVerifiedAndMarkNeedsChangeSetTheExpectedStatus() {
    FieldMappingProfileService service = new FieldMappingProfileService();
    MappingScopeKey scope = MappingScopeKey.of("local-docker", "project-a");

    service.markVerified(scope, CanonicalField.CIF);
    assertThat(service.verificationStatus(scope, CanonicalField.CIF)).isEqualTo(FieldVerificationStatus.VERIFIED);

    service.markNeedsChange(scope, CanonicalField.TRACE_ID);
    assertThat(service.verificationStatus(scope, CanonicalField.TRACE_ID)).isEqualTo(FieldVerificationStatus.NEEDS_CHANGE);
  }

  @Test
  void editingAVerifiedFieldsCandidatesRevertsItToUnverified() {
    FieldMappingProfileService service = new FieldMappingProfileService();
    MappingScopeKey scope = MappingScopeKey.of("local-docker", "project-a");
    service.markVerified(scope, CanonicalField.CIF);
    assertThat(service.verificationStatus(scope, CanonicalField.CIF)).isEqualTo(FieldVerificationStatus.VERIFIED);

    service.updateCandidates(scope, CanonicalField.CIF, List.of(JsonPath.parse("newPath")));

    assertThat(service.verificationStatus(scope, CanonicalField.CIF))
        .as("the evidence backing VERIFIED no longer applies to the new candidate")
        .isEqualTo(FieldVerificationStatus.UNVERIFIED);
  }

  @Test
  void editingANeedsChangeFieldsCandidatesDoesNotSilentlyPromoteItToVerified() {
    FieldMappingProfileService service = new FieldMappingProfileService();
    MappingScopeKey scope = MappingScopeKey.of("local-docker", "project-a");
    service.markNeedsChange(scope, CanonicalField.CIF);

    service.updateCandidates(scope, CanonicalField.CIF, List.of(JsonPath.parse("newPath")));

    assertThat(service.verificationStatus(scope, CanonicalField.CIF))
        .as("mission: do not silently promote NEEDS_CHANGE to VERIFIED after a save")
        .isEqualTo(FieldVerificationStatus.NEEDS_CHANGE);
  }

  @Test
  void resettingTheProfileRestoresExactlyTheFreshScopeVerificationState() {
    // RESET_TO_DEFAULTS_RESTORES_VERIFIED_STATUS=PASS. CIF (owner-approved
    // default) explicitly edited then custom-verified; JOURNEY_ID
    // (no default) explicitly custom-mapped and marked needs-change.
    // Reset must discard BOTH custom states and restore the fresh-scope
    // truth: CIF back to VERIFIED (the untouched owner-approved default,
    // not UNVERIFIED), JOURNEY_ID back to UNVERIFIED with no candidate.
    FieldMappingProfileService service = new FieldMappingProfileService();
    MappingScopeKey scope = MappingScopeKey.of("local-docker", "project-a");
    service.updateCandidates(scope, CanonicalField.CIF, List.of(JsonPath.parse("customer.cif")));
    service.markVerified(scope, CanonicalField.CIF);
    service.updateCandidates(scope, CanonicalField.JOURNEY_ID, List.of(JsonPath.parse("mdc.customJourneyId")));
    service.markNeedsChange(scope, CanonicalField.JOURNEY_ID);

    FieldMappingProfile reset = service.resetToDefault(scope);

    assertThat(service.verificationStatus(scope, CanonicalField.CIF))
        .as("RESET_REMOVES_CUSTOM_VERIFICATION - back to the owner-approved default's own VERIFIED state, not UNVERIFIED")
        .isEqualTo(FieldVerificationStatus.VERIFIED);
    assertThat(reset.candidates(CanonicalField.CIF)).extracting(JsonPath::raw).containsExactly("cif");
    assertThat(service.verificationStatus(scope, CanonicalField.JOURNEY_ID))
        .as("RESET_REMOVES_CUSTOM_JOURNEY_ID_MAPPING")
        .isEqualTo(FieldVerificationStatus.UNVERIFIED);
    assertThat(reset.candidates(CanonicalField.JOURNEY_ID)).isEmpty();
  }

  @Test
  void verificationStatusIsFullyScopedAcrossProjects() {
    // PROJECT_SCOPED_VERIFICATION / CROSS_PROJECT_VERIFICATION_LEAK=NO.
    // JOURNEY_ID has no owner-approved default, so its fresh-scope
    // baseline (UNVERIFIED) is meaningfully different from an explicit
    // custom verification - the field this test needs to prove isolation.
    FieldMappingProfileService service = new FieldMappingProfileService();
    MappingScopeKey projectA = MappingScopeKey.of("local-docker", "project-a");
    MappingScopeKey projectB = MappingScopeKey.of("local-docker", "project-b");

    service.updateCandidates(projectA, CanonicalField.JOURNEY_ID, List.of(JsonPath.parse("mdc.customJourneyId")));
    service.markVerified(projectA, CanonicalField.JOURNEY_ID);

    assertThat(service.verificationStatus(projectA, CanonicalField.JOURNEY_ID)).isEqualTo(FieldVerificationStatus.VERIFIED);
    assertThat(service.verificationStatus(projectB, CanonicalField.JOURNEY_ID))
        .as("a field verified for project A must never leak into project B's own status")
        .isEqualTo(FieldVerificationStatus.UNVERIFIED);
  }

  /** BUILT_IN_DEFAULTS_ARE_NOT_MUTATED_GLOBALLY_BY_ONE_PROJECT=PASS / FRESH_PROJECT_SCOPE_INHERITS_VERIFIED_DEFAULT_PROFILE=PASS. */
  @Test
  void oneProjectEditingAFieldNeverMutatesAnotherProjectsOwnVerifiedDefaultState() {
    FieldMappingProfileService service = new FieldMappingProfileService();
    MappingScopeKey projectA = MappingScopeKey.of("local-docker", "project-a");
    MappingScopeKey projectB = MappingScopeKey.of("local-docker", "project-b");

    service.updateCandidates(projectA, CanonicalField.CIF, List.of(JsonPath.parse("customer.cif")));

    assertThat(service.verificationStatus(projectA, CanonicalField.CIF))
        .as("editing project A's own CIF candidate reverts ONLY project A to UNVERIFIED")
        .isEqualTo(FieldVerificationStatus.UNVERIFIED);
    assertThat(service.verificationStatus(projectB, CanonicalField.CIF))
        .as("project B never touched CIF - still the fresh, owner-approved VERIFIED default")
        .isEqualTo(FieldVerificationStatus.VERIFIED);
    assertThat(service.activeProfile(projectB).candidates(CanonicalField.CIF))
        .extracting(JsonPath::raw)
        .containsExactly("cif");
  }
}
