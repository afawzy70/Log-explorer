package com.logexplorer.api.dto;

/**
 * Detect-pattern body: the selected field, the selected event's value for
 * it (the anchor, as the user sees it — the server redacts it again), and
 * the scope to sample similar events from.
 */
public record PatternDetectionRequestDto(String field, String anchorValue, ClassificationSampleScopeDto scope,
    Integer sampleSize) {

  @Override
  public String toString() {
    return "PatternDetectionRequestDto[field=" + field + ", anchorValue=" + (anchorValue == null ? "null" : "[REDACTED]")
        + ", scope=" + scope + ", sampleSize=" + sampleSize + "]";
  }
}
