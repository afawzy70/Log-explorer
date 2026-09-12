package com.logexplorer.source.openshift;

import com.fasterxml.jackson.databind.JsonNode;
import com.logexplorer.core.model.RawToken;
import com.logexplorer.core.tls.CompositeX509TrustManager;
import com.logexplorer.source.openshift.OpenShiftApiException.Kind;
import io.netty.handler.ssl.SslContext;
import io.netty.handler.ssl.SslContextBuilder;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.time.Duration;
import java.time.Instant;
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
import java.util.concurrent.atomic.AtomicReference;
import org.reactivestreams.Subscription;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.core.io.buffer.DataBufferUtils;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientRequestException;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import org.springframework.web.util.UriComponentsBuilder;
import reactor.core.publisher.BaseSubscriber;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.publisher.MonoSink;
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
      // The list response already carries each item's full spec, so the
      // selector is captured here for free - no second GET per workload
      // (OS-1B review recovery: needed to resolve "All workloads" pod
      // scope truthfully, bounded to the workloads actually discovered).
      Map<String, String> selector = selectorMatchLabels(item, kind);
      summaries.add(new WorkloadSummary(new WorkloadRef(kind, name, namespace), desired, ready, selector));
    }
    summaries.sort(Comparator.comparing(w -> w.ref().name()));
    return List.copyOf(summaries);
  }

  /**
   * The workload's own label selector, read fresh at pod-resolution time
   * rather than cached from discovery (OS-1B §9) - a single extra GET per
   * pod-discovery-for-a-workload request, which is bounded and far cheaper
   * than an N+1 per-pod call pattern (OS-1B §18). Used only when the
   * caller already has a single, specific {@link WorkloadRef} in hand
   * (a committed selection); resolving pods for "All workloads" instead
   * uses {@link WorkloadSummary#selector()}, captured once per workload
   * during {@link #fetchWorkloads} itself, since re-reading every
   * discovered workload's selector individually would reintroduce the
   * "N calls per workload" cost this method exists to bound for the
   * single-workload case (see the OS-1B review-recovery verification
   * report for the immutability argument that makes the cached value
   * safe to reuse for that broader case).
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

  /**
   * OS-1C — the Kubernetes/OpenShift pod-log endpoint itself (never {@code
   * oc logs}, never a shell, never a runtime {@code oc} dependency). The
   * response body is plain text, one raw log line per {@code \n}-delimited
   * line — never JSON at the transport level, unlike every other call this
   * client makes — so this uses its own raw-text read path rather than
   * {@link #get}, which always expects a JSON body.
   *
   * <p>{@code follow} is always {@code false} here — OS-1C is a single
   * bounded read, never a live stream (that is OS-1E's job, explicitly out
   * of scope for this slice). {@code timestamps=true} is always requested
   * so each line arrives prefixed with Kubernetes' own RFC3339Nano receive
   * timestamp, which becomes this event's {@code sourceTimestamp} — the
   * same "adapter's own native clock, always known even for a malformed
   * line" role Docker's frame-receive time and Loki's stream-entry
   * timestamp already play (see {@link
   * com.logexplorer.core.model.CanonicalLogEvent#sourceTimestamp()}).
   *
   * @param sinceTime pushed down as {@code sinceTime} to reduce upstream
   *     volume — an optimization only (OS-1C §6); the exact {@code
   *     request.start()}/{@code end()} bound is still re-applied after
   *     parsing by {@code core.search.EventFilters}, exactly like Docker's
   *     own {@code since}/{@code until} push-down already works
   * @param tailLines an additional hard bound on lines read, independent
   *     of {@code sinceTime} (OS-1C §5/§7)
   * @param maxBytes a hard client-side cap on how much of the response
   *     body is ever read, regardless of how much the upstream would send
   *     (OS-1C §7 "max bytes per pod/container") — enforced by counting
   *     actual bytes <b>as they arrive on the wire</b> and stopping/
   *     cancelling once this many have been read (OS-1C review recovery —
   *     see {@link #readBounded}; never by first reading the whole body
   *     into memory and truncating a materialized {@code String} by
   *     {@code length()} afterward, which the pre-recovery implementation
   *     did and which is neither a real memory bound — the full body was
   *     already buffered — nor a real byte bound — {@code String.length()}
   *     counts UTF-16 chars, not bytes)
   * @return the bounded body plus whether the byte cap actually stopped a
   *     larger response short ({@link PodLogFetchResult#byteCapReached()})
   *     — never hidden from the caller
   */
  public Mono<PodLogFetchResult> fetchPodLog(
      URI server, RawToken token, String caPath, String namespace, String podName, String containerName,
      Instant sinceTime, int tailLines, long maxBytes, Duration timeout) {
    WebClient client;
    try {
      client = build(server, caPath);
    } catch (OpenShiftApiException e) {
      return Mono.error(e);
    }
    UriComponentsBuilder uri = UriComponentsBuilder
        .fromPath("/api/v1/namespaces/" + namespace + "/pods/" + podName + "/log")
        .queryParam("container", containerName)
        .queryParam("timestamps", "true")
        .queryParam("follow", "false")
        .queryParam("tailLines", tailLines);
    if (sinceTime != null) {
      uri.queryParam("sinceTime", sinceTime.toString());
    }
    // .retrieve() still inspects the status code and raises
    // WebClientResponseException for 4xx/5xx BEFORE the body is ever
    // extracted, exactly as it did for bodyToMono(String.class) - the
    // error-classification path below is completely unaffected by
    // switching the success-path body extraction to raw DataBuffers.
    Flux<DataBuffer> rawBody = client
        .get()
        .uri(uri.build().toUriString())
        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token.value())
        .retrieve()
        .bodyToFlux(DataBuffer.class);
    return readBounded(rawBody, maxBytes)
        .timeout(timeout)
        .onErrorMap(OpenShiftApiClient::classify);
  }

  /**
   * OS-1C review recovery — true streaming byte-bounded consumption of a
   * {@code Flux<DataBuffer>}, counting real encoded bytes as they arrive
   * and never materializing more than {@code maxBytes} of the upstream
   * response, regardless of how large it actually is.
   *
   * <p>Deliberately hand-rolled with a {@link BaseSubscriber} rather than
   * {@link DataBufferUtils#join(org.reactivestreams.Publisher, int)} (the
   * obvious built-in candidate): {@code join}'s own bounded overload
   * discards everything and raises {@code DataBufferLimitException} the
   * moment the limit is exceeded — it cannot return the bytes read so far.
   * OS-1C needs the opposite: keep exactly the first {@code maxBytes}
   * bytes and report that the cap was hit, never lose the truncated
   * prefix.
   *
   * <p><b>No accidental controlling limit.</b> Spring's default in-memory
   * codec limit ({@code spring.codec.max-in-memory-size}, 256 KB by
   * default) only ever applies to strategies that themselves aggregate a
   * whole body in memory ({@code bodyToMono(String.class)},
   * {@code bodyToMono(byte[].class)}, an unbounded {@code
   * DataBufferUtils.join}) — this method never calls any of those; it
   * consumes the raw {@code Flux<DataBuffer>} directly, so {@code
   * maxBytes} (this call's own parameter) is the only limit in effect,
   * whether it is smaller or larger than that default.
   *
   * <p><b>Bounded, not unbounded, memory.</b> Every {@link DataBuffer} is
   * released in a {@code finally} block the instant its bytes are copied
   * out (success, cap-reached, or error path alike) — nothing is ever
   * retained beyond the single buffer currently being processed plus the
   * bounded accumulator, which itself never exceeds {@code maxBytes}.
   *
   * <p><b>Real cancellation.</b> The moment accumulation reaches {@code
   * maxBytes}, {@link BaseSubscriber#cancel()} is called on the upstream
   * subscription — Reactor Netty propagates this to the underlying
   * connection, so a pod streaming gigabytes of log never has more than
   * one in-flight buffer beyond the cap actually read off the wire.
   *
   * <p><b>UTF-8 decoding happens exactly once</b>, after the bounded byte
   * array is complete — never per-chunk (which could split a multi-byte
   * UTF-8 character across two chunks and corrupt it) — and {@link
   * #trimIncompleteUtf8Suffix} defensively drops a truncated trailing
   * multi-byte sequence at the cap boundary before decoding, so a cut-off
   * response never ends in a garbled replacement character.
   */
  static Mono<PodLogFetchResult> readBounded(Flux<DataBuffer> source, long maxBytes) {
    return Mono.create(sink -> {
      BoundedBodyCollector collector = new BoundedBodyCollector(maxBytes, sink);
      // OS-1C final review recovery - bridges cancellation of THIS Mono
      // (downstream abort, Mono.timeout(), an overall search cancelled) to
      // the raw body subscription. Without this, the manually-created
      // subscriber can remain subscribed after the request that owned it
      // is already gone, letting the HTTP body keep draining for nothing.
      sink.onCancel(collector::cancelFromDownstream);
      source.subscribe(collector);
    });
  }

  /** Which side triggered {@link BaseSubscriber#cancel()} on {@link BoundedBodyCollector}. */
  private enum CancelCause {
    /** Not yet cancelled. */
    NONE,
    /** The byte cap was reached - a successful, intentionally bounded result. */
    INTERNAL_CAP,
    /** The downstream consumer of {@link #readBounded} cancelled/timed out - never a success. */
    DOWNSTREAM
  }

  /**
   * The {@link BaseSubscriber} behind {@link #readBounded} - a named class
   * (rather than the original anonymous one) so its cancellation cause can
   * be tracked deterministically.
   *
   * <p>Uses pull-style backpressure ({@code request(1)} at subscribe time
   * and again only after each buffer is fully processed and released,
   * never {@code request(Long.MAX_VALUE)} - OS-1C final review recovery
   * §3) so at most one {@link DataBuffer} is ever in flight from the body
   * publisher, on top of the bounded accumulator itself.
   *
   * <p>Two independent causes can trigger {@link #cancel()}: this
   * subscriber's own byte-cap logic ({@link CancelCause#INTERNAL_CAP}) and
   * a cancellation of the {@link Mono} this subscriber backs ({@link
   * CancelCause#DOWNSTREAM}, bridged via {@link #cancelFromDownstream()}).
   * They race on different threads (the HTTP client's event loop vs.
   * whatever thread owns the timeout/cancellation), so the cause is
   * recorded with a single {@link AtomicReference#compareAndSet} performed
   * immediately before calling {@code cancel()} - exactly one wins, and
   * {@link #hookOnCancel()} trusts that recorded cause rather than
   * re-deriving it, so a downstream cancellation can never be mistaken for
   * the cap's own "successful bounded result" and resurface a stale {@link
   * PodLogFetchResult}.
   */
  private static final class BoundedBodyCollector extends BaseSubscriber<DataBuffer> {
    private final long maxBytes;
    private final MonoSink<PodLogFetchResult> sink;
    private final ByteArrayOutputStream out = new ByteArrayOutputStream();
    private final AtomicReference<CancelCause> cause = new AtomicReference<>(CancelCause.NONE);
    private volatile boolean terminalEmitted = false;

    BoundedBodyCollector(long maxBytes, MonoSink<PodLogFetchResult> sink) {
      this.maxBytes = maxBytes;
      this.sink = sink;
    }

    @Override
    protected void hookOnSubscribe(Subscription subscription) {
      request(1);
    }

    @Override
    protected void hookOnNext(DataBuffer buffer) {
      try {
        if (cause.get() != CancelCause.NONE) {
          // A buffer that arrived after cancel() was already requested -
          // Reactive Streams allows a small number of in-flight signals
          // after cancel(); it is simply discarded, never accumulated.
          return;
        }
        int readable = buffer.readableByteCount();
        long remaining = maxBytes - out.size();
        int toCopy = (int) Math.min(readable, remaining);
        if (toCopy > 0) {
          byte[] chunk = new byte[toCopy];
          buffer.read(chunk);
          // ByteArrayOutputStream#write(byte[]) never actually throws -
          // the checked IOException it declares (inherited from the
          // OutputStream contract, not overridden away) is unreachable
          // for this specific implementation.
          try {
            out.write(chunk);
          } catch (java.io.IOException impossible) {
            throw new IllegalStateException(impossible);
          }
        }
        if (toCopy < readable) {
          // Real bytes existed beyond the cap in this exact buffer - the
          // response is genuinely larger than maxBytes, not merely
          // exactly maxBytes. Cancel immediately: no further buffers are
          // pulled from the upstream connection.
          if (cause.compareAndSet(CancelCause.NONE, CancelCause.INTERNAL_CAP)) {
            cancel();
          }
          return;
        }
      } finally {
        DataBufferUtils.release(buffer);
      }
      // Pull-style backpressure (OS-1C final review recovery §3): only ask
      // for the next buffer once this one is fully processed and released -
      // never unlimited demand against the body publisher.
      request(1);
    }

    @Override
    protected void hookOnComplete() {
      emitSuccessOnce();
    }

    @Override
    protected void hookOnCancel() {
      if (cause.get() == CancelCause.INTERNAL_CAP) {
        // Our own cap-triggered cancel() - still a successful, bounded
        // result, never an error; the caller asked for "at most maxBytes,"
        // and that is exactly what was delivered.
        emitSuccessOnce();
        return;
      }
      // DOWNSTREAM cancel (or, defensively, any cancel this collector did
      // not itself decide on): the caller of readBounded no longer wants
      // this result at all. Never synthesize a successful
      // PodLogFetchResult here - that would silently convert an aborted
      // request into a truncated-but-"successful" one.
      terminalEmitted = true;
    }

    @Override
    protected void hookOnError(Throwable error) {
      if (terminalEmitted) {
        return;
      }
      terminalEmitted = true;
      sink.error(error);
    }

    private void emitSuccessOnce() {
      if (terminalEmitted) {
        return;
      }
      terminalEmitted = true;
      byte[] bytes = trimIncompleteUtf8Suffix(out.toByteArray());
      sink.success(new PodLogFetchResult(
          new String(bytes, StandardCharsets.UTF_8), cause.get() == CancelCause.INTERNAL_CAP));
    }

    /**
     * Bridges cancellation of the {@link Mono} returned by {@link
     * #readBounded} (downstream abort, {@code Mono.timeout()}, an overall
     * search being cancelled) to this subscriber's own upstream
     * subscription, so the HTTP body is torn down instead of continuing to
     * drain after nobody will ever read the result.
     */
    void cancelFromDownstream() {
      if (cause.compareAndSet(CancelCause.NONE, CancelCause.DOWNSTREAM)) {
        cancel();
      }
    }
  }

  /**
   * OS-1C review recovery — if a byte-bounded cut lands in the middle of a
   * multi-byte UTF-8 character, drop that trailing incomplete sequence
   * rather than let {@link String#String(byte[], java.nio.charset.Charset)}
   * silently substitute a U+FFFD replacement character at the very end of
   * a truncated log line. Every byte before the cut point is untouched -
   * this only ever trims the final 1-3 bytes, and only when they are
   * genuinely an incomplete sequence.
   *
   * <p>UTF-8's own self-describing structure makes this decidable by
   * inspecting only the trailing bytes: a continuation byte has the top
   * bits {@code 10xxxxxx} (0x80-0xBF); a lead byte declares how many
   * continuation bytes follow via its own top bits ({@code 110xxxxx} = 1
   * more, {@code 1110xxxx} = 2 more, {@code 11110xxx} = 3 more). Walking
   * backward from the end for at most 3 bytes is always enough to find
   * either a complete sequence or the start of an incomplete one.
   */
  static byte[] trimIncompleteUtf8Suffix(byte[] bytes) {
    if (bytes.length == 0) {
      return bytes;
    }
    int i = bytes.length - 1;
    int back = 0;
    // Walk back over continuation bytes (10xxxxxx) only - at most 3, since
    // no valid UTF-8 sequence is longer than 4 bytes total.
    while (i >= 0 && back < 3 && (bytes[i] & 0xC0) == 0x80) {
      i--;
      back++;
    }
    if (i < 0) {
      // Every byte examined was a continuation byte with no lead byte in
      // range - the whole tail is malformed/incomplete; safest deterministic
      // behavior is to drop it rather than guess.
      return new byte[0];
    }
    int lead = bytes[i] & 0xFF;
    int expectedLength = expectedUtf8SequenceLength(lead);
    if (expectedLength == 1) {
      // The byte just before the continuation run is plain ASCII or itself
      // a continuation byte with no lead in range within our 3-byte
      // lookback - either way this is not a valid multi-byte lead, so the
      // continuation bytes found are not a legitimate sequence at all.
      // Complete as-is; trimIncompleteUtf8Suffix only ever removes a
      // genuinely truncated *trailing* sequence, never reinterprets
      // otherwise-valid content.
      return bytes;
    }
    int actualLength = bytes.length - i;
    return actualLength < expectedLength ? java.util.Arrays.copyOfRange(bytes, 0, i) : bytes;
  }

  /** 1 for a plain ASCII/continuation byte (not a valid multi-byte lead), otherwise the full sequence length a UTF-8 lead byte declares. */
  private static int expectedUtf8SequenceLength(int leadByte) {
    if ((leadByte & 0x80) == 0x00) {
      return 1; // ASCII
    }
    if ((leadByte & 0xE0) == 0xC0) {
      return 2;
    }
    if ((leadByte & 0xF0) == 0xE0) {
      return 3;
    }
    if ((leadByte & 0xF8) == 0xF0) {
      return 4;
    }
    return 1; // not a valid UTF-8 lead byte at all - treat as opaque/complete, nothing to trim
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
      // OS-1C review recovery - its own Kind, split out of NETWORK (a
      // timeout is "something answered too slowly," never "nothing is
      // listening there" - see Kind.TIMEOUT's own javadoc).
      return new OpenShiftApiException(Kind.TIMEOUT, "The cluster API did not respond in time.", error);
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
