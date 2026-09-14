package com.logexplorer.core.mapping.scan;

import java.util.List;

/**
 * Full result of one Quick Schema Scan (owner mission "Field Mapping
 * Schema Scan + Masking Policy Extension" §A, project-scoped per owner
 * mission "Project-Scoped Schema Scan" §1/§6: "Discovered Source Schema"
 * + bounded "Original Event Samples," never conflated — mission §A5 —
 * and always scoped to exactly the project/namespace the caller selected,
 * never an entire source scanned indiscriminately).
 *
 * <p>{@code scopeLabel} is the real, resolved Compose project / OpenShift
 * namespace this scan actually ran against ({@code null} for a source
 * with no sub-project concept, or none selected) — see {@code
 * LogSource#resolveMappingScopeLabel}. {@code servicesObserved} is the
 * distinct set of {@code CanonicalLogEvent#service()} values seen among
 * {@code STRUCTURED_JSON_APPLICATION_EVENT} events only (mission §4/§6 —
 * "Services observed: iam, gateway, payments," strictly inside the
 * selected project).
 *
 * <p>{@code structuredJsonEventCount}/{@code nonJsonEventCount} (mission
 * §5/§6) truthfully report the classification split; {@code
 * representativeEvents} draws ONLY from {@code
 * STRUCTURED_JSON_APPLICATION_EVENT} events, while {@code
 * diagnosticNonJsonSamples} draws ONLY from {@code
 * NON_JSON_OR_MALFORMED_EVENT} ones — the two are never mixed, so a
 * malformed/infrastructure line (an nginx access line, a fixture's own
 * deliberately-malformed line) can never become "the" representative
 * sample driving field mapping. {@code structuralVariantCount} is the
 * number of distinct structural signatures observed among structured
 * events (mission §6 — "Structural variants: N") — independent of, and
 * potentially larger than, {@code representativeEvents.size()}, which is
 * additionally capped by {@link SchemaScanBounds#MAX_REPRESENTATIVE_EVENTS}.
 *
 * <p>{@code eventLimitReached}/{@code byteLimitReached}/{@code
 * durationLimitReached} report truthfully which bound (if any) ended the
 * scan early (mission §A11 — the UI must never claim a "Complete /
 * Guaranteed" schema). {@code mappedPathsNotObserved} cross-references the
 * currently active saved field-mapping profile for THIS EXACT scope's own
 * candidate paths against what this scan actually discovered.
 */
public record SchemaScanResult(
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
    List<OriginalEventSample> representativeEvents,
    List<OriginalEventSample> diagnosticNonJsonSamples,
    List<DiscoveredPathEntry> discoveredSchema,
    List<String> mappedPathsNotObserved
) {

  public SchemaScanResult {
    servicesObserved = servicesObserved == null ? List.of() : List.copyOf(servicesObserved);
    representativeEvents = representativeEvents == null ? List.of() : List.copyOf(representativeEvents);
    diagnosticNonJsonSamples = diagnosticNonJsonSamples == null ? List.of() : List.copyOf(diagnosticNonJsonSamples);
    discoveredSchema = discoveredSchema == null ? List.of() : List.copyOf(discoveredSchema);
    mappedPathsNotObserved = mappedPathsNotObserved == null ? List.of() : List.copyOf(mappedPathsNotObserved);
  }
}
