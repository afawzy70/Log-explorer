package com.logexplorer.source.openshift;

/**
 * OS-1C review recovery — the result of one bounded pod-log fetch.
 * {@code byteCapReached} is {@code true} only when the upstream response
 * genuinely had more bytes than {@code maxBytes} and accumulation was
 * stopped early — never inferred from {@code body.length()} (a
 * UTF-16-char count, not a byte count) after the fact. See {@link
 * OpenShiftApiClient#fetchPodLog} for how this is produced.
 */
public record PodLogFetchResult(String body, boolean byteCapReached) {
}
