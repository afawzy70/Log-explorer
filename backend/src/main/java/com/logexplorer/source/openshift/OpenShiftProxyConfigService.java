package com.logexplorer.source.openshift;

import java.util.concurrent.atomic.AtomicReference;
import org.springframework.stereotype.Service;

/**
 * The one, authoritative, user-editable OpenShift/Loki proxy setting
 * (pre-closure functional recovery 2, §B5/§B6: "One authoritative
 * OpenShift proxy configuration... apply consistently to ALL
 * OpenShift-related outbound traffic"). Injected into both {@link
 * OpenShiftApiClient} and {@link com.logexplorer.source.loki.LokiWebClientFactory}
 * - there is exactly one place this value lives, so the two can never
 * drift into inconsistent routing (e.g. OpenShift API on CUSTOM while
 * Loki stays on SYSTEM).
 *
 * <p><b>Deliberately in-memory only, never persisted to disk</b> - the
 * same "session-only" convention {@link OpenShiftSession}'s own token
 * already follows (its own javadoc: "lives only here, only in memory,
 * only for this process"). A backend restart resets proxy routing back to
 * {@code SYSTEM} (the environment-variable behavior), never silently
 * keeping a stale custom proxy the user is no longer at. This mirrors
 * {@code core.mask.MaskingPolicyService}'s identical "safe default on
 * every restart" design choice.
 *
 * <p>Independent of {@link OpenShiftSession}'s connect/disconnect
 * lifecycle on purpose: the proxy setting is what a user configures
 * <i>in order to</i> reach the cluster at all (§B12 - "Test Connection ...
 * must use the currently selected proxy mode"), so it must be readable
 * and writable before any connection exists, and must survive a
 * disconnect/reconnect rather than resetting with the connection itself.
 */
@Service
public class OpenShiftProxyConfigService {

  private final AtomicReference<ProxyConfig> current = new AtomicReference<>(ProxyConfig.SYSTEM_DEFAULT);

  public ProxyConfig current() {
    return current.get();
  }

  /** @throws IllegalArgumentException if {@code config} fails {@link ProxyConfig#validate()} */
  public void update(ProxyConfig config) {
    String problem = config.validate();
    if (problem != null) {
      throw new IllegalArgumentException(problem);
    }
    current.set(config);
  }

  public void resetToDefault() {
    current.set(ProxyConfig.SYSTEM_DEFAULT);
  }
}
