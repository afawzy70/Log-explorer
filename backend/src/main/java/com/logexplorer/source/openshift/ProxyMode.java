package com.logexplorer.source.openshift;

/**
 * Pre-closure functional recovery 2 (§B2) - how a proxy is chosen for
 * OpenShift/Loki outbound traffic, user-selectable from the application
 * itself rather than only via OS environment variables.
 */
public enum ProxyMode {
  /** Honor the existing {@code HTTPS_PROXY}/{@code HTTP_PROXY}/{@code NO_PROXY} environment-variable behavior (unchanged - {@link ProxyRoute#resolve(java.util.Map, String)}). The default. */
  SYSTEM,
  /** Always connect directly - the environment's proxy variables are never consulted, regardless of what is set. */
  DIRECT,
  /** Always use the user-supplied host/port from the application's own settings - never the environment, even if it also has a proxy configured. */
  CUSTOM
}
