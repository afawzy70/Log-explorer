package com.logexplorer.source.openshift;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Deterministic fake for the OS-1C Kubernetes pod-log endpoint ({@code
 * GET /api/v1/namespaces/{namespace}/pods/{pod}/log}) — a plain JDK {@link
 * HttpServer}, the same convention as {@link MockOpenShiftScopeServer}.
 *
 * <p>Programmable per (pod, container) key: a fixed plain-text body (never
 * JSON — this endpoint's response is always raw text, one line per {@code
 * \n}), or one of the HTTP failure outcomes OS-1C must classify (403/404/
 * 500), each optionally delayed to simulate a slow pod. A multi-threaded
 * executor is used deliberately (unlike {@link MockOpenShiftScopeServer}'s
 * single-threaded default) so tests can prove OS-1C's bounded-concurrency
 * fan-out and out-of-order-completion determinism against genuinely
 * concurrent requests, not serialized ones.
 */
public final class MockOpenShiftPodLogServer implements AutoCloseable {

  public enum Outcome { OK, FORBIDDEN, NOT_FOUND, ERROR }

  public record Fixture(Outcome outcome, String body, int delayMs) {
    public static Fixture ok(String body) {
      return new Fixture(Outcome.OK, body, 0);
    }

    public static Fixture ok(String body, int delayMs) {
      return new Fixture(Outcome.OK, body, delayMs);
    }

    public static Fixture forbidden() {
      return new Fixture(Outcome.FORBIDDEN, null, 0);
    }

    public static Fixture notFound() {
      return new Fixture(Outcome.NOT_FOUND, null, 0);
    }

    public static Fixture error() {
      return new Fixture(Outcome.ERROR, null, 0);
    }
  }

  private final HttpServer server;
  private final String namespace;
  private final Map<String, Fixture> fixtures = new ConcurrentHashMap<>();
  private final Map<String, String> lastQueryByKey = new ConcurrentHashMap<>();
  private volatile boolean unauthorized = false;
  private final AtomicInteger requestCount = new AtomicInteger();
  private final AtomicInteger inFlight = new AtomicInteger();
  private final AtomicInteger maxConcurrentRequests = new AtomicInteger();

  public MockOpenShiftPodLogServer(String namespace) throws IOException {
    this.namespace = namespace;
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/", this::handle);
    server.setExecutor(Executors.newCachedThreadPool());
    server.start();
  }

  public String baseUrl() {
    return "http://127.0.0.1:" + server.getAddress().getPort();
  }

  public void setFixture(String pod, String container, Fixture fixture) {
    fixtures.put(key(pod, container), fixture);
  }

  public void setUnauthorized(boolean value) {
    this.unauthorized = value;
  }

  public int requestCount() {
    return requestCount.get();
  }

  public int maxConcurrentRequests() {
    return maxConcurrentRequests.get();
  }

  public String lastQuery(String pod, String container) {
    return lastQueryByKey.get(key(pod, container));
  }

  private static String key(String pod, String container) {
    return pod + "/" + container;
  }

  private void handle(HttpExchange exchange) throws IOException {
    if (unauthorized) {
      respond(exchange, 401, "{\"message\":\"Unauthorized\"}");
      return;
    }
    String path = exchange.getRequestURI().getPath();
    String prefix = "/api/v1/namespaces/" + namespace + "/pods/";
    if (!path.startsWith(prefix) || !path.endsWith("/log")) {
      respond(exchange, 404, "{\"message\":\"not found\"}");
      return;
    }
    String podName = path.substring(prefix.length(), path.length() - "/log".length());
    Map<String, String> params = parseQuery(exchange.getRequestURI().getRawQuery());
    String container = params.get("container");

    requestCount.incrementAndGet();
    lastQueryByKey.put(key(podName, container), exchange.getRequestURI().getRawQuery());

    int current = inFlight.incrementAndGet();
    maxConcurrentRequests.updateAndGet(prev -> Math.max(prev, current));
    try {
      Fixture fixture = fixtures.get(key(podName, container));
      if (fixture == null) {
        respond(exchange, 404, "{\"message\":\"not found\"}");
        return;
      }
      if (fixture.delayMs() > 0) {
        try {
          Thread.sleep(fixture.delayMs());
        } catch (InterruptedException e) {
          Thread.currentThread().interrupt();
        }
      }
      switch (fixture.outcome()) {
        case OK -> respondText(exchange, 200, fixture.body());
        case FORBIDDEN -> respond(exchange, 403, "{\"message\":\"Forbidden\"}");
        case NOT_FOUND -> respond(exchange, 404, "{\"message\":\"not found\"}");
        case ERROR -> respond(exchange, 500, "{\"message\":\"Internal Server Error\"}");
      }
    } finally {
      inFlight.decrementAndGet();
    }
  }

  private static Map<String, String> parseQuery(String rawQuery) {
    Map<String, String> result = new LinkedHashMap<>();
    if (rawQuery == null || rawQuery.isBlank()) {
      return result;
    }
    for (String param : rawQuery.split("&")) {
      String[] kv = param.split("=", 2);
      if (kv.length == 2) {
        result.put(kv[0], URLDecoder.decode(kv[1], StandardCharsets.UTF_8));
      }
    }
    return result;
  }

  private static void respondText(HttpExchange exchange, int status, String body) throws IOException {
    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
    exchange.getResponseHeaders().add("Content-Type", "text/plain");
    exchange.sendResponseHeaders(status, bytes.length);
    try (OutputStream out = exchange.getResponseBody()) {
      out.write(bytes);
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
  }
}
