package com.logexplorer.source.docker;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.github.dockerjava.core.DockerClientConfig;
import com.logexplorer.config.DockerProperties;
import com.logexplorer.config.DockerRemoteAllowlistProperties;
import com.logexplorer.source.docker.security.RemoteHostGuard;
import java.io.IOException;
import java.net.InetAddress;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/**
 * Connection-mode resolution tests (IMPLEMENTATION_PLAN.md "Phase C"
 * required automated test: "default port applied, override honored, TLS
 * off ⇒ no cert requirement, TLS on ⇒ verification required"). Uses a real
 * {@link RemoteHostGuard} (default, empty allowlist) with the real DNS
 * resolver - every host literal in this file is a plain IPv4 literal
 * (never a name needing an actual lookup) from the RFC 5737 TEST-NET-1
 * documentation range (192.0.2.0/24), which is deliberately not one of
 * {@link RemoteHostGuard}'s denied special-purpose ranges, so it resolves
 * and passes policy exactly like any other ordinary public address would -
 * SSRF-guard-specific behavior (rejection cases) is covered in {@code
 * RemoteHostGuardTest} instead, to keep this file focused on connection-mode
 * shape as it always has been.
 */
class DockerClientFactoryTest {

  private final DockerClientFactory factory =
      new DockerClientFactory(new RemoteHostGuard(new DockerRemoteAllowlistProperties(), InetAddress::getAllByName));
  private Path tempCertDir;

  @AfterEach
  void cleanup() throws IOException {
    if (tempCertDir != null && Files.exists(tempCertDir)) {
      Files.delete(tempCertDir);
    }
  }

  @Test
  void localModeBuildsWithoutRequiringAnyRemoteProperties() {
    DockerProperties properties = new DockerProperties();
    properties.setMode(DockerProperties.Mode.LOCAL);

    DockerClientConfig config = factory.buildConfig(properties);

    assertThat(config).isNotNull();
    assertThat(config.getDockerHost()).isNotNull();
  }

  @Test
  void remoteModeUsesTheDefaultPortWhenNotOverridden() {
    DockerProperties properties = new DockerProperties();
    properties.setMode(DockerProperties.Mode.REMOTE);
    properties.setHost("192.0.2.10");
    // port left at its default (2375, prefilled)

    DockerClientConfig config = factory.buildConfig(properties);

    assertThat(config.getDockerHost().toString()).contains("192.0.2.10").contains("2375");
  }

  @Test
  void remoteModeHonorsAnOverriddenPort() {
    DockerProperties properties = new DockerProperties();
    properties.setMode(DockerProperties.Mode.REMOTE);
    properties.setHost("192.0.2.10");
    properties.setPort(9999);

    DockerClientConfig config = factory.buildConfig(properties);

    assertThat(config.getDockerHost().toString()).contains("9999");
  }

  @Test
  void remoteModeRequiresAHostToBeConfigured() {
    DockerProperties properties = new DockerProperties();
    properties.setMode(DockerProperties.Mode.REMOTE);
    // host left unset

    assertThatThrownBy(() -> factory.buildConfig(properties))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("host");
  }

  @Test
  void remoteModeWithTlsOffRequiresNoCertificatePath() {
    DockerProperties properties = new DockerProperties();
    properties.setMode(DockerProperties.Mode.REMOTE);
    properties.setHost("192.0.2.10");
    properties.setTls(false);
    // tlsCertPath deliberately left unset

    DockerClientConfig config = factory.buildConfig(properties);

    assertThat(config.getDockerHost().toString()).startsWith("tcp://");
  }

  @Test
  void remoteModeWithTlsOnRequiresAValidCertificateDirectory() {
    DockerProperties properties = new DockerProperties();
    properties.setMode(DockerProperties.Mode.REMOTE);
    properties.setHost("192.0.2.10");
    properties.setTls(true);
    // tlsCertPath deliberately left unset - must be rejected, not silently
    // allowed through (that would risk an unverified/trust-all connection).

    assertThatThrownBy(() -> factory.buildConfig(properties))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("tls-cert-path");
  }

  @Test
  void remoteModeWithTlsOnAndAValidCertDirectorySucceeds() throws IOException {
    tempCertDir = Files.createTempDirectory("docker-tls-test");

    DockerProperties properties = new DockerProperties();
    properties.setMode(DockerProperties.Mode.REMOTE);
    properties.setHost("192.0.2.10");
    properties.setTls(true);
    properties.setTlsCertPath(tempCertDir.toString());

    DockerClientConfig config = factory.buildConfig(properties);

    assertThat(config.getDockerHost().toString()).startsWith("https://");
    assertThat(config.getSSLConfig()).isNotNull();
  }

  @Test
  void remoteModeIsRejectedByTheSsrfGuardForALoopbackHost() {
    // Legacy Remediation Slice 3: buildConfig() must route REMOTE mode
    // through RemoteHostGuard - the same policy Test Connection uses
    // (DockerSettingsControllerTest proves the reverse: the controller
    // reuses this exact method).
    DockerProperties properties = new DockerProperties();
    properties.setMode(DockerProperties.Mode.REMOTE);
    properties.setHost("127.0.0.1");

    assertThatThrownBy(() -> factory.buildConfig(properties))
        .isInstanceOf(com.logexplorer.source.docker.security.RemoteHostRejectedException.class);
  }

  @Test
  void localModeIsNeverSubjectToTheRemoteHostGuardEvenIfHostHappensToBeSet() {
    // LOCAL mode never reads host/port at all - buildConfig() must not
    // even consult the guard for it (LOCAL is deployment-time
    // configuration, not the SSRF-sensitive surface the guard defends).
    DockerProperties properties = new DockerProperties();
    properties.setMode(DockerProperties.Mode.LOCAL);
    properties.setHost("127.0.0.1"); // would be rejected in REMOTE mode - must be irrelevant here

    DockerClientConfig config = factory.buildConfig(properties);

    assertThat(config).isNotNull();
  }
}
