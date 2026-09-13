package com.logexplorer.api.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * Pre-closure functional recovery (§13): one field toggle at a time,
 * matching the settings UI's own checkbox-per-field interaction — never a
 * bulk overwrite that could silently re-mask/unmask fields the user never
 * touched in this request.
 */
public record MaskingFieldUpdateRequestDto(@NotBlank String field, boolean masked) {}
