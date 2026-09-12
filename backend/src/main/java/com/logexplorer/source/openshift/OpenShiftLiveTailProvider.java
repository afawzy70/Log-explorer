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
 * <h2>Initial tail vs. reconnect</h2>
 *
 * <p>A target's very first connection ({@code attempt == 0}) uses {@code
 * tailLines = initialTailLines} — small, bounded, historical pre-Live
 * context. <b>Every reconnect uses {@code tailLines = 0}</b> (the
 * well-established {@code kubectl logs -f --tail=0} idiom: "follow new
 * lines only, replay nothing") — never the initial tail value again, so a
 * reconnect can never re-deliver an already-emitted historical line.
 *
 * <h2>CONNECTING vs. ACTIVE vs. OUTAGE_RECOVERY (final implementation)</h2>
 *
 * <p>Two genuinely different questions, kept genuinely separate:
 *
 * <ul>
 *   <li><b>Is this target's stream currently ACTIVE?</b> Evidenced
 *   solely by {@link OpenShiftApiClient#followPodLog}'s {@code
 *   onEstablished} callback — fired the instant a {@code 2xx} response is
 *   observed, independent of whether any log line has arrived. A quiet
 *   pod is still a successfully connected live stream; requiring a log
 *   line as proof would misreport every idle-but-healthy target as
 *   forever "connecting." {@link #followTarget} never marks a target
 *   {@code ACTIVE} at its own entry (the defect the design closure
 *   found) — only this callback does.</li>
 *   <li><b>Has this target's bounded reconnect budget genuinely earned a
 *   reset?</b> A stricter question, answered only by {@link
 *   #budgetBasis} — {@code REAL_RECOVERY} requires an actual {@link
 *   DecodedLine} to have arrived during a reconnect attempt ({@code
 *   attempt > 0}, hence {@code tailLines=0}, hence provably
 *   non-replayed). A successful {@code 2xx} re-establishment alone does
 *   NOT reset the budget — a quiet, successfully-reconnected stream may
 *   be {@code ACTIVE} while its prior outage's budget remains
 *   un-reset; if it fails again before any genuine post-reconnect line
 *   arrives, the existing attempt count continues exactly where it left
 *   off. This is intentional (mission §8): a stream merely re-opening a
 *   TCP/HTTP connection repeatedly, without ever proving it can actually
 *   deliver a line, must not be treated as "recovered" for budgeting
 *   purposes, or {@code maxReconnectAttempts} would stop being a
 *   reliable bound again — this is exactly the class of defect the
 *   original {@code tailLines} bug caused, now prevented structurally by
 *   requiring genuine decoded content, not merely a successful
 *   handshake, for the budget-reset question specifically.</li>
 * </ul>
 *
 * <h2>Per-target reconnect, never a shared retry</h2>
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
 *   <li>{@link Kind#TLS} — explicitly classified, but deliberately NOT
 *   its own permanent-stop branch: this client cannot distinguish
 *   "permanently wrong/missing CA" from "a transient handshake hiccup"
 *   from the exception alone, and TLS verification is never weakened to
 *   find out (CLAUDE.md §2 rule 7). Falls through to the same bounded
 *   transient path, so a persistent TLS failure still reaches a real,
 *   bounded permanent stop — never an endless loop.</li>
 *   <li>Everything else (a clean stream end, network/timeout/proxy/
 *   malformed-response) — transient; bounded exponential-backoff
 *   reconnect up to {@link OpenShiftLiveProperties#getMaxReconnectAttempts()}.</li>
 * </ul>
 *
 * <h2>Connect-attempt concurrency</h2>
 *
 * <p>{@code DirectPodLogProperties#maxConcurrency} bounds how many of
 * this session's own targets may simultaneously be in the {@code
 * CONNECTING} admission phase — never how many may be simultaneously
 * {@code ACTIVE} (that would be {@code maxTargets}, already the fan-out
 * cap). Implemented as a per-session, non-blocking {@link Semaphore}
 * permit gate ({@link #acquirePermit}): a target polls for a free permit
 * (no thread ever blocks), and releases it the instant its follow request
 * is genuinely established ({@code onEstablished}), on any terminating
 * signal (error/completion/cancellation), or after {@link
 * OpenShiftLiveProperties#getConnectPermitTimeout()} elapses — whichever
 * is first — so a connection that is admitted but stuck never starves a
 * later target waiting to connect. <b>The timeout releases only the
 * admission permit; it never marks the target {@code ACTIVE}</b> — the
 * target remains {@code CONNECTING} until the real establishment signal
 * arrives or the attempt fails. This deliberately does NOT use {@code
 * flatMap(..., maxConcurrency)} over the target list: that operator only
 * releases a concurrency slot when its inner sequence terminates, and a
 * healthy live stream is intentionally infinite.
 *
 * <h2>Zero-active-target truthfulness</h2>
 *
 * <p>{@link #follow()}'s companion {@link LiveFollowResult#status()}
 * channel (see {@link SessionRuntimeState}) reports a full CURRENT
 * snapshot of every target's phase (connecting/active/reconnecting/
 * stopped) after every change — never only the most recently changed
 * target. When every resolved target has permanently stopped (or zero
 * targets were ever resolved), {@link LiveSourceStatus#state()} becomes
 * {@link LiveSourceStatus.State#NO_ACTIVE_TARGETS} (or {@link
 * LiveSourceStatus.State#EXPIRED} if a 401 was the cause) and the merged
 * event {@link Flux} completes — {@code LiveTailService} is responsible
 * for the terminal-SSE grace-close and for suppressing the frontend's
 * generic automatic reconnect once it observes a {@link
 * LiveSourceStatus.State#isTerminal()} state.
 *
 * <h2>Staleness — generation and scope changes</h2>
 *
 * <p>A lightweight, bounded periodic check (never a cluster/network call
 * — {@link OpenShiftLiveProperties#getStalenessCheckInterval()}, reading
 * only already-in-memory {@link OpenShiftSession} state) detects two
 * conditions and marks the session {@link LiveSourceStatus.State#STALE},
 * terminating every target stream, if either becomes true: (a) {@code
 * session.generation()} no longer matches the generation captured at
 * session start, or (b) the selected project/workload/pod/container this
 * session's immutable target snapshot was built from no longer matches
 * the session's CURRENT selection. Neither condition ever migrates this
 * session onto new credentials or a new target set — a stale session
 * only ever stops itself; an explicit new {@link #follow()} call
 * (Restart) is required to pick up the current state — no automatic
 * {@code EventSource} reconnect is permitted to silently re-enter a
 * different scope (mission §16, final owner decision).
 *
 * <h2>Partial-final-line truthfulness</h2>
 *
 * <p>See {@link OpenShiftApiClient#decodeLines}'s own javadoc for the
 * full clean-EOF-vs-error-vs-cancellation contract. This class only
 * needs to wire the two resulting signals into {@link SessionRuntimeState}:
 * a clean-EOF unterminated fragment flows through as an ordinary {@link
 * DecodedLine} (becoming a real {@link CanonicalLogEvent}, since it is
 * genuine content — just not confirmed complete), counted via {@link
 * SessionRuntimeState#incrementUnterminated}; a transport-error-dropped
 * fragment never becomes an event at all, counted via {@link
 * SessionRuntimeState#incrementPartialDropped}. An intentional
 * cancellation (Stop/disconnect) reports neither — expected, not a
 * truthfulness concern.
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
        // The first configured initialTailLines are historical pre-Live
        // context, never proof those events occurred after Start. A
        // one-time status notice, never per-event metadata (kept
        // minimal, non-cluttering) - and never repeated on reconnect,
        // since reconnects use tailLines=0 and therefore carry no
        // historical replay at all.
        extraWarnings.add("Initial tail may include up to " + liveProperties.getInitialTailLines()
            + " event(s) per target that occurred before Live started (INITIAL_TAIL_NOT_LIVE_PROOF).");
      }
    }

    // Seeded to CONNECTING for every resolved target before the first
    // status snapshot is ever pushed - without this, a session's very
    // first (synchronous, constructor-time) push would otherwise show
    // connecting=0/active=0/reconnecting=0/stopped=0, which the state
    // formula would misread as NO_ACTIVE_TARGETS (a session that just
    // started, before any target has even been attempted, is not the
    // same truth as "every target has permanently stopped").
    SessionRuntimeState state = new SessionRuntimeState(targets, extraWarnings, statusSink);

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
   * Reads only already-in-memory {@link OpenShiftSession} state (never a
   * cluster/network call). Returns a human-readable, safe reason the
   * moment either the connection generation or the selected project/
   * workload/pod/container this session's immutable snapshot was built
   * from has changed, or {@code null} while both remain exactly as
   * captured.
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
   * OS-1E reuse of {@code DirectPodLogProvider#resolveTargets} (live
   * target semantics must exactly match search's own Selected
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
    // Never marks ACTIVE here - only a real, evidence-backed 2xx
    // establishment signal (wired below via onEstablished) may do that.
    // Covers both "waiting for a connect-admission permit" and "permit
    // held, request issued, no 2xx yet" - both are equally "not yet
    // proven" (mission §3).
    state.markConnecting(target.targetKey());
    // Every reconnect (attempt > 0) uses tailLines=0 - see this class's
    // own javadoc "Initial tail vs. reconnect". Only the very first
    // attempt ever replays historical context.
    int tailLines = attempt == 0 ? liveProperties.getInitialTailLines() : 0;
    AtomicBoolean receivedRealDataThisAttempt = new AtomicBoolean(false);
    Runnable onEstablished = () -> state.markActive(target.targetKey());
    Runnable onPartialDroppedByError = () -> state.incrementPartialDropped(target.targetKey());
    return gatedFollow(server, token, caPath, namespace, target, tailLines, connectPermits, onEstablished, onPartialDroppedByError)
        .doOnNext(line -> {
          // OUTAGE_RECOVERY_BUDGET_RESET requires genuine decoded content,
          // deliberately NOT merely a successful 2xx (mission §8) - see
          // this class's own javadoc "CONNECTING vs. ACTIVE vs.
          // OUTAGE_RECOVERY" section for the full rationale.
          receivedRealDataThisAttempt.set(true);
          if (line.truncated()) {
            state.incrementOverlong(target.targetKey());
          }
          if (line.unterminated()) {
            state.incrementUnterminated(target.targetKey());
          }
        })
        .map(line -> toEvent(line.content(), namespace, target))
        .concatWith(Flux.defer(() -> reconnectOrStop(
            server, token, caPath, namespace, target, generation, state, connectPermits,
            budgetBasis(attempt, receivedRealDataThisAttempt), null)))
        .onErrorResume(error -> reconnectOrStop(
            server, token, caPath, namespace, target, generation, state, connectPermits,
            budgetBasis(attempt, receivedRealDataThisAttempt), error));
  }

  /**
   * {@code REAL_RECOVERY} definition (mission §8): the reconnect attempt
   * budget resets to 0 only when THIS attempt was itself a reconnect
   * ({@code attempt > 0}, which always used {@code tailLines=0}) AND it
   * actually delivered at least one decoded line — a guarantee that line
   * is genuinely new, never replayed history, and genuinely proves the
   * stream can deliver content (not merely complete a handshake). An
   * attempt-0 event (historical tail, {@code tailLines > 0}) never resets
   * anything (there is no budget to reset at {@code attempt == 0}
   * anyway).
   */
  private static int budgetBasis(int attempt, AtomicBoolean receivedRealDataThisAttempt) {
    return attempt > 0 && receivedRealDataThisAttempt.get() ? 0 : attempt;
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
          // See this class's own javadoc "Per-target reconnect" section:
          // explicitly classified, deliberately still bounded-transient
          // below, never an endless loop.
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

  // ------------------------------------------------------------ connect-attempt admission

  /**
   * Bounds how many of this session's targets may simultaneously be
   * {@code CONNECTING} — see this class's own javadoc for the full
   * rationale and why {@code flatMap(..., maxConcurrency)} is the wrong
   * tool here. Releases the permit the instant the follow request is
   * genuinely established ({@code onEstablished}), on any terminating
   * signal, or after {@link OpenShiftLiveProperties#getConnectPermitTimeout()},
   * whichever comes first — the timeout releases ONLY the permit, it
   * never calls {@code onEstablished}.
   */
  private Flux<DecodedLine> gatedFollow(
      URI server, RawToken token, String caPath, String namespace, PodLogTarget target, int tailLines,
      Semaphore connectPermits, Runnable onEstablished, Runnable onPartialDroppedByError) {
    return acquirePermit(connectPermits).thenMany(Flux.defer(() -> {
      AtomicBoolean permitReleased = new AtomicBoolean(false);
      Runnable releasePermitOnce = () -> {
        if (permitReleased.compareAndSet(false, true)) {
          connectPermits.release();
        }
      };
      Disposable timeoutTimer = Mono.delay(liveProperties.getConnectPermitTimeout())
          .subscribe(tick -> releasePermitOnce.run());
      Runnable onEstablishedReleasingPermit = () -> {
        // A real, evidence-backed 2xx is exactly the moment this
        // admission attempt has succeeded - the permit is no longer
        // needed the instant the target has its own genuine connection
        // (mission §6). Distinct from the timeout branch above, which
        // releases the SAME permit without ever calling onEstablished.
        releasePermitOnce.run();
        onEstablished.run();
      };
      return client
          .followPodLog(
              server, token, caPath, namespace, target.podName(), target.containerName(), tailLines,
              liveProperties.getMaxLineBytes(), onEstablishedReleasingPermit, onPartialDroppedByError)
          .doFinally(signalType -> {
            releasePermitOnce.run();
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

  // ------------------------------------------------------------ runtime status

  /**
   * The CURRENT, cumulative truth of one live session's own targets —
   * every mutator recomputes and pushes a full {@link LiveSourceStatus}
   * snapshot (never an incremental delta), so a caller sampling only the
   * latest emission (exactly what {@code LiveTailService}'s heartbeat
   * does) always reflects every target's current phase, not merely
   * whichever one most recently changed. Entirely request/session-scoped
   * — instantiated fresh per {@link #follow()} call, never a field on
   * {@link OpenShiftLiveTailProvider} itself (which is a singleton bean)
   * — so two concurrent Live sessions never observe each other's target
   * health.
   */
  private static final class SessionRuntimeState {
    private enum TargetPhase { CONNECTING, ACTIVE, RECONNECTING, STOPPED }

    private final int resolvedTargets;
    private final List<String> extraWarnings;
    private final Sinks.Many<LiveSourceStatus> statusSink;
    private final Map<String, TargetPhase> phases = new ConcurrentHashMap<>();
    private final Map<String, String> stopReasons = new ConcurrentHashMap<>();
    private final AtomicLong overlongLineCount = new AtomicLong();
    private final AtomicLong unterminatedLineCount = new AtomicLong();
    private final AtomicLong partialLineDroppedCount = new AtomicLong();
    private final AtomicBoolean sessionExpired = new AtomicBoolean(false);
    private final AtomicReference<String> staleReason = new AtomicReference<>();

    /**
     * Seeds every resolved target's phase to {@code CONNECTING} before
     * the first {@link #push()} — without this, the very first snapshot
     * (before any target has even started its first attempt) would show
     * every count at zero, which the state-derivation formula would
     * misread as {@code NO_ACTIVE_TARGETS} ("every target permanently
     * stopped") rather than the truthful "every target is about to
     * start."
     */
    SessionRuntimeState(List<PodLogTarget> targets, List<String> extraWarnings, Sinks.Many<LiveSourceStatus> statusSink) {
      this.resolvedTargets = targets.size();
      this.extraWarnings = List.copyOf(extraWarnings);
      this.statusSink = statusSink;
      for (PodLogTarget target : targets) {
        phases.put(target.targetKey(), TargetPhase.CONNECTING);
      }
      push();
    }

    void markConnecting(String targetKey) {
      if (phases.put(targetKey, TargetPhase.CONNECTING) != TargetPhase.CONNECTING) {
        push();
      }
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
     * Overlong-line truncation is reported as one bounded, growing COUNT
     * ("N overlong lines truncated"), never one new warning string per
     * occurrence, so a pathological stream cannot flood this session's
     * own status with repeated identical entries.
     */
    void incrementOverlong(String targetKey) {
      overlongLineCount.incrementAndGet();
      push();
    }

    /** Mission §12/§13/§26-A — a clean-EOF unterminated final fragment, one bounded count, not one string per occurrence. */
    void incrementUnterminated(String targetKey) {
      unterminatedLineCount.incrementAndGet();
      push();
    }

    /** Mission §12/§26-B — a transport-error-dropped buffered fragment, one bounded count, not one string per occurrence. */
    void incrementPartialDropped(String targetKey) {
      partialLineDroppedCount.incrementAndGet();
      push();
    }

    private void push() {
      statusSink.tryEmitNext(snapshot());
    }

    private LiveSourceStatus snapshot() {
      int connecting = count(TargetPhase.CONNECTING);
      int active = count(TargetPhase.ACTIVE);
      int reconnecting = count(TargetPhase.RECONNECTING);
      int stopped = count(TargetPhase.STOPPED);

      List<String> warnings = new ArrayList<>(extraWarnings);
      warnings.addAll(stopReasons.values());
      appendBoundedCount(warnings, overlongLineCount.get(), "overlong log line",
          "truncated to the configured limit (LIVE_LINE_TRUNCATED).");
      appendBoundedCount(warnings, unterminatedLineCount.get(), "live stream ending",
          "left a final line without its own terminator (UNTERMINATED_LIVE_LINE).");
      appendBoundedCount(warnings, partialLineDroppedCount.get(), "buffered partial line",
          "was lost to a transport failure before it could complete (PARTIAL_LINE_DROPPED).");

      // Priority order below is the mission's own exact formula, with one
      // documented, necessary completion: the mission's literal
      // CONNECTING rule additionally required stopped==0, which leaves a
      // real, reachable combination unhandled (some targets already
      // permanently stopped on their very first attempt - e.g. an
      // immediate 403 - while OTHER targets in the same session are
      // still connecting, none ever active or reconnecting). That
      // combination is resolved to CONNECTING here too: the session's
      // outcome is not yet fully known either way, so "still connecting"
      // remains the more truthful label than a fallback DEGRADED (which
      // would falsely imply something is currently active) or
      // NO_ACTIVE_TARGETS (which would falsely imply nothing further
      // could ever come online). Every explicitly-named example in the
      // mission's own worked table produces an identical result under
      // this formula - this closes a genuine gap, it does not change any
      // specified outcome.
      LiveSourceStatus.State state;
      String stale = staleReason.get();
      if (stale != null) {
        warnings.add(0, stale);
        state = LiveSourceStatus.State.STALE;
      } else if (sessionExpired.get()) {
        state = LiveSourceStatus.State.EXPIRED;
      } else if (resolvedTargets > 0 && active == resolvedTargets) {
        state = LiveSourceStatus.State.RUNNING;
      } else if (active > 0) {
        state = LiveSourceStatus.State.DEGRADED;
      } else if (reconnecting > 0) {
        state = LiveSourceStatus.State.RECONNECTING;
      } else if (connecting > 0) {
        state = LiveSourceStatus.State.CONNECTING;
      } else {
        state = LiveSourceStatus.State.NO_ACTIVE_TARGETS;
      }
      return new LiveSourceStatus(state, resolvedTargets, connecting, active, reconnecting, stopped, warnings);
    }

    private static void appendBoundedCount(List<String> warnings, long count, String noun, String suffix) {
      if (count > 0) {
        warnings.add(count + " " + noun + (count == 1 ? "" : "s") + " " + suffix);
      }
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
