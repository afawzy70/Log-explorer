package com.logexplorer.core.model;

/** One discovered service, for {@code GET /api/v1/sources/{id}/services}. */
public record ServiceInfo(
    String name,
    int runningCount,
    int totalCount
) {
}
