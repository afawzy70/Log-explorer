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
    boolean composeProjectScoping
) {
}
