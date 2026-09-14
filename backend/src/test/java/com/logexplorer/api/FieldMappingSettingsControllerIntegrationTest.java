package com.logexplorer.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.logexplorer.api.dto.FieldMappingCandidatesUpdateRequestDto;
import com.logexplorer.api.dto.FieldMappingProfileDto;
import com.logexplorer.api.dto.FieldMappingSaveRequestDto;
import com.logexplorer.api.dto.FieldMappingValidationReportDto;
import com.logexplorer.api.dto.FieldMappingValidationRequestDto;
import com.logexplorer.core.mapping.FieldMappingProfileService;
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
    assertThat(dto.fields()).extracting(FieldMappingProfileDto.CanonicalFieldMappingDto::field).contains("cif", "journeyName");
    var cif = dto.fields().stream().filter(f -> f.field().equals("cif")).findFirst().orElseThrow();
    assertThat(cif.sensitive()).isTrue();
    assertThat(cif.candidatePaths()).containsExactly("mdc.cif");
    var journeyName = dto.fields().stream().filter(f -> f.field().equals("journeyName")).findFirst().orElseThrow();
    assertThat(journeyName.candidatePaths()).isEmpty();
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
    assertThat(cif.candidatePaths()).containsExactly("mdc.cif");
  }
}
