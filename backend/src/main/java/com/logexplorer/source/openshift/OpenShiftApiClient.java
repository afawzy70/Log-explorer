package com.logexplorer.source.openshift;

import com.fasterxml.jackson.databind.JsonNode;
import com.logexplorer.core.model.RawToken;
import com.logexplorer.core.tls.CompositeX509TrustManager;
import com.logexplorer.source.openshift.OpenShiftApiException.Kind;
import io.netty.handler.ssl.SslContext;
import io.netty.handler.ssl.SslContextBuilder;
import java.io.InputStream;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;
import javax.net.ssl.SSLException;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientRequestException;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import org.springframework.web.util.UriComponentsBuilder;
import reactor.core.publisher.Mono;
import reactor.netty.http.client.HttpClient;
import reactor.netty.transport.ProxyProvider;

/**
 * Minimal read-only OpenShift API client for OS-1A: validate a connection,
 * resolve the authenticated user, and list the projects that user can see.
 *
 * <h2>Why WebClient rather than a Kubernetes client library (OS-1A §13)</h2>
 *
 * <p>Evaluated against adding {@code fabric8-kubernetes-client} or the
 * official Java client, and rejected on evidence:
 *
 * <ul>
 *   <li><b>Dependency weight</b> - OS-1A needs exactly two endpoints
 *   ({@code users/~} and {@code projects}). A full client brings a large
 *   transitive tree and its own HTTP stack into a desktop app that is
 *   jlink-bundled and shipped to end users.</li>
 *   <li><b>TLS</b> - this repository already has a proven private-CA
 *   mechanism ({@code CompositeX509TrustManager}, adding one CA on top of
 *   the JVM defaults and never trusting all). Reusing it keeps one
 *   auditable TLS path instead of two.</li>
 *   <li><b>Proxy</b> - OS-1A §12 requires scoped, non-global proxy control
 *   honouring {@code NO_PROXY}. That is direct with Reactor Netty and
 *   indirect through a library's own abstraction.</li>
 *   <li><b>Streaming</b> - the future Live slice needs a reactive stream
 *   of log lines, which is native here.</li>
 * </ul>
 *
 * <p>The trade-off accepted: we hand-roll two small JSON reads. That is a
 * smaller, more reviewable surface than a general-purpose client.
 *
 * <h2>Read-only</h2>
 *
 * <p>Only {@code GET} is ever issued (CLAUDE.md §2 rule 9: OpenShift
 * access is strictly read-only).
 */
@Component
public class OpenShiftApiClient {

  /** OpenShift's own "who am I" endpoint. */
  private static final String USER_PATH = "/apis/user.openshift.io/v1/users/~";

  /** OpenShift Projects - the user-scoped, RBAC-filtered view. */
  private static final String PROJECTS_PATH = "/apis/project.openshift.io/v1/projects";

  /** Kubernetes namespaces - only ever a fallback (OS-1A §16). */
  private static final String NAMESPACES_PATH = "/api/v1/namespaces";

  private static final Duration TIMEOUT = Duration.ofSeconds(15);

  private final Map<String, String> environment;

  public OpenShiftApiClient() {
    this(System.getenv());
  }

  /** Test seam: the proxy environment is injected rather than read globally. */
  OpenShiftApiClient(Map<String, String> environment) {
    this.environment = environment;
  }

  /** The proxy route that would be used for {@code server}, for display only. */
  public Optional<ProxyRoute> proxyFor(URI server) {
    return ProxyRoute.resolve(environment, server.getHost());
  }

  /**
   * The authenticated user's name, or empty when the cluster does not
   * expose the OpenShift user API (a plain Kubernetes API server does
   * not). A missing identity is <b>not</b> a connection failure - it is
   * simply unknown, and is reported as such rather than guessed at.
   */
  public Mono<Optional<String>> fetchUsername(URI server, RawToken token, String caPath) {
    return get(server, token, caPath, USER_PATH)
        .map(json -> Optional.ofNullable(json.path("metadata").path("name").asText(null)))
        .onErrorResume(OpenShiftApiException.class, e -> {
          // 403/404 here means "this cluster or user does not expose
          // identity", which must not fail an otherwise valid connection.
          // A 401 genuinely is an auth failure and must propagate.
          if (e.kind() == Kind.UNAUTHORIZED) {
            return Mono.error(e);
          }
          return Mono.just(Optional.empty());
        });
  }

