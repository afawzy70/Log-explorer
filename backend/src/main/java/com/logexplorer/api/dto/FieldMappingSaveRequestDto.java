package com.logexplorer.api.dto;

/**
 * {@code POST /api/v1/settings/field-mapping/save} request body —
 * {@code validationPassed} must be the {@code passed} value from the most
 * recent {@code POST /api/v1/settings/field-mapping/validate} call the
 * frontend made against the exact same candidates. The controller trusts
 * this value (the same unauthenticated-local-tool trust model every other
 * settings endpoint already uses — see {@code MaskingSettingsController}'s
 * own doc comment); the workflow (mission §14) always calls validate
 * immediately before save, in the same user action.
 */
public record FieldMappingSaveRequestDto(Boolean validationPassed) {
}
