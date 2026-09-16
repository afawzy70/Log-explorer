package com.logexplorer.api.dto;

import com.logexplorer.core.classify.ClassificationRule;

/**
 * "Suggest extractions" body (owner mission "Classification real search
 * scope, assisted extraction, and visual tagging" §"Assisted extraction"):
 * the rule whose matching events should be mined for extractable values —
 * either a saved rule by {@code ruleId} or an unsaved draft {@code rule} —
 * the field to read, the selected event's value for it, and the committed
 * search scope to sample from.
 *
 * <p>Suggestion only: nothing is saved, and no external service is
 * involved — suggestions come from the same deterministic detector Detect
 * pattern uses.
 */
public record ExtractionSuggestionRequestDto(String ruleId, ClassificationRule rule, String field, String anchorValue,
    ClassificationSampleScopeDto scope, Integer sampleSize) {

  @Override
  public String toString() {
    return "ExtractionSuggestionRequestDto[ruleId=" + ruleId + ", field=" + field
        + ", anchorValue=" + (anchorValue == null ? "null" : "[REDACTED]") + ", scope=" + scope
        + ", sampleSize=" + sampleSize + "]";
  }
}
