package com.logexplorer.source.openshift;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpsConfigurator;
import com.sun.net.httpserver.HttpsParameters;
import com.sun.net.httpserver.HttpsServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;

/**
 * OPENSHIFT_HTTP_BUFFER_LIFECYCLE bug fix mission — an HTTPS-capable
 * deterministic fake OpenShift API server, otherwise identical in
 * behavior/response shapes to {@link MockOpenShiftServer}.
 *
 * <p><b>Why this exists as a separate class.</b> Every existing
 * {@code OpenShiftApiClient*Test} runs {@link MockOpenShiftServer} — a
 * plain JDK {@code HttpServer} over HTTP. The reported bug
 * (`IllegalReferenceCountException`, "unexpected response (HTTP 200)") only
 * reproduces against a real OpenShift cluster, which is always HTTPS
 * (port 6443). No existing automated test exercises {@link OpenShiftApiClient}
 * over a real TLS handshake + Reactor Netty response body decode at all —
 * that gap is exactly where this class closes the coverage hole.
 *
 * <p>Uses {@code keytool} (bundled with every JDK, no new test dependency)
 * to generate a throwaway self-signed certificate once per server instance,
 * and exposes the matching CA PEM path so a test can pass it as {@code
 * caPath} to {@link OpenShiftApiClient} — the exact same "trust one extra
 * CA" mechanism {@link OpenShiftApiClient#buildSslContext} already uses for
 * a real deployment's custom cluster CA (mission's own "temporary Java
 * truststore CA setup... is an environment concern only" — this test
 * reproduces the equivalent for a real cluster, in-process).
 */
final class MockOpenShiftHttpsServer implements AutoCloseable {

  private final HttpsServer server;
  private final java.util.concurrent.ExecutorService executor;
  private final Path tempDir;
  private final String caPemPath;
  private volatile MockOpenShiftServer.Scenario scenario = MockOpenShiftServer.Scenario.OK;
  private final java.util.concurrent.atomic.AtomicInteger requestCount = new java.util.concurrent.atomic.AtomicInteger();

  MockOpenShiftHttpsServer() throws Exception {
    tempDir = Files.createTempDirectory("openshift-https-test");
    Path keystorePath = tempDir.resolve("keystore.p12");
    Path caPath = tempDir.resolve("ca.pem");
    String storePassword = "changeit";

    runKeytool("-genkeypair", "-alias", "openshift-test", "-keyalg", "RSA", "-keysize", "2048",
        "-validity", "1", "-keystore", keystorePath.toString(), "-storetype", "PKCS12",
        "-storepass", storePassword, "-keypass", storePassword,
        "-dname", "CN=127.0.0.1", "-ext", "SAN=IP:127.0.0.1");
    runKeytool("-exportcert", "-alias", "openshift-test", "-keystore", keystorePath.toString(),
        "-storetype", "PKCS12", "-storepass", storePassword, "-rfc", "-file", caPath.toString());
    this.caPemPath = caPath.toString();

    KeyStore keyStore = KeyStore.getInstance("PKCS12");
    try (var in = Files.newInputStream(keystorePath)) {
      keyStore.load(in, storePassword.toCharArray());
    }
    KeyManagerFactory kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
    kmf.init(keyStore, storePassword.toCharArray());
    SSLContext sslContext = SSLContext.getInstance("TLS");
    sslContext.init(kmf.getKeyManagers(), null, null);

    server = HttpsServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.setHttpsConfigurator(new HttpsConfigurator(sslContext) {
      @Override
      public void configure(HttpsParameters params) {
        params.setSSLParameters(sslContext.getDefaultSSLParameters());
      }
    });
    server.createContext("/", this::handle);
    // A real cluster serves requests concurrently. A never-completing
    // pod-log stream (see #streamPodLogForever) would otherwise starve
    // every other request on the default single-threaded executor.
    executor = java.util.concurrent.Executors.newCachedThreadPool(runnable -> {
      Thread t = new Thread(runnable, "mock-openshift-https");
      t.setDaemon(true); // never blocks JVM/test-runner shutdown
      return t;
    });
    server.setExecutor(executor);
    server.start();
  }

  private static void runKeytool(String... args) throws Exception {
    String javaHome = System.getProperty("java.home");
    String keytool = javaHome + java.io.File.separator + "bin" + java.io.File.separator + "keytool";
    java.util.List<String> command = new java.util.ArrayList<>();
    command.add(keytool);
    command.addAll(java.util.List.of(args));
    Process process = new ProcessBuilder(command).redirectErrorStream(true).start();
    String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
    int exit = process.waitFor();
    if (exit != 0) {
      throw new IllegalStateException("keytool failed (" + exit + "): " + output);
    }
  }

  String baseUrl() {
    return "https://127.0.0.1:" + server.getAddress().getPort();
  }

  /** The PEM-encoded CA certificate a client must trust to reach this server — pass as {@code caPath}. */
  String caPemPath() {
    return caPemPath;
  }

  void setScenario(MockOpenShiftServer.Scenario scenario) {
    this.scenario = scenario;
  }

  int requestCount() {
    return requestCount.get();
  }

