package com.logexplorer.source.fixture;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.logexplorer.core.parse.LogLineParser;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.Configuration;

/**
 * Proves - with a real Spring {@link ApplicationContextRunner} that
 * component-scans the actual class (so its real {@code @Profile}
 * annotation is what gets evaluated, not a stand-in) - that {@link
 * FixtureLogSource} is unreachable outside dev/test profiles
 * (IMPLEMENTATION_PLAN.md "Phase A2b" PASS criterion: "registered as a
 * dev/test-only source"; FAIL criterion: "Fixture source
 * reachable/selectable in a non-dev/test profile").
 */
class FixtureLogSourceProfileGatingTest {

  @Configuration
  @ComponentScan(basePackageClasses = FixtureLogSource.class)
  static class ScanConfig {
    @Bean
    ObjectMapper objectMapper() {
      return new ObjectMapper();
    }

    @Bean
    LogLineParser logLineParser(ObjectMapper objectMapper) {
      return new LogLineParser(objectMapper);
    }
  }

  private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
      .withUserConfiguration(ScanConfig.class);

  @Test
  void isAbsentWithNoActiveProfile() {
    contextRunner.run(ctx -> assertThat(ctx).doesNotHaveBean(FixtureLogSource.class));
  }

  @Test
  void isAbsentUnderAProductionLikeProfile() {
    contextRunner.withPropertyValues("spring.profiles.active=production")
        .run(ctx -> assertThat(ctx).doesNotHaveBean(FixtureLogSource.class));
  }

  @Test
  void isPresentUnderDevProfile() {
    contextRunner.withPropertyValues("spring.profiles.active=dev")
        .run(ctx -> assertThat(ctx).hasSingleBean(FixtureLogSource.class));
  }

  @Test
  void isPresentUnderTestProfile() {
    contextRunner.withPropertyValues("spring.profiles.active=test")
        .run(ctx -> assertThat(ctx).hasSingleBean(FixtureLogSource.class));
  }
}
