package com.logexplorer.api.dto;

import java.util.List;

/**
 * {@code POST /api/v1/settings/field-mapping/fields/{field}/verify} request
 * body (owner mission "Mapping Verification and Investigation Workspace")
 * — real, unmasked Original Source JSON samples (typically the current
 * Quick Schema Scan's own representative events, already held in the
 * caller's ephemeral session state) the server re-validates the field's
 * active candidate against before allowing {@code VERIFIED}. Never
 * persisted, never logged — same discipline as {@link
 * FieldMappingValidationRequestDto#samples}.
 */
public record FieldMappingVerifyRequestDto(List<String> samples) {

  @Override
  public String toString() {
    int count = samples == null ? 0 : samples.size();
    return "FieldMappingVerifyRequestDto[samples=[REDACTED, " + count + " sample(s)]]";
  }
}
