package com.logexplorer.source.docker;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import org.junit.jupiter.api.Test;

class ComposeLabelsTest {

  @Test
  void extractsProjectAndServiceFromLabels() {
    Map<String, String> labels = Map.of(
        "com.docker.compose.project", "logexplorer",
        "com.docker.compose.service", "gateway");
    assertThat(ComposeLabels.project(labels)).isEqualTo("logexplorer");
    assertThat(ComposeLabels.service(labels)).isEqualTo("gateway");
    assertThat(ComposeLabels.isComposeManaged(labels)).isTrue();
  }

  @Test
  void nonComposeContainerIsNotManaged() {
    Map<String, String> labels = Map.of("some.other.label", "x");
    assertThat(ComposeLabels.isComposeManaged(labels)).isFalse();
    assertThat(ComposeLabels.project(labels)).isNull();
    assertThat(ComposeLabels.service(labels)).isNull();
  }

  @Test
  void nullLabelsMapIsHandledSafely() {
    assertThat(ComposeLabels.isComposeManaged(null)).isFalse();
    assertThat(ComposeLabels.project(null)).isNull();
    assertThat(ComposeLabels.service(null)).isNull();
  }
}
