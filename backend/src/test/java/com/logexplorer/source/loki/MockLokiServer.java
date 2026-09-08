package com.logexplorer.source.loki;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

/**
 * JVM-side mock Loki gateway for JUnit tests (IMPLEMENTATION_PLAN.md "Phase
 * D" required automated test: "mock-server tests for query construction").
 *
 * <p>Mirrors {@code tools/mock-loki} (A2a's standalone Node server, used
 * for real manual/live integration testing) in route shape and
 * configurability, but as a plain JDK {@code HttpServer} so the Java test
 * suite doesn't need to shell out to a Node process. Captures the last
 * request's query string and headers so tests can assert on exactly what
 * {@link LokiQueryClient} sent - real query construction, not a guess.
 */
class MockLokiServer implements AutoCloseable {

  private final HttpServer server;
  private final String expectedPath;
  private final ObjectMapper objectMapper = new ObjectMapper();
  private final AtomicReference<String> lastQueryString = new AtomicReference<>();
  private final AtomicReference<String> lastAuthorizationHeader = new AtomicReference<>();
  private volatile String scenario;
  private volatile List<Map<String, Object>> customResults;

  MockLokiServer(String gatewayPrefix, String tenant, String namespaceLabelKey, String serviceLabelKey) throws IOException {
    this.expectedPath = gatewayPrefix + "/" + tenant + "/loki/api/v1/query_range";
    this.server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/", this::handle);
    server.setExecutor(null);
    server.start();
  }

  int port() {
    return server.getAddress().getPort();
  }

  String baseUrl() {
    return "http://127.0.0.1:" + port();
  }

  /** Next response(s) will use this error scenario ("401", "403", "429", "5xx", "timeout") until reset. */
  void setScenario(String scenario) {
    this.scenario = scenario;
  }

  /**
   * Overrides the default single-stream/single-line success body with exact
   * caller-built {@code result} entries (each a {@code {"stream": {...},
   * "values": [[nanos, line], ...]}} map) - needed for {@link
   * LokiLogSourceTest}, which asserts on enrichment/merge/filter behavior
   * across multiple streams and lines that the default fixture can't
   * express. {@link #stream} builds one entry.
   */
  void respondWithStreams(List<Map<String, Object>> streamResults) {
    this.customResults = streamResults;
  }

  static Map<String, Object> stream(Map<String, String> labels, List<List<String>> values) {
    Map<String, Object> result = new LinkedHashMap<>();
    result.put("stream", labels);
    result.put("values", values);
    return result;
  }

  String lastQueryString() {
    return lastQueryString.get();
  }

  String lastAuthorizationHeader() {
    return lastAuthorizationHeader.get();
  }

  private void handle(HttpExchange exchange) throws IOException {
    lastQueryString.set(exchange.getRequestURI().getQuery());
    lastAuthorizationHeader.set(exchange.getRequestHeaders().getFirst("Authorization"));

    String currentScenario = scenario;
    if (currentScenario != null) {
      switch (currentScenario) {
        case "401" -> respondJson(exchange, 401, Map.of("status", "error", "error", "unauthorized"));
        case "403" -> respondJson(exchange, 403, Map.of("status", "error", "error", "forbidden"));
        case "429" -> respondJson(exchange, 429, Map.of("status", "error", "error", "rate limited"));
        case "5xx" -> respondJson(exchange, 503, Map.of("status", "error", "error", "unavailable"));
        case "timeout" -> {
          // Never respond - let the caller's own timeout fire.
          return;
        }
        default -> throw new IllegalStateException("unknown scenario " + currentScenario);
      }
      return;
    }

    if (!"GET".equals(exchange.getRequestMethod()) || !exchange.getRequestURI().getPath().equals(expectedPath)) {
      respondJson(exchange, 404, Map.of("status", "error", "error", "no route"));
      return;
    }

    Map<String, String> params = parseQuery(exchange.getRequestURI());

    List<Map<String, Object>> results = customResults;
    if (results == null) {
      long start = Long.parseLong(params.getOrDefault("start", "0"));
      long end = Long.parseLong(params.getOrDefault("end", "0"));

      Map<String, String> stream = new LinkedHashMap<>();
      stream.put(namespaceLabelKeyFromQuery(params), "mock-namespace");
      stream.put("app", "mock-service");

      long midpoint = start + (end - start) / 2;
      List<List<String>> values = List.of(List.of(String.valueOf(midpoint),
          "{\"@timestamp\":\"2026-01-01T00:00:00Z\",\"message\":\"mock loki line\",\"application\":\"mock-service\",\"mdc\":{}}"));

      results = List.of(stream(stream, values));
    }

    Map<String, Object> data = new LinkedHashMap<>();
    data.put("resultType", "streams");
    data.put("result", results);

    Map<String, Object> body = new LinkedHashMap<>();
    body.put("status", "success");
    body.put("data", data);

    respondJson(exchange, 200, body);
  }

  private String namespaceLabelKeyFromQuery(Map<String, String> params) {
    // The selector is embedded in the "query" param as {key="value",...} -
    // extract the first label key so the fixture stream uses whatever key
    // this test configured, proving the mock genuinely varies by config
    // rather than hardcoding a label name.
    String query = params.get("query");
    if (query == null) {
      return "namespace";
    }
    int eq = query.indexOf('=');
    if (eq <= 1) {
      return "namespace";
    }
    return query.substring(1, eq);
  }

  private Map<String, String> parseQuery(URI uri) {
    Map<String, String> result = new LinkedHashMap<>();
    String query = uri.getRawQuery();
    if (query == null) {
      return result;
    }
    for (String pair : query.split("&")) {
      int idx = pair.indexOf('=');
      if (idx < 0) {
        continue;
      }
      String key = java.net.URLDecoder.decode(pair.substring(0, idx), StandardCharsets.UTF_8);
      String value = java.net.URLDecoder.decode(pair.substring(idx + 1), StandardCharsets.UTF_8);
      result.put(key, value);
    }
    return result;
  }

  private void respondJson(HttpExchange exchange, int status, Object body) throws IOException {
    byte[] payload = objectMapper.writeValueAsBytes(body);
    exchange.getResponseHeaders().add("Content-Type", "application/json");
    exchange.sendResponseHeaders(status, payload.length);
    try (OutputStream out = exchange.getResponseBody()) {
      out.write(payload);
    }
  }

  @Override
  public void close() {
    server.stop(0);
  }
}
