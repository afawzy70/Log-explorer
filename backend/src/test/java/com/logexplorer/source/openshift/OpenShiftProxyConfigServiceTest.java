package com.logexplorer.source.openshift;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

/**
 * Pre-closure functional recovery 2 (§B5/§B6/§B15) - the one, shared,
 * in-memory OpenShift/Loki proxy setting. Deliberately mirrors {@code
 * core.mask.MaskingPolicyServiceTest}'s own "safe default on every
 * restart" proof shape.
 */
class OpenShiftProxyConfigServiceTest {

  private final OpenShiftProxyConfigService service = new OpenShiftProxyConfigService();

  @Test
  void aFreshServiceAlwaysStartsInSystemModeTheSafeDefault() {
    assertThat(service.current()).isEqualTo(ProxyConfig.SYSTEM_DEFAULT);
  }

  @Test
  void updateChangesTheCurrentConfig() {
    service.update(ProxyConfig.direct());
    assertThat(service.current().mode()).isEqualTo(ProxyMode.DIRECT);

    service.update(ProxyConfig.custom("proxy.company.local", 8080));
    assertThat(service.current()).isEqualTo(ProxyConfig.custom("proxy.company.local", 8080));
  }

  @Test
  void updateRejectsAnInvalidCustomConfigAndLeavesThePreviousValueInPlace() {
    service.update(ProxyConfig.direct());

    assertThatThrownBy(() -> service.update(new ProxyConfig(ProxyMode.CUSTOM, "", 8080)))
        .isInstanceOf(IllegalArgumentException.class);

    // The rejected write never applied - DIRECT still stands.
    assertThat(service.current().mode()).isEqualTo(ProxyMode.DIRECT);
  }

  @Test
  void resetToDefaultRestoresSystemModeAfterBeingChanged() {
    service.update(ProxyConfig.custom("proxy.company.local", 8080));
    service.resetToDefault();
    assertThat(service.current()).isEqualTo(ProxyConfig.SYSTEM_DEFAULT);
  }
}
