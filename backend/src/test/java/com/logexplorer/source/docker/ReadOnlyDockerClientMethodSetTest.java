package com.logexplorer.source.docker;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

/**
 * Read-only enforcement test (IMPLEMENTATION_PLAN.md "Phase C" scope item
 * 6). {@link DockerLogSource} and everything else in {@code source.docker}
 * depend only on {@link ReadOnlyDockerClient} — never the raw {@code
 * DockerClient}, which exposes start/stop/create/remove/exec. This locks
 * this class's own public method set to exactly the intended read-only
 * operations, so a future edit cannot quietly add a mutating one without
 * this test catching it.
 */
class ReadOnlyDockerClientMethodSetTest {

  private static final Set<String> ALLOWED_METHOD_NAMES = Set.of(
      "listContainers", "inspectContainer", "readLogs", "ping", "version", "close");

  @Test
  void exposesOnlyTheIntendedReadOnlyOperations() {
    Set<String> actualPublicMethodNames = java.util.Arrays.stream(ReadOnlyDockerClient.class.getDeclaredMethods())
        .filter(m -> Modifier.isPublic(m.getModifiers()))
        .map(Method::getName)
        .collect(Collectors.toSet());

    assertThat(actualPublicMethodNames)
        .as("ReadOnlyDockerClient must expose exactly the allowed read-only operations - "
            + "if this fails because a new method was intentionally added, update ALLOWED_METHOD_NAMES "
            + "deliberately and confirm the new method is genuinely non-mutating first")
        .isSubsetOf(ALLOWED_METHOD_NAMES);
  }

  @Test
  void noMutatingDockerOperationNamesAppearAnywhereInThePublicSurface() {
    Set<String> mutatingKeywords = Set.of(
        "start", "stop", "create", "remove", "kill", "pause", "unpause",
        "restart", "exec", "rename", "update", "resize", "commit", "prune", "wait");

    for (Method method : ReadOnlyDockerClient.class.getDeclaredMethods()) {
      if (!Modifier.isPublic(method.getModifiers())) {
        continue;
      }
      String lowerName = method.getName().toLowerCase();
      for (String keyword : mutatingKeywords) {
        assertThat(lowerName)
            .as("public method '%s' must not resemble a mutating Docker operation ('%s')",
                method.getName(), keyword)
            .doesNotContain(keyword);
      }
    }
  }
}
