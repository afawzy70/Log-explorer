package com.logexplorer.source.loki;

import static org.assertj.core.api.Assertions.assertThat;

import com.logexplorer.config.LokiProperties;
import com.sun.net.httpserver.HttpsConfigurator;
import com.sun.net.httpserver.HttpsServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import reactor.test.StepVerifier;

/**
 * Real TLS-handshake tests against a self-signed HTTPS server, proving
 * {@link LokiWebClientFactory}/{@link CompositeX509TrustManager} actually
 * verify certificates rather than trusting blindly (CLAUDE.md §2 rule 7:
 * "TLS verification stays on ... never add trust-all").
 *
 * <p>Uses the JDK's own {@code keytool} (confirmed present in this
 * environment) to generate real self-signed certificates - this is a real
 * handshake against a real {@link HttpsServer}, not a mocked trust manager.
 */
class LokiWebClientFactoryTest {

  private static final String STORE_PASSWORD = "changeit";

  @TempDir
  private Path tempDir;

  private HttpsServer server;
  private Path serverCertPath;

  @BeforeEach
  void generateSelfSignedCertAndStartHttpsServer() throws Exception {
    Path keystorePath = tempDir.resolve("server.p12");
    serverCertPath = tempDir.resolve("server.pem");

    runKeytool("-genkeypair", "-alias", "loki-test-server", "-keyalg", "RSA", "-keysize", "2048",
        "-validity", "2", "-keystore", keystorePath.toString(), "-storetype", "PKCS12",
        "-storepass", STORE_PASSWORD, "-keypass", STORE_PASSWORD,
        "-dname", "CN=127.0.0.1", "-ext", "SAN=IP:127.0.0.1");
    runKeytool("-exportcert", "-alias", "loki-test-server", "-keystore", keystorePath.toString(),
        "-storetype", "PKCS12", "-storepass", STORE_PASSWORD, "-rfc", "-file", serverCertPath.toString());

    KeyStore keyStore = KeyStore.getInstance("PKCS12");
    try (var in = Files.newInputStream(keystorePath)) {
      keyStore.load(in, STORE_PASSWORD.toCharArray());
    }
    KeyManagerFactory keyManagerFactory = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
    keyManagerFactory.init(keyStore, STORE_PASSWORD.toCharArray());
    SSLContext sslContext = SSLContext.getInstance("TLS");
    sslContext.init(keyManagerFactory.getKeyManagers(), null, null);

    server = HttpsServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.setHttpsConfigurator(new HttpsConfigurator(sslContext));
    server.createContext("/api/logs/v1/application/loki/api/v1/query_range", this::respondSuccess);
    server.setExecutor(null);
    server.start();
  }

  @AfterEach
  void stopServer() {
    if (server != null) {
      server.stop(0);
    }
  }

  private void respondSuccess(com.sun.net.httpserver.HttpExchange exchange) throws IOException {
    byte[] body = "{\"status\":\"success\",\"data\":{\"resultType\":\"streams\",\"result\":[]}}"
        .getBytes(StandardCharsets.UTF_8);
    exchange.getResponseHeaders().add("Content-Type", "application/json");
    exchange.sendResponseHeaders(200, body.length);
    try (OutputStream out = exchange.getResponseBody()) {
      out.write(body);
    }
  }

  private LokiProperties propertiesForServer() {
    LokiProperties properties = new LokiProperties();
    properties.setBaseUrl("https://127.0.0.1:" + server.getAddress().getPort());
    properties.setGatewayPrefix("/api/logs/v1");
    properties.setTenant("application");
    properties.setRequestTimeout(Duration.ofSeconds(5));
    return properties;
  }

  private LokiQueryClient clientFor(LokiProperties properties) {
    return new LokiQueryClient(properties, new LokiTokenSupplier(properties), new LokiWebClientFactory());
  }

  @Test
  void selfSignedCertIsRejectedWhenNoCaCertPathIsConfigured() {
    // No caCertPath set - the JVM's default trust store has no reason to
    // trust this self-signed cert, so the handshake must fail. If this
    // ever passed, TLS verification would effectively be off.
    LokiProperties properties = propertiesForServer();

    StepVerifier.create(clientFor(properties).queryRange("{namespace=\"x\"}", 1L, 2L, 10, "backward"))
        .expectErrorSatisfies(e -> assertThat(e).isInstanceOf(LokiRequestException.class))
        .verify(Duration.ofSeconds(10));
  }

  @Test
  void connectionSucceedsWhenTheServerCertIsAddedAsAnExtraTrustedCa() {
    LokiProperties properties = propertiesForServer();
    properties.setCaCertPath(serverCertPath.toString());

    StepVerifier.create(clientFor(properties).queryRange("{namespace=\"x\"}", 1L, 2L, 10, "backward"))
        .assertNext(response -> assertThat(response.status()).isEqualTo("success"))
        .verifyComplete();
  }

  @Test
  void anUnrelatedCaCertPathDoesNotAccidentallyTrustEverything() throws Exception {
    // A configured caCertPath that names some OTHER CA must not somehow
    // make the client trust-all; the handshake against this server's own
    // (different) self-signed cert must still fail.
    Path unrelatedKeystore = tempDir.resolve("unrelated.p12");
    Path unrelatedCertPath = tempDir.resolve("unrelated.pem");
    runKeytool("-genkeypair", "-alias", "unrelated", "-keyalg", "RSA", "-keysize", "2048",
        "-validity", "2", "-keystore", unrelatedKeystore.toString(), "-storetype", "PKCS12",
        "-storepass", STORE_PASSWORD, "-keypass", STORE_PASSWORD, "-dname", "CN=unrelated.example.com");
    runKeytool("-exportcert", "-alias", "unrelated", "-keystore", unrelatedKeystore.toString(),
        "-storetype", "PKCS12", "-storepass", STORE_PASSWORD, "-rfc", "-file", unrelatedCertPath.toString());

    LokiProperties properties = propertiesForServer();
    properties.setCaCertPath(unrelatedCertPath.toString());

    StepVerifier.create(clientFor(properties).queryRange("{namespace=\"x\"}", 1L, 2L, 10, "backward"))
        .expectErrorSatisfies(e -> assertThat(e).isInstanceOf(LokiRequestException.class))
        .verify(Duration.ofSeconds(10));
  }

  private void runKeytool(String... args) throws Exception {
    List<String> command = new ArrayList<>();
    command.add("keytool");
    command.addAll(List.of(args));
    Process process = new ProcessBuilder(command).redirectErrorStream(true).start();
    String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
    boolean finished = process.waitFor(30, java.util.concurrent.TimeUnit.SECONDS);
    if (!finished || process.exitValue() != 0) {
      throw new IllegalStateException("keytool failed (exit=" + (finished ? process.exitValue() : "timeout")
          + "): " + output);
    }
  }
}
