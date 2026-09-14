package com.logexplorer.api.dto;

import java.util.List;

/**
 * {@code POST /api/v1/sources/{sourceId}/field-mapping/schema-scan} response
 * (owner mission "Field Mapping Schema Scan + Masking Policy Extension"
 * §A, project-scoped per owner mission "Project-Scoped Schema Scan" §1/§6).
 * {@code representativeEvents}/{@code diagnosticNonJsonSamples} carry
 * real, unmasked Original Source JSON — never logged server-side, and the
 * frontend must hold it only in session memory, exactly like {@link
 * FieldMappingSampleResponseDto}.
 *
 * <p>{@code scopeLabel} is the real, resolved Compose project/OpenShift
 * namespace this scan ran against (mission §6 — "Selected scope:"), {@code
 * null} for a source with no sub-project concept or none selected. {@code
 * servicesObserved} is the distinct set of services seen strictly inside
 * that scope (mission §4/§6). {@code representativeEvents} draws only from
 * structured JSON events; {@code diagnosticNonJsonSamples} draws only from
 * non-JSON/malformed ones and is never used for field mapping (mission
 * §5).
 */
public record SchemaScanResponseDto(
    String sourceId,
    String scopeLabel,
    List<String> servicesObserved,
    int totalEventsInspected,
    int structuredJsonEventCount,
    int nonJsonEventCount,
    int structuralVariantCount,
    long totalBytesInspected,
    boolean eventLimitReached,
    boolean byteLimitReached,
    boolean durationLimitReached,
    List<OriginalEventSampleDto> representativeEvents,
    List<OriginalEventSampleDto> diagnosticNonJsonSamples,
    List<DiscoveredPathEntryDto> discoveredSchema,
    List<String> mappedPathsNotObserved
) {

  public record OriginalEventSampleDto(String originalJson, String severity, String classification) {
  }

  public record DiscoveredPathEntryDto(
      String path, List<String> observedTypes, int occurrenceCount, double coveragePercentage) {
  }

  @Override
  public String toString() {
    return "SchemaScanResponseDto[sourceId=" + sourceId
        + ", scopeLabel=" + scopeLabel
        + ", servicesObserved=" + servicesObserved
        + ", totalEventsInspected=" + totalEventsInspected
        + ", structuredJsonEventCount=" + structuredJsonEventCount
        + ", nonJsonEventCount=" + nonJsonEventCount
        + ", representativeEvents=[REDACTED, " + representativeEvents.size() + " sample(s)]"
        + ", diagnosticNonJsonSamples=[REDACTED, " + diagnosticNonJsonSamples.size() + " sample(s)]"
        + ", discoveredSchema=[" + discoveredSchema.size() + " path(s)]]";
  }
}
