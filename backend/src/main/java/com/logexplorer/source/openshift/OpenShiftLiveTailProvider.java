package com.logexplorer.source.openshift;

import com.logexplorer.config.DirectPodLogProperties;
import com.logexplorer.config.OpenShiftLiveProperties;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.LiveFollowResult;
import com.logexplorer.core.model.RawToken;
import com.logexplorer.core.parse.LogLineParser;
import com.logexplorer.source.openshift.OpenShiftApiException.Kind;
import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.publisher.Sinks;

/**
 * OS-1E — direct OpenShift live tail: resolves the current OS-1B scope
 * into the exact same bounded (pod, container) target set {@link
 * DirectPodLogProvider} already computes for search, opens one {@code
 * follow=true} Kubernetes pod-log stream per target via {@link
 * OpenShiftApiClient#followPodLog}, and merges them into one {@link
 * CanonicalLogEvent} stream — reusing the existing generic Live
 * transport/reconnect/lifecycle/masking/buffering architecture end to end
 * ({@code LiveTailController}/{@code LiveTailService}/{@code
 * LiveTailGuard}) rather than building an OpenShift-specific product.
 *
 * <h2>One atomic snapshot per live session (mission §6)</h2>
 *
 * <p>{@link #follow()} calls {@link OpenShiftSession#operationSnapshot()}
 * exactly once, at subscribe time, and every field this class uses for
 * the lifetime of the session — server, token, CA path, namespace, and
 * the resolved target set itself — comes from that one snapshot. A
 * reconnect/project switch/scope change after Live has started has no
 * effect on an already-running session (mission §21 "{@code
 * LIVE_TARGET_SNAPSHOT=IMMUTABLE}"): new replicas from a rolling
 * deployment are deliberately NOT auto-attached, and a stale/expired
 * connection is never silently migrated onto a fresh token — the session
 * degrades and reports why instead.
 *
 * <h2>Per-target reconnect, never a shared retry (mission §18/§39)</h2>
 *
 * <p>Each (pod, container) target owns its own bounded-backoff reconnect
 * loop, independent of every other target — one pod dying or one 403 never
 * stops the others. A target's stream ending (cleanly or with an error) is
 * classified via the same {@link OpenShiftApiException.Kind} {@link
 * DirectPodLogProvider} already uses:
 *
 * <ul>
 *   <li>{@link Kind#UNAUTHORIZED} (401) — the whole connection's token is
 *   gone; this target stops permanently and, generation-guarded exactly
 *   like {@code DirectPodLogProvider}'s own 401 handling, expires the
 *   live {@link OpenShiftSession} (never a stale re-read — the {@code
 *   generation} captured at session start, never {@code
 *   session.generation()} re-read fresh here).</li>
 *   <li>{@link Kind#FORBIDDEN} (403) / {@link Kind#NOT_FOUND} (404) — this
 *   target stops permanently; the permission or existence truth has
 *   already been established and reconnecting cannot change it.</li>
 *   <li>Everything else (a clean stream end, network/timeout/TLS/proxy/
 *   malformed-response) — transient; bounded exponential-backoff
 *   reconnect up to {@link OpenShiftLiveProperties#getMaxReconnectAttempts()},
 *   then this target also stops permanently.</li>
 * </ul>
 *
 * <p>Every permanent stop is reported once, truthfully, on {@link
 * #warnings} — never silently. When every target has permanently
 * stopped, the merged event stream completes (mission §22 "a zero-target
 * session moves to an explicit non-LIVE state, never a quiet LIVE") —
 * {@code LiveTailService}'s existing heartbeat/status channel keeps the
 * SSE connection itself alive so the frontend can render that truth
 * rather than the connection simply vanishing.
 */
@Component
public class OpenShiftLiveTailProvider {

  private static final String SOURCE_ID = "openshift";

  private final OpenShiftApiClient client;
  private final OpenShiftSession session;
  private final LogLineParser parser;
  private final DirectPodLogProvider directPodLogProvider;
  private final DirectPodLogProperties searchProperties;
  private final OpenShiftLiveProperties liveProperties;

