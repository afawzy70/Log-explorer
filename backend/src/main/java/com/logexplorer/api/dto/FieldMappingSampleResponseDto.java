package com.logexplorer.api.dto;

import java.util.List;

/**
 * {@code POST /api/v1/sources/{sourceId}/field-mapping/samples} response.
 * {@code samples} are the real, unmasked Original Source JSON strings
 * (mission §3/§4) — never logged server-side (this DTO is built and
 * returned in one request; nothing is cached), and the frontend must hold
 * them only in session memory (never {@code localStorage}).
 */
public record FieldMappingSampleResponseDto(
    String sourceId,
    int requestedLimit,
    int actualCount,
    List<String> samples
) {

  @Override
  public String toString() {
    return "FieldMappingSampleResponseDto[sourceId=" + sourceId
        + ", requestedLimit=" + requestedLimit
        + ", actualCount=" + actualCount
        + ", samples=[REDACTED, " + actualCount + " sample(s)]]";
  }
}
