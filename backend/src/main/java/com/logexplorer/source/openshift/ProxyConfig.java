package com.logexplorer.source.openshift;

/**
 * The user's chosen OpenShift/Loki proxy configuration (pre-closure
 * functional recovery 2, §B2/§B6) - distinct from {@link ProxyRoute},
 * which is the already-RESOLVED host/port/credentials for one specific
 * request. This is the standing, user-editable setting; {@link
 * ProxyRoute#resolve(ProxyConfig, java.util.Map, String)} turns it (plus
 * the process environment, for {@link ProxyMode#SYSTEM}) into an actual
 * route per request.
 *
 * <p>{@code customHost}/{@code customPort} are meaningful only when {@code
 * mode == CUSTOM}; they are ignored for {@code SYSTEM}/{@code DIRECT} (see
 * {@link ProxyRoute#resolve}), never validated or required outside that
 * mode.
 */
public record ProxyConfig(ProxyMode mode, String customHost, Integer customPort) {

  public static final ProxyConfig SYSTEM_DEFAULT = new ProxyConfig(ProxyMode.SYSTEM, null, null);

  public static ProxyConfig direct() {
    return new ProxyConfig(ProxyMode.DIRECT, null, null);
  }

  public static ProxyConfig custom(String host, int port) {
    return new ProxyConfig(ProxyMode.CUSTOM, host, port);
  }

  /**
   * §B4 - the minimum, deterministic validation a CUSTOM configuration
   * must pass: a non-blank host and a port in the valid TCP range.
   * {@code SYSTEM}/{@code DIRECT} are always valid regardless of the
   * (ignored) host/port fields. Returns a human-readable reason, or
   * {@code null} when valid - never throws, so a caller can turn this
   * into a clean 400 response without a try/catch.
   */
  public String validate() {
    if (mode() != ProxyMode.CUSTOM) {
      return null;
    }
    if (customHost() == null || customHost().isBlank()) {
      return "Proxy server is required for a custom proxy.";
    }
    if (customPort() == null) {
      return "Proxy port is required for a custom proxy.";
    }
    if (customPort() <= 0 || customPort() > 65535) {
      return "Proxy port must be between 1 and 65535.";
    }
    return null;
  }
}
