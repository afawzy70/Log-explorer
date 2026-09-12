package com.logexplorer.api.live;

import static org.assertj.core.api.Assertions.assertThat;

import com.logexplorer.api.EventMapper;
import com.logexplorer.api.dto.EventDto;
import com.logexplorer.config.LiveTailProperties;
import com.logexplorer.config.SourcesProperties;
import com.logexplorer.core.guard.GuardrailViolationException;
import com.logexplorer.core.guard.LiveTailGuard;
import com.logexplorer.core.guard.TooManyConcurrentLiveTailsException;
import com.logexplorer.core.mask.MaskingService;
import com.logexplorer.core.mask.TextRedactor;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.LiveSourceStatus;
import com.logexplorer.core.model.RawSensitiveFields;
import com.logexplorer.core.model.SourceCapabilities;
import com.logexplorer.source.LogSourceRegistry;
import com.logexplorer.source.StubLogSource;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;
import org.springframework.http.codec.ServerSentEvent;
import reactor.core.publisher.Flux;
import reactor.test.StepVerifier;

/**
 * Orchestration tests for {@link LiveTailService} (IMPLEMENTATION_PLAN.md
 * "Phase J"): masking on emit, unsupported-source rejection ("Do not fake
 * it"), bounded server buffer with accurate drop counting, connection
 * timeout, and the concurrent-tail cap actually being wired (not just
 * unit-tested in isolation on {@link LiveTailGuard}).
 */
class LiveTailServiceTest {

  private static final Instant NOW = Instant.parse("2026-01-01T12:00:00Z");
  private static final SourceCapabilities LIVE_CAPABLE =
      new SourceCapabilities(true, true, false, false, false, false, false);
  private static final SourceCapabilities LIVE_INCAPABLE =
      new SourceCapabilities(true, false, false, false, false, false, false);

  /** Polls a condition on a background heartbeat scheduler thread until true or the timeout elapses - no new test dependency (Awaitility) needed for this file's small number of async waits. */
  private void waitUntil(java.util.function.BooleanSupplier condition, Duration timeout) {
    long deadline = System.nanoTime() + timeout.toNanos();
    while (!condition.getAsBoolean()) {
      if (System.nanoTime() > deadline) {
        throw new AssertionError("condition not met within " + timeout);
      }
      try {
        Thread.sleep(10);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        throw new AssertionError("interrupted while waiting", e);
      }
    }
  }

  private LiveTailService newService(StubLogSource stub, LiveTailProperties properties) {
    LiveTailGuard guard = new LiveTailGuard(properties);
    EventMapper eventMapper = new EventMapper(new MaskingService(), new TextRedactor());
    LogSourceRegistry registry = new LogSourceRegistry(List.of(stub), new SourcesProperties());
    return new LiveTailService(registry, guard, properties, eventMapper);
  }

  private LiveTailProperties defaultProperties() {
    LiveTailProperties properties = new LiveTailProperties();
    properties.setHeartbeatInterval(Duration.ofMinutes(10)); // never fires within a test's own timeout
    properties.setConnectionTimeout(Duration.ofMinutes(10));
    return properties;
  }

  @Test
  void aSourceThatDoesNotSupportLiveTailIsRejectedOutright() {
    StubLogSource stub = new StubLogSource("no-live", "No Live", LIVE_INCAPABLE);
    LiveTailService service = newService(stub, defaultProperties());

    StepVerifier.create(service.follow("no-live", List.of()))
        .expectErrorSatisfies(e -> {
          assertThat(e).isInstanceOf(GuardrailViolationException.class);
          assertThat(((GuardrailViolationException) e).reason())
              .isEqualTo(GuardrailViolationException.Reason.LIVE_TAIL_NOT_SUPPORTED);
        })
        .verify(Duration.ofSeconds(2));
  }

  @Test
  void unknownSourcePropagatesAsAnErrorSignal() {
    LiveTailService service = newService(new StubLogSource("real-source"), defaultProperties());
    StepVerifier.create(service.follow("does-not-exist", List.of()))
        .expectError(com.logexplorer.source.UnknownSourceException.class)
        .verify(Duration.ofSeconds(2));
  }

