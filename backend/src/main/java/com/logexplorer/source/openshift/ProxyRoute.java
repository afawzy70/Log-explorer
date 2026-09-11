package com.logexplorer.source.openshift;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

/**
 * Resolves whether a given OpenShift API host should be reached through an
 * HTTP proxy, from the conventional {@code HTTPS_PROXY} / {@code HTTP_PROXY}
 * / {@code NO_PROXY} environment variables.
 *
 * <h2>Why this class exists at all (OS-1A §12)</h2>
 *
 * <p>OS-A flagged "does the HTTP stack honour the proxy environment
 * variables?" as an <i>unverified assumption</i>. It was verified for
 * OS-1A, and the answer is <b>no</b>: Reactor Netty 1.2.18's {@code
 * ProxyProvider} reads only JVM <i>system properties</i> - {@code
 * http.proxyHost}, {@code http.proxyPort}, {@code https.proxyHost},
 * {@code https.proxyPort}, {@code http.nonProxyHosts} and the SOCKS
 * equivalents. There is no {@code HTTP_PROXY}/{@code NO_PROXY}
 * environment-variable support anywhere in it, and {@code
 * proxyWithSystemProperties()} is an explicit opt-in that the existing
 * {@code LokiWebClientFactory} does not call.
 *
 * <p>Enterprise developer machines overwhelmingly set the environment
 * variables (that is what {@code curl}, {@code oc} and most CLI tooling
 * read), so "it works in my terminal but not in Log Explorer" would have
 * been a common and very confusing failure. Hence explicit support.
 *
 * <p><b>Scoped, never JVM-global.</b> This resolves a route for one
 * client; it never calls {@code System.setProperty}. Mutating global proxy
 * settings would silently change the Docker and Loki sources' networking
 * too, which is precisely the kind of action-at-a-distance OS-1A §12
 * warns against.
 *
 * <p>The environment is injected rather than read from {@link
 * System#getenv()} so this is deterministically testable.
 */
public record ProxyRoute(String host, int port, String username, String password) {

  /** Conventional lowercase spellings are checked too - both are in real-world use. */
  private static final String[] HTTPS_PROXY_KEYS = {"HTTPS_PROXY", "https_proxy"};

  private static final String[] HTTP_PROXY_KEYS = {"HTTP_PROXY", "http_proxy"};
  private static final String[] NO_PROXY_KEYS = {"NO_PROXY", "no_proxy"};

  public boolean hasCredentials() {
    return username != null && !username.isBlank();
  }

  /** Safe to show and to log - never includes proxy credentials. */
  public String display() {
    return host + ":" + port + (hasCredentials() ? " (authenticated)" : "");
  }

  @Override
  public String toString() {
    return "ProxyRoute[" + display() + "]";
  }

  /**
   * The proxy to use for {@code targetHost}, or empty when the request
   * should go direct.
   *
   * <p>The OpenShift API is always https, so {@code HTTPS_PROXY} wins;
   * {@code HTTP_PROXY} is honoured only as a fallback, matching the
   * behaviour of the CLI tooling users compare against.
   */
  public static Optional<ProxyRoute> resolve(Map<String, String> environment, String targetHost) {
    if (targetHost == null || targetHost.isBlank()) {
      return Optional.empty();
    }
    if (isBypassed(firstPresent(environment, NO_PROXY_KEYS), targetHost)) {
      return Optional.empty();
    }
    String raw = firstPresent(environment, HTTPS_PROXY_KEYS);
    if (raw == null) {
      raw = firstPresent(environment, HTTP_PROXY_KEYS);
    }
    return parse(raw);
  }

  private static String firstPresent(Map<String, String> environment, String[] keys) {
    for (String key : keys) {
      String value = environment.get(key);
      if (value != null && !value.isBlank()) {
        return value.trim();
      }
    }
    return null;
  }

  /**
   * {@code NO_PROXY} matching, deliberately conservative: an exact host
   * match, a domain-suffix match (with or without the conventional leading
   * dot), or {@code *} meaning "never proxy anything".
   *
   * <p>Suffix matching requires a dot boundary, so {@code example.com}
   * matches {@code api.example.com} but <b>not</b> {@code notexample.com} -
   * getting that wrong would send a cluster's traffic through a proxy the
   * user explicitly excluded, or vice versa.
   *
   * <p>CIDR entries are not interpreted; an entry that is not a plain host
   * or suffix simply does not match. Erring toward "use the proxy" is the
   * safer default here: a proxied request to a reachable host fails
   * loudly, whereas wrongly bypassing a mandatory corporate proxy fails in
   * a way users cannot diagnose.
   */
  static boolean isBypassed(String noProxy, String targetHost) {
    if (noProxy == null) {
      return false;
    }
    String host = targetHost.toLowerCase(Locale.ROOT);
    for (String entryRaw : noProxy.split(",")) {
      String entry = entryRaw.trim().toLowerCase(Locale.ROOT);
      if (entry.isEmpty()) {
        continue;
      }
      if ("*".equals(entry)) {
        return true;
      }
      // Strip an optional port suffix and a leading dot.
      int colon = entry.indexOf(':');
      if (colon > 0) {
        entry = entry.substring(0, colon);
      }
      String suffix = entry.startsWith(".") ? entry.substring(1) : entry;
      if (host.equals(suffix) || host.endsWith("." + suffix)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Accepts {@code http://host:port}, {@code http://user:pass@host:port}
   * and the bare {@code host:port} form some environments still use.
   * Anything unparseable yields empty rather than throwing - a malformed
   * proxy variable must not prevent the user from connecting directly.
   */
  static Optional<ProxyRoute> parse(String raw) {
    if (raw == null || raw.isBlank()) {
      return Optional.empty();
    }
    String candidate = raw.contains("://") ? raw : "http://" + raw;
    try {
      URI uri = new URI(candidate);
      String host = uri.getHost();
      if (host == null || host.isBlank()) {
        return Optional.empty();
      }
      int port = uri.getPort() != -1 ? uri.getPort() : defaultPortFor(uri.getScheme());
      String username = null;
      String password = null;
      String userInfo = uri.getUserInfo();
      if (userInfo != null && !userInfo.isBlank()) {
        int separator = userInfo.indexOf(':');
        username = separator >= 0 ? userInfo.substring(0, separator) : userInfo;
        password = separator >= 0 ? userInfo.substring(separator + 1) : null;
      }
      return Optional.of(new ProxyRoute(host, port, username, password));
    } catch (URISyntaxException e) {
      // Never log `raw` - a proxy URL can carry credentials in userinfo.
      return Optional.empty();
    }
  }

  private static int defaultPortFor(String scheme) {
    return "https".equalsIgnoreCase(scheme) ? 443 : 80;
  }
}
