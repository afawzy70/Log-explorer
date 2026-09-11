package com.logexplorer.source.openshift;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Deterministic fake OpenShift API server for OS-1A Layer 2 tests.
 *
 * <p>A plain JDK {@link HttpServer}, following {@code MockLokiServer}'s
 * precedent in this repository: no new test dependency, no network, no
 * real cluster. It answers the two endpoints OS-1A actually calls
 * ({@code users/~} and {@code projects}, plus the {@code namespaces}
 * fallback) and can be switched into each failure mode the product must
 * tell apart.
 *
 * <p>It captures the Authorization header so tests can prove the bearer
 * token really was sent - and, just as importantly, that it never appears
 * anywhere else.
 */
final class MockOpenShiftServer implements AutoCloseable {

  /** Which behaviour the next request gets. */
  enum Scenario {
    OK,
    /** Projects list returns 200 with zero items - "this user has no projects". */
    EMPTY_PROJECTS,
    UNAUTHORIZED_401,
    FORBIDDEN_403,
    /** No OpenShift Projects API at all - what a vanilla Kubernetes API server does. */
    NO_PROJECTS_API_404,
    MALFORMED_BODY,
    SLOW
  }

  private final HttpServer server;
  private volatile Scenario scenario = Scenario.OK;
  private final AtomicReference<String> lastAuthorization = new AtomicReference<>();
  private final AtomicReference<String> lastPath = new AtomicReference<>();

  MockOpenShiftServer() throws IOException {
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/", this::handle);
    server.setExecutor(null);
    server.start();
  }

  String baseUrl() {
    return "http://127.0.0.1:" + server.getAddress().getPort();
  }

  void setScenario(Scenario scenario) {
    this.scenario = scenario;
  }

  String lastAuthorizationHeader() {
    return lastAuthorization.get();
  }

  String lastPath() {
    return lastPath.get();
  }

  private void handle(HttpExchange exchange) throws IOException {
    lastAuthorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
    String path = exchange.getRequestURI().getPath();
    lastPath.set(path);

    if (scenario == Scenario.SLOW) {
      try {
        Thread.sleep(2_000);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      }
    }

    boolean isProjects = path.contains("/projects");
    boolean isNamespaces = path.contains("/namespaces");
    boolean isUser = path.contains("/users/");

    switch (scenario) {
      case UNAUTHORIZED_401 -> respond(exchange, 401, "{\"message\":\"Unauthorized\"}");
      case FORBIDDEN_403 -> respond(exchange, 403, "{\"message\":\"Forbidden\"}");
      case MALFORMED_BODY -> respond(exchange, 200, "not json at all");
      case NO_PROJECTS_API_404 -> {
        if (isProjects) {
          respond(exchange, 404, "{\"message\":\"the server could not find the requested resource\"}");
        } else if (isNamespaces) {
          respond(exchange, 200, list("fallback-ns-a", "fallback-ns-b"));
        } else {
          respond(exchange, 200, user("developer"));
        }
      }
      case EMPTY_PROJECTS -> {
        if (isProjects || isNamespaces) {
          respond(exchange, 200, "{\"items\":[]}");
        } else {
          respond(exchange, 200, user("developer"));
        }
      }
      default -> {
        if (isProjects || isNamespaces) {
          // Deliberately unsorted, so the client's own ordering is proved.
          respond(exchange, 200, list("payments", "accounts", "gateway"));
        } else if (isUser) {
          respond(exchange, 200, user("developer"));
        } else {
          respond(exchange, 404, "{\"message\":\"not found\"}");
        }
      }
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
  }
}
