package com.logexplorer.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.logexplorer.api.dto.MaskingFieldUpdateRequestDto;
import com.logexplorer.api.dto.MaskingSettingsDto;
import com.logexplorer.core.mask.MaskingPolicyService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.test.web.reactive.server.WebTestClient;

/**
 * Pre-closure functional recovery (§11/§12/§13/§16/§43): the global,
 * source-independent masking-settings endpoint, exercised over real HTTP
 * against a real dev-mode Spring context — never mocked, since this
 * endpoint's whole point is proving the real server-side enforcement
 * boundary.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class MaskingSettingsControllerIntegrationTest {

  @Autowired
  private WebTestClient webTestClient;

  @Autowired
  private MaskingPolicyService policy;

  @AfterEach
  void resetPolicy() {
    // Every test in this file must not leak its own policy mutation into
    // the next - the shared Spring context means the singleton bean
    // otherwise carries state across tests.
    policy.resetToDefaults();
  }

  @Test
  void defaultPolicyMasksAllFiveProtectedFields() {
    MaskingSettingsDto dto = webTestClient
        .get()
        .uri("/api/v1/settings/masking")
        .exchange()
        .expectStatus()
        .isOk()
        .expectBody(MaskingSettingsDto.class)
        .returnResult()
        .getResponseBody();
    assertThat(dto).isNotNull();
    assertThat(dto.cif()).isTrue();
    assertThat(dto.userName()).isTrue();
    assertThat(dto.customerId()).isTrue();
    assertThat(dto.deviceId()).isTrue();
    assertThat(dto.deviceIp()).isTrue();
  }

  @Test
  void togglingOneFieldOffIsReflectedImmediatelyInTheNextGetAndLeavesOthersUnchanged() {
    webTestClient
        .put()
        .uri("/api/v1/settings/masking")
        .bodyValue(new MaskingFieldUpdateRequestDto("cif", false))
        .exchange()
        .expectStatus()
        .isOk()
        .expectBody(MaskingSettingsDto.class)
        .value(dto -> {
          assertThat(dto.cif()).isFalse();
          assertThat(dto.userName()).isTrue();
          assertThat(dto.customerId()).isTrue();
          assertThat(dto.deviceId()).isTrue();
          assertThat(dto.deviceIp()).isTrue();
        });

    webTestClient
        .get()
        .uri("/api/v1/settings/masking")
        .exchange()
        .expectStatus()
        .isOk()
        .expectBody(MaskingSettingsDto.class)
        .value(dto -> assertThat(dto.cif()).isFalse());
  }

  @Test
  void togglingAFieldBackOnRestoresMasking() {
    webTestClient.put().uri("/api/v1/settings/masking").bodyValue(new MaskingFieldUpdateRequestDto("deviceIp", false)).exchange().expectStatus().isOk();
    webTestClient.put().uri("/api/v1/settings/masking").bodyValue(new MaskingFieldUpdateRequestDto("deviceIp", true)).exchange().expectStatus().isOk();
    webTestClient
        .get()
        .uri("/api/v1/settings/masking")
        .exchange()
        .expectBody(MaskingSettingsDto.class)
        .value(dto -> assertThat(dto.deviceIp()).isTrue());
  }

  @Test
  void unknownFieldNameIsRejectedWithBadRequestNeverSilentlyIgnored() {
    webTestClient
        .put()
        .uri("/api/v1/settings/masking")
        .bodyValue(new MaskingFieldUpdateRequestDto("notAProtectedField", false))
        .exchange()
        .expectStatus()
        .isEqualTo(HttpStatus.BAD_REQUEST);
  }

  @Test
  void blankFieldNameIsRejectedByValidationBeforeReachingTheController() {
    webTestClient
        .put()
        .uri("/api/v1/settings/masking")
        .bodyValue(new MaskingFieldUpdateRequestDto("", false))
        .exchange()
        .expectStatus()
        .isEqualTo(HttpStatus.BAD_REQUEST);
  }

  @Test
  void everyOneOfTheFiveProtectedFieldsCanBeAddressedByItsExactApiKey() {
    for (String key : new String[] {"cif", "userName", "customerId", "deviceId", "deviceIp"}) {
      webTestClient
          .put()
          .uri("/api/v1/settings/masking")
          .bodyValue(new MaskingFieldUpdateRequestDto(key, false))
          .exchange()
          .expectStatus()
          .isOk();
    }
    policy.resetToDefaults();
  }
}
