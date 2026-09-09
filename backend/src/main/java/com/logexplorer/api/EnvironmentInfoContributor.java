package com.logexplorer.api;

import java.util.List;
import java.util.Map;
import org.springframework.boot.actuate.info.Info;
import org.springframework.boot.actuate.info.InfoContributor;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

/**
 * UI Gap Closure Pass - a compact, truthful environment/profile indicator
 * (`docs/verification/UI_GAP_CLOSURE_REPORT.md`). Adds exactly one real,
 * already-known, non-secret fact to the existing {@code /actuator/info}
 * endpoint: the Spring profile(s) this specific running instance actually
 * has active - the same fact {@code LogExplorerApplication}'s own startup
 * log line already prints ("The following N profile(s) are active: ...").
 * Never a guess, never a hardcoded label, never derived environment
 * variables or config values (which could be sensitive) - only
 * {@link Environment#getActiveProfiles()}, exposed verbatim.
 *
 * <p>When no profile is active at all (the genuine default - most real
 * production deployments run this way, with no {@code SPRING_PROFILES_ACTIVE}
 * set), this reports the literal string {@code "default"} rather than
 * inferring "production" - inferring a deployment tier from the mere
 * absence of a dev/test profile would itself be exactly the kind of guess
 * this pass's own mission explicitly forbids ("Never display a guessed
 * deployment environment").
 */
@Component
public class EnvironmentInfoContributor implements InfoContributor {

  private final Environment environment;

  public EnvironmentInfoContributor(Environment environment) {
    this.environment = environment;
  }

  @Override
  public void contribute(Info.Builder builder) {
    String[] activeProfiles = environment.getActiveProfiles();
    String label = activeProfiles.length == 0 ? "default" : String.join(",", activeProfiles);
    builder.withDetail("environment", Map.of("activeProfiles", List.of(activeProfiles), "label", label));
  }
}
