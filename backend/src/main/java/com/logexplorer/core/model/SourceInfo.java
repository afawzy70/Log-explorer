package com.logexplorer.core.model;

/** One entry of {@code GET /api/v1/sources}. */
public record SourceInfo(
    String id,
    String displayName,
    SourceCapabilities capabilities
) {
}
