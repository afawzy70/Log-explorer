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
    boolean contextView
) {
}
