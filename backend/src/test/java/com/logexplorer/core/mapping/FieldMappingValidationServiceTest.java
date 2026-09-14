package com.logexplorer.core.mapping;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.logexplorer.core.mapping.FieldMappingValidationService.FieldValidation;
import com.logexplorer.core.mapping.FieldMappingValidationService.MappingValidationReport;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Covers mission §16 (validation preview: found / absent / invalid path / conflicts / type warnings). */
class FieldMappingValidationServiceTest {

  private final FieldMappingValidationService service = new FieldMappingValidationService(new ObjectMapper());
  private final FieldMappingProfile defaultProfile = DefaultFieldMappingProfile.build();

  @Test
  void fieldMappedAndFoundAcrossSamples() {
    List<String> samples = List.of("{\"cif\":\"2449\"}", "{\"cif\":\"3300\"}");
    MappingValidationReport report = service.validate(Map.of(CanonicalField.CIF, List.of("cif")), defaultProfile, samples);

    FieldValidation cif = fieldOf(report, CanonicalField.CIF);
    assertThat(cif.foundInAnySample()).isTrue();
    assertThat(cif.mappedButAbsent()).isFalse();
    assertThat(cif.exampleValues()).containsExactlyInAnyOrder("2449", "3300");
  }

  @Test
  void fieldMappedButAbsentFromEverySample() {
    List<String> samples = List.of("{\"other\":\"x\"}", "{\"other\":\"y\"}");
    MappingValidationReport report = service.validate(Map.of(CanonicalField.CIF, List.of("cif")), defaultProfile, samples);

    FieldValidation cif = fieldOf(report, CanonicalField.CIF);
    assertThat(cif.foundInAnySample()).isFalse();
    assertThat(cif.mappedButAbsent()).isTrue();
  }

  @Test
  void unmappedFieldIsNeitherFoundNorMappedButAbsent() {
    MappingValidationReport report = service.validate(
        Map.of(CanonicalField.JOURNEY_NAME, List.of()), defaultProfile, List.of("{\"cif\":\"2449\"}"));
    FieldValidation journeyName = fieldOf(report, CanonicalField.JOURNEY_NAME);
    assertThat(journeyName.foundInAnySample()).isFalse();
    assertThat(journeyName.mappedButAbsent()).isFalse();
  }

  @Test
  void invalidPathSyntaxIsReportedPerField_andFailsOverallValidation() {
    MappingValidationReport report = service.validate(
        Map.of(CanonicalField.CIF, List.of("mdc..cif")), defaultProfile, List.of("{\"cif\":\"2449\"}"));

    FieldValidation cif = fieldOf(report, CanonicalField.CIF);
    assertThat(cif.invalidPaths()).containsExactly("mdc..cif");
    assertThat(report.passed()).isFalse();
  }

  @Test
  void validPathsAmongInvalidOnesAreStillUsedForResolution() {
    MappingValidationReport report = service.validate(
        Map.of(CanonicalField.CIF, List.of("mdc..cif", "cif")), defaultProfile, List.of("{\"cif\":\"2449\"}"));
    FieldValidation cif = fieldOf(report, CanonicalField.CIF);
    assertThat(cif.invalidPaths()).containsExactly("mdc..cif");
    assertThat(cif.foundInAnySample()).isTrue();
  }

  @Test
  void conflictingCandidates_sameSourcePathClaimedByTwoCanonicalFields() {
    MappingValidationReport report = service.validate(
        Map.of(
            CanonicalField.CIF, List.of("sharedKey"),
            CanonicalField.USERNAME, List.of("sharedKey")),
        defaultProfile, List.of("{\"sharedKey\":\"x\"}"));

    assertThat(report.conflicts()).hasSize(1);
    assertThat(report.conflicts().get(0).pathRaw()).isEqualTo("sharedKey");
    assertThat(report.conflicts().get(0).fields()).containsExactlyInAnyOrder(CanonicalField.CIF, CanonicalField.USERNAME);
  }

  @Test
  void anInvalidPathNeverCountsTowardAConflict() {
    MappingValidationReport report = service.validate(
        Map.of(
            CanonicalField.CIF, List.of("mdc..bad"),
            CanonicalField.USERNAME, List.of("mdc..bad")),
        defaultProfile, List.of());
    assertThat(report.conflicts()).isEmpty();
  }

  @Test
  void structuredValueWarningWhenPathResolvesToANestedObject() {
    MappingValidationReport report = service.validate(
        Map.of(CanonicalField.CIF, List.of("customer")), defaultProfile, List.of("{\"customer\":{\"cif\":\"2449\"}}"));
    FieldValidation cif = fieldOf(report, CanonicalField.CIF);
    assertThat(cif.structuredValueWarning()).isTrue();
  }

  @Test
  void malformedSampleIsCountedSeparatelyAndDoesNotCrashValidation() {
    MappingValidationReport report = service.validate(
        Map.of(CanonicalField.CIF, List.of("cif")), defaultProfile, List.of("{\"cif\":\"2449\"}", "not-json-at-all"));
    assertThat(report.sampleCount()).isEqualTo(1);
    assertThat(report.malformedSampleCount()).isEqualTo(1);
  }

  @Test
  void omittedFieldFallsBackToTheGivenProfilesExistingCandidates() {
    // Only CIF is being proposed as a change; every other field should still be
    // validated using the fallback (default) profile's own existing candidates.
    MappingValidationReport report = service.validate(
        Map.of(CanonicalField.CIF, List.of("cif")), defaultProfile,
        List.of("{\"cif\":\"2449\",\"mdc\":{\"traceId\":\"t-1\"}}"));
    FieldValidation traceId = fieldOf(report, CanonicalField.TRACE_ID);
    assertThat(traceId.candidatePathsRaw()).containsExactly("mdc.traceId");
    assertThat(traceId.foundInAnySample()).isTrue();
  }

  @Test
  void passesWhenNoInvalidPathsAnywhere() {
    MappingValidationReport report = service.validate(Map.of(), defaultProfile, List.of("{\"cif\":\"2449\"}"));
    assertThat(report.passed()).isTrue();
  }

  private FieldValidation fieldOf(MappingValidationReport report, CanonicalField field) {
    return report.fields().stream().filter(f -> f.field() == field).findFirst().orElseThrow();
  }
}
