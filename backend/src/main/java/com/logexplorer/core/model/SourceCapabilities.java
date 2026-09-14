package com.logexplorer.core.model;

/**
 * Explicit, backend-declared capabilities for one source (HANDOVER.md §7).
 * The frontend must never infer what a source can do — it only ever reads
 * this.
 */
public record SourceCapabilities(
    boolean historicalSearch,
    boolean liveTail,
    boolean rawLogQL,
    boolean serviceDiscovery,
    boolean queryStatistics,
    boolean contextView,
    /**
     * UX-R3 — whether this source has a real, request-scoped Docker
     * Compose "investigation scope" concept at all ({@code true} only for
     * {@code local-docker}). The frontend uses this, never source id/name
     * heuristics, to decide whether to even show the Compose project
     * selector - the same "frontend never infers what a source can do"
     * rule every other capability here already follows.
     */
    boolean composeProjectScoping,
    /**
     * Owner mission "Configurable Log Field Mapping + Original JSON
     * Sampling" §6 — whether this source can safely supply bounded,
     * ephemeral Original Source JSON samples for the field-mapping setup
     * workflow ({@code core.mapping.sample.FieldMappingSampleService}).
     * Truthfully {@code true} for every source today (Fixture, Docker,
     * OpenShift, Loki) because all four route through the same {@code
     * core.parse.LogLineParser} and {@code CanonicalLogEvent#originalRawJson()}
     * capture, entirely reusing each source's existing, already-bounded
     * {@code search()} — this is a genuine, uniform architectural property,
     * never fabricated per mission §6's "do not fabricate support"
     * instruction. Kept as an explicit per-source capability (not a
     * hard-coded assumption in the frontend) so a future source that
     * genuinely cannot support it — should one ever be added — can
     * truthfully declare {@code false} without a code change anywhere else.
     */
    boolean originalSchemaSampling
) {
}