  private void handle(HttpExchange exchange) throws IOException {
    requestCount.incrementAndGet();
    String path = exchange.getRequestURI().getPath();
    boolean isPodLog = path.contains("/log");
    boolean isProjects = !isPodLog && path.contains("/projects");
    boolean isNamespaces = !isPodLog && path.contains("/namespaces");
    boolean isUser = path.contains("/users/");

    if (isPodLog) {
      streamPodLogForever(exchange);
      return;
    }

    switch (scenario) {
      case UNAUTHORIZED_401 -> respond(exchange, 401, "{\"message\":\"Unauthorized\"}");
      case FORBIDDEN_403 -> respond(exchange, 403, "{\"message\":\"Forbidden\"}");
      case INTERNAL_SERVER_ERROR_500 -> respond(exchange, 500, "{\"message\":\"Internal Server Error\"}");
      case MALFORMED_BODY -> respond(exchange, 200, "not json at all");
      case EMPTY_BODY -> respond(exchange, 200, "");
      case EMPTY_PROJECTS -> {
        if (isProjects || isNamespaces) {
          respond(exchange, 200, "{\"items\":[]}");
        } else {
          respond(exchange, 200, user("developer"));
        }
      }
      case CHUNKED_SLOW -> {
        // Writes the body in several small pieces with a real delay + flush
        // between each - unlike SLOW (one sleep, then one single write),
        // this keeps the HTTP exchange genuinely open and mid-stream for a
        // while, so a short CLIENT-side timeout applied on top of the
        // subscription has a real chance to fire WHILE bytes are still
        // arriving - the exact race window a Reactor Netty cancellation/
        // buffer-release bug of this shape would need.
        if (isProjects || isNamespaces) {
          writeChunked(exchange, list("payments", "accounts", "gateway"));
        } else {
          writeChunked(exchange, user("developer"));
        }
      }
      case LARGE_PROJECTS_LIST -> {
        if (isProjects || isNamespaces) {
          String[] names = new String[2000];
          for (int i = 0; i < names.length; i++) {
            names[i] = "project-" + i + "-with-a-realistically-longish-name-to-pad-the-body-size";
          }
          respond(exchange, 200, list(names));
        } else {
          respond(exchange, 200, user("developer"));
        }
      }
      default -> {
        if (isProjects || isNamespaces) {
          respond(exchange, 200, list("payments", "accounts", "gateway"));
        } else if (isUser) {
          respond(exchange, 200, user("developer"));
        } else {
          respond(exchange, 404, "{\"message\":\"not found\"}");
        }
      }
    }
  }

  /**
   * A real Kubernetes {@code ?follow=true} pod log stream: never completes
   * on its own, delivers one log line every 100ms until the CLIENT
   * disconnects (exactly what {@code OpenShiftApiClient#followPodLog}/live
   * tail expects and what a real cancellation - "Stop" button, connection
   * dropped, OpenShift disconnect - actually looks like at the wire level).
   * Writes stop the instant the client socket closes ({@code IOException}
   * on write), mirroring a real TCP disconnect.
   */
  private void streamPodLogForever(HttpExchange exchange) throws IOException {
    exchange.getResponseHeaders().add("Content-Type", "text/plain");
    exchange.sendResponseHeaders(200, 0);
    try (OutputStream out = exchange.getResponseBody()) {
      int i = 0;
      while (true) {
        String line = "2026-01-01T00:00:00.000Z line-" + (i++) + " synthetic pod log content\n";
        out.write(line.getBytes(StandardCharsets.UTF_8));
        out.flush();
        Thread.sleep(100);
      }
    } catch (IOException clientDisconnected) {
      // Expected, normal end-of-stream once the client cancels/closes.
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }
  }

  private static String list(String... names) {
    StringBuilder json = new StringBuilder("{\"items\":[");
    for (int i = 0; i < names.length; i++) {
      if (i > 0) {
        json.append(',');
      }
      json.append("{\"metadata\":{\"name\":\"").append(names[i]).append("\"}}");
    }
    return json.append("]}").toString();
  }

  private static String user(String name) {
    return "{\"metadata\":{\"name\":\"" + name + "\"}}";
  }

  private static void writeChunked(HttpExchange exchange, String body) throws IOException {
    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
    exchange.getResponseHeaders().add("Content-Type", "application/json");
    // No fixed Content-Length (chunked transfer) - closer to a real
    // reverse-proxied cluster API response than the fixed-length responses
    // every other scenario here uses.
    exchange.sendResponseHeaders(200, 0);
    try (OutputStream out = exchange.getResponseBody()) {
      int chunkSize = Math.max(1, bytes.length / 8);
      for (int offset = 0; offset < bytes.length; offset += chunkSize) {
        int end = Math.min(bytes.length, offset + chunkSize);
        out.write(bytes, offset, end - offset);
        out.flush();
        try {
          Thread.sleep(150);
        } catch (InterruptedException e) {
          Thread.currentThread().interrupt();
          return;
        }
      }
    }
  }

  private static void respond(HttpExchange exchange, int status, String body) throws IOException {
    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
    exchange.getResponseHeaders().add("Content-Type", "application/json");
    exchange.sendResponseHeaders(status, bytes.length);
    try (OutputStream out = exchange.getResponseBody()) {
      out.write(bytes);
    }
  }

  @Override
  public void close() {
    server.stop(0);
    executor.shutdownNow();
    try {
      Files.walk(tempDir)
          .sorted(java.util.Comparator.reverseOrder())
          .forEach(p -> {
            try {
              Files.deleteIfExists(p);
            } catch (IOException ignored) {
              // best-effort cleanup
            }
          });
    } catch (IOException ignored) {
      // best-effort cleanup
    }
  }
}
