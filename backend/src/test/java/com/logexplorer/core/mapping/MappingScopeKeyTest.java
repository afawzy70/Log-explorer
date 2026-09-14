package com.logexplorer.core.mapping;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

/** Owner mission "Project-Scoped Schema Scan" §7 — the scope-key value object every per-project mapping profile is keyed by. */
class MappingScopeKeyTest {

  @Test
  void sameSourceAndProjectProduceEqualKeys() {
    assertThat(MappingScopeKey.of("local-docker", "boubyan-platform"))
        .isEqualTo(MappingScopeKey.of("local-docker", "boubyan-platform"));
  }

  @Test
  void differentProjectsOnTheSameSourceAreDistinctKeys() {
    assertThat(MappingScopeKey.of("local-docker", "project-a"))
        .isNotEqualTo(MappingScopeKey.of("local-docker", "project-b"));
  }

  @Test
  void theSameProjectNameOnDifferentSourcesAreDistinctKeys() {
    assertThat(MappingScopeKey.of("local-docker", "shared-name"))
        .isNotEqualTo(MappingScopeKey.of("openshift", "shared-name"));
  }

  @Test
  void nullAndBlankScopeIdBothNormalizeToTheSameUnscopedKey() {
    assertThat(MappingScopeKey.of("local-docker", null))
        .isEqualTo(MappingScopeKey.of("local-docker", "  "))
        .isEqualTo(MappingScopeKey.of("local-docker", ""));
  }

  @Test
  void aNullOrBlankSourceIdFallsBackToUnspecified_ratherThanThrowing() {
    assertThat(MappingScopeKey.of(null, "anything")).isEqualTo(MappingScopeKey.UNSPECIFIED);
    assertThat(MappingScopeKey.of("", "anything")).isEqualTo(MappingScopeKey.UNSPECIFIED);
  }

  @Test
  void theDirectRecordConstructorRejectsABlankSourceId() {
    assertThatThrownBy(() -> new MappingScopeKey(null, "x")).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new MappingScopeKey("  ", "x")).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void isUnscopedAndDisplayScopeAreConsistent() {
    MappingScopeKey scoped = MappingScopeKey.of("local-docker", "boubyan-platform");
    MappingScopeKey unscoped = MappingScopeKey.of("local-docker", null);

    assertThat(scoped.isUnscoped()).isFalse();
    assertThat(scoped.displayScope()).isEqualTo("boubyan-platform");
    assertThat(unscoped.isUnscoped()).isTrue();
    assertThat(unscoped.displayScope()).isNull();
    assertThat(MappingScopeKey.UNSPECIFIED.isUnscoped()).isTrue();
  }
}