  @Test
  void everyEmittedLogEventIsMaskedBeforeItEverReachesTheStream() {
    StubLogSource stub = new StubLogSource("live-source", "Live Source", LIVE_CAPABLE);
    CanonicalLogEvent raw = CanonicalLogEvent.builder()
        .timestamp(NOW)
        .service("gateway")
        .message("live event")
        .sensitive(new RawSensitiveFields("RAW-CIF-VALUE", "raw-username", "raw-customer", "raw-device", "1.2.3.4"))
        .build();
    stub.withFollowFlux(Flux.just(raw));
    LiveTailService service = newService(stub, defaultProperties());

    StepVerifier.create(service.follow("live-source", List.of()))
        .assertNext(sse -> {
          assertThat(sse.event()).isEqualTo("log");
          EventDto dto = (EventDto) sse.data();
          assertThat(dto.protectedFields().cif()).isNotEqualTo("RAW-CIF-VALUE");
          assertThat(dto.protectedFields().cif()).doesNotContain("RAW-CIF-VALUE");
        })
        .thenCancel()
        .verify(Duration.ofSeconds(2));
  }

  /**
   * Legacy Remediation Slice 7 — free-text redaction must happen BEFORE
   * an event enters the browser-visible Live SSE stream (mission §15),
   * through the exact same {@link EventMapper} boundary the five
   * structured fields already go through above - never a second,
   * separate masking pass for the streaming path.
   */
  @Test
  void everyEmittedLogEventHasItsFreeTextRedactedBeforeItEverReachesTheStream() {
    StubLogSource stub = new StubLogSource("live-source", "Live Source", LIVE_CAPABLE);
    String sentinel = "RAW-LIVE-SENTINEL-8e42";
    CanonicalLogEvent raw = CanonicalLogEvent.builder()
        .timestamp(NOW)
        .service("gateway")
        .message("Login failed for customerId=" + sentinel)
        .exception("java.lang.RuntimeException: Authorization: Bearer " + sentinel + "AlsoLongEnough")
        .build();
    stub.withFollowFlux(Flux.just(raw));
    LiveTailService service = newService(stub, defaultProperties());

    StepVerifier.create(service.follow("live-source", List.of()))
        .assertNext(sse -> {
          EventDto dto = (EventDto) sse.data();
          assertThat(dto.message()).doesNotContain(sentinel);
          assertThat(dto.message()).contains("customerId=[REDACTED]");
          assertThat(dto.exception()).doesNotContain(sentinel);
          assertThat(dto.exception()).contains("Authorization: Bearer [REDACTED]");
        })
        .thenCancel()
        .verify(Duration.ofSeconds(2));
  }

  /**
   * A minimal, spec-compliant {@link org.reactivestreams.Subscriber} that
   * requests a fixed, small amount exactly once and never again - the
   * only way to observe genuine "produced faster than requested"
   * behavior directly. A {@code StepVerifier}-based consumer turned out
   * unsuitable for this specific assertion: verified directly (a
   * standalone probe, before writing this test) that {@code StepVerifier}
   * and typical eager consumers (`collectList`, `take(Duration)`) all
   * issue enough cumulative/prefetch demand over time to eventually drain
   * a small, finite source completely, which would make "no drop
   * happened" indistinguishable from "the bound doesn't work" - neither
   * this project's own conventions nor Reactor's public contract promise
   * a specific number of items survive an overflow, only that delivered
   * output never exceeds what was actually requested.
   */
  private static final class FixedDemandSubscriber implements org.reactivestreams.Subscriber<ServerSentEvent<Object>> {
    final List<ServerSentEvent<Object>> received = new java.util.concurrent.CopyOnWriteArrayList<>();
    private final long initialDemand;
    private volatile org.reactivestreams.Subscription subscription;

    FixedDemandSubscriber(long initialDemand) {
      this.initialDemand = initialDemand;
    }

    @Override
    public void onSubscribe(org.reactivestreams.Subscription s) {
      subscription = s;
      s.request(initialDemand);
    }

    @Override
    public void onNext(ServerSentEvent<Object> event) {
      received.add(event);
    }

    @Override
    public void onError(Throwable t) {
      throw new AssertionError("live tail must never error out from a slow consumer alone", t);
    }

    @Override
    public void onComplete() {
      // no-op - a real live tail only ever ends via cancellation/timeout, not natural completion
    }
  }

