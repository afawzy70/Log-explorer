package com.logexplorer.api.dto;

import java.util.List;

/**
 * {@code POST /api/v1/settings/field-mapping/validate} response (mission
 * §16). {@code exampleValues} are real, unmasked resolved values —
 * deliberate, owner-approved, for this privileged mapping-setup surface
 * only (see {@code core.mapping.FieldMappingValidationService}'s own
 * javadoc). {@code toString()} is not overridden to redact them: this DTO
 * is never logged (see {@code FieldMappingSettingsLeakTest}), and hiding
 * the very values the owner explicitly asked to see here would defeat the
 * endpoint's purpose.
 */
public record FieldMappingValidationReportDto(
    List<FieldValidationDto> fields,
    List<ConflictDto> conflicts,
    int sampleCount,
    int malformedSampleCount,
    boolean passed
) {

  public record FieldValidationDto(
      String field,
      String displayName,
      List<String> candidatePaths,
      List<String> invalidPaths,
      int sampleCount,
      int foundCount,
      boolean foundInAnySample,
      boolean mappedButAbsent,
      boolean structuredValueWarning,
      List<String> exampleValues
  ) {
  }

  public record ConflictDto(String pathRaw, List<String> fields) {
  }
}
