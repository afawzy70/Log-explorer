package com.logexplorer.source.loki;

import static org.assertj.core.api.Assertions.assertThat;

import com.logexplorer.config.LokiProperties;
import java.io.IOException;
import java.time.Duration;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import reactor.test.StepVerifier;

/**
 * Mock-server tests for query construction (IMPLEMENTATION_PLAN.md "Phase
 * D" required automated test: "query construction (prefix/tenant/labels
 * all vary), nanosecond conversion, ..., each error class").
 */
class LokiQueryClientTest {

  private MockLokiServer mockServer;

  @AfterEach
  void tearDown() {
    if (mockServer != null) {
      mockServer.close();
    }
  }

  private LokiProperties propertiesFor(MockLokiServer server, String gatewayPrefix, String tenant) {
    LokiProperties properties = new LokiProperties();
    properties.setBaseUrl(server.baseUrl());
    properties.setGatewayPrefix(gatewayPrefix);
    properties.setTenant(tenant);
    properties.setRequestTimeout(Duration.ofSeconds(2));
    return properties;
  }

  private LokiQueryClient clientFor(LokiProperties properties) {
    return new LokiQueryClient(properties, new LokiTokenSupplier(properties), new LokiWebClientFactory());
  }

  @Test
  void queryConstructionUsesTheConfiguredGatewayPrefixAndTenant() throws IOException {
    mockServer = new MockLokiServer("/api/logs/v1", "application", "namespace", "app");
    LokiProperties properties = propertiesFor(mockServer, "/api/logs/v1", "application");

    StepVerifier.create(clientFor(properties).queryRange("{namespace=\"x\"}", 1_000_000_000L, 2_000_000_000L, 10, "backward"))
        .assertNext(response -> assertThat(response.status()).isEqualTo("success"))
        .verifyComplete();
  }

  @Test
  void queryConstructionVariesCorrectlyWithADifferentGatewayPrefixAndTenant() throws IOException {
    // A genuinely different route shape must still resolve - proves the
    // client builds the path from config, not a hardcoded default.
    mockServer = new MockLokiServer("/gw/logging", "tenant-b", "ns", "svc");
    LokiProperties properties = propertiesFor(mockServer, "/gw/logging", "tenant-b");

    StepVerifier.create(clientFor(properties).queryRange("{ns=\"x\"}", 1_000_000_000L, 2_000_000_000L, 10, "backward"))
        .assertNext(response -> assertThat(response.status()).isEqualTo("success"))
        .verifyComplete();
  }

  @Test
  void wrongTenantConfiguredAgainstTheServerFails() throws IOException {
    mockServer = new MockLokiServer("/api/logs/v1", "application", "namespace", "app");
    LokiProperties properties = propertiesFor(mockServer, "/api/logs/v1", "wrong-tenant");

    StepVerifier.create(clientFor(properties).queryRange("{namespace=\"x\"}", 1_000_000_000L, 2_000_000_000L, 10, "backward"))
        .expectErrorSatisfies(e -> assertThat(e).isInstanceOf(LokiRequestException.class))
        .verify();
  }

  @Test
  void startEndLimitAndDirectionAreSentAsNanosecondEpochQueryParams() throws IOException {
    mockServer = new MockLokiServer("/api/logs/v1", "application", "namespace", "app");
    LokiProperties properties = propertiesFor(mockServer, "/api/logs/v1", "application");

    long startNanos = 1_767_225_600_000_000_000L; // 2026-01-01T00:00:00Z in nanoseconds
    long endNanos = 1_767_229_200_000_000_000L; // one hour later

    StepVerifier.create(clientFor(properties).queryRange("{namespace=\"x\"}", startNanos, endNanos, 42, "forward"))
        .expectNextCount(1)
        .verifyComplete();

    Map<String, String> params = parseQuery(mockServer.lastQueryString());
    assertThat(params.get("start")).isEqualTo(String.valueOf(startNanos));
    assertThat(params.get("end")).isEqualTo(String.valueOf(endNanos));
    assertThat(params.get("limit")).isEqualTo("42");
    assertThat(params.get("direction")).isEqualTo("forward");
  }

  @Test
  void queryParamCarriesTheBuiltLogQlSelectorVerbatim() throws IOException {
    mockServer = new MockLokiServer("/api/logs/v1", "application", "namespace", "app");
    LokiProperties properties = propertiesFor(mockServer, "/api/logs/v1", "application");
    String selector = LogQlSelectorBuilder.build("namespace", "my-ns", "app", java.util.List.of("gateway"));

    StepVerifier.create(clientFor(properties).queryRange(selector, 1L, 2L, 10, "backward"))
        .expectNextCount(1)
        .verifyComplete();

    Map<String, String> params = parseQuery(mockServer.lastQueryString());
    assertThat(params.get("query")).isEqualTo(selector);
  }