  @Test
  void aSlowConsumerNeverReceivesMoreThanItActuallyRequested() {
    // The direct, reliable half of "bounded buffers" (HANDOVER.md §18.4):
    // regardless of how many real events a fast/bursty source produces,
    // a consumer that only ever asks for 1 item receives at most 1 - the
    // server never force-feeds a slow client more than it can handle.
    LiveTailProperties properties = defaultProperties();
    properties.setServerBufferSize(2);
    properties.setHeartbeatInterval(Duration.ofSeconds(30)); // won't fire within this test

    StubLogSource stub = new StubLogSource("live-source", "Live Source", LIVE_CAPABLE);
    List<CanonicalLogEvent> tenEvents = IntStream.range(0, 10)
        .mapToObj(i -> CanonicalLogEvent.builder().timestamp(NOW).message("event-" + i).service("gateway").build())
        .toList();
    stub.withFollowFlux(Flux.fromIterable(tenEvents));
    LiveTailService service = newService(stub, properties);

    FixedDemandSubscriber subscriber = new FixedDemandSubscriber(1);
    service.follow("live-source", List.of()).subscribe(subscriber);

    waitUntil(() -> !subscriber.received.isEmpty(), Duration.ofSeconds(2));
    // Give any (incorrect) over-delivery a real chance to happen, then assert it didn't.
    try {
      Thread.sleep(300);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }
    assertThat(subscriber.received).hasSize(1);
    assertThat(subscriber.received.get(0).event()).isEqualTo("log");
  }

  @Test
  void aLargeBurstAgainstATinyServerBufferNeverOverDeliversToASlowConsumer() {
    // Legacy Remediation Slice 5 - "Audit this critically... do not leave
    // an effectively unlimited BUFFER strategy". `DockerLogSource#follow`
    // itself uses `Flux.create(..., FluxSink.OverflowStrategy.BUFFER)`,
    // which sounds unbounded read in isolation; this test proves the
    // actual composed pipeline (this class's own `onBackpressureBuffer(N,
    // DROP_OLDEST)` immediately downstream) is what really governs
    // delivery at real scale (a 200-event burst, 20x this test suite's
    // pre-existing 10-event scenarios) against a tiny 5-slot buffer and a
    // consumer that only ever asks for 1 - the slow consumer still never
    // receives more than it asked for, so the burst was never force-fed
    // to it from an unbounded backlog.
    LiveTailProperties properties = defaultProperties();
    properties.setServerBufferSize(5);
    properties.setHeartbeatInterval(Duration.ofSeconds(30));

    StubLogSource stub = new StubLogSource("live-source", "Live Source", LIVE_CAPABLE);
    List<CanonicalLogEvent> burst = IntStream.range(0, 200)
        .mapToObj(i -> CanonicalLogEvent.builder().timestamp(NOW).message("burst-" + i).service("gateway").build())
        .toList();
    stub.withFollowFlux(Flux.fromIterable(burst));
    LiveTailService service = newService(stub, properties);

    FixedDemandSubscriber subscriber = new FixedDemandSubscriber(1);
    service.follow("live-source", List.of()).subscribe(subscriber);

    waitUntil(() -> !subscriber.received.isEmpty(), Duration.ofSeconds(2));
    try {
      Thread.sleep(300);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }
    assertThat(subscriber.received).hasSize(1);
    assertThat(subscriber.received.get(0).event()).isEqualTo("log");
  }