  /**
   * Projects visible to the authenticated user.
   *
   * <p>Uses the OpenShift Projects API, which is already RBAC-filtered to
   * exactly what the user may see - no cluster-admin required, and no
   * enumeration of namespaces the user cannot access (OS-1A §14).
   *
   * <p>A {@code 403} propagates as {@link Kind#FORBIDDEN} and is
   * <b>never</b> converted into an empty list (OS-1A §15).
   */
  public Mono<ProjectDiscovery> fetchProjects(URI server, RawToken token, String caPath) {
    // Every failure propagates with its own kind. In particular a 403 is
    // NEVER converted into an empty list, and is never quietly retried as
    // the namespaces fallback - that would relabel "forbidden" as
    // "unavailable" and hide a real permission answer (OS-1A §15/§16).
    // Deciding whether a fallback is appropriate belongs to the caller,
    // which knows whether the failure means "not an OpenShift cluster".
    return get(server, token, caPath, PROJECTS_PATH)
        .map(json -> new ProjectDiscovery(names(json), ProjectDiscovery.Api.PROJECTS));
  }

  /** Kubernetes namespaces fallback - see {@link #fetchProjects} for when this is legitimate. */
  public Mono<ProjectDiscovery> fetchNamespaces(URI server, RawToken token, String caPath) {
    return get(server, token, caPath, NAMESPACES_PATH)
        .map(json -> new ProjectDiscovery(names(json), ProjectDiscovery.Api.NAMESPACES));
  }

  /**
   * One workload kind's list for a namespace (OS-1B §7). Every failure
   * propagates with its own {@link Kind} - a genuine 404 means this
   * cluster does not expose {@code kind}'s API at all (e.g. no
   * DeploymentConfig on a vanilla cluster), a 403 means this user may not
   * list it, and both are the caller's ({@code OpenShiftScopeService})
   * decision to classify, never silently swallowed here.
   */
  public Mono<List<WorkloadSummary>> fetchWorkloads(URI server, RawToken token, String caPath, WorkloadKind kind,
      String namespace) {
    return get(server, token, caPath, kind.listPath(namespace)).map(json -> workloadSummaries(json, kind, namespace));
  }

  private static List<WorkloadSummary> workloadSummaries(JsonNode listJson, WorkloadKind kind, String namespace) {
    List<WorkloadSummary> summaries = new ArrayList<>();
    for (JsonNode item : listJson.path("items")) {
      String name = item.path("metadata").path("name").asText(null);
      if (name == null || name.isBlank()) {
        continue;
      }
      // A DaemonSet has no spec.replicas at all - its "desired" count is
      // scheduler-determined, reported as status.desiredNumberScheduled.
      int desired = kind == WorkloadKind.DAEMON_SET
          ? item.path("status").path("desiredNumberScheduled").asInt(0)
          : item.path("spec").path("replicas").asInt(0);
      int ready = kind == WorkloadKind.DAEMON_SET
          ? item.path("status").path("numberReady").asInt(0)
          : item.path("status").path("readyReplicas").asInt(0);
      summaries.add(new WorkloadSummary(new WorkloadRef(kind, name, namespace), desired, ready));
    }
    summaries.sort(Comparator.comparing(w -> w.ref().name()));
    return List.copyOf(summaries);
  }

  /**
   * The workload's own label selector, read fresh at pod-resolution time
   * rather than cached from discovery (OS-1B §9) - a single extra GET per
   * pod-discovery-for-a-workload request, which is bounded and far cheaper
   * than an N+1 per-pod call pattern (OS-1B §18).
   *
   * <p>{@code DeploymentConfig}'s selector is a flat map directly under
   * {@code spec.selector}; every {@code apps/v1} kind nests it one level
   * deeper at {@code spec.selector.matchLabels}. Only equality-based
   * labels are read - {@code matchExpressions} is not supported in this
   * slice (OS-1B decision, see the verification report).
   */
  public Mono<Map<String, String>> fetchWorkloadSelector(URI server, RawToken token, String caPath, WorkloadRef ref) {
    return get(server, token, caPath, ref.kind().getPath(ref.namespace(), ref.name()))
        .map(json -> selectorMatchLabels(json, ref.kind()));
  }

  private static Map<String, String> selectorMatchLabels(JsonNode workloadJson, WorkloadKind kind) {
    JsonNode selectorNode = kind == WorkloadKind.DEPLOYMENT_CONFIG
        ? workloadJson.path("spec").path("selector")
        : workloadJson.path("spec").path("selector").path("matchLabels");
    Map<String, String> labels = new LinkedHashMap<>();
    selectorNode.fields().forEachRemaining(entry -> labels.put(entry.getKey(), entry.getValue().asText()));
    return Map.copyOf(labels);
  }

