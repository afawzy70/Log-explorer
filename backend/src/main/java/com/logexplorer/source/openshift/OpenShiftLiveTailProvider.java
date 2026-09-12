package com.logexplorer.source.openshift;

import com.logexplorer.config.DirectPodLogProperties;
import com.logexplorer.config.OpenShiftLiveProperties;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.LiveFollowResult;
import com.logexplorer.core.model.LiveSourceStatus;
import com.logexplorer.core.model.RawToken;
import com.logexplorer.core.parse.LogLineParser;
import com.logexplorer.source.openshift.OpenShiftApiClient.DecodedLine;
import com.logexplorer.source.openshift.OpenShiftApiException.Kind;
import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import org.springframework.stereotype.Component;
import reactor.core.Disposable;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.publisher.Sinks;
import reactor.util.retry.Retry;

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
 * the resolved target set itself — comes from that one snapshot.
 *
 * <h2>OS-1E review recovery — initial tail vs. reconnect (mission §1/§2/§3)</h2>
 *
 * <p>A target's very first connection ({@code attempt == 0}) uses {@code
 * tailLines = initialTailLines} — small, bounded, historical pre-Live
 * context (mission §18). <b>Every reconnect uses {@code tailLines = 0}</b>
 * (the well-established {@code kubectl logs -f --tail=0} idiom: "follow
 * new lines only, replay nothing") — never the initial tail value again.
 * This closes a real defect the first implementation had: reusing {@code
 * initialTailLines} on every reconnect could re-deliver the same
 * already-emitted historical line(s), which kept marking the reconnect
 * budget as "recovered" and made {@code maxReconnectAttempts} an
 * unreliable bound. Because a reconnect can now never replay history,
 * <b>any event received during a reconnect attempt is definitionally a
 * genuine, new, post-reconnect event</b> — this is this class's own
 * {@code REAL_RECOVERY} definition, and it is what the reconnect attempt
 * budget resets on (never on an attempt-0 historical event, and never
 * merely because "some data arrived" without that guarantee).
 *
 * <h2>Per-target reconnect, never a shared retry (mission §18/§22/§39)</h2>
 *
 * <p>Each (pod, container) target owns its own bounded-backoff reconnect
 * loop, independent of every other target. A target's stream ending
 * (cleanly or with an error) is classified via the same {@link
 * OpenShiftApiException.Kind} {@link DirectPodLogProvider} already uses:
 *
 * <ul>
 *   <li>{@link Kind#UNAUTHORIZED} (401) — permanent stop, generation-
 *   guarded session expiry.</li>
 *   <li>{@link Kind#FORBIDDEN} (403) / {@link Kind#NOT_FOUND} (404) —
 *   permanent stop; the truth is already established.</li>
 *   <li>{@link Kind#TLS} — explicitly classified (mission §23), but
 *   deliberately NOT its own permanent-stop branch: this client cannot
 *   distinguish "permanently wrong/missing CA" from "a transient
 *   handshake hiccup" from the exception alone, and TLS verification is
 *   never weakened to find out (CLAUDE.md §2 rule 7). Falls through to
 *   the same bounded transient path, so a persistent TLS failure still
 *   reaches a real, bounded permanent stop — never an endless loop.</li>
 *   <li>Everything else (a clean stream end, network/timeout/proxy/
 *   malformed-response) — transient; bounded exponential-backoff
 *   reconnect up to {@link OpenShiftLiveProperties#getMaxReconnectAttempts()}.</li>
 * </ul>
 *
 * <h2>Connect-attempt concurrency (mission §8/§9/§10)</h2>
 *
 * <p>{@code DirectPodLogProperties#maxConcurrency} bounds how many of
 * this session's own targets may simultaneously be in the "opening a
 * connection" admission phase — never how many may be simultaneously
 * ACTIVE (that would be {@code maxTargets}, already the fan-out cap).
 * Implemented as a per-session, non-blocking {@link Semaphore} permit
 * gate ({@link #acquirePermit}): a target polls for a free permit (no
 * thread ever blocks — see that method's own javadoc for why polling was
 * chosen over a blocking acquire), and releases it the moment its first
 * signal (data/error/completion) arrives, or after {@link
 * OpenShiftLiveProperties#getConnectPermitTimeout()} elapses, whichever
 * is first — so a connection that is genuinely established but simply
 * idle never holds its permit forever and starves a later target waiting
 * to connect. This deliberately does NOT use {@code flatMap(...,
 * maxConcurrency)} over the target list: that operator only releases a
 * concurrency slot when its inner sequence terminates, and a healthy live
 * stream is intentionally infinite — the first {@code maxConcurrency}
 * targets would run forever and every later target would never start.
 *
 * <h2>Zero-active-target truthfulness (mission §11/§14/§22)</h2>
 *
 * <p>{@link #follow()}'s companion {@link LiveFollowResult#status()}
 * channel (see {@link SessionRuntimeState}) reports a full CURRENT
 * snapshot of every target's phase (active/reconnecting/stopped) after
 * every change — never only the most recently changed target's own
 * warning. When every resolved target has permanently stopped (or zero
 * targets were ever resolved), {@link LiveSourceStatus#state()} becomes
 * {@link LiveSourceStatus.State#NO_ACTIVE_TARGETS} (or {@link
 * LiveSourceStatus.State#EXPIRED} if a 401 was the cause) and the merged
 * event {@link Flux} completes — the frontend is responsible for no
 * longer displaying a plain LIVE badge once it observes that state (mission
 * §14), even though {@code LiveTailService}'s own heartbeat keeps the SSE
 * connection itself open to deliver that final truth.
 *
 * <h2>Staleness — generation and scope changes (mission §16/§17)</h2>
 *
 * <p>A lightweight, bounded periodic check (never a cluster/network call
 * — {@link OpenShiftLiveProperties#getStalenessCheckInterval()}, reading
 * only already-in-memory {@link OpenShiftSession} state) detects two
 * conditions and marks the session {@link LiveSourceStatus.State#STALE},
 * terminating every target stream, if either becomes true: (a) {@code
 * session.generation()} no longer matches the generation captured at
 * session start (a reconnect replaced the connection this session was
 * using), or (b) the selected project/workload/pod/container this
 * session's immutable target snapshot was built from no longer matches
 * the session's CURRENT selection (the user changed scope while this
 * session kept following its old, now-superseded target set). Neither
 * condition ever migrates this session onto new credentials or a new
 * target set — a stale session only ever stops itself; a fresh {@link
 * #follow()} call is required to pick up the current state.
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
    Sinks.Many<LiveSourceStatus> statusSink = Sinks.many().replay().limit(1);
    Flux<CanonicalLogEvent> events = Flux.defer(() -> startSession(statusSink));
    return new LiveFollowResult(events, statusSink.asFlux());
  }

  private Flux<CanonicalLogEvent> startSession(Sinks.Many<LiveSourceStatus> statusSink) {
    ConnectionOperationSnapshot connection = session.operationSnapshot();
    DirectPodLogProvider.requireConnectedWithSelectedProject(connection);
    long generation = connection.generation();
    URI server = connection.server();
    RawToken token = connection.token();
    String caPath = connection.certificateAuthorityPath();
    String namespace = connection.selectedProject();
    OpenShiftScope scope = connection.scope();

    List<PodLogTarget> targets = boundedTargets(scope, namespace);

    List<String> extraWarnings = new ArrayList<>();
    if (targets.isEmpty()) {
      extraWarnings.add("No pods are currently in scope to tail (NO_LIVE_TARGETS) — select a pod/workload with "
          + "at least one matching pod, or start Live again after scope changes.");
    } else {
      if (targets.size() < scope.pods().size() && scope.selectedPod() == null) {
        // Mirrors DirectPodLogProvider#describeScopeWarnings' own
        // TARGET_CAP_REACHED truth for search - a live session must be
        // equally honest about a capped fan-out, not just a search result.
        extraWarnings.add("Only " + targets.size() + " pod/container target"
            + (targets.size() == 1 ? "" : "s") + " are being tailed live; the resolved scope was larger and was "
            + "capped (TARGET_CAP_REACHED).");
      }
      if (liveProperties.getInitialTailLines() > 0) {
        // Mission §18 - the first configured initialTailLines are
        // historical pre-Live context, never proof those events occurred
        // after Start. A one-time status notice, never per-event
        // metadata (kept minimal, non-cluttering) - and never repeated
        // on reconnect, since reconnects use tailLines=0 and therefore
        // carry no historical replay at all.
        extraWarnings.add("Initial tail may include up to " + liveProperties.getInitialTailLines()
            + " event(s) per target that occurred before Live started (INITIAL_TAIL_NOT_LIVE_PROOF).");
      }
    }

    SessionRuntimeState state = new SessionRuntimeState(targets.size(), extraWarnings, statusSink);

    if (targets.isEmpty()) {
      return Flux.empty();
    }

    Semaphore connectPermits = new Semaphore(Math.max(1, searchProperties.getMaxConcurrency()));

    Map<String, Flux<CanonicalLogEvent>> perTarget = new LinkedHashMap<>();
    for (PodLogTarget target : targets) {
      perTarget.put(
          target.targetKey(),
          followTarget(server, token, caPath, namespace, target, generation, state, connectPermits, 0));
    }

    Mono<Long> staleSignal = Flux.interval(liveProperties.getStalenessCheckInterval())
        .filter(tick -> {
          String reason = detectStaleness(generation, namespace, scope);
          if (reason != null) {
            state.markStale(reason);
            return true;
          }
          return false;
        })
        .next();

    return Flux.merge(perTarget.values()).takeUntilOther(staleSignal);
  }

  /**
   * Mission §16/§17 — reads only already-in-memory {@link
   * OpenShiftSession} state (never a cluster/network call). Returns a
   * human-readable, safe reason the moment either the connection
   * generation or the selected project/workload/pod/container this
   * session's immutable snapshot was built from has changed, or {@code
   * null} while both remain exactly as captured.
   */
  private String detectStaleness(long capturedGeneration, String capturedNamespace, OpenShiftScope capturedScope) {
    if (session.generation() != capturedGeneration) {
      return "This Live session's OpenShift connection was replaced (reconnected) after Live started — restart "
          + "Live to use the current connection (STALE_CONNECTION).";
    }
    if (!Objects.equals(session.selectedProject(), capturedNamespace)) {
      return "The selected project changed after this Live session started — restart Live to follow the current "
          + "scope (SCOPE_CHANGED_RESTART_LIVE).";
    }
    OpenShiftScope current = session.scope();
    if (!Objects.equals(current.selectedWorkload(), capturedScope.selectedWorkload())
        || !Objects.equals(current.selectedPod(), capturedScope.selectedPod())
        || !Objects.equals(current.selectedContainer(), capturedScope.selectedContainer())) {
      return "The selected workload/pod/container changed after this Live session started — restart Live to "
          + "follow the current scope (SCOPE_CHANGED_RESTART_LIVE).";
    }
    return null;
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
      SessionRuntimeState state, Semaphore connectPermits, int attempt) {
    state.markActive(target.targetKey());
    // Every reconnect (attempt > 0) uses tailLines=0 - see this class's
    // own javadoc "initial tail vs. reconnect". Only the very first
    // attempt ever replays historical context.
    int tailLines = attempt == 0 ? liveProperties.getInitialTailLines() : 0;
    AtomicBoolean receivedAnyEvent = new AtomicBoolean(false);
    return gatedFollow(server, token, caPath, namespace, target, tailLines, connectPermits)
        .doOnNext(line -> {
          receivedAnyEvent.set(true);
          if (line.truncated()) {
            state.incrementOverlong(target.targetKey());
          }
        })
        .map(line -> toEvent(line.content(), namespace, target))
        .concatWith(Flux.defer(() -> reconnectOrStop(
            server, token, caPath, namespace, target, generation, state, connectPermits,
            budgetBasis(attempt, receivedAnyEvent), null)))
        .onErrorResume(error -> reconnectOrStop(
            server, token, caPath, namespace, target, generation, state, connectPermits,
            budgetBasis(attempt, receivedAnyEvent), error));
  }

  /**
   * OS-1E review recovery — {@code REAL_RECOVERY} definition (mission
   * §3/§4): the reconnect attempt budget resets to 0 only when THIS
   * attempt was itself a reconnect ({@code attempt > 0}, which always
   * used {@code tailLines=0}) AND it actually delivered at least one
   * event — a guarantee that event is genuinely new, never replayed
   * history. An attempt-0 event (historical tail, {@code tailLines >
   * 0}) never resets anything (there is no budget to reset at {@code
   * attempt == 0} anyway, so this is a documented no-op for that case,
   * never a place a future change could accidentally wire historical
   * data into a reset).
   */
  private static int budgetBasis(int attempt, AtomicBoolean receivedAnyEvent) {
    return attempt > 0 && receivedAnyEvent.get() ? 0 : attempt;
  }

  private Flux<CanonicalLogEvent> reconnectOrStop(
      URI server, RawToken token, String caPath, String namespace, PodLogTarget target, long generation,
      SessionRuntimeState state, Semaphore connectPermits, int attempt, Throwable error) {
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
          state.markExpired();
          stopPermanently(state, target, "the OpenShift session has expired (401)");
          return Flux.empty();
        }
        case FORBIDDEN -> {
          stopPermanently(state, target, "no longer permitted to read this pod/container (403)");
          return Flux.empty();
        }
        case NOT_FOUND -> {
          stopPermanently(state, target, "the pod or container no longer exists (404)");
          return Flux.empty();
        }
        case TLS -> {
          // Mission §23 - see this class's own javadoc "Per-target
          // reconnect" section: explicitly classified, deliberately
          // still bounded-transient below, never an endless loop.
        }
        default -> {
          // Transient (NETWORK/TIMEOUT/PROXY/MALFORMED_RESPONSE/UPSTREAM_UNAVAILABLE) - bounded reconnect below.
        }
      }
    }
    int nextAttempt = attempt + 1;
    if (nextAttempt > liveProperties.getMaxReconnectAttempts()) {
      stopPermanently(
          state, target,
          "gave up reconnecting after " + liveProperties.getMaxReconnectAttempts() + " attempt"
              + (liveProperties.getMaxReconnectAttempts() == 1 ? "" : "s"));
      return Flux.empty();
    }
    state.markReconnecting(target.targetKey());
    Duration delay = backoffDelay(nextAttempt);
    return Mono.delay(delay)
        .thenMany(Flux.defer(() ->
            followTarget(server, token, caPath, namespace, target, generation, state, connectPermits, nextAttempt)));
  }

  private Duration backoffDelay(int attempt) {
    long initialMillis = liveProperties.getInitialReconnectDelay().toMillis();
    long maxMillis = liveProperties.getMaxReconnectDelay().toMillis();
    long scaled = initialMillis * (1L << Math.min(attempt - 1, 30));
    return Duration.ofMillis(Math.min(scaled, maxMillis));
  }

  private void stopPermanently(SessionRuntimeState state, PodLogTarget target, String reason) {
    state.markStopped(target.targetKey(), describeTarget(target) + " stopped — " + reason + " (LIVE_TARGET_STOPPED).");
  }

  private static String describeTarget(PodLogTarget target) {
    return "Pod " + target.podName() + " / container " + target.containerName();
  }

  // ------------------------------------------------------------ connect-attempt admission (mission §8/§9/§10)

  /**
   * Bounds how many of this session's targets may simultaneously be
   * "opening" — see this class's own javadoc for the full rationale and
   * why {@code flatMap(..., maxConcurrency)} is the wrong tool here.
   * Releases the permit on the first data/error/completion signal, or
   * after {@link OpenShiftLiveProperties#getConnectPermitTimeout()},
   * whichever comes first.
   */
  private Flux<DecodedLine> gatedFollow(
      URI server, RawToken token, String caPath, String namespace, PodLogTarget target, int tailLines,
      Semaphore connectPermits) {
    return acquirePermit(connectPermits).thenMany(Flux.defer(() -> {
      AtomicBoolean released = new AtomicBoolean(false);
      Runnable releaseOnce = () -> {
        if (released.compareAndSet(false, true)) {
          connectPermits.release();
        }
      };
      Disposable timeoutTimer = Mono.delay(liveProperties.getConnectPermitTimeout())
          .subscribe(tick -> releaseOnce.run());
      return client
          .followPodLog(
              server, token, caPath, namespace, target.podName(), target.containerName(), tailLines,
              liveProperties.getMaxLineBytes())
          .doOnNext(line -> releaseOnce.run())
          .doFinally(signalType -> {
            releaseOnce.run();
            timeoutTimer.dispose();
          });
    }));
  }

  /**
   * A small, cheap marker (no stack trace, no message) used only to drive
   * {@link Retry#filter}; never surfaced to a caller or logged.
   */
  private static final class PermitNotYetAvailable extends RuntimeException {
    PermitNotYetAvailable() {
      super(null, null, false, false);
    }
  }

  /**
   * Non-blocking permit admission, deliberately implemented as a bounded
   * poll rather than {@link Semaphore#acquire()} on a worker thread: a
   * blocking acquire would need to be interruptible to remain safely
   * cancellable (Stop, a stale session, the whole target giving up) and
   * hand-rolled interrupt-vs-cancellation handling around a raw blocking
   * call is exactly the kind of subtle concurrency bug this bound exists
   * to avoid introducing. A short fixed poll interval costs nothing here
   * — {@code maxTargets} is small (tens, not thousands) — and is trivially
   * correctly cancellable through Reactor's own standard mechanism.
   */
  private static Mono<Void> acquirePermit(Semaphore connectPermits) {
    return Mono.<Void>defer(() -> connectPermits.tryAcquire() ? Mono.empty() : Mono.error(new PermitNotYetAvailable()))
        .retryWhen(Retry.fixedDelay(Long.MAX_VALUE, Duration.ofMillis(25))
            .filter(PermitNotYetAvailable.class::isInstance));
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

  // ------------------------------------------------------------ runtime status (mission §12/§13/§20)

  /**
   * The CURRENT, cumulative truth of one live session's own targets —
   * every mutator recomputes and pushes a full {@link LiveSourceStatus}
   * snapshot (never an incremental delta), so a caller sampling only the
   * latest emission (exactly what {@code LiveTailService}'s heartbeat
   * does) always reflects every target's current phase, not merely
   * whichever one most recently changed (the defect the original
   * single-{@code List<String>}-slot warnings channel had). Entirely
   * request/session-scoped — instantiated fresh per {@link #follow()}
   * call, never a field on {@link OpenShiftLiveTailProvider} itself
   * (which is a singleton bean) — so two concurrent Live sessions never
   * observe each other's target health (mission §19).
   */
  private static final class SessionRuntimeState {
    private enum TargetPhase { ACTIVE, RECONNECTING, STOPPED }

    private final int resolvedTargets;
    private final List<String> extraWarnings;
    private final Sinks.Many<LiveSourceStatus> statusSink;
    private final Map<String, TargetPhase> phases = new ConcurrentHashMap<>();
    private final Map<String, String> stopReasons = new ConcurrentHashMap<>();
    private final AtomicLong overlongLineCount = new AtomicLong();
    private final AtomicBoolean sessionExpired = new AtomicBoolean(false);
    private final AtomicReference<String> staleReason = new AtomicReference<>();

    SessionRuntimeState(int resolvedTargets, List<String> extraWarnings, Sinks.Many<LiveSourceStatus> statusSink) {
      this.resolvedTargets = resolvedTargets;
      this.extraWarnings = List.copyOf(extraWarnings);
      this.statusSink = statusSink;
      push();
    }

    void markActive(String targetKey) {
      if (phases.put(targetKey, TargetPhase.ACTIVE) != TargetPhase.ACTIVE) {
        push();
      }
    }

    void markReconnecting(String targetKey) {
      if (phases.put(targetKey, TargetPhase.RECONNECTING) != TargetPhase.RECONNECTING) {
        push();
      }
    }

    void markStopped(String targetKey, String reason) {
      phases.put(targetKey, TargetPhase.STOPPED);
      stopReasons.put(targetKey, reason);
      push();
    }

    void markExpired() {
      if (sessionExpired.compareAndSet(false, true)) {
        push();
      }
    }

    void markStale(String reason) {
      if (staleReason.compareAndSet(null, reason)) {
        push();
      }
    }

    /**
     * Mission §24/§6/§7 — overlong-line truncation is reported as one
     * bounded, growing COUNT ("N overlong lines truncated"), never one
     * new warning string per occurrence, so a pathological stream
     * cannot flood this session's own status with repeated identical
     * entries.
     */
    void incrementOverlong(String targetKey) {
      overlongLineCount.incrementAndGet();
      push();
    }

    private void push() {
      statusSink.tryEmitNext(snapshot());
    }

    private LiveSourceStatus snapshot() {
      int active = count(TargetPhase.ACTIVE);
      int reconnecting = count(TargetPhase.RECONNECTING);
      int stopped = count(TargetPhase.STOPPED);

      List<String> warnings = new ArrayList<>(extraWarnings);
      warnings.addAll(stopReasons.values());
      long overlong = overlongLineCount.get();
      if (overlong > 0) {
        warnings.add(overlong + " overlong log line" + (overlong == 1 ? "" : "s")
            + " truncated to the configured limit (LIVE_LINE_TRUNCATED).");
      }

      LiveSourceStatus.State state;
      String stale = staleReason.get();
      if (stale != null) {
        warnings.add(0, stale);
        state = LiveSourceStatus.State.STALE;
      } else if (sessionExpired.get()) {
        state = LiveSourceStatus.State.EXPIRED;
      } else if (resolvedTargets == 0) {
        state = LiveSourceStatus.State.NO_ACTIVE_TARGETS;
      } else if (active == resolvedTargets) {
        state = LiveSourceStatus.State.RUNNING;
      } else if (active == 0 && reconnecting == 0) {
        state = LiveSourceStatus.State.NO_ACTIVE_TARGETS;
      } else if (active == 0) {
        state = LiveSourceStatus.State.RECONNECTING;
      } else {
        state = LiveSourceStatus.State.DEGRADED;
      }
      return new LiveSourceStatus(state, resolvedTargets, active, reconnecting, stopped, warnings);
    }

    private int count(TargetPhase phase) {
      int n = 0;
      for (TargetPhase p : phases.values()) {
        if (p == phase) {
          n++;
        }
      }
      return n;
    }
  }
}