  public OpenShiftLiveTailProvider(
      OpenShiftApiClient client,
      OpenShiftSession session,
      LogLineParser parser,
      DirectPodLogProvider directPodLogProvider,
      DirectPodLogProperties searchProperties,
      OpenShiftLiveProperties liveProperties) {
    this.client = client;
    this.session = session;
    this.parser = parser;
    this.directPodLogProvider = directPodLogProvider;
    this.searchProperties = searchProperties;
    this.liveProperties = liveProperties;
  }

  /**
   * Starts one live session. Deferred so the atomic snapshot capture
   * happens at subscribe time (when {@code LiveTailService} actually
   * starts the SSE connection), never when this method is merely called.
   */
  public LiveFollowResult follow() {
    Sinks.Many<List<String>> warningsSink = Sinks.many().multicast().onBackpressureBuffer();
    Flux<CanonicalLogEvent> events = Flux.defer(() -> startSession(warningsSink));
    return new LiveFollowResult(events, warningsSink.asFlux());
  }

  private Flux<CanonicalLogEvent> startSession(Sinks.Many<List<String>> warningsSink) {
    ConnectionOperationSnapshot connection = session.operationSnapshot();
    DirectPodLogProvider.requireConnectedWithSelectedProject(connection);
    long generation = connection.generation();
    URI server = connection.server();
    RawToken token = connection.token();
    String caPath = connection.certificateAuthorityPath();
    String namespace = connection.selectedProject();
    OpenShiftScope scope = connection.scope();

    List<PodLogTarget> targets = boundedTargets(scope, namespace);
    if (targets.isEmpty()) {
      emitWarning(warningsSink, "No pods are currently in scope to tail (NO_LIVE_TARGETS) — "
          + "select a pod/workload with at least one matching pod, or start Live again after scope changes.");
      return Flux.empty();
    }
    if (targets.size() < scope.pods().size() && scope.selectedPod() == null) {
      // Mirrors DirectPodLogProvider#describeScopeWarnings' own
      // TARGET_CAP_REACHED truth for search - a live session must be
      // equally honest about a capped fan-out, not just a search result.
      emitWarning(warningsSink, "Only " + targets.size() + " pod/container target"
          + (targets.size() == 1 ? "" : "s") + " are being tailed live; the resolved scope was larger and was "
          + "capped (TARGET_CAP_REACHED).");
    }

    Map<String, Flux<CanonicalLogEvent>> perTarget = new LinkedHashMap<>();
    for (PodLogTarget target : targets) {
      perTarget.put(
          target.targetKey(),
          followTarget(server, token, caPath, namespace, target, generation, warningsSink, 0));
    }
    return Flux.merge(perTarget.values());
  }

  /**
   * OS-1E reuse of {@code DirectPodLogProvider#resolveTargets} (mission
   * §5 — live target semantics must exactly match search's own Selected
   * Pod+Container / Pod+Container=All / Pod=All+Workload /
   * Pod=All+Workload=All resolution), deduplicated and capped by {@code
   * maxTargets} exactly like {@code resolveTargetPlan} does for search —
   * {@code maxPods} is already applied inside {@code resolveTargets}
   * itself.
   */
  private List<PodLogTarget> boundedTargets(OpenShiftScope scope, String namespace) {
    List<PodLogTarget> resolved = directPodLogProvider.resolveTargets(scope, namespace);
    Map<String, PodLogTarget> deduped = new LinkedHashMap<>();
    for (PodLogTarget target : resolved) {
      deduped.putIfAbsent(target.targetKey(), target);
    }
    List<PodLogTarget> all = List.copyOf(deduped.values());
    return all.size() > searchProperties.getMaxTargets() ? all.subList(0, searchProperties.getMaxTargets()) : all;
  }

  // ------------------------------------------------------------ per-target follow + reconnect