  /**
   * Pods in {@code namespace}, optionally narrowed by an equality-based
   * label selector (OS-1B §9/§10/§18) - a single namespace-scoped list
   * call, never one call per pod. An empty/{@code null} selector lists
   * every pod in the namespace ("All workloads" scope, OS-1B §22).
   *
   * @param workload attached to every returned {@link PodSummary} so the
   *     caller can tell which workload (if any) this listing was scoped to
   */
  public Mono<List<PodSummary>> fetchPods(URI server, RawToken token, String caPath, String namespace,
      Map<String, String> labelSelector, WorkloadRef workload) {
    return get(server, token, caPath, podsPath(namespace, labelSelector))
        .map(json -> podSummaries(json, workload));
  }

  private static String podsPath(String namespace, Map<String, String> labelSelector) {
    String base = "/api/v1/namespaces/" + namespace + "/pods";
    if (labelSelector == null || labelSelector.isEmpty()) {
      return base;
    }
    String selectorValue = labelSelector.entrySet().stream()
        .sorted(Map.Entry.comparingByKey())
        .map(e -> e.getKey() + "=" + e.getValue())
        .collect(Collectors.joining(","));
    // Deliberately NOT pre-encoded here: WebClient's own uri(String) call in
    // get() already encodes this template once. Encoding it here too turned
    // "=" into "%3D" and then "%3D" into "%253D" on the wire - a real,
    // caught-by-test double-encoding bug (OS-1B) that made the selector
    // value the server actually received unparseable, which - against this
    // repo's own deterministic fake API - silently degraded to "no filter
    // applied" rather than an explicit error. Fixed by encoding exactly
    // once, here at the WebClient call site.
    return UriComponentsBuilder.fromPath(base).queryParam("labelSelector", selectorValue).build().toUriString();
  }

  private static List<PodSummary> podSummaries(JsonNode listJson, WorkloadRef workload) {
    List<PodSummary> pods = new ArrayList<>();
    for (JsonNode item : listJson.path("items")) {
      String name = item.path("metadata").path("name").asText(null);
      if (name == null || name.isBlank()) {
        continue;
      }
      String phase = item.path("status").path("phase").asText("Unknown");
      // Runtime containers only - spec.initContainers is deliberately not
      // read here (OS-1B §11: DEFERRED, never silently merged in).
      List<String> containerNames = new ArrayList<>();
      for (JsonNode c : item.path("spec").path("containers")) {
        String containerName = c.path("name").asText(null);
        if (containerName != null && !containerName.isBlank()) {
          containerNames.add(containerName);
        }
      }
      int totalStatuses = 0;
      int readyCount = 0;
      int restarts = 0;
      for (JsonNode status : item.path("status").path("containerStatuses")) {
        totalStatuses++;
        if (status.path("ready").asBoolean(false)) {
          readyCount++;
        }
        restarts += status.path("restartCount").asInt(0);
      }
      // A pod with no reported containerStatuses yet (e.g. still Pending)
      // falls back to the container count from its spec as the denominator,
      // so the ready summary is never a misleading "0/0".
      int denominator = totalStatuses > 0 ? totalStatuses : containerNames.size();
      pods.add(new PodSummary(name, phase, readyCount + "/" + denominator, restarts, List.copyOf(containerNames),
          workload));
    }
    pods.sort(Comparator.comparing(PodSummary::name));
    return List.copyOf(pods);
  }

  private static List<String> names(JsonNode listJson) {
    List<String> names = new ArrayList<>();
    for (JsonNode item : listJson.path("items")) {
      String name = item.path("metadata").path("name").asText(null);
      if (name != null && !name.isBlank()) {
        names.add(name);
      }
    }
    names.sort(String::compareTo);
    return List.copyOf(names);
  }

