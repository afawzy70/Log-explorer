package com.logexplorer.api.dto;

import java.util.List;

/**
 * {@code GET /api/v1/sources/openshift/pods} response (OS-1B review
 * recovery — "All workloads" scope truthfulness).
 *
 * @param status {@code COMPLETE} or {@code PARTIAL}. For a specifically
 *     selected workload this is always {@code COMPLETE}. For "All
 *     workloads", {@code PARTIAL} means at least one supported workload
 *     kind could not be listed (forbidden or errored) or one specific
 *     workload's own pods could not be resolved — the returned list is
 *     never widened to compensate, only honestly flagged as possibly
 *     incomplete.
 */
public record OpenShiftPodDiscoveryDto(String status, List<OpenShiftPodDto> pods) {}
