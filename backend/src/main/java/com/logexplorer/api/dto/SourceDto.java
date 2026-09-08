package com.logexplorer.api.dto;

import com.logexplorer.core.model.SourceCapabilities;

/** {@code GET /api/v1/sources} entry. {@link SourceCapabilities} carries no sensitive data. */
public record SourceDto(
    String id,
    String displayName,
    SourceCapabilities capabilities
) {
}
