package com.logexplorer.api.dto;

import java.util.List;

/** {@code PUT /api/v1/settings/field-mapping/fields/{field}} request body. */
public record FieldMappingCandidatesUpdateRequestDto(
    List<String> candidatePaths
) {
}
