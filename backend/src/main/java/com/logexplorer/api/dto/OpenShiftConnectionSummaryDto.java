package com.logexplorer.api.dto;

import java.util.List;

/**
 * The only OpenShift connection information this application will ever
 * return to a caller (OS-1A §17).
 *
 * <p>Note what is absent, deliberately and permanently: the bearer token,
 * any prefix or hash of it, the Authorization header, and the raw pasted
 * command. There is no "reveal" endpoint and no debug variant of this
 * record - the token exists only in backend memory and has no read path
 * out of it. `OpenShiftConnectionSummaryDtoTest` asserts this shape stays
 * that way.
 *
 * @param state DISCONNECTED / CONNECTED / EXPIRED / FAILED
 * @param connectionName the user's own label for this cluster, if given
 * @param server host:port of the API server - never the full URL with
 *     credentials, never a token
 * @param username the authenticated user if the cluster exposes it; null
 *     when unknown, never guessed
 * @param projectCount how many projects this user can actually see
 * @param projects the visible project names (safe, non-sensitive)
 * @param selectedProject the committed project, if any
 * @param tlsVerified always true when connected - Log Explorer has no
 *     insecure mode
 * @param usingPrivateCa whether an extra CA certificate was supplied
 * @param proxy sanitized proxy route ("host:port"), or null for a direct
 *     connection - never includes proxy credentials
 * @param projectApi which API answered discovery ("PROJECTS" or
 *     "NAMESPACES"), so the UI can stay truthful about what it lists
 */
public record OpenShiftConnectionSummaryDto(
    String state,
    String connectionName,
    String server,
    String username,
    int projectCount,
    List<String> projects,
    String selectedProject,
    boolean tlsVerified,
    boolean usingPrivateCa,
    String proxy,
    String projectApi) {}
