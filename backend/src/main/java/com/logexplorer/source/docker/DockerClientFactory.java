package com.logexplorer.source.docker;

import com.github.dockerjava.api.DockerClient;
import com.github.dockerjava.core.DefaultDockerClientConfig;
import com.github.dockerjava.core.DockerClientConfig;
import com.github.dockerjava.core.DockerClientImpl;
import com.github.dockerjava.httpclient5.ApacheDockerHttpClient;
import com.github.dockerjava.transport.DockerHttpClient;
import com.logexplorer.config.DockerProperties;
import java.io.File;
import java.net.URI;
import org.springframework.stereotype.Component;

/**
 * Builds the {@link ReadOnlyDockerClient} for the configured connection
 * mode (IMPLEMENTATION_PLAN.md "Phase C" scope item 1).
 *
 * <p>{@code LOCAL} mode uses {@code docker-java}'s own default config
 * builder unchanged — it already honors {@code DOCKER_HOST} and the
 * standard Docker TLS env vars (scope item 2), so there is nothing to
 * duplicate here. {@code REMOTE} mode builds the host URL explicitly from
 * {@link DockerProperties}: a prefilled, overridable port, and TLS as an
 * optional mode — {@link DockerClientConfig.DockerClientConfigBuilder
 * #withDockerTlsVerify} is only ever set from the {@code tls} flag itself;
 * there is no code path that disables verification on a connection that
 * has TLS turned on (no trust-all, ever — CLAUDE.md §2 rule 7).
 */
@Component
public class DockerClientFactory {

  public ReadOnlyDockerClient create(DockerProperties properties) {
    DockerClientConfig config = buildConfig(properties);
    DockerHttpClient httpClient = new ApacheDockerHttpClient.Builder()
        .dockerHost(config.getDockerHost())
        .sslConfig(config.getSSLConfig())
        .connectionTimeout(properties.getConnectTimeout())
        .responseTimeout(properties.getRequestTimeout())
        .build();
    DockerClient client = DockerClientImpl.getInstance(config, httpClient);
    return new ReadOnlyDockerClient(client);
  }

  /** Package-private (not private) so connection-mode resolution tests can inspect the result directly. */
  DockerClientConfig buildConfig(DockerProperties properties) {
    DefaultDockerClientConfig.Builder builder = DefaultDockerClientConfig.createDefaultConfigBuilder();

    if (properties.getMode() == DockerProperties.Mode.LOCAL) {
      // Deliberately do nothing further: the default builder already reads
      // DOCKER_HOST / DOCKER_TLS_VERIFY / DOCKER_CERT_PATH from the
      // environment, falling back to the platform's local socket.
      return builder.build();
    }

    // REMOTE: explicit host/port/TLS from configuration, never inferred,
    // never hardcoded (IMPLEMENTATION_PLAN.md §2 "Remote Docker port").
    String host = properties.getHost();
    if (host == null || host.isBlank()) {
      throw new IllegalStateException(
          "logexplorer.docker.mode=REMOTE requires logexplorer.docker.host to be set");
    }
    String scheme = properties.isTls() ? "https" : "tcp";
    URI dockerHost = URI.create(scheme + "://" + host + ":" + properties.getPort());
    builder.withDockerHost(dockerHost.toString());
    builder.withDockerTlsVerify(properties.isTls());
    if (properties.isTls()) {
      String certPath = properties.getTlsCertPath();
      if (certPath == null || certPath.isBlank() || !new File(certPath).isDirectory()) {
        throw new IllegalStateException(
            "logexplorer.docker.tls=true requires logexplorer.docker.tls-cert-path to be an existing directory "
                + "containing ca.pem/cert.pem/key.pem");
      }
      builder.withDockerCertPath(certPath);
    }
    return builder.build();
  }
}
