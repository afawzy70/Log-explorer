package com.logexplorer.api.dto;

import java.util.List;

/**
 * {@code POST /api/v1/sources/{sourceId}/field-mapping/schema-scan} response
 * (owner mission "Field Mapping Schema Scan + Masking Policy Extension"
 * §A). {@code representativeEvents} carries real, unmasked Original Source
 * JSON — never logged server-side, and the frontend must hold it only in
 * session memory, exactly like {@link FieldMappingSampleResponseDto}.
 *
 * <p>{@code discoveredSchema} is the generated path union — the response's
 * {@code toString} deliberately redacts {@code representativeEvents}'
 * actual JSON content but not {@code discoveredSchema}, since a discovered
 * path/type/count is schema metadata (mission §A7 — "Do NOT store raw
 * values as persistent schema metadata"), not a raw value.
 */
public record SchemaScanResponseDto(
    String sourceId,
    int totalEventsInspected,
    int malformedEventsInspected,
    long totalBytesInspected,
    boolean eventLimitReached,
    boolean byteLimitReached,
    boolean durationLimitReached,
    List<OriginalEventSampleDto> representativeEvents,
    List<DiscoveredPathEntryDto> discoveredSchema,
    List<String> mappedPathsNotObserved
) {

  public record OriginalEventSampleDto(String originalJson, String severity, boolean malformed) {
  }

  public record DiscoveredPathEntryDto(
      String path, List<String> observedTypes, int occurrenceCount, double coveragePercentage) {
  }

  @Override
  public String toString() {
    return "SchemaScanResponseDto[sourceId=" + sourceId
        + ", totalEventsInspected=" + totalEventsInspected
        + ", malformedEventsInspected=" + malformedEventsInspected
        + ", representativeEvents=[REDACTED, " + representativeEvents.size() + " sample(s)]"
        + ", discoveredSchema=[" + discoveredSchema.size() + " path(s)]]";
  }
}