  @Test
  void tokenIsSentAsABearerAuthorizationHeaderWhenConfigured() throws IOException {
    mockServer = new MockLokiServer("/api/logs/v1", "application", "namespace", "app");
    LokiProperties properties = propertiesFor(mockServer, "/api/logs/v1", "application");
    properties.setTokenEnvVar("PATH"); // any real env var, see LokiTokenSupplierTest

    StepVerifier.create(clientFor(properties).queryRange("{namespace=\"x\"}", 1L, 2L, 10, "backward"))
        .expectNextCount(1)
        .verifyComplete();

    assertThat(mockServer.lastAuthorizationHeader()).isEqualTo("Bearer " + System.getenv("PATH"));
  }

  @Test
  void noAuthorizationHeaderIsSentWhenNoTokenIsConfigured() throws IOException {
    mockServer = new MockLokiServer("/api/logs/v1", "application", "namespace", "app");
    LokiProperties properties = propertiesFor(mockServer, "/api/logs/v1", "application");

    StepVerifier.create(clientFor(properties).queryRange("{namespace=\"x\"}", 1L, 2L, 10, "backward"))
        .expectNextCount(1)
        .verifyComplete();

    assertThat(mockServer.lastAuthorizationHeader()).isNull();
  }

  @Test
  void status401IsClassifiedAsUnauthorized() throws IOException {
    mockServer = new MockLokiServer("/api/logs/v1", "application", "namespace", "app");
    mockServer.setScenario("401");
    LokiProperties properties = propertiesFor(mockServer, "/api/logs/v1", "application");

    StepVerifier.create(clientFor(properties).queryRange("{namespace=\"x\"}", 1L, 2L, 10, "backward"))
        .expectErrorSatisfies(e -> assertThat(((LokiRequestException) e).reason())
            .isEqualTo(LokiRequestException.Reason.UNAUTHORIZED))
        .verify();
  }

  @Test
  void status403IsClassifiedAsForbidden() throws IOException {
    mockServer = new MockLokiServer("/api/logs/v1", "application", "namespace", "app");
    mockServer.setScenario("403");
    LokiProperties properties = propertiesFor(mockServer, "/api/logs/v1", "application");

    StepVerifier.create(clientFor(properties).queryRange("{namespace=\"x\"}", 1L, 2L, 10, "backward"))
        .expectErrorSatisfies(e -> assertThat(((LokiRequestException) e).reason())
            .isEqualTo(LokiRequestException.Reason.FORBIDDEN))
        .verify();
  }

  @Test
  void status429IsClassifiedAsRateLimited() throws IOException {
    mockServer = new MockLokiServer("/api/logs/v1", "application", "namespace", "app");
    mockServer.setScenario("429");
    LokiProperties properties = propertiesFor(mockServer, "/api/logs/v1", "application");

    StepVerifier.create(clientFor(properties).queryRange("{namespace=\"x\"}", 1L, 2L, 10, "backward"))
        .expectErrorSatisfies(e -> assertThat(((LokiRequestException) e).reason())
            .isEqualTo(LokiRequestException.Reason.RATE_LIMITED))
        .verify();
  }

  @Test
  void status5xxIsClassifiedAsServerError() throws IOException {
    mockServer = new MockLokiServer("/api/logs/v1", "application", "namespace", "app");
    mockServer.setScenario("5xx");
    LokiProperties properties = propertiesFor(mockServer, "/api/logs/v1", "application");

    StepVerifier.create(clientFor(properties).queryRange("{namespace=\"x\"}", 1L, 2L, 10, "backward"))
        .expectErrorSatisfies(e -> assertThat(((LokiRequestException) e).reason())
            .isEqualTo(LokiRequestException.Reason.SERVER_ERROR))
        .verify();
  }

  @Test
  void timeoutScenarioCausesARealClientSideTimeoutClassifiedAsTimeout() throws IOException {
    mockServer = new MockLokiServer("/api/logs/v1", "application", "namespace", "app");
    mockServer.setScenario("timeout");
    LokiProperties properties = propertiesFor(mockServer, "/api/logs/v1", "application");
    properties.setRequestTimeout(Duration.ofMillis(200));

    StepVerifier.create(clientFor(properties).queryRange("{namespace=\"x\"}", 1L, 2L, 10, "backward"))
        .expectErrorSatisfies(e -> assertThat(((LokiRequestException) e).reason())
            .isEqualTo(LokiRequestException.Reason.TIMEOUT))
        .verify(Duration.ofSeconds(2));
  }

  private Map<String, String> parseQuery(String rawQuery) {
    Map<String, String> result = new java.util.LinkedHashMap<>();
    if (rawQuery == null) {
      return result;
    }
    for (String pair : rawQuery.split("&")) {
      int idx = pair.indexOf('=');
      if (idx < 0) {
        continue;
      }
      String key = java.net.URLDecoder.decode(pair.substring(0, idx), java.nio.charset.StandardCharsets.UTF_8);
      String value = java.net.URLDecoder.decode(pair.substring(idx + 1), java.nio.charset.StandardCharsets.UTF_8);
      result.put(key, value);
    }
    return result;
  }
}
