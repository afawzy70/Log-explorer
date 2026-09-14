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
    assertThat(reset.candidates(CanonicalField.CIF)).extracting(JsonPath::raw).containsExactly("mdc.cif");
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
    assertThat(resetB.candidates(CanonicalField.CIF)).extracting(JsonPath::raw).containsExactly("mdc.cif");
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
}
