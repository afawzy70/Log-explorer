package com.logexplorer.api.dto;

/**
 * Import apply body. {@code packJson} is the same file text that was
 * previewed, re-validated in full on apply. {@code conflictResolution} is
 * required for MERGE when conflicts exist; {@code confirmReplaceAll} must
 * be true for REPLACE_ALL.
 */
public record ImportApplyRequestDto(String packJson, String mode, String conflictResolution, Long expectedRevision,
    Boolean confirmReplaceAll) {

  @Override
  public String toString() {
    return "ImportApplyRequestDto[packJson=" + (packJson == null ? "null" : packJson.length() + " chars") + ", mode="
        + mode + ", conflictResolution=" + conflictResolution + ", expectedRevision=" + expectedRevision
        + ", confirmReplaceAll=" + confirmReplaceAll + "]";
  }
}
