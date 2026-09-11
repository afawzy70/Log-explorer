package com.logexplorer.source.openshift;

/**
 * One resolved (pod, container) direct-log-fetch target (OS-1C §10/§11).
 * {@code workload} is carried through purely for identity/notes — never
 * used to build the log-fetch URL, which only ever needs namespace/pod/
 * container.
 */
public record PodLogTarget(String namespace, WorkloadRef workload, String podName, String containerName) {

  /** Stable identity for dedup/capping - a target is uniquely (pod, container), workload is descriptive only. */
  public String targetKey() {
    return podName + "/" + containerName;
  }
}
