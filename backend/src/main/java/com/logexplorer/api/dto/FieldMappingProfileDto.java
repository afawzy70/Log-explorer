package com.logexplorer.api.dto;

import java.util.List;

/** {@code GET /api/v1/settings/field-mapping} response — the current active profile plus its readiness state. */
public record FieldMappingProfileDto(
    List<CanonicalFieldMappingDto> fields,
    boolean modifiedFromDefault,
    boolean searchReady
) {

  public record CanonicalFieldMappingDto(
      String field,
      String displayName,
      boolean sensitive,
      List<String> candidatePaths
  ) {
  }
}
