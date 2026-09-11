package com.logexplorer.source.openshift;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Deterministic fake OpenShift/Kubernetes API for OS-1B Layer 2 tests -
 * workloads, pods and the selector-based resolution between them. A plain
 * JDK {@link HttpServer}, the same convention as {@code MockOpenShiftServer}
 * and {@code MockLokiServer}.
 *
 * <p>Fully programmable per test: each {@link WorkloadKind}'s list can be
 * set independently, each kind's HTTP behaviour can be switched to
 * simulate a genuinely absent API (404), a forbidden one (403), or a real
 * error (500); pods are label-selector filtered exactly like the real
 * Kubernetes pod-list API, so the client's own selector-building logic is
 * proved, not assumed. Fixtures are mutable between requests from the
 * same test, so "a pod disappears between discovery calls" and "a
 * workload disappears" are just two calls with different fixtures set in
 * between.
 */
public final class MockOpenShiftScopeServer implements AutoCloseable {

  public enum KindStatus { OK, NOT_FOUND, FORBIDDEN, ERROR }

  /** One fixture workload - deliberately not the production {@link WorkloadSummary}, so this stays test-only. */
  public record WorkloadFixture(String name, int desired, int ready, Map<String, String> selector) {}

  /** One fixture pod. {@code labels} drives label-selector filtering; production never sees them directly. */
  public record PodFixture(
      String name, String phase, int totalContainers, int readyContainers, int restarts,
      List<String> containerNames, Map<String, String> labels) {}

  private final HttpServer server;
  private final String namespace;
  private final Map<WorkloadKind, KindStatus> kindStatus = new ConcurrentHashMap<>();
  private final Map<WorkloadKind, List<WorkloadFixture>> workloadsByKind = new ConcurrentHashMap<>();
  private volatile List<PodFixture> pods = new ArrayList<>();
  private volatile boolean unauthorized = false;
  private volatile int podsDelayMs = 0;
  private volatile Map<String, String> forbiddenPodsSelector = null;
  private final AtomicInteger podsRequestCount = new AtomicInteger();
  private final AtomicReference<String> lastPodsQuery = new AtomicReference<>();

  public MockOpenShiftScopeServer(String namespace) throws IOException {
    this.namespace = namespace;
    for (WorkloadKind kind : WorkloadKind.values()) {
      kindStatus.put(kind, KindStatus.OK);
      workloadsByKind.put(kind, List.of());
    }
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/", this::handle);
    server.setExecutor(null);
    server.start();
  }

  public String baseUrl() {
    return "http://127.0.0.1:" + server.getAddress().getPort();
  }

  public void setKindStatus(WorkloadKind kind, KindStatus status) {
    kindStatus.put(kind, status);
  }

  public void setWorkloads(WorkloadKind kind, List<WorkloadFixture> fixtures) {
    workloadsByKind.put(kind, List.copyOf(fixtures));
  }

  public void setPods(List<PodFixture> newPods) {
    this.pods = List.copyOf(newPods);
  }

  public void setUnauthorized(boolean value) {
    this.unauthorized = value;
  }

  public void setPodsDelayMs(int millis) {
    this.podsDelayMs = millis;
  }

  /**
   * The pod-list call for exactly this label selector (an equality-based
   * OS-1B "resolve pods for one supported workload" request) answers 403
   * instead of the normal fixture - simulates pod-level RBAC being
   * narrower than workload-listing RBAC, distinct from a whole kind being
   * forbidden during workload discovery.
   */
  public void setPodsForbiddenForSelector(Map<String, String> selector) {
    this.forbiddenPodsSelector = Map.copyOf(selector);
  }

  public int podsRequestCount() {
    return podsRequestCount.get();
  }

  public String lastPodsQuery() {
    return lastPodsQuery.get();
  }

  private void handle(HttpExchange exchange) throws IOException {
    if (unauthorized) {
      respond(exchange, 401, "{\"message\":\"Unauthorized\"}");
      return;
    }
    String path = exchange.getRequestURI().getPath();
    String query = exchange.getRequestURI().getRawQuery();

    if (path.equals("/api/v1/namespaces/" + namespace + "/pods")) {
      podsRequestCount.incrementAndGet();
      lastPodsQuery.set(query);
      if (forbiddenPodsSelector != null && forbiddenPodsSelector.equals(parseLabelSelector(query))) {
        respond(exchange, 403, "{\"message\":\"Forbidden\"}");
        return;
      }
      if (podsDelayMs > 0) {
        try {
          Thread.sleep(podsDelayMs);
        } catch (InterruptedException e) {
          Thread.currentThread().interrupt();
        }
      }
      respond(exchange, 200, podsJson(matchingPods(query)));
      return;
    }

    for (WorkloadKind kind : WorkloadKind.values()) {
      if (path.equals(kind.listPath(namespace))) {
        respondForKind(exchange, kind, kindStatus.get(kind), listJson(kind, workloadsByKind.get(kind)));
        return;
      }
      String prefix = kind.listPath(namespace) + "/";
      if (path.startsWith(prefix)) {
        String name = path.substring(prefix.length());
        WorkloadFixture fixture = workloadsByKind.get(kind).stream()
            .filter(w -> w.name().equals(name))
            .findFirst()
            .orElse(null);
        if (fixture == null) {
          respond(exchange, 404, "{\"message\":\"not found\"}");
          return;
        }
        respondForKind(exchange, kind, kindStatus.get(kind), objectJson(kind, fixture));
        return;
      }
    }

    respond(exchange, 404, "{\"message\":\"not found\"}");
  }

