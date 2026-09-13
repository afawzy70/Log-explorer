package com.logexplorer.api.dto;

/**
 * The current (GET) or desired (PUT) OpenShift/Loki proxy configuration
 * (pre-closure functional recovery 2, §B16). {@code mode} is one of
 * {@code SYSTEM}/{@code DIRECT}/{@code CUSTOM}; {@code host}/{@code port}
 * are meaningful only for {@code CUSTOM} and are {@code null} otherwise -
 * mirrored back exactly as sent, never coerced.
 *
 * <p>Never carries a bearer token or any other credential - a proxy
 * server/port is not itself sensitive, but this DTO exists specifically
 * so nothing else ever needs to be added to it that would be.
 */
public record OpenShiftProxySettingsDto(String mode, String host, Integer port) {}