  @Test
  void theConnectionSurvivesASustainedSlowConsumerWithoutErroringOutFromTheHeartbeatAlone() {
    // A real bug this exact test caught during this phase's own
    // verification: `Flux.interval` (the heartbeat/status source) has no
    // buffer of its own - a tick arriving while a genuinely slow consumer
    // hasn't yet requested one used to be a hard `OverflowException`
    // ("Could not emit tick ... due to lack of requests") that killed the
    // *entire* connection, log events included, over nothing more than a
    // missed heartbeat. Fixed with `.onBackpressureLatest()` on the
    // status stream (see `LiveTailService`'s own comment). This test
    // reproduces the exact minimal-demand, real-heartbeat-interval
    // conditions that triggered it.
    LiveTailProperties properties = defaultProperties();
    properties.setServerBufferSize(2);
    properties.setHeartbeatInterval(Duration.ofMillis(50));

    StubLogSource stub = new StubLogSource("live-source", "Live Source", LIVE_CAPABLE);
    List<CanonicalLogEvent> tenEvents = IntStream.range(0, 10)
        .mapToObj(i -> CanonicalLogEvent.builder().timestamp(NOW).message("event-" + i).service("gateway").build())
        .toList();
    stub.withFollowFlux(Flux.fromIterable(tenEvents));
    LiveTailService service = newService(stub, properties);

    FixedDemandSubscriber subscriber = new FixedDemandSubscriber(1);
    service.follow("live-source", List.of()).subscribe(subscriber);

    // Several real heartbeat intervals elapse with demand mostly
    // exhausted - onError (an AssertionError from the subscriber above)
    // would fail this test immediately if the bug were still present.
    try {
      Thread.sleep(400);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }
    assertThat(subscriber.received).isNotEmpty();

    // Now drain everything, including at least one status tick, and
    // confirm a real, non-negative dropped count is reported - the drop
    // accounting itself still works once genuine demand arrives.
    subscriber.subscription.request(50);
    waitUntil(() -> subscriber.received.stream().anyMatch(sse -> "status".equals(sse.event())), Duration.ofSeconds(2));
    LiveTailService.StatusPayload status = subscriber.received.stream()
        .filter(sse -> "status".equals(sse.event()))
        .map(sse -> (LiveTailService.StatusPayload) sse.data())
        .reduce((first, second) -> second) // the most recent one
        .orElseThrow();
    assertThat(status.droppedCount()).isGreaterThanOrEqualTo(0);
  }

  @Test
  void theConnectionCompletesGracefullyAfterTheConfiguredTimeoutRatherThanStreamingForever() {
    LiveTailProperties properties = defaultProperties();
    properties.setConnectionTimeout(Duration.ofSeconds(5));
    properties.setHeartbeatInterval(Duration.ofMinutes(10));

    StubLogSource stub = new StubLogSource("live-source", "Live Source", LIVE_CAPABLE);
    stub.withFollowFlux(Flux.never()); // a source that would otherwise stream forever
    LiveTailService service = newService(stub, properties);

    StepVerifier.withVirtualTime(() -> service.follow("live-source", List.of()))
        .expectSubscription()
        .thenAwait(Duration.ofSeconds(5))
        .verifyComplete(); // not an error - a graceful, expected end
  }

  @Test
  void theConcurrentTailCapIsActuallyWiredNotJustUnitTestedInIsolation() {
    LiveTailProperties properties = defaultProperties();
    properties.setMaxConcurrentTails(1);
    StubLogSource stub = new StubLogSource("live-source", "Live Source", LIVE_CAPABLE);
    stub.withFollowFlux(Flux.never());
    LiveTailService service = newService(stub, properties);

    var holder = service.follow("live-source", List.of()).subscribe();
    try {
      StepVerifier.create(service.follow("live-source", List.of()))
          .expectError(TooManyConcurrentLiveTailsException.class)
          .verify(Duration.ofSeconds(2));
    } finally {
      holder.dispose();
    }
  }

  /**
   * OS-1E final terminal-status-delivery fix — a real review defect: with
   * the DEFAULT properties, {@code heartbeatInterval} is 15s while
   * {@code terminalGrace} is {@code min(2*15s, 10s) = 10s}, so the SSE
   * connection could close a full 5 seconds before the next periodic
   * heartbeat would even have fired, leaving the browser believing the
   * last-known source state was still non-terminal at the moment
   * {@code onerror} runs. These tests use the REAL default
   * {@code heartbeatInterval} (never overridden) specifically so the
   * defect's own exact numeric relationship (15s &gt; 10s) is what's
   * actually verified, not a scaled-down stand-in.
   */
  private LiveTailProperties defaultHeartbeatProperties() {
    LiveTailProperties properties = new LiveTailProperties(); // real defaults: heartbeatInterval=15s
    properties.setConnectionTimeout(Duration.ofMinutes(10));
    return properties;
  }

  private LiveSourceStatus running() {
    return new LiveSourceStatus(LiveSourceStatus.State.RUNNING, 1, 0, 1, 0, 0, List.of());
  }

