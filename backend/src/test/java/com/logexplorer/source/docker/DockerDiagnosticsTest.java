package com.logexplorer.source.docker;

import static org.assertj.core.api.Assertions.assertThat;

import com.logexplorer.core.model.SourceHealth;
import java.io.IOException;
import java.net.ConnectException;
import java.net.UnknownHostException;
import java.util.concurrent.TimeoutException;
import javax.net.ssl.SSLHandshakeException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class DockerDiagnosticsTest {

  @Test
  void connectionRefusedIsClassifiedActionably() {
    assertThat(DockerDiagnostics.classify(new ConnectException("Connection refused")))
        .contains("unreachable");
  }

  @Test
  void permissionDeniedIsClassifiedActionably() {
    assertThat(DockerDiagnostics.classify(new IOException("Permission denied")))
        .contains("Permission denied");
  }

  @Test
  void tlsHandshakeFailureIsClassifiedActionably() {
    assertThat(DockerDiagnostics.classify(new SSLHandshakeException("handshake failed")))
        .contains("TLS handshake failed");
  }

  @Test
  void timeoutIsClassifiedActionably() {
    assertThat(DockerDiagnostics.classify(new TimeoutException("Read timed out")))
        .contains("Timed out");
  }

  @Test
  void unknownHostIsClassifiedActionably() {
    assertThat(DockerDiagnostics.classify(new UnknownHostException("bad-host")))
        .contains("Cannot reach");
  }

  @Test
  void unclassifiableErrorFallsBackToAGenericSanitizedMessage() {
    assertThat(DockerDiagnostics.classify(new RuntimeException("some obscure internal detail")))
        .isEqualTo("Docker daemon health check failed.");
  }

  @Test
  void classificationLooksThroughWrappedCausesToTheRootCause() {
    RuntimeException wrapped = new RuntimeException("wrapper", new ConnectException("Connection refused"));
    assertThat(DockerDiagnostics.classify(wrapped)).contains("unreachable");
  }

  @Test
  void toHealthReturnsDownStatusWithASanitizedMessage() {
    SourceHealth health = DockerDiagnostics.toHealth(new ConnectException("Connection refused"));
    assertThat(health.status()).isEqualTo(SourceHealth.Status.DOWN);
    assertThat(health.message()).isNotBlank();
    assertThat(health.checkedAt()).isNotNull();
  }

  @ParameterizedTest
  @ValueSource(strings = {
      "Connection refused",
      "Permission denied",
      "SSL handshake failed",
      "Read timed out",
      "unknown host example.invalid",
      "No such file or directory: /var/run/docker.sock",
      "some completely unrelated internal error",
  })
  void noClassifiedMessageEverAdvisesExposingPort2375(String rawMessage) {
    // CLAUDE.md / IMPLEMENTATION_PLAN.md Phase C scope item 7: "Explicitly
    // do not advise users to expose port 2375 as the fix."
    String classified = DockerDiagnostics.classify(new RuntimeException(rawMessage));
    assertThat(classified.toLowerCase()).doesNotContain("2375").doesNotContain("expose");
  }
}
