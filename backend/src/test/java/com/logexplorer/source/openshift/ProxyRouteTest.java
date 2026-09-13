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

  // Pre-closure functional recovery (§45) - NO_PROXY's lowercase spelling
  // was already implemented (`ProxyRoute.NO_PROXY_KEYS`) but, unlike
  // HTTPS_PROXY's own `lowercaseSpellingIsHonouredToo` test above, had no
  // dedicated test proving it - closing that specific coverage gap.
  @Test
  void lowercaseNoProxySpellingIsHonouredToo() {
    Optional<ProxyRoute> route = ProxyRoute.resolve(
        Map.of(
            "HTTPS_PROXY", "http://proxy.example.com:3128",
            "no_proxy", ".cluster.internal"),
        "api.cluster.internal");

    assertThat(route).as("lowercase no_proxy must win over HTTPS_PROXY exactly like NO_PROXY does").isEmpty();
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

  // ------------------------------------------- ProxyConfig-aware resolver
  // Pre-closure functional recovery 2 (§B2/§B7/§B8/§B9/§B10) -
  // resolve(ProxyConfig, Map, String) is the ONE authoritative resolver
  // every caller now goes through; SYSTEM must delegate unchanged to the
  // pre-existing resolve(Map, String) tested exhaustively above, and
  // DIRECT/CUSTOM must never consult the environment at all.

  @Test
  void systemModeDelegatesToTheExactSameEnvironmentOnlyBehavior() {
    ProxyConfig system = ProxyConfig.SYSTEM_DEFAULT;
    Map<String, String> env = Map.of("HTTPS_PROXY", "http://proxy.corp.example.com:3128");

    Optional<ProxyRoute> route = ProxyRoute.resolve(system, env, "api.example.com");

    assertThat(route).isPresent();
    assertThat(route.get().host()).isEqualTo("proxy.corp.example.com");
    assertThat(route.get().port()).isEqualTo(3128);
  }

  @Test
  void systemModeWithNoEnvironmentIsDirect() {
    assertThat(ProxyRoute.resolve(ProxyConfig.SYSTEM_DEFAULT, Map.of(), "api.example.com")).isEmpty();
  }

  @Test
  void directModeIsAlwaysEmptyEvenWhenTheEnvironmentHasAProxyConfigured() {
    Map<String, String> env = Map.of("HTTPS_PROXY", "http://proxy.corp.example.com:3128");

    Optional<ProxyRoute> route = ProxyRoute.resolve(ProxyConfig.direct(), env, "api.example.com");

    assertThat(route).as("DIRECT must never consult the environment").isEmpty();
  }

  @Test
  void directModeIsAlwaysEmptyWithNoEnvironmentEither() {
    assertThat(ProxyRoute.resolve(ProxyConfig.direct(), Map.of(), "api.example.com")).isEmpty();
  }

  @Test
  void customModeAlwaysUsesTheConfiguredHostAndPort_neverTheEnvironment() {
    ProxyConfig custom = ProxyConfig.custom("proxy.company.local", 8080);
    // Deliberately a DIFFERENT proxy in the environment, to prove CUSTOM
    // never reads it.
    Map<String, String> env = Map.of("HTTPS_PROXY", "http://wrong-proxy.example.com:9999");

    Optional<ProxyRoute> route = ProxyRoute.resolve(custom, env, "api.example.com");

    assertThat(route).isPresent();
    assertThat(route.get().host()).isEqualTo("proxy.company.local");
    assertThat(route.get().port()).isEqualTo(8080);
  }

  @Test
  void customModeIgnoresNoProxy_neverSilentlyBypassesAnExplicitlyConfiguredCustomProxy() {
    ProxyConfig custom = ProxyConfig.custom("proxy.company.local", 8080);
    Map<String, String> env = Map.of("NO_PROXY", "*");

    Optional<ProxyRoute> route = ProxyRoute.resolve(custom, env, "api.example.com");

    assertThat(route).as("an explicit CUSTOM proxy is authoritative, unlike SYSTEM's NO_PROXY bypass").isPresent();
    assertThat(route.get().host()).isEqualTo("proxy.company.local");
  }

  @Test
  void customModeWorksWithNoEnvironmentAtAll_provingNoEnvironmentDependency() {
    // §B9/§B14 - CUSTOM must not depend on the environment in any way,
    // which is what makes it work identically regardless of launch
    // method (Finder/Dock/Start Menu/terminal/dev server).
    Optional<ProxyRoute> route =
        ProxyRoute.resolve(ProxyConfig.custom("proxy.company.local", 8080), Map.of(), "api.example.com");

    assertThat(route).isPresent();
    assertThat(route.get().host()).isEqualTo("proxy.company.local");
    assertThat(route.get().port()).isEqualTo(8080);
  }

  @Test
  void aBlankTargetHostIsAlwaysEmptyRegardlessOfMode() {
    for (ProxyConfig config : new ProxyConfig[] {
      ProxyConfig.SYSTEM_DEFAULT, ProxyConfig.direct(), ProxyConfig.custom("proxy.example.com", 8080)
    }) {
      assertThat(ProxyRoute.resolve(config, Map.of(), "")).isEmpty();
      assertThat(ProxyRoute.resolve(config, Map.of(), null)).isEmpty();
    }
  }

  // -------------------------------------------------- ProxyConfig.validate()

  @Test
  void systemAndDirectAreAlwaysValidRegardlessOfIgnoredHostPortFields() {
    assertThat(ProxyConfig.SYSTEM_DEFAULT.validate()).isNull();
    assertThat(ProxyConfig.direct().validate()).isNull();
    assertThat(new ProxyConfig(ProxyMode.SYSTEM, "ignored", 999999).validate()).isNull();
  }

  @Test
  void customWithAValidHostAndPortIsValid() {
    assertThat(ProxyConfig.custom("proxy.company.local", 8080).validate()).isNull();
    assertThat(ProxyConfig.custom("proxy.company.local", 1).validate()).isNull();
    assertThat(ProxyConfig.custom("proxy.company.local", 65535).validate()).isNull();
  }

  @Test
  void customWithABlankOrNullHostIsRejected() {
    assertThat(new ProxyConfig(ProxyMode.CUSTOM, null, 8080).validate()).isNotNull();
    assertThat(new ProxyConfig(ProxyMode.CUSTOM, "", 8080).validate()).isNotNull();
    assertThat(new ProxyConfig(ProxyMode.CUSTOM, "   ", 8080).validate()).isNotNull();
  }

  @Test
  void customWithANullPortIsRejected() {
    assertThat(new ProxyConfig(ProxyMode.CUSTOM, "proxy.company.local", null).validate()).isNotNull();
  }

  @Test
  void customWithAnOutOfRangePortIsRejected() {
    for (int badPort : new int[] {0, -1, -100, 65536, 100000}) {
      assertThat(ProxyConfig.custom("proxy.company.local", badPort).validate())
          .as("port %d must be rejected", badPort)
          .isNotNull();
    }
  }
}
