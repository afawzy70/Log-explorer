package com.logexplorer.source.openshift;

/**
 * The workload types OS-1B discovers, in the deterministic order they are
 * always reported and sorted in (OS-1B §6/§19).
 *
 * <p>Jobs and CronJobs are deliberately not here yet — deferred, not
 * forgotten: their pods are short-lived and completed-pod semantics (a Job
 * that already finished, a CronJob's historical runs) deserve their own
 * design rather than being squeezed into the "current replicas" model the
 * four kinds below share. See the OS-1B verification report for the
 * explicit decision record.
 */
public enum WorkloadKind {
  DEPLOYMENT("apps/v1", "deployments", "Deployment"),
  DEPLOYMENT_CONFIG("apps.openshift.io/v1", "deploymentconfigs", "DeploymentConfig"),
  STATEFUL_SET("apps/v1", "statefulsets", "StatefulSet"),
  DAEMON_SET("apps/v1", "daemonsets", "DaemonSet");

  private final String apiGroupVersion;
  private final String resourcePlural;
  private final String displayName;

  WorkloadKind(String apiGroupVersion, String resourcePlural, String displayName) {
    this.apiGroupVersion = apiGroupVersion;
    this.resourcePlural = resourcePlural;
    this.displayName = displayName;
  }

  /** Namespaced list path, e.g. {@code /apis/apps/v1/namespaces/payments/deployments}. */
  String listPath(String namespace) {
    return "/apis/" + apiGroupVersion + "/namespaces/" + namespace + "/" + resourcePlural;
  }

  /** Single-object path, used only to re-read a workload's selector at pod-resolution time. */
  String getPath(String namespace, String name) {
    return listPath(namespace) + "/" + name;
  }

  public String displayName() {
    return displayName;
  }
}
