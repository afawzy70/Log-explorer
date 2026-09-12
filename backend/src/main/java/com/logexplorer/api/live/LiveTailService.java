package com.logexplorer.api.live;

import com.logexplorer.api.EventMapper;
import com.logexplorer.config.LiveTailProperties;
import com.logexplorer.core.guard.GuardrailViolationException;
import com.logexplorer.core.guard.GuardrailViolationException.Reason;
import com.logexplorer.core.guard.LiveTailGuard;
import com.logexplorer.core.model.FollowRequest;
import com.logexplorer.core.model.LiveSourceStatus;
import com.logexplorer.source.LogSource;
import com.logexplorer.source.LogSourceRegistry;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.stereotype.Component;
import reactor.core.publisher.BufferOverflowStrategy;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.publisher.Sinks;

/**
 * Orchestrates one live tail (IMPLEMENTATION_PLAN.md "Phase J",
 * HANDOVER.md §18): resolve the source, reject outright if it doesn't
 * genuinely support live tail ("Do not fake it"), apply the concurrent-tail
 * cap, bound the per-connection server buffer with a dropped-count
 * counter, mask every event before it is ever emitted (the exact same
 * {@link EventMapper} every other endpoint uses — a single masking
 * boundary, never a second one for the streaming path), and enforce a
 * connection timeout. Every step is wrapped in {@link Flux#defer} so
 * validation failures surface as a normal {@code Flux} error on
 * subscription, not a thrown exception at call time — the same pattern
 * {@code api.SearchService} already established.
 */
@Component
public class LiveTailService {

  private final LogSourceRegistry registry;
  private final LiveTailGuard guard;
  private final LiveTailProperties properties;
  private final EventMapper eventMapper;

  public LiveTailService(
      LogSourceRegistry registry, LiveTailGuard guard, LiveTailProperties properties, EventMapper eventMapper) {
    this.registry = registry;
    this.guard = guard;
    this.properties = properties;
    this.eventMapper = eventMapper;
  }

  public Flux<ServerSentEvent<Object>> follow(String sourceId, List<String> services) {
    return follow(sourceId, services, null);
  }