  private Mono<JsonNode> get(URI server, RawToken token, String caPath, String path) {
    WebClient client;
    try {
      client = build(server, caPath);
    } catch (OpenShiftApiException e) {
      return Mono.error(e);
    }
    return client
        .get()
        .uri(path)
        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token.value())
        .retrieve()
        .bodyToMono(JsonNode.class)
        .timeout(TIMEOUT)
        .onErrorMap(OpenShiftApiClient::classify);
  }

  /**
   * Maps transport/HTTP failures to the categories the UI distinguishes.
   *
   * <p>The original exception is kept only as a cause. Its message is
   * never surfaced: for a {@link WebClientResponseException} it can carry
   * the response body, and for a request exception it can carry the full
   * request URI - both built from user-supplied input.
   */
  private static Throwable classify(Throwable error) {
    if (error instanceof OpenShiftApiException) {
      return error;
    }
    if (error instanceof WebClientResponseException response) {
      HttpStatus status = HttpStatus.resolve(response.getStatusCode().value());
      if (status == HttpStatus.UNAUTHORIZED) {
        return new OpenShiftApiException(
            Kind.UNAUTHORIZED, "The cluster rejected this token. It may have expired - sign in again.", error);
      }
      if (status == HttpStatus.FORBIDDEN) {
        return new OpenShiftApiException(
            Kind.FORBIDDEN, "This account is not permitted to perform that request on the cluster.", error);
      }
      if (status == HttpStatus.NOT_FOUND) {
        // A genuine 404 on the Projects endpoint itself is the ONLY signal
        // that means "this cluster has no OpenShift Projects API" - see
        // Kind.NOT_FOUND's own javadoc. Every other status (429 rate
        // limited, 500/502/503 upstream failures, etc.) falls through to
        // the generic MALFORMED_RESPONSE branch below, which the
        // namespaces fallback deliberately does NOT act on.
        return new OpenShiftApiException(
            Kind.NOT_FOUND, "The cluster returned HTTP 404 for that API.", error);
      }
      return new OpenShiftApiException(
          Kind.MALFORMED_RESPONSE,
          "The cluster returned an unexpected response (HTTP " + response.getStatusCode().value() + ").",
          error);
    }
    if (error instanceof WebClientRequestException request) {
      Throwable cause = request.getCause();
      if (cause instanceof SSLException || cause instanceof java.security.cert.CertificateException) {
        return new OpenShiftApiException(
            Kind.TLS,
            "TLS verification failed. If this cluster uses a private certificate authority, supply its CA "
                + "certificate.",
            error);
      }
      return new OpenShiftApiException(
          Kind.NETWORK,
          "Could not reach the cluster API. Check VPN, DNS and that the server URL is correct.",
          error);
    }
    if (error instanceof java.util.concurrent.TimeoutException) {
      return new OpenShiftApiException(Kind.NETWORK, "The cluster API did not respond in time.", error);
    }
    return new OpenShiftApiException(Kind.MALFORMED_RESPONSE, "The cluster API call failed.", error);
  }

  private WebClient build(URI server, String caPath) {
    HttpClient httpClient = HttpClient.create().responseTimeout(TIMEOUT);

    if (caPath != null && !caPath.isBlank()) {
      SslContext sslContext = buildSslContext(caPath);
      httpClient = httpClient.secure(spec -> spec.sslContext(sslContext));
    }

    // OS-1A §12 - scoped proxy configuration, never JVM-global, and never
    // applied when NO_PROXY covers this host.
    Optional<ProxyRoute> route = ProxyRoute.resolve(environment, server.getHost());
    if (route.isPresent()) {
      ProxyRoute proxy = route.get();
      httpClient = httpClient.proxy(spec -> {
        var typeSpec = spec.type(ProxyProvider.Proxy.HTTP).host(proxy.host()).port(proxy.port());
        if (proxy.hasCredentials()) {
          typeSpec.username(proxy.username());
          if (proxy.password() != null) {
            typeSpec.password(user -> proxy.password());
          }
        }
      });
    }

    return WebClient.builder()
        .baseUrl(server.toString())
        .clientConnector(new ReactorClientHttpConnector(httpClient))
        .build();
  }

  /**
   * Adds exactly one extra trusted CA on top of the JVM's own trust
   * anchors - the same {@code CompositeX509TrustManager} approach the Loki
   * client already uses. Verification is never disabled and hostname
   * verification is never relaxed (CLAUDE.md §2 rule 7).
   */
  private static SslContext buildSslContext(String caCertPath) {
    try {
      X509Certificate extraCa;
      try (InputStream in = Files.newInputStream(Path.of(caCertPath))) {
        extraCa = (X509Certificate) CertificateFactory.getInstance("X.509").generateCertificate(in);
      }
      KeyStore keyStore = KeyStore.getInstance(KeyStore.getDefaultType());
      keyStore.load(null, null);
      keyStore.setCertificateEntry("openshift-ca", extraCa);

      TrustManagerFactory extraFactory =
          TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
      extraFactory.init(keyStore);

      TrustManagerFactory defaultFactory =
          TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
      defaultFactory.init((KeyStore) null);

      List<X509TrustManager> managers = new ArrayList<>();
      for (var manager : defaultFactory.getTrustManagers()) {
        if (manager instanceof X509TrustManager x509) {
          managers.add(x509);
        }
      }
      for (var manager : extraFactory.getTrustManagers()) {
        if (manager instanceof X509TrustManager x509) {
          managers.add(x509);
        }
      }
      return SslContextBuilder.forClient()
          .trustManager(new CompositeX509TrustManager(managers))
          .build();
    } catch (Exception e) {
      // The path came from user input; never echo it.
      throw new OpenShiftApiException(
          Kind.TLS, "The supplied certificate authority file could not be read as a PEM certificate.", e);
    }
  }
}
