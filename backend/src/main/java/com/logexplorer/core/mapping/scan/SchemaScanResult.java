package com.logexplorer.core.mapping.scan;

import java.util.List;

/**
 * Full result of one Quick Schema Scan (owner mission §A: "Discovered
 * Source Schema" + bounded "Original Event Samples," never conflated —
 * mission §A5).
 *
 * <p>{@code eventLimitReached}/{@code byteLimitReached}/{@code
 * durationLimitReached} report truthfully which bound (if any) ended the
 * scan early (mission §A11 — the UI must never claim a "Complete /
 * Guaranteed" schema; these flags are exactly how it knows to say
 * "Observed" instead). {@code mappedPathsNotObserved} cross-references the
 * currently active saved field-mapping profile's own candidate paths
 * against what this scan actually discovered — the backend half of mission
 * §A9's rescan-safety requirement ("highlight saved mapping paths currently
 * absent"); the frontend is responsible for the other half (diffing
 * against its own previously-held scan result to show newly-discovered vs.
 * disappeared paths across two scans), the same "frontend is the only
 * place samples are held across calls" precedent {@code
 * core.mapping.sample.FieldMappingSampleService} already established.
 */
public record SchemaScanResult(
    String sourceId,
    int totalEventsInspected,
    int malformedEventsInspected,
    long totalBytesInspected,
    boolean eventLimitReached,
    boolean byteLimitReached,
    boolean durationLimitReached,
    List<OriginalEventSample> representativeEvents,
    List<DiscoveredPathEntry> discoveredSchema,
    List<String> mappedPathsNotObserved
) {

  public SchemaScanResult {
    representativeEvents = representativeEvents == null ? List.of() : List.copyOf(representativeEvents);
    discoveredSchema = discoveredSchema == null ? List.of() : List.copyOf(discoveredSchema);
    mappedPathsNotObserved = mappedPathsNotObserved == null ? List.of() : List.copyOf(mappedPathsNotObserved);
  }
}
