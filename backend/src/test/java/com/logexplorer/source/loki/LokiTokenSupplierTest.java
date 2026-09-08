package com.logexplorer.source.loki;

import static org.assertj.core.api.Assertions.assertThat;

import com.logexplorer.config.LokiProperties;
import com.logexplorer.core.model.RawToken;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class LokiTokenSupplierTest {

  private Path tempTokenFile;

  @AfterEach
  void cleanup() throws IOException {
    if (tempTokenFile != null && Files.exists(tempTokenFile)) {
      Files.delete(tempTokenFile);
    }
  }

  @Test
  void returnsEmptyWhenNeitherEnvVarNorFileIsConfigured() {
    LokiProperties properties = new LokiProperties();
    RawToken token = new LokiTokenSupplier(properties).get();
    assertThat(token.isPresent()).isFalse();
  }

  @Test
  void readsFromTheConfiguredEnvVarWhenSet() {
    // Can't fabricate a new env var portably in a JUnit test (System.getenv
    // is read-only), so this proves the env-var-reading path against a
    // real, always-present variable rather than skipping the scenario.
    LokiProperties properties = new LokiProperties();
    properties.setTokenEnvVar("PATH");

    RawToken token = new LokiTokenSupplier(properties).get();
    assertThat(token.isPresent()).isTrue();
    assertThat(token.value()).isEqualTo(System.getenv("PATH"));
  }

  @Test
  void envVarTakesPrecedenceOverFileWhenBothAreConfigured() throws IOException {
    tempTokenFile = Files.createTempFile("loki-token-test", ".txt");
    Files.writeString(tempTokenFile, "should-not-be-used");

    LokiProperties properties = new LokiProperties();
    properties.setTokenEnvVar("PATH");
    properties.setTokenFilePath(tempTokenFile.toString());

    RawToken token = new LokiTokenSupplier(properties).get();
    assertThat(token.value()).isEqualTo(System.getenv("PATH"));
  }

  @Test
  void readsFromTheConfiguredFileWhenSet() throws IOException {
    tempTokenFile = Files.createTempFile("loki-token-test", ".txt");
    Files.writeString(tempTokenFile, "test-token-value-from-file\n");

    LokiProperties properties = new LokiProperties();
    properties.setTokenFilePath(tempTokenFile.toString());

    RawToken token = new LokiTokenSupplier(properties).get();
    assertThat(token.isPresent()).isTrue();
    assertThat(token.value()).isEqualTo("test-token-value-from-file");
  }

  @Test
  void missingConfiguredFileFallsBackToEmptyRatherThanThrowing() {
    LokiProperties properties = new LokiProperties();
    properties.setTokenFilePath("/nonexistent/path/that/does/not/exist");

    RawToken token = new LokiTokenSupplier(properties).get();
    assertThat(token.isPresent()).isFalse();
  }

  @Test
  void tokenIsWrappedInRawTokenWhichRedactsInToString() throws IOException {
    tempTokenFile = Files.createTempFile("loki-token-test", ".txt");
    Files.writeString(tempTokenFile, "super-secret-token-xyz");

    LokiProperties properties = new LokiProperties();
    properties.setTokenFilePath(tempTokenFile.toString());

    RawToken token = new LokiTokenSupplier(properties).get();
    assertThat(token.toString()).doesNotContain("super-secret-token-xyz");
    assertThat(token.toString()).isEqualTo("RawToken[REDACTED]");
  }
}
