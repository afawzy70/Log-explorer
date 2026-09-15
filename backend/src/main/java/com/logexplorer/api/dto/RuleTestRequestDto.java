package com.logexplorer.api.dto;

import com.logexplorer.core.classify.ClassificationRule;

/** Test-rule body: an unsaved rule and the scope to sample from. Never persisted. */
public record RuleTestRequestDto(ClassificationRule rule, ClassificationSampleScopeDto scope, Integer sampleSize) {
}