  private void respondForKind(HttpExchange exchange, WorkloadKind kind, KindStatus status, String body)
      throws IOException {
    switch (status) {
      case NOT_FOUND -> respond(exchange, 404, "{\"message\":\"the server could not find the requested resource\"}");
      case FORBIDDEN -> respond(exchange, 403, "{\"message\":\"Forbidden\"}");
      case ERROR -> respond(exchange, 500, "{\"message\":\"Internal Server Error\"}");
      case OK -> respond(exchange, 200, body);
    }
  }

  private List<PodFixture> matchingPods(String rawQuery) {
    Map<String, String> selector = parseLabelSelector(rawQuery);
    if (selector.isEmpty()) {
      return pods;
    }
    List<PodFixture> matched = new ArrayList<>();
    for (PodFixture pod : pods) {
      boolean allMatch = selector.entrySet().stream()
          .allMatch(e -> e.getValue().equals(pod.labels().get(e.getKey())));
      if (allMatch) {
        matched.add(pod);
      }
    }
    return matched;
  }

  private static Map<String, String> parseLabelSelector(String rawQuery) {
    Map<String, String> result = new java.util.LinkedHashMap<>();
    if (rawQuery == null || rawQuery.isBlank()) {
      return result;
    }
    for (String param : rawQuery.split("&")) {
      String[] kv = param.split("=", 2);
      if (kv.length == 2 && kv[0].equals("labelSelector")) {
        String decoded = java.net.URLDecoder.decode(kv[1], StandardCharsets.UTF_8);
        for (String pair : decoded.split(",")) {
          String[] labelKv = pair.split("=", 2);
          if (labelKv.length == 2) {
            result.put(labelKv[0], labelKv[1]);
          }
        }
      }
    }
    return result;
  }

  private static String listJson(WorkloadKind kind, List<WorkloadFixture> fixtures) {
    StringBuilder json = new StringBuilder("{\"items\":[");
    for (int i = 0; i < fixtures.size(); i++) {
      if (i > 0) {
        json.append(',');
      }
      json.append(objectJson(kind, fixtures.get(i)));
    }
    return json.append("]}").toString();
  }

  private static String objectJson(WorkloadKind kind, WorkloadFixture fixture) {
    StringBuilder selectorJson = new StringBuilder("{");
    boolean first = true;
    for (var entry : fixture.selector().entrySet()) {
      if (!first) {
        selectorJson.append(',');
      }
      first = false;
      selectorJson.append('"').append(entry.getKey()).append("\":\"").append(entry.getValue()).append('"');
    }
    selectorJson.append('}');
    String selectorField = kind == WorkloadKind.DEPLOYMENT_CONFIG
        ? "\"selector\":" + selectorJson
        : "\"selector\":{\"matchLabels\":" + selectorJson + "}";

    String specReplicas = kind == WorkloadKind.DAEMON_SET ? "" : "\"replicas\":" + fixture.desired() + ",";
    String statusFields = kind == WorkloadKind.DAEMON_SET
        ? "\"desiredNumberScheduled\":" + fixture.desired() + ",\"numberReady\":" + fixture.ready()
        : "\"readyReplicas\":" + fixture.ready();

    return "{\"metadata\":{\"name\":\"" + fixture.name() + "\"},"
        + "\"spec\":{" + specReplicas + selectorField + "},"
        + "\"status\":{" + statusFields + "}}";
  }

  private static String podsJson(List<PodFixture> fixtures) {
    StringBuilder json = new StringBuilder("{\"items\":[");
    for (int i = 0; i < fixtures.size(); i++) {
      if (i > 0) {
        json.append(',');
      }
      PodFixture pod = fixtures.get(i);
      StringBuilder containerStatuses = new StringBuilder("[");
      for (int c = 0; c < pod.totalContainers(); c++) {
        if (c > 0) {
          containerStatuses.append(',');
        }
        boolean ready = c < pod.readyContainers();
        containerStatuses.append("{\"ready\":").append(ready).append(",\"restartCount\":")
            .append(c == 0 ? pod.restarts() : 0).append('}');
      }
      containerStatuses.append(']');

      StringBuilder containers = new StringBuilder("[");
      for (int c = 0; c < pod.containerNames().size(); c++) {
        if (c > 0) {
          containers.append(',');
        }
        containers.append("{\"name\":\"").append(pod.containerNames().get(c)).append("\"}");
      }
      containers.append(']');

      json.append("{\"metadata\":{\"name\":\"").append(pod.name()).append("\"},")
          .append("\"spec\":{\"containers\":").append(containers).append("},")
          .append("\"status\":{\"phase\":\"").append(pod.phase()).append("\",")
          .append("\"containerStatuses\":").append(containerStatuses).append("}}");
    }
    return json.append("]}").toString();
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
