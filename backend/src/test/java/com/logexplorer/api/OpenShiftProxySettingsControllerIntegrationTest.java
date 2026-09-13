package com.logexplorer.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.logexplorer.source.openshift.OpenShiftProxyConfigService;
import com.logexplorer.source.openshift.ProxyConfig;
import com.logexplorer.source.openshift.ProxyMode;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.reactive.server.WebTestClient;

/**
 * Pre-closure functional recovery 2 (§B2/§B4/§B16) - the real HTTP surface
 * for user-configurable OpenShift/Loki proxy settings, over the actual
 * {@link OpenShiftProxyConfigService} bean (never a mock), mirroring
 * {@code MaskingSettingsControllerIntegrationTest}'s own real-HTTP
 * pattern for the same reasons (real Bean Validation, real JSON
 * (de)serialization, real 400-vs-200 status codes).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestPropertySource(properties = "server.address=127.0.0.1")
class OpenShiftProxySettingsControllerIntegrationTest {

  @Autowired
  private WebTestClient webTestClient;

  @Autowired
  private OpenShiftProxyConfigService proxyConfigService;

  @AfterEach
  void resetProxyConfig() {
    proxyConfigService.resetToDefault();
  }

  @Test
  void defaultsToSystemModeWithNoHostOrPort() {
    webTestClient
        .get()
        .uri("/api/v1/sources/openshift/proxy")
        .exchange()
        .expectStatus()
        .isOk()
        .expectBody()
        .jsonPath("$.mode")
        .isEqualTo("SYSTEM")
        .jsonPath("$.host")
        .doesNotExist()
        .jsonPath("$.port")
        .doesNotExist();
  }

  @Test
  void switchingToDirectIsReflectedOnTheNextRead() {
    webTestClient
        .put()
        .uri("/api/v1/sources/openshift/proxy")
        .bodyValue(new ProxyBody("DIRECT", null, null))
        .exchange()
        .expectStatus()
        .isOk()
        .expectBody()
        .jsonPath("$.mode")
        .isEqualTo("DIRECT");

    assertThat(proxyConfigService.current().mode()).isEqualTo(ProxyMode.DIRECT);

    webTestClient
        .get()
        .uri("/api/v1/sources/openshift/proxy")
        .exchange()
        .expectStatus()
        .isOk()
        .expectBody()
        .jsonPath("$.mode")
        .isEqualTo("DIRECT");
  }

  @Test
  void switchingToCustomWithAValidHostAndPortIsApplied() {
    webTestClient
        .put()
        .uri("/api/v1/sources/openshift/proxy")
        .bodyValue(new ProxyBody("CUSTOM", "proxy.company.local", 8080))
        .exchange()
        .expectStatus()
        .isOk()
        .expectBody()
        .jsonPath("$.mode")
        .isEqualTo("CUSTOM")
        .jsonPath("$.host")
        .isEqualTo("proxy.company.local")
        .jsonPath("$.port")
        .isEqualTo(8080);

    assertThat(proxyConfigService.current())
        .isEqualTo(ProxyConfig.custom("proxy.company.local", 8080));
  }

  @Test
  void customModeWithABlankHostIsRejectedWithAClearMessage_neverSilentlyCoerced() {
    String body = webTestClient
        .put()
        .uri("/api/v1/sources/openshift/proxy")
        .bodyValue(new ProxyBody("CUSTOM", "", 8080))
        .exchange()
        .expectStatus()
        .isBadRequest()
        .expectBody(String.class)
        .returnResult()
        .getResponseBody();
    assertThat(body).isNotNull().containsIgnoringCase("proxy server");

    // Rejected write never lands in the service - the prior (default) value stands.
    assertThat(proxyConfigService.current()).isEqualTo(ProxyConfig.SYSTEM_DEFAULT);
  }

  @Test
  void customModeWithAMissingPortIsRejected() {
    String body = webTestClient
        .put()
        .uri("/api/v1/sources/openshift/proxy")
        .bodyValue(new ProxyBody("CUSTOM", "proxy.company.local", null))
        .exchange()
        .expectStatus()
        .isBadRequest()
        .expectBody(String.class)
        .returnResult()
        .getResponseBody();
    assertThat(body).isNotNull().containsIgnoringCase("port");
  }

  @Test
  void customModeWithAnOutOfRangePortIsRejected() {
    for (int badPort : new int[] {0, -1, 65536, 999999}) {
      webTestClient
          .put()
          .uri("/api/v1/sources/openshift/proxy")
          .bodyValue(new ProxyBody("CUSTOM", "proxy.company.local", badPort))
          .exchange()
          .expectStatus()
          .isBadRequest();
    }
  }

  @Test
  void anUnknownProxyModeIsRejectedWithBadRequest() {
    webTestClient
        .put()
        .uri("/api/v1/sources/openshift/proxy")
        .bodyValue(new ProxyBody("SOCKS5", null, null))
        .exchange()
        .expectStatus()
        .isBadRequest();
  }

  @Test
  void switchingAwayFromCustomStopsReturningTheStaleHostAndPort() {
    webTestClient
        .put()
        .uri("/api/v1/sources/openshift/proxy")
        .bodyValue(new ProxyBody("CUSTOM", "old-proxy.example.com", 3128))
        .exchange()
        .expectStatus()
        .isOk();

    webTestClient
        .put()
        .uri("/api/v1/sources/openshift/proxy")
        .bodyValue(new ProxyBody("SYSTEM", null, null))
        .exchange()
        .expectStatus()
        .isOk()
        .expectBody()
        .jsonPath("$.mode")
        .isEqualTo("SYSTEM")
        .jsonPath("$.host")
        .doesNotExist();

    assertThat(proxyConfigService.current()).isEqualTo(ProxyConfig.SYSTEM_DEFAULT);
  }

  @Test
  void theProxySettingsResponseNeverCarriesAnyTokenOrCredentialField() {
    String body = webTestClient
        .get()
        .uri("/api/v1/sources/openshift/proxy")
        .exchange()
        .expectStatus()
        .isOk()
        .expectBody(String.class)
        .returnResult()
        .getResponseBody();
    assertThat(body).isNotNull();
    assertThat(body.toLowerCase()).doesNotContain("token").doesNotContain("password").doesNotContain("bearer");
  }

  private record ProxyBody(String mode, String host, Integer port) {}
}
