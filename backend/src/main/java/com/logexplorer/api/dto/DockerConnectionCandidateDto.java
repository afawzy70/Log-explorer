package com.logexplorer.api.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * {@code POST /api/v1/sources/docker/test-connection} body (Legacy
 * Remediation Slice 3) — an ephemeral candidate connection, never
 * persisted, never applied to the running application's actual Docker
 * connection. {@code host}/{@code port}/{@code tls}/{@code tlsCertPath}
 * are exactly the same shape {@code config.DockerProperties} already
 * exposes; this type exists only so the inbound HTTP body is validated at
 * the API boundary rather than binding directly onto the mutable
 * singleton properties bean.
 */
public record DockerConnectionCandidateDto(
    @NotBlank String mode,
    String host,
    Integer port,
    Boolean tls,
    String tlsCertPath
) {
}