  /** UX-R3 §9/§19 — {@code composeProject} threads the same request-scoped Compose boundary Search/Context/Journey already carry into Live. */
  public Flux<ServerSentEvent<Object>> follow(String sourceId, List<String> services, String composeProject) {
    return Flux.defer(() -> {
      LogSource source = registry.require(sourceId);
      if (!source.capabilities().liveTail()) {
        throw new GuardrailViolationException(
            Reason.LIVE_TAIL_NOT_SUPPORTED, "Live tail is not supported for source " + sourceId);
      }

      FollowRequest request = new FollowRequest(sourceId, services, composeProject);
      return source.followWithStatus(request).flatMapMany(result -> {
        AtomicLong droppedCount = new AtomicLong();
        // OS-1E — the most recent CURRENT snapshot from this exact
        // session's own status() channel (a full current snapshot on
        // every emission, never a delta), sampled once per heartbeat,
        // never once per event — a namespace with several reconnecting
        // targets must not flood the client with one status event per
        // transient condition. `LiveSourceStatus.NOMINAL` for every
        // source but OpenShift, whose default status() never changes it.
        AtomicReference<LiveSourceStatus> latestStatus = new AtomicReference<>(LiveSourceStatus.NOMINAL);

        Flux<ServerSentEvent<Object>> logEvents = result.events()
            // "Bounded buffers; backpressure with a dropped-count notice"
            // (HANDOVER.md §18.4) - a slow SSE consumer (or a burst from the
            // source) must never accumulate an unbounded backlog server-side;
            // the oldest buffered event is dropped instead, counted, and
            // reported via the periodic status event below.
            .onBackpressureBuffer(
                properties.getServerBufferSize(),
                dropped -> droppedCount.incrementAndGet(),
                BufferOverflowStrategy.DROP_OLDEST)
            // "Normalize and mask before emit" (HANDOVER.md §18.4) - the
            // exact same EventMapper/MaskingService boundary every other
            // endpoint (/search, /context, /journey) already uses.
            .map(event -> logEvent(eventMapper.toDto(event)));

        // OS-1E final implementation — terminal-SSE grace-close (mission
        // §19): once a status first becomes terminal (`LiveSourceStatus.State#isTerminal()`
        // — NO_ACTIVE_TARGETS/EXPIRED/STALE), no future work is possible
        // for this session (its target snapshot is immutable; a stale
        // session only ever stops itself). Holding the SSE connection
        // open until the full `connectionTimeout` (tens of minutes) would
        // waste a live socket for a session that can never produce
        // another event. `terminalCloseSignal` fires exactly ONCE, a
        // bounded `terminalGrace` after the first terminal status is
        // observed (long enough for that final status to actually reach
        // the browser), and `takeUntilOther` below completes the WHOLE
        // merged flux at that point - the status heartbeat included, so
        // the frontend's very last "status" event is guaranteed to carry
        // the terminal truth. `Sinks.Empty` (not a plain `Mono.delay`)
        // deliberately guarantees at-most-once firing even under
        // concurrent status emissions, without a separate guard flag.
        Duration terminalGrace = Duration.ofMillis(
            Math.min(2 * properties.getHeartbeatInterval().toMillis(), Duration.ofSeconds(10).toMillis()));
        Sinks.Empty<Void> terminalCloseSignal = Sinks.empty();
        AtomicBoolean terminalTimerStarted = new AtomicBoolean(false);

        // Subscribed alongside logEvents/status (via the merge below) so
        // its lifecycle - cancellation on client disconnect/Stop included
        // - is the SAME lifecycle as the rest of this SSE connection,
        // never a separately-forgotten subscription. Emits no SSE event
        // of its own; it only updates latestStatus as a side effect and
        // arms the terminal-close timer (once) when appropriate.
        Flux<ServerSentEvent<Object>> statusTracker = result.status()
            .doOnNext(latestStatus::set)
            .doOnNext(status -> {
              if (status.state().isTerminal() && terminalTimerStarted.compareAndSet(false, true)) {
                Mono.delay(terminalGrace).subscribe(tick -> terminalCloseSignal.tryEmitEmpty());
              }
            })
            .flatMap(s -> Mono.<ServerSentEvent<Object>>empty());

        // A real bug found via this phase's own testing (a slow/limited
        // downstream demand scenario, exactly what a genuinely slow SSE
        // client looks like): `Flux.interval` has no buffer of its own -
        // without `onBackpressureLatest()` here, a tick arriving while the
        // downstream hasn't yet requested one is a hard `OverflowException`
        // ("Could not emit tick ... due to lack of requests") that would
        // kill the *entire* connection, log events included, over nothing
        // more than a missed heartbeat. `onBackpressureLatest()` is exactly
        // right for this payload's own semantics too: only the most recent
        // dropped-count/status/timestamp is ever meaningful, so silently
        // superseding a stale pending tick with a fresher one loses nothing.
        // Deliberately outlives `logEvents` completing: a zero-active-
        // target OpenShift session still needs this heartbeat to deliver
        // the final truthful status to the frontend, even though no more
        // "log" events will ever arrive - `logEvents` completing does not
        // end this merged flux (only `terminalCloseSignal`, or explicit
        // Stop/disconnect, or `connectionTimeout`, do).
        Flux<ServerSentEvent<Object>> status = Flux.interval(properties.getHeartbeatInterval())
            .onBackpressureLatest()
            .map(tick -> statusEvent(droppedCount.get(), latestStatus.get()));

        return guard.guard(Flux.merge(logEvents, statusTracker, status).takeUntilOther(terminalCloseSignal.asMono()))
            .take(properties.getConnectionTimeout());
      });
    });
  }

  private ServerSentEvent<Object> logEvent(Object dto) {
    return ServerSentEvent.<Object>builder(dto).event("log").build();
  }

  private ServerSentEvent<Object> statusEvent(long droppedCount, LiveSourceStatus liveSourceStatus) {
    return ServerSentEvent.<Object>builder(new StatusPayload(
            droppedCount, Instant.now(), liveSourceStatus.state().name(), liveSourceStatus.resolvedTargets(),
            liveSourceStatus.connectingTargets(), liveSourceStatus.activeTargets(),
            liveSourceStatus.reconnectingTargets(), liveSourceStatus.stoppedTargets(), liveSourceStatus.warnings()))
        .event("status")
        .build();
  }

  /**
   * The periodic "status" event's payload - also this stream's heartbeat
   * (HANDOVER.md §18.4 "heartbeat"). OS-1E — the fields from {@code
   * liveSourceState} onward mirror {@link LiveSourceStatus} (flattened
   * rather than nested, so the frontend DTO stays a plain object) and are
   * always present (never {@code null}) for every source, since {@link
   * LogSource#followWithStatus}'s default reports {@link
   * LiveSourceStatus#NOMINAL} rather than omitting the channel.
   */
  public record StatusPayload(
      long droppedCount, Instant serverTime, String liveSourceState, int resolvedTargets, int connectingTargets,
      int activeTargets, int reconnectingTargets, int stoppedTargets, List<String> warnings) {
    public StatusPayload {
      warnings = warnings == null ? List.of() : List.copyOf(warnings);
    }
  }
}
