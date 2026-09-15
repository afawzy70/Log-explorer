package com.logexplorer.api.dto;

import com.logexplorer.core.classify.RuleValidationError;
import java.util.List;

/** Validate-only result. */
public record RuleValidationResponseDto(boolean valid, List<RuleValidationError> errors) {
}
