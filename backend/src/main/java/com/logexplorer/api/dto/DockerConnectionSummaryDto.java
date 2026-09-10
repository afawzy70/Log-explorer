package com.logexplorer.api.dto;

/**
 * {@code GET /api/v1/sources/docker/connection} (Legacy Remediation Slice
 * 3) — the current effective Docker connection configuration, sanitized:
 * {@code host}/{@code port} are shown (they are not secrets — the same
 * judgement CLAUDE.md already makes about non-sensitive structural
 * request fields), but nothing else about the connection (certificate
 * paths, contents, or any credential material) is ever included here.
 *
 * <p>{@code runtimeMutationSupported} is always honest, never aspirational
 * — this deployment has no authenticated admin boundary (see {@code
 * api.DockerSettingsController}'s own javadoc for the owner decision this
 * reflects), so it is always {@code false} and {@code settingsNote}
 * explains what to do instead. A future deployment with a real admin
 * boundary could flip this without changing the DTO shape.
 */
public record DockerConnectionSummaryDto(
    String mode,
    String host,
    Integer port,
    boolean tlsEnabled,
    String composeProjectFilter,
    boolean runtimeMutationSupported,
    String settingsNote,
    /** UX-R3 §6 — REMOTE mode only, cosmetic only (e.g. "QA Docker"); {@code null} for LOCAL or when unset. */
    String connectionName
) {
}
