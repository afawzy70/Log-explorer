package com.logexplorer.source.openshift;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * OS-1A §12 - enterprise proxy routing.
 *
 * <p>Background, because it is the reason this class exists: Reactor Netty
 * 1.2.18 honours only JVM <i>system properties</i> ({@code
 * https.proxyHost}, {@code http.nonProxyHosts}, ...). It has no support
 * for the {@code HTTPS_PROXY}/{@code NO_PROXY} <i>environment
 * variables</i> that {@code oc}, {@code curl} and most enterprise tooling
 * actually read. Without explicit support, "it works in my terminal but
 * not in Log Explorer" would be a common and baffling failure.
 *
 * <p>The most important tests here are the {@code NO_PROXY} boundary
 * cases: a wrong suffix match would either route a cluster's traffic
 * through a proxy the user explicitly excluded, or bypass a mandatory
 * corporate proxy - and the second failure mode is undiagnosable for a
 * user.
 */
class ProxyRouteTest {

  @Test
  void noProxyEnvironmentMeansDirectConnection() {
    assertThat(ProxyRoute.resolve(Map.of(), "api.cluster.example.com")).isEmpty();
  }

  @Test
  void httpsProxyIsUsedForTheApiServer() {
    Optional<ProxyRoute> route =
        ProxyRoute.resolve(Map.of("HTTPS_PROXY", "http://proxy.corp.example.com:3128"), "api.cluster.example.com");

    assertThat(route).isPresent();
    assertThat(route.get().host()).isEqualTo("proxy.corp.example.com");
    assertThat(route.get().port()).isEqualTo(3128);
  }

  @Test
  void lowercaseSpellingIsHonouredToo() {
    assertThat(ProxyRoute.resolve(Map.of("https_proxy", "http://proxy.corp.example.com:3128"), "api.example.com"))
        .isPresent();
  }

  @Test
  void httpsProxyWinsOverHttpProxyForTheAlwaysHttpsApiServer() {
    Optional<ProxyRoute> route = ProxyRoute.resolve(
        Map.of(
            "HTTP_PROXY", "http://wrong.example.com:1111",
            "HTTPS_PROXY", "http://right.example.com:2222"),
        "api.example.com");

    assertThat(route).isPresent();
    assertThat(route.get().host()).isEqualTo("right.example.com");
  }

  @Test
  void httpProxyIsUsedAsAFallbackWhenOnlyItIsSet() {
    Optional<ProxyRoute> route =
        ProxyRoute.resolve(Map.of("HTTP_PROXY", "http://only.example.com:8080"), "api.example.com");

    assertThat(route).isPresent();
    assertThat(route.get().host()).isEqualTo("only.example.com");
  }

  @Test
  void proxyCredentialsAreParsedButNeverPrinted() {
    Optional<ProxyRoute> route = ProxyRoute.resolve(
        Map.of("HTTPS_PROXY", "http://alice:s3cret@proxy.example.com:3128"), "api.example.com");

    assertThat(route).isPresent();
    assertThat(route.get().hasCredentials()).isTrue();
    assertThat(route.get().username()).isEqualTo("alice");
    // The display string and toString are used in the connection summary
    // and in logs - neither may carry the proxy password.
    assertThat(route.get().display()).doesNotContain("s3cret");
    assertThat(route.get().toString()).doesNotContain("s3cret");
  }

  @Test
  void aBareHostPortFormIsAccepted() {
    Optional<ProxyRoute> route = ProxyRoute.resolve(Map.of("HTTPS_PROXY", "proxy.example.com:3128"), "api.example.com");

    assertThat(route).isPresent();
    assertThat(route.get().port()).isEqualTo(3128);
  }

  @Test
  void aMalformedProxyValueFallsBackToADirectConnectionRatherThanFailing() {
    // A broken proxy variable must not stop the user connecting at all.
    assertThat(ProxyRoute.parse("::::not a url::::")).isEmpty();
    assertThat(ProxyRoute.parse("")).isEmpty();
    assertThat(ProxyRoute.parse(null)).isEmpty();
  }

  // ------------------------------------------------------------- NO_PROXY

  @ParameterizedTest
  @CsvSource({
    // noProxy,                      targetHost,                 bypassed
    "'api.cluster.example.com',      api.cluster.example.com,    true",
    "'.example.com',                 api.cluster.example.com,    true",
    "'example.com',                  api.cluster.example.com,    true",
    "'cluster.example.com',          api.cluster.example.com,    true",
    "'a.com,b.com,example.com',      api.example.com,            true",
    "'*',                            anything.example.com,       true",
    "'other.com',                    api.example.com,            false",
    "'notexample.com',               api.example.com,            false",
    "'ample.com',                    api.example.com,            false",
    "'example.com:8443',             api.example.com,            true",
  })
  void noProxyMatchingRespectsDomainBoundaries(String noProxy, String targetHost, boolean bypassed) {
    assertThat(ProxyRoute.isBypassed(noProxy, targetHost)).isEqualTo(bypassed);
  }

  /**
   * The boundary case that matters most: a suffix must only match on a dot
   * boundary. {@code example.com} must not swallow {@code notexample.com}.
   */
  @ParameterizedTest
  @ValueSource(strings = {"notexample.com", "myexample.com", "example.com.evil.net"})
  void noProxySuffixNeverMatchesAcrossALabelBoundary(String host) {
    assertThat(ProxyRoute.isBypassed("example.com", host)).isFalse();
  }

  @Test
  void noProxyOverridesAConfiguredProxy() {
    Optional<ProxyRoute> route = ProxyRoute.resolve(
        Map.of(
            "HTTPS_PROXY", "http://proxy.example.com:3128",
            "NO_PROXY", ".cluster.internal"),
        "api.cluster.internal");

    assertThat(route).as("NO_PROXY must win over HTTPS_PROXY").isEmpty();
  }

  @Test
  void aHostNotCoveredByNoProxyStillUsesTheProxy() {
    Optional<ProxyRoute> route = ProxyRoute.resolve(
        Map.of(
            "HTTPS_PROXY", "http://proxy.example.com:3128",
            "NO_PROXY", ".cluster.internal"),
        "api.public.example.com");

    assertThat(route).isPresent();
  }

  @Test
  void anUnparseableNoProxyEntryDoesNotAccidentallyBypass() {
    // CIDR entries are not interpreted. Erring toward "use the proxy" is
    // the safer direction: a proxied request to a reachable host fails
    // loudly, whereas wrongly skipping a mandatory proxy does not.
    assertThat(ProxyRoute.isBypassed("10.0.0.0/8", "api.example.com")).isFalse();
  }
}
