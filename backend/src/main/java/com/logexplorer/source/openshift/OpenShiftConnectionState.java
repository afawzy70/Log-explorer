package com.logexplorer.source.openshift;

/**
 * The OpenShift source's runtime connection state (OS-1A §5).
 *
 * <p>Deliberately a small enum on the existing source rather than a second
 * connection-state framework: {@code SourceHealth} already answers "can
 * this source be used right now", and this only adds the one thing health
 * cannot express - that the source is fine but nobody has authenticated
 * yet, which is a normal starting state rather than a failure.
 */
public enum OpenShiftConnectionState {
  /** No credentials have been supplied in this session. The normal initial state - not an error. */
  DISCONNECTED,
  /** Credentials accepted and validated against the cluster. */
  CONNECTED,
  /** Credentials were valid but the cluster has since rejected them (401). Re-authentication required. */
  EXPIRED,
  /** The last connection attempt failed for a reason other than authentication (TLS, network, proxy). */
  FAILED
}
