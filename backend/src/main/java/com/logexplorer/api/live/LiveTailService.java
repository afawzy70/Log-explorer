package com.logexplorer.api.live;

import com.logexplorer.api.EventMapper;
import com.logexplorer.config.LiveTailProperties;
import com.logexplorer.core.guard.GuardrailViolationException;
import com.logexplorer.core.guard.GuardrailViolationException.Reason;
import com.logexplorer.core.guard.LiveTailGuard;
import com.logexplorer.core.model.FollowRequest;
import com.logexplorer.source.LogSource;
import com.logexplorer.source.LogSourceRegistry;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.stereotype.Component;
import reactor.core.publisher.BufferOverflowStrategy;
import reactor.core.publisher.Flux;

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

      AtomicLong droppedCount = new AtomicLong();
      Flux<ServerSentEvent<Object>> logEvents = source.follow(new FollowRequest(sourceId, services, composeProject))
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

      // A real bug found via this phase's own testing (a slow/limited
      // downstream demand scenario, exactly what a genuinely slow SSE
      // client looks like): `Flux.interval` has no buffer of its own -
      // without `onBackpressureLatest()` here, a tick arriving while the
      // downstream hasn't yet requested one is a hard `OverflowException`
      // ("Could not emit tick ... due to lack of requests") that would
      // kill the *entire* connection, log events included, over nothing
      // more than a missed heartbeat. `onBackpressureLatest()` is exactly
      // right for this payload's own semantics too: only the most recent
      // dropped-count/timestamp is ever meaningful, so silently
      // superseding a stale pending tick with a fresher one loses nothing.
      Flux<ServerSentEvent<Object>> status = Flux.interval(properties.getHeartbeatInterval())
          .onBackpressureLatest()
          .map(tick -> statusEvent(droppedCount.get()));

      return guard.guard(Flux.merge(logEvents, status))
          .take(properties.getConnectionTimeout());
    });
  }

  private ServerSentEvent<Object> logEvent(Object dto) {
    return ServerSentEvent.<Object>builder(dto).event("log").build();
  }

  private ServerSentEvent<Object> statusEvent(long droppedCount) {
    return ServerSentEvent.<Object>builder(new StatusPayload(droppedCount, Instant.now())).event("status").build();
  }

  /** The periodic "status" event's payload - also this stream's heartbeat (HANDOVER.md §18.4 "heartbeat"). */
  public record StatusPayload(long droppedCount, Instant serverTime) {
  }
}
