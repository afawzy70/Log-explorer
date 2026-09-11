package com.logexplorer.api.dto;

/**
 * One workload kind's own discovery outcome (OS-1B §17) — {@code
 * AVAILABLE}, {@code UNAVAILABLE_RESOURCE_TYPE} (a genuine 404: this
 * cluster does not expose the kind's API), {@code FORBIDDEN} (a genuine
 * 403: this user may not list it), or {@code ERROR} (any other real
 * failure). Never collapsed into a single pass/fail for the whole
 * discovery — see {@code WorkloadDiscovery}'s own javadoc.
 */
public record OpenShiftWorkloadKindOutcomeDto(String kind, String status) {}
