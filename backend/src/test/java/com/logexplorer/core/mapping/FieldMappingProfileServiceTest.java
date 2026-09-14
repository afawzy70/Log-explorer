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
}