  private Flux<CanonicalLogEvent> followTarget(
      URI server, RawToken token, String caPath, String namespace, PodLogTarget target, long generation,
      Sinks.Many<List<String>> warningsSink, int attempt) {
    // Resets the bounded reconnect budget back to 0 the moment this
    // attempt actually delivers at least one real event - a target that
    // has been streaming healthily for an hour and then hits one fresh
    // disconnect must not inherit an already-exhausted attempt count from
    // reconnects that happened long before, or it would give up on a
    // brand new, unrelated outage (mission §18's own bounded-reconnect-
    // per-outage intent, not bounded-reconnects-for-the-whole-session).
    AtomicBoolean receivedAnyEvent = new AtomicBoolean(false);
    return client
        .followPodLog(
            server, token, caPath, namespace, target.podName(), target.containerName(),
            liveProperties.getInitialTailLines(), liveProperties.getMaxLineBytes())
        .doOnNext(rawLine -> receivedAnyEvent.set(true))
        .map(rawLine -> toEvent(rawLine, namespace, target))
        .concatWith(Flux.defer(() -> reconnectOrStop(
            server, token, caPath, namespace, target, generation, warningsSink,
            receivedAnyEvent.get() ? 0 : attempt, null)))
        .onErrorResume(error -> reconnectOrStop(
            server, token, caPath, namespace, target, generation, warningsSink,
            receivedAnyEvent.get() ? 0 : attempt, error));
  }

  private Flux<CanonicalLogEvent> reconnectOrStop(
      URI server, RawToken token, String caPath, String namespace, PodLogTarget target, long generation,
      Sinks.Many<List<String>> warningsSink, int attempt, Throwable error) {
    if (error instanceof OpenShiftApiException apiException) {
      switch (apiException.kind()) {
        case UNAUTHORIZED -> {
          // Generation-guarded exactly like DirectPodLogProvider's own
          // 401 handling - only expires the CURRENT live session, never
          // decides what this target authorized/executed against (that
          // was already the captured `generation`, never re-read here).
          if (session.generation() == generation) {
            session.markExpired();
          }
          stopPermanently(warningsSink, target, "the OpenShift session has expired (401)");
          return Flux.empty();
        }
        case FORBIDDEN -> {
          stopPermanently(warningsSink, target, "no longer permitted to read this pod/container (403)");
          return Flux.empty();
        }
        case NOT_FOUND -> {
          stopPermanently(warningsSink, target, "the pod or container no longer exists (404)");
          return Flux.empty();
        }
        default -> {
          // Transient - falls through to the bounded reconnect below.
        }
      }
    }
    int nextAttempt = attempt + 1;
    if (nextAttempt > liveProperties.getMaxReconnectAttempts()) {
      stopPermanently(
          warningsSink, target,
          "gave up reconnecting after " + liveProperties.getMaxReconnectAttempts() + " attempt"
              + (liveProperties.getMaxReconnectAttempts() == 1 ? "" : "s"));
      return Flux.empty();
    }
    Duration delay = backoffDelay(nextAttempt);
    return Mono.delay(delay)
        .thenMany(Flux.defer(() ->
            followTarget(server, token, caPath, namespace, target, generation, warningsSink, nextAttempt)));
  }

  private Duration backoffDelay(int attempt) {
    long initialMillis = liveProperties.getInitialReconnectDelay().toMillis();
    long maxMillis = liveProperties.getMaxReconnectDelay().toMillis();
    long scaled = initialMillis * (1L << Math.min(attempt - 1, 30));
    return Duration.ofMillis(Math.min(scaled, maxMillis));
  }

  private void stopPermanently(Sinks.Many<List<String>> warningsSink, PodLogTarget target, String reason) {
    emitWarning(warningsSink, describeTarget(target) + " stopped — " + reason + " (LIVE_TARGET_STOPPED).");
  }

  private static String describeTarget(PodLogTarget target) {
    return "Pod " + target.podName() + " / container " + target.containerName();
  }

  private void emitWarning(Sinks.Many<List<String>> warningsSink, String warning) {
    warningsSink.tryEmitNext(List.of(warning));
  }

  // ------------------------------------------------------------ parse

  private CanonicalLogEvent toEvent(String rawLine, String namespace, PodLogTarget target) {
    Instant sourceTimestamp = DirectPodLogProvider.extractTimestamp(rawLine, Instant.now());
    String content = DirectPodLogProvider.stripTimestamp(rawLine);
    String serviceHint = target.workload() != null ? target.workload().name() : null;
    return parser.parse(content, serviceHint).toBuilder()
        .sourceId(SOURCE_ID)
        .namespace(namespace)
        .pod(target.podName())
        .containerName(target.containerName())
        .sourceTimestamp(sourceTimestamp)
        .build();
  }
}
