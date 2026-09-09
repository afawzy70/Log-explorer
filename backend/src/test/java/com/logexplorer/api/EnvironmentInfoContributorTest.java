package com.logexplorer.api;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.boot.actuate.info.Info;
import org.springframework.mock.env.MockEnvironment;

/**
 * UI Gap Closure Pass - {@link EnvironmentInfoContributor} must report the
 * real active profile(s) verbatim, never a guessed/inferred deployment
 * tier, and must fall back to the literal "default" (never "production")
 * when no profile is active at all.
 */
class EnvironmentInfoContributorTest {

  @Test
  void reportsTheRealActiveProfileVerbatim() {
    MockEnvironment env = new MockEnvironment();
    env.setActiveProfiles("dev");
    EnvironmentInfoContributor contributor = new EnvironmentInfoContributor(env);

    Info.Builder builder = new Info.Builder();
    contributor.contribute(builder);
    Info info = builder.build();

    @SuppressWarnings("unchecked")
    var detail = (java.util.Map<String, Object>) info.getDetails().get("environment");
    assertThat(detail.get("label")).isEqualTo("dev");
    assertThat(detail.get("activeProfiles")).isEqualTo(java.util.List.of("dev"));
  }

  @Test
  void joinsMultipleActiveProfilesRatherThanPickingOne() {
    MockEnvironment env = new MockEnvironment();
    env.setActiveProfiles("dev", "test");
    EnvironmentInfoContributor contributor = new EnvironmentInfoContributor(env);

    Info.Builder builder = new Info.Builder();
    contributor.contribute(builder);

    @SuppressWarnings("unchecked")
    var detail = (java.util.Map<String, Object>) builder.build().getDetails().get("environment");
    assertThat(detail.get("label")).isEqualTo("dev,test");
  }

  @Test
  void reportsTheLiteralWordDefaultWhenNoProfileIsActive_neverGuessingProduction() {
    MockEnvironment env = new MockEnvironment(); // no active profiles set - the real, common production shape
    EnvironmentInfoContributor contributor = new EnvironmentInfoContributor(env);

    Info.Builder builder = new Info.Builder();
    contributor.contribute(builder);

    @SuppressWarnings("unchecked")
    var detail = (java.util.Map<String, Object>) builder.build().getDetails().get("environment");
    assertThat(detail.get("label")).isEqualTo("default");
    assertThat(detail.get("label")).isNotEqualTo("production").isNotEqualTo("prod"); // never an inferred tier
  }
}
