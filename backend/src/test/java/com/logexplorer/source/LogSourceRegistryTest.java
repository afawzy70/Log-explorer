package com.logexplorer.source;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.logexplorer.config.SourcesProperties;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

class LogSourceRegistryTest {

  @Test
  void resolvesARegisteredSourceById() {
    StubLogSource docker = new StubLogSource("local-docker");
    LogSourceRegistry registry = new LogSourceRegistry(List.of(docker), new SourcesProperties());
    assertThat(registry.require("local-docker")).isSameAs(docker);
  }

  @Test
  void unknownSourceIdThrowsUnknownSourceException() {
    LogSourceRegistry registry = new LogSourceRegistry(List.of(), new SourcesProperties());
    assertThatThrownBy(() -> registry.require("does-not-exist"))
        .isInstanceOf(UnknownSourceException.class);
  }

  @Test
  void disabledSourceThrowsDisabledSourceExceptionEvenThoughItExists() {
    StubLogSource loki = new StubLogSource("openshift-loki");
    SourcesProperties properties = new SourcesProperties();
    properties.setDisabled(Set.of("openshift-loki"));
    LogSourceRegistry registry = new LogSourceRegistry(List.of(loki), properties);

    assertThatThrownBy(() -> registry.require("openshift-loki"))
        .isInstanceOf(DisabledSourceException.class);
  }

  @Test
  void allExcludesDisabledSources() {
    StubLogSource docker = new StubLogSource("local-docker");
    StubLogSource loki = new StubLogSource("openshift-loki");
    SourcesProperties properties = new SourcesProperties();
    properties.setDisabled(Set.of("openshift-loki"));
    LogSourceRegistry registry = new LogSourceRegistry(List.of(docker, loki), properties);

    assertThat(registry.all()).containsExactly(docker);
  }

  @Test
  void allIncludesEveryNonDisabledSource() {
    StubLogSource docker = new StubLogSource("local-docker");
    StubLogSource loki = new StubLogSource("openshift-loki");
    LogSourceRegistry registry = new LogSourceRegistry(List.of(docker, loki), new SourcesProperties());

    assertThat(registry.all()).containsExactlyInAnyOrder(docker, loki);
  }
}