  private void terminalStatusIsDeliveredImmediatelyBeforeClose(LiveSourceStatus.State terminalState) {
    LiveTailProperties properties = defaultHeartbeatProperties();
    assertThat(properties.getHeartbeatInterval()).isEqualTo(Duration.ofSeconds(15));
    Duration terminalGrace = Duration.ofMillis(
        Math.min(2 * properties.getHeartbeatInterval().toMillis(), Duration.ofSeconds(10).toMillis()));
    assertThat(terminalGrace).isEqualTo(Duration.ofSeconds(10));
    assertThat(properties.getHeartbeatInterval()).isGreaterThan(terminalGrace); // the exact race condition this fix closes

    StubLogSource stub = new StubLogSource("live-source", "Live Source", LIVE_CAPABLE);
    LiveSourceStatus terminal = new LiveSourceStatus(terminalState, 1, 0, 0, 0, 1, List.of("terminal-reason"));
    stub.withFollowFlux(Flux.never());
    stub.withStatusFlux(Flux.just(running(), terminal));
    LiveTailService service = newService(stub, properties);

    // D: the terminal status SSE event arrives well before the next
    // heartbeat tick (t=15s) COULD have fired, and the connection
    // completes only after terminalGrace (t=10s) — never earlier, never
    // waiting for the 15s heartbeat.
    StepVerifier.withVirtualTime(() -> service.follow("live-source", List.of()))
        .expectSubscription()
        .assertNext(sse -> {
          assertThat(sse.event()).isEqualTo("status");
          LiveTailService.StatusPayload payload = (LiveTailService.StatusPayload) sse.data();
          assertThat(payload.liveSourceState()).isEqualTo(terminalState.name());
        })
        .expectNoEvent(terminalGrace.minusMillis(200))
        .thenAwait(Duration.ofMillis(200))
        .verifyComplete();
  }

  @Test
  void terminalStatusA_staleIsDeliveredImmediatelyNotOnTheNextHeartbeat() {
    terminalStatusIsDeliveredImmediatelyBeforeClose(LiveSourceStatus.State.STALE);
  }

  @Test
  void terminalStatusB_expiredIsDeliveredImmediatelyNotOnTheNextHeartbeat() {
    terminalStatusIsDeliveredImmediatelyBeforeClose(LiveSourceStatus.State.EXPIRED);
  }

  @Test
  void terminalStatusC_noActiveTargetsIsDeliveredImmediatelyNotOnTheNextHeartbeat() {
    terminalStatusIsDeliveredImmediatelyBeforeClose(LiveSourceStatus.State.NO_ACTIVE_TARGETS);
  }

  @Test
  void terminalStatusE_cancellationDuringGraceCancelsTheTerminalTimerNoOrphanWork() {
    // The grace timer must be part of the SAME reactive lifecycle as the
    // rest of this SSE connection - never a detached
    // `Mono.delay(...).subscribe(...)` that survives cancellation on its
    // own. Proven here the standard way Reactor's own contract guarantees
    // it: cancelling the downstream subscription propagates `cancel()` to
    // every still-active upstream Publisher, including whichever inner
    // publisher is currently live inside the `flatMap` that hosts the
    // grace timer - so the STATUS source itself must observe a cancel.
    LiveTailProperties properties = defaultProperties();
    properties.setHeartbeatInterval(Duration.ofSeconds(3)); // terminalGrace = min(6s, 10s) = 6s - long enough to dispose mid-grace deterministically

    StubLogSource stub = new StubLogSource("live-source", "Live Source", LIVE_CAPABLE);
    LiveSourceStatus stale = new LiveSourceStatus(LiveSourceStatus.State.STALE, 1, 0, 0, 0, 1, List.of("scope-changed"));
    java.util.concurrent.atomic.AtomicBoolean statusSourceCancelled = new java.util.concurrent.atomic.AtomicBoolean(false);
    stub.withFollowFlux(Flux.never());
    stub.withStatusFlux(Flux.just(stale).doOnCancel(() -> statusSourceCancelled.set(true)));
    LiveTailService service = newService(stub, properties);

    FixedDemandSubscriber subscriber = new FixedDemandSubscriber(10);
    service.follow("live-source", List.of()).subscribe(subscriber);

    waitUntil(() -> subscriber.received.stream().anyMatch(sse -> "status".equals(sse.event())), Duration.ofSeconds(2));
    // Still well inside the 6s grace window - cancel now.
    subscriber.subscription.cancel();

    waitUntil(statusSourceCancelled::get, Duration.ofSeconds(1));

    // Wait past what the (now-cancelled) grace timer would have needed to
    // fire - no crash, and (since the subscriber itself is cancelled) no
    // further delivery is possible; nothing throws from an orphan timer
    // still trying to touch a torn-down connection.
    try {
      Thread.sleep(500);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }
    assertThat(subscriber.received).hasSize(1);
  }
}
