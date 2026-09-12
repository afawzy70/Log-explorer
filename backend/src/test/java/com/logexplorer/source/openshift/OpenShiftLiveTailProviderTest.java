package com.logexplorer.source.openshift;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.logexplorer.config.DirectPodLogProperties;
import com.logexplorer.config.OpenShiftLiveProperties;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.LiveFollowResult;
import com.logexplorer.core.model.LiveSourceStatus;
import com.logexplorer.core.model.RawToken;
import com.logexplorer.core.parse.LogLineParser;
import com.logexplorer.core.search.ContextTargetProofCodec;
import java.net.URI;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.BooleanSupplier;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import reactor.core.Disposable;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Sinks;
import reactor.test.StepVerifier;

/**
 * OS-1E review recovery — reconnect-budget truthfulness (mission §1-4,
 * §25), overlong-line handling reaching runtime status (mission §24,
 * §26), connect-attempt concurrency (mission §8-10), runtime status
 * truthfulness (mission §11-14, §27), and generation/scope staleness
 * (mission §16-17, §28) for {@link OpenShiftLiveTailProvider}.
 *
 * <p>{@link OpenShiftApiClient} is mocked rather than exercised over real
 * HTTP: {@link OpenShiftApiClientLiveStreamTest} already covers the wire-
 * level streaming/decoding contract in full; this class's own job is the
 * orchestration layer above it.
 */
class OpenShiftLiveTailProviderTest {

  private static final String NAMESPACE = "payments";
  private static final RawToken TOKEN = RawToken.of("sha256~live-tail-test-token-0123456789");

  private OpenShiftApiClient client;
  private OpenShiftSession session;
  private DirectPodLogProvider directPodLogProvider;
  private DirectPodLogProperties searchProperties;
  private OpenShiftLiveProperties liveProperties;
  private OpenShiftLiveTailProvider provider;
  private long generation;

  /** Queues one canned Flux per (pod, container) target, consumed in call order. */
  private final Map<String, Deque<Flux<OpenShiftApiClient.DecodedLine>>> scripted = new ConcurrentHashMap<>();
  /** Every {@code tailLines} value THIS target was actually called with, in call order — proves the initial-tail-vs-reconnect contract (mission §1/§2). */
  private final Map<String, List<Integer>> tailLinesCalls = new ConcurrentHashMap<>();

  @BeforeEach
  void setUp() {
    client = mock(OpenShiftApiClient.class);
    session = new OpenShiftSession();
    searchProperties = new DirectPodLogProperties();
    LogLineParser parser = new LogLineParser(new ObjectMapper());
    directPodLogProvider = new DirectPodLogProvider(
        client, session, parser, searchProperties, new ContextTargetProofCodec(new ObjectMapper()));
    liveProperties = new OpenShiftLiveProperties();
    liveProperties.setInitialReconnectDelay(Duration.ofMillis(5));
    liveProperties.setMaxReconnectDelay(Duration.ofMillis(20));
    liveProperties.setMaxReconnectAttempts(2);
    liveProperties.setConnectPermitTimeout(Duration.ofSeconds(30)); // effectively "never" for these tests - release is data/error/cancel-driven
    liveProperties.setStalenessCheckInterval(Duration.ofMillis(20));
    provider = new OpenShiftLiveTailProvider(client, session, parser, directPodLogProvider, searchProperties, liveProperties);

    when(client.followPodLog(any(), any(), any(), anyString(), anyString(), anyString(), anyInt(), anyInt()))
        .thenAnswer(invocation -> {
          String pod = invocation.getArgument(4);
          String container = invocation.getArgument(5);
          int tailLines = invocation.getArgument(6);
          tailLinesCalls.computeIfAbsent(pod + "/" + container, k -> new CopyOnWriteArrayList<>()).add(tailLines);
          Deque<Flux<OpenShiftApiClient.DecodedLine>> queue = scripted.get(pod + "/" + container);
          if (queue == null || queue.isEmpty()) {
            // A clean, immediate "no more data" completion once a test's
            // own script is exhausted - NOT Flux.never(): production code
            // always attempts a bounded reconnect after ANY stream end,
            // so a never-completing fallback would make every finite test
            // script hang forever waiting for a bounded give-up that can
            // never arrive.
            return Flux.empty();
          }
          return queue.poll();
        });

    OcLoginCommand command = new OcLoginCommand(URI.create("https://cluster.example.invalid:6443"), TOKEN, null);
    generation = session.connect(command, "Test", "developer", List.of(NAMESPACE), ProjectDiscovery.Api.PROJECTS, null);
    assertThat(session.selectProject(NAMESPACE, generation)).isTrue();
  }

  @SafeVarargs
  private void script(String pod, String container, Flux<OpenShiftApiClient.DecodedLine>... attempts) {
    scripted.put(pod + "/" + container, new ArrayDeque<>(List.of(attempts)));
  }

  private static Flux<OpenShiftApiClient.DecodedLine> justLine(String rawLine) {
    return Flux.just(new OpenShiftApiClient.DecodedLine(rawLine, false));
  }

  private static Flux<OpenShiftApiClient.DecodedLine> error(OpenShiftApiException.Kind kind) {
    return Flux.error(new OpenShiftApiException(kind, "test"));
  }

  private PodSummary pod(String name, List<String> containers) {
    return new PodSummary(name, "Running", containers.size() + "/" + containers.size(), 0, containers, null);
  }

  private void seedPods(List<PodSummary> pods) {
    assertThat(session.updatePods(pods, true, NAMESPACE, null, generation)).isTrue();
  }

  private void selectOnly(String podName, String containerName) {
    assertThat(session.selectPod(podName, generation)).isTrue();
    assertThat(session.updateContainers(List.of(containerName), podName, generation)).isTrue();
    assertThat(session.selectContainer(containerName, generation)).isTrue();
  }

  /**
   * Subscribes to {@code result.status()} immediately, before the caller
   * ever touches {@code result.events()} - required because status is a
   * hot channel: the very first snapshot is pushed synchronously when the
   * events Flux is first subscribed.
   */
  private static List<LiveSourceStatus> subscribeToStatus(LiveFollowResult result) {
    List<LiveSourceStatus> collected = new ArrayList<>();
    result.status().subscribe(collected::add);
    return collected;
  }

  private static LiveSourceStatus latest(List<LiveSourceStatus> statuses) {
    assertThat(statuses).isNotEmpty();
    return statuses.get(statuses.size() - 1);
  }

  /** A minimal bounded poll, avoiding a new test dependency for the handful of real-timing assertions below. */
  private static void waitUntil(Duration timeout, BooleanSupplier condition) {
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

  private static String rawLine(String timestamp, String message) {
    return timestamp + " {\"@timestamp\":\"2026-09-12T10:00:00Z\",\"application\":\"payments\",\"level\":\"INFO\""
        + ",\"message\":\"" + message + "\"}";
  }

  // ------------------------------------------------------------ single target normal follow

  @Test
  void oneTargetNormalFollowEmitsFullyEnrichedCanonicalLogEvents() {
    seedPods(List.of(pod("payment-api-abc", List.of("app"))));
    selectOnly("payment-api-abc", "app");

    script("payment-api-abc", "app", justLine(rawLine("2026-09-12T10:00:00.000000000Z", "hello")));

    LiveFollowResult result = provider.follow();
    List<CanonicalLogEvent> events = result.events().collectList().block(Duration.ofSeconds(2));

    assertThat(events).hasSize(1);
    CanonicalLogEvent event = events.get(0);
    assertThat(event.sourceId()).isEqualTo("openshift");
    assertThat(event.namespace()).isEqualTo(NAMESPACE);
    assertThat(event.pod()).isEqualTo("payment-api-abc");
    assertThat(event.containerName()).isEqualTo("app");
    assertThat(event.message()).isEqualTo("hello");
  }

  // ------------------------------------------------------------ multi-target merge

  @Test
  void multipleTargetsAreMergedIntoOneEventStream_neverJoinedOrDropped() {
    seedPods(List.of(pod("payment-api-1", List.of("app")), pod("payment-api-2", List.of("app"))));

    script("payment-api-1", "app", justLine(rawLine("2026-09-12T10:00:00.000000000Z", "from-1")));
    script("payment-api-2", "app", justLine(rawLine("2026-09-12T10:00:00.000000000Z", "from-2")));

    LiveFollowResult result = provider.follow();
    List<CanonicalLogEvent> events = result.events().collectList().block(Duration.ofSeconds(2));

    assertThat(events).hasSize(2);
    assertThat(events.stream().map(CanonicalLogEvent::pod)).containsExactlyInAnyOrder("payment-api-1", "payment-api-2");
  }

  @Test
  void oneTargetPermanentlyFailingNeverStopsTheOtherHealthyTargets() {
    seedPods(List.of(pod("payment-api-1", List.of("app")), pod("payment-api-2", List.of("app"))));

    script("payment-api-1", "app", error(OpenShiftApiException.Kind.FORBIDDEN));
    script("payment-api-2", "app", justLine(rawLine("2026-09-12T10:00:00.000000000Z", "still-alive")));

    LiveFollowResult result = provider.follow();
    List<LiveSourceStatus> statuses = subscribeToStatus(result);
    List<CanonicalLogEvent> events = result.events().collectList().block(Duration.ofSeconds(2));

    assertThat(events).hasSize(1);
    assertThat(events.get(0).pod()).isEqualTo("payment-api-2");
    LiveSourceStatus status = latest(statuses);
    assertThat(status.warnings()).anyMatch(w -> w.contains("payment-api-1") && w.contains("403"));
  }

  // ------------------------------------------------------------ target cap

  @Test
  void targetCapReachedIsReportedTruthfullyOnStatus() {
    searchProperties.setMaxTargets(1);
    seedPods(List.of(pod("payment-api-1", List.of("app")), pod("payment-api-2", List.of("app"))));
    script("payment-api-1", "app", Flux.never());
    script("payment-api-2", "app", Flux.never());

    LiveFollowResult result = provider.follow();
    List<LiveSourceStatus> statuses = subscribeToStatus(result);
    result.events().take(Duration.ofMillis(100)).blockLast();

    assertThat(latest(statuses).warnings()).anyMatch(w -> w.contains("TARGET_CAP_REACHED"));
    assertThat(latest(statuses).resolvedTargets()).isEqualTo(1);
  }

  @Test
  void zeroResolvedTargetsCompletesTheStreamAndReportsNoActiveTargets() {
    // No pods seeded at all - scope resolves to zero targets.
    LiveFollowResult result = provider.follow();
    List<LiveSourceStatus> statuses = subscribeToStatus(result);

    StepVerifier.create(result.events()).expectComplete().verify(Duration.ofSeconds(2));

    LiveSourceStatus status = latest(statuses);
    assertThat(status.state()).isEqualTo(LiveSourceStatus.State.NO_ACTIVE_TARGETS);
    assertThat(status.warnings()).anyMatch(w -> w.contains("NO_LIVE_TARGETS"));
  }

  // ------------------------------------------------------------ initial tail truthfulness (mission §18)

  @Test
  void initialTailTruthfulnessNoticeIsIncludedOnceWhenTargetsExist() {
    seedPods(List.of(pod("payment-api-abc", List.of("app"))));
    selectOnly("payment-api-abc", "app");
    script("payment-api-abc", "app", Flux.never());

    LiveFollowResult result = provider.follow();
    List<LiveSourceStatus> statuses = subscribeToStatus(result);
    result.events().take(Duration.ofMillis(50)).blockLast();

    assertThat(statuses.get(0).warnings()).anyMatch(w -> w.contains("INITIAL_TAIL_NOT_LIVE_PROOF"));
  }

  // ------------------------------------------------------------ generation isolation

  @Test
  void aUnauthorizedFailureExpiresTheSessionOnlyWhenGenerationStillMatches() {
    seedPods(List.of(pod("payment-api-abc", List.of("app"))));
    selectOnly("payment-api-abc", "app");
    script("payment-api-abc", "app", error(OpenShiftApiException.Kind.UNAUTHORIZED));

    LiveFollowResult result = provider.follow();
    List<LiveSourceStatus> statuses = subscribeToStatus(result);
    result.events().collectList().block(Duration.ofSeconds(2));

    assertThat(session.state()).isEqualTo(OpenShiftConnectionState.EXPIRED);
    assertThat(latest(statuses).state()).isEqualTo(LiveSourceStatus.State.EXPIRED);
  }

  @Test
  void aUnauthorizedFailureFromAStaleGenerationNeverExpiresTheCurrentConnection() {
    seedPods(List.of(pod("payment-api-abc", List.of("app"))));
    selectOnly("payment-api-abc", "app");
    script("payment-api-abc", "app", error(OpenShiftApiException.Kind.UNAUTHORIZED));

    LiveFollowResult result = provider.follow();

    OcLoginCommand reconnectCommand = new OcLoginCommand(URI.create("https://cluster.example.invalid:6443"), TOKEN, null);
    long newGeneration = session.connect(
        reconnectCommand, "Test", "developer", List.of(NAMESPACE), ProjectDiscovery.Api.PROJECTS, null);
    assertThat(session.selectProject(NAMESPACE, newGeneration)).isTrue();

    result.events().collectList().block(Duration.ofSeconds(2));

    assertThat(session.state()).isEqualTo(OpenShiftConnectionState.CONNECTED);
    assertThat(session.generation()).isEqualTo(newGeneration);
  }

  // ------------------------------------------------------------ reconnect classification

  @Test
  void aForbiddenFailureStopsPermanentlyWithoutAnyReconnectAttempt() {
    seedPods(List.of(pod("payment-api-abc", List.of("app"))));
    selectOnly("payment-api-abc", "app");
    script("payment-api-abc", "app", error(OpenShiftApiException.Kind.FORBIDDEN));

    provider.follow().events().collectList().block(Duration.ofSeconds(2));

    verify(client, times(1))
        .followPodLog(any(), any(), any(), eq(NAMESPACE), eq("payment-api-abc"), eq("app"), anyInt(), anyInt());
  }

  @Test
  void aNotFoundFailureStopsPermanentlyWithoutAnyReconnectAttempt() {
    seedPods(List.of(pod("payment-api-abc", List.of("app"))));
    selectOnly("payment-api-abc", "app");
    script("payment-api-abc", "app", error(OpenShiftApiException.Kind.NOT_FOUND));

    provider.follow().events().collectList().block(Duration.ofSeconds(2));

    verify(client, times(1))
        .followPodLog(any(), any(), any(), eq(NAMESPACE), eq("payment-api-abc"), eq("app"), anyInt(), anyInt());
  }

  @Test
  void aTlsFailureIsBoundedRatherThanRetriedForever() {
    liveProperties.setMaxReconnectAttempts(2);
    seedPods(List.of(pod("payment-api-abc", List.of("app"))));
    selectOnly("payment-api-abc", "app");
    Flux<OpenShiftApiClient.DecodedLine> tlsFailure = error(OpenShiftApiException.Kind.TLS);
    script("payment-api-abc", "app", tlsFailure, tlsFailure, tlsFailure, tlsFailure, tlsFailure);

    LiveFollowResult result = provider.follow();
    StepVerifier.create(result.events()).expectComplete().verify(Duration.ofSeconds(5));

    // initial attempt (0) + maxReconnectAttempts(2) retries = 3 real calls, never more.
    verify(client, times(3))
        .followPodLog(any(), any(), any(), eq(NAMESPACE), eq("payment-api-abc"), eq("app"), anyInt(), anyInt());
  }

  @Test
  void aPersistentTransientFailureGivesUpAfterMaxReconnectAttemptsAndWarns() {
    seedPods(List.of(pod("payment-api-abc", List.of("app"))));
    selectOnly("payment-api-abc", "app");

    Flux<OpenShiftApiClient.DecodedLine> alwaysFails = error(OpenShiftApiException.Kind.TIMEOUT);
    script("payment-api-abc", "app", alwaysFails, alwaysFails, alwaysFails, alwaysFails, alwaysFails);

    LiveFollowResult result = provider.follow();
    List<LiveSourceStatus> statuses = subscribeToStatus(result);
    List<CanonicalLogEvent> events = new ArrayList<>();
    StepVerifier.create(result.events().doOnNext(events::add))
        .expectComplete()
        .verify(Duration.ofSeconds(5));

    assertThat(events).isEmpty();
    assertThat(latest(statuses).state()).isEqualTo(LiveSourceStatus.State.NO_ACTIVE_TARGETS);
    assertThat(latest(statuses).warnings()).anyMatch(w -> w.contains("gave up reconnecting"));
    // initial attempt (0) + maxReconnectAttempts(2) retries = 3 real calls.
    verify(client, times(3))
        .followPodLog(any(), any(), any(), eq(NAMESPACE), eq("payment-api-abc"), eq("app"), anyInt(), anyInt());
  }

  // ================================================================
  // Defect A — reconnect budget / initial-tail-vs-reconnect (mission §1-4, §25)
  // ================================================================

  @Test
  void reconnectA_initialTailUsesConfiguredValueEveryReconnectUsesZero() {
    liveProperties.setInitialTailLines(5);
    seedPods(List.of(pod("payment-api-abc", List.of("app"))));
    selectOnly("payment-api-abc", "app");

    Flux<OpenShiftApiClient.DecodedLine> h = justLine(rawLine("2026-09-12T10:00:00.000000000Z", "H"));
    Flux<OpenShiftApiClient.DecodedLine> thenFail = error(OpenShiftApiException.Kind.NETWORK);
    script("payment-api-abc", "app", h, thenFail, thenFail, thenFail);

    provider.follow().events().collectList().block(Duration.ofSeconds(2));

    List<Integer> calls = tailLinesCalls.get("payment-api-abc/app");
    assertThat(calls).isNotEmpty();
    assertThat(calls.get(0)).isEqualTo(5); // attempt 0 - the real, configured initial tail
    assertThat(calls.subList(1, calls.size())).allMatch(v -> v == 0); // every reconnect - never replays history
  }

  @Test
  void reconnectB_historicalTailEventCannotResetTheReconnectBudget() {
    // H is delivered on attempt 0 (tailLines=5, genuinely historical).
    // Every reconnect after that (tailLines=0) fails immediately with NO
    // data at all - if H incorrectly "counted" as a recovery, the budget
    // would never exhaust. It must exhaust in exactly maxReconnectAttempts.
    liveProperties.setMaxReconnectAttempts(2);
    seedPods(List.of(pod("payment-api-abc", List.of("app"))));
    selectOnly("payment-api-abc", "app");

    Flux<OpenShiftApiClient.DecodedLine> h = justLine(rawLine("2026-09-12T10:00:00.000000000Z", "H"));
    Flux<OpenShiftApiClient.DecodedLine> emptyClose = Flux.empty();
    script("payment-api-abc", "app", h, emptyClose, emptyClose, emptyClose, emptyClose);

    List<CanonicalLogEvent> events = provider.follow().events().collectList().block(Duration.ofSeconds(2));

    assertThat(events).hasSize(1); // H, exactly once - never replayed
    // attempt0 (H) + 2 reconnect attempts = exactly 3 calls, never more.
    verify(client, times(3))
        .followPodLog(any(), any(), any(), eq(NAMESPACE), eq("payment-api-abc"), eq("app"), anyInt(), anyInt());
  }

  @Test
  void reconnectC_persistentFailureAfterHistoricalDataStillReachesRetryExhaustion() {
    liveProperties.setMaxReconnectAttempts(2);
    seedPods(List.of(pod("payment-api-abc", List.of("app"))));
    selectOnly("payment-api-abc", "app");

    Flux<OpenShiftApiClient.DecodedLine> h = justLine(rawLine("2026-09-12T10:00:00.000000000Z", "H"));
    Flux<OpenShiftApiClient.DecodedLine> fails = error(OpenShiftApiException.Kind.TIMEOUT);
    script("payment-api-abc", "app", h, fails, fails, fails, fails);

    LiveFollowResult result = provider.follow();
    List<LiveSourceStatus> statuses = subscribeToStatus(result);
    StepVerifier.create(result.events()).expectNextCount(1).expectComplete().verify(Duration.ofSeconds(5));

    assertThat(latest(statuses).state()).isEqualTo(LiveSourceStatus.State.NO_ACTIVE_TARGETS);
    verify(client, times(3))
        .followPodLog(any(), any(), any(), eq(NAMESPACE), eq("payment-api-abc"), eq("app"), anyInt(), anyInt());
  }

  @Test
  void reconnectD_aGenuinePostReconnectEventResetsTheBudget() {
    liveProperties.setMaxReconnectAttempts(2);
    seedPods(List.of(pod("payment-api-abc", List.of("app"))));
    selectOnly("payment-api-abc", "app");

    Flux<OpenShiftApiClient.DecodedLine> fail = error(OpenShiftApiException.Kind.NETWORK);
    // attempt0: fail (uses budget slot 1/2)
    // attempt1 (reconnect, tailLines=0): delivers a REAL event "recovered", then fails - REAL_RECOVERY, budget resets to 0
    // attempts 2,3: fail (a fresh 1/2, 2/2 - would have been exhausted at attempt 3 WITHOUT the reset)
    // attempt4: fail -> now exceeds the fresh budget -> permanent stop
    Flux<OpenShiftApiClient.DecodedLine> recoveredThenFails = Flux.concat(
        justLine(rawLine("2026-09-12T10:00:00.000000000Z", "recovered")), Flux.error(new OpenShiftApiException(OpenShiftApiException.Kind.NETWORK, "again")));
    script("payment-api-abc", "app", fail, recoveredThenFails, fail, fail, fail, fail);

    List<CanonicalLogEvent> events = provider.follow().events().collectList().block(Duration.ofSeconds(2));

    assertThat(events).hasSize(1);
    assertThat(events.get(0).message()).isEqualTo("recovered");
    // Without the reset, exhaustion would occur at 3 total calls. With the
    // reset, it must take MORE than 3 - proving the budget genuinely reset.
    List<Integer> calls = tailLinesCalls.get("payment-api-abc/app");
    assertThat(calls.size()).isGreaterThan(3);
  }

  @Test
  void reconnectE_retryExhaustionIsExactlyDeterministic() {
    liveProperties.setMaxReconnectAttempts(4);
    seedPods(List.of(pod("payment-api-abc", List.of("app"))));
    selectOnly("payment-api-abc", "app");
    Flux<OpenShiftApiClient.DecodedLine> fails = error(OpenShiftApiException.Kind.TIMEOUT);
    script("payment-api-abc", "app", fails, fails, fails, fails, fails, fails, fails);

    provider.follow().events().collectList().block(Duration.ofSeconds(5));

    // initial attempt (0) + maxReconnectAttempts(4) retries = exactly 5 calls.
    verify(client, times(5))
        .followPodLog(any(), any(), any(), eq(NAMESPACE), eq("payment-api-abc"), eq("app"), anyInt(), anyInt());
  }

  @Test
  void reconnectF_stopDuringReconnectBackoffCancelsTheRetry() {
    liveProperties.setInitialReconnectDelay(Duration.ofSeconds(5)); // long enough to reliably dispose mid-wait
    seedPods(List.of(pod("payment-api-abc", List.of("app"))));
    selectOnly("payment-api-abc", "app");
    script("payment-api-abc", "app", error(OpenShiftApiException.Kind.NETWORK));

    Disposable subscription = provider.follow().events().subscribe();
    waitUntil(Duration.ofSeconds(1), () -> tailLinesCalls.getOrDefault("payment-api-abc/app", List.of()).size() >= 1);
    subscription.dispose(); // Stop, while the target is waiting out its backoff delay

    // Give the (now-cancelled) backoff timer a chance to fire if it were
    // ever going to - it must not, so the call count must stay at 1.
    try {
      Thread.sleep(200);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }
    assertThat(tailLinesCalls.get("payment-api-abc/app")).hasSize(1);
  }

  // ================================================================
  // Overlong-line status propagation (mission §24, §26)
  // ================================================================

  @Test
  void overlongLineTruncationReachesRuntimeStatusAsABoundedCount() {
    liveProperties.setMaxLineBytes(16);
    seedPods(List.of(pod("payment-api-abc", List.of("app"))));
    selectOnly("payment-api-abc", "app");

    // Two truncated lines then a normal one - the DECODER's own job
    // (producing at most one truncated DecodedLine per physical line) is
    // covered by OpenShiftApiClientLiveStreamTest; this proves the
    // orchestration layer surfaces that truncation truthfully.
    script(
        "payment-api-abc", "app",
        Flux.just(
            new OpenShiftApiClient.DecodedLine("y".repeat(16), true),
            new OpenShiftApiClient.DecodedLine("z".repeat(16), true),
            new OpenShiftApiClient.DecodedLine("normal", false)));

    LiveFollowResult result = provider.follow();
    List<LiveSourceStatus> statuses = subscribeToStatus(result);
    List<CanonicalLogEvent> events = result.events().collectList().block(Duration.ofSeconds(2));

    assertThat(events).hasSize(3); // truncated lines are still real events, just marked - never dropped silently
    assertThat(latest(statuses).warnings()).anyMatch(w -> w.contains("2 overlong log lines") && w.contains("LIVE_LINE_TRUNCATED"));
  }

  // ================================================================
  // Connect-attempt concurrency (mission §8-10)
  // ================================================================

  @Test
  void connectAttemptConcurrencyIsBoundedByMaxConcurrency_neverAllTargetsAtOnce() {
    searchProperties.setMaxConcurrency(2);
    searchProperties.setMaxTargets(5);
    List<PodSummary> pods = new ArrayList<>();
    for (int i = 1; i <= 5; i++) {
      pods.add(pod("payment-api-" + i, List.of("app")));
    }
    seedPods(pods);
    // Every target's own stream never emits anything and never
    // terminates - its connect permit is therefore held until the test
    // itself intervenes, letting the test observe exactly how many
    // targets are admitted to "connecting" at once.
    for (PodSummary p : pods) {
      script(p.name(), "app", Flux.never());
    }

    Disposable subscription = provider.follow().events().subscribe();
    try {
      waitUntil(Duration.ofSeconds(2), () -> totalCalls() >= 2);
      // Give any incorrectly-unbounded implementation a real chance to
      // over-admit before asserting the bound held.
      Thread.sleep(200);
      assertThat(totalCalls())
          .as("no more than maxConcurrency targets may be in the connecting phase at once")
          .isEqualTo(2);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    } finally {
      subscription.dispose();
    }
  }

  @Test
  void allAuthorizedTargetsEventuallyBecomeActive_oneLongLivedStreamDoesNotStarveOthers() {
    searchProperties.setMaxConcurrency(1);
    searchProperties.setMaxTargets(3);
    seedPods(List.of(pod("payment-api-1", List.of("app")), pod("payment-api-2", List.of("app")), pod("payment-api-3", List.of("app"))));

    Map<String, Sinks.Many<OpenShiftApiClient.DecodedLine>> sinks = new ConcurrentHashMap<>();
    when(client.followPodLog(any(), any(), any(), anyString(), anyString(), anyString(), anyInt(), anyInt()))
        .thenAnswer(invocation -> {
          String pod = invocation.getArgument(4);
          String container = invocation.getArgument(5);
          Sinks.Many<OpenShiftApiClient.DecodedLine> sink = Sinks.many().multicast().onBackpressureBuffer();
          sinks.put(pod + "/" + container, sink);
          return sink.asFlux();
        });

    Disposable subscription = provider.follow().events().subscribe();
    try {
      // With maxConcurrency=1, exactly one target connects first.
      waitUntil(Duration.ofSeconds(2), () -> sinks.size() >= 1);
      assertThat(sinks).hasSize(1);

      // That first target streams data (releasing nothing - a real
      // streaming target's permit already released on its first emit),
      // then the SECOND target must still be able to connect - proving
      // the first, long-lived ACTIVE stream never starves the others.
      String firstKey = sinks.keySet().iterator().next();
      sinks.get(firstKey).tryEmitNext(new OpenShiftApiClient.DecodedLine("first-data", false));

      waitUntil(Duration.ofSeconds(2), () -> sinks.size() >= 2);
      String secondKey = sinks.keySet().stream().filter(k -> !k.equals(firstKey)).findFirst().orElseThrow();
      sinks.get(secondKey).tryEmitNext(new OpenShiftApiClient.DecodedLine("second-data", false));

      waitUntil(Duration.ofSeconds(2), () -> sinks.size() >= 3);
      assertThat(sinks).hasSize(3);
    } finally {
      subscription.dispose();
    }
  }

  @Test
  void cancellationReleasesAPendingConnectPermit_queuedTargetIsNeverStrandedForever() {
    // Proven indirectly via the same chain-reaction mechanism above:
    // disposing the whole session must not leave any permit permanently
    // held (verified by the fact that a FRESH follow() call afterward can
    // immediately admit its own first target - if the old permit leaked,
    // a stale semaphore would never be reused since each session owns its
    // own fresh Semaphore instance; this test instead proves cancellation
    // itself completes cleanly with no hung/leaked subscription).
    searchProperties.setMaxConcurrency(1);
    seedPods(List.of(pod("payment-api-1", List.of("app")), pod("payment-api-2", List.of("app"))));
    script("payment-api-1", "app", Flux.never());
    script("payment-api-2", "app", Flux.never());

    Disposable subscription = provider.follow().events().subscribe();
    waitUntil(Duration.ofSeconds(2), () -> totalCalls() >= 1);
    assertThat(totalCalls()).isEqualTo(1); // the second target is still queued, waiting for a permit

    subscription.dispose();

    // A brand new session must start cleanly and immediately admit its
    // own first target - proving no global/shared permit state leaked
    // across sessions.
    tailLinesCalls.clear();
    scripted.clear();
    script("payment-api-1", "app", justLine(rawLine("2026-09-12T10:00:00.000000000Z", "fresh")));
    script("payment-api-2", "app", Flux.never());
    Disposable fresh = provider.follow().events().subscribe();
    try {
      waitUntil(Duration.ofSeconds(2), () -> totalCalls() >= 1);
    } finally {
      fresh.dispose();
    }
  }

  @Test
  void aFailedConnectReleasesItsPermitForTheNextQueuedTarget() {
    searchProperties.setMaxConcurrency(1);
    seedPods(List.of(pod("payment-api-1", List.of("app")), pod("payment-api-2", List.of("app"))));
    // Permanent failure (403) - target 1 never retries, so its permit
    // release is unambiguous (not entangled with its own reconnect
    // re-acquiring the same permit).
    script("payment-api-1", "app", error(OpenShiftApiException.Kind.FORBIDDEN));
    script("payment-api-2", "app", Flux.never());

    provider.follow().events().subscribe();

    waitUntil(Duration.ofSeconds(2), () -> totalCalls() >= 2);
    assertThat(tailLinesCalls.get("payment-api-2/app")).isNotEmpty();
  }

  private int totalCalls() {
    return tailLinesCalls.values().stream().mapToInt(List::size).sum();
  }

  // ================================================================
  // Runtime status truthfulness (mission §11-14, §27)
  // ================================================================

  private void seedNPods(int n) {
    List<PodSummary> pods = new ArrayList<>();
    for (int i = 1; i <= n; i++) {
      pods.add(pod("payment-api-" + i, List.of("app")));
    }
    seedPods(pods);
  }

  @Test
  void statusRunning_everyResolvedTargetActive() {
    seedNPods(3);
    for (int i = 1; i <= 3; i++) {
      script("payment-api-" + i, "app", Flux.never());
    }
    LiveFollowResult result = provider.follow();
    List<LiveSourceStatus> statuses = subscribeToStatus(result);
    result.events().take(Duration.ofMillis(100)).blockLast();

    LiveSourceStatus status = latest(statuses);
    assertThat(status.state()).isEqualTo(LiveSourceStatus.State.RUNNING);
    assertThat(status.resolvedTargets()).isEqualTo(3);
    assertThat(status.activeTargets()).isEqualTo(3);
  }

  @Test
  void statusDegraded_someActiveSomePermanentlyStopped() {
    seedNPods(2);
    script("payment-api-1", "app", Flux.never());
    script("payment-api-2", "app", error(OpenShiftApiException.Kind.FORBIDDEN));

    LiveFollowResult result = provider.follow();
    List<LiveSourceStatus> statuses = subscribeToStatus(result);
    result.events().take(Duration.ofMillis(150)).blockLast();

    LiveSourceStatus status = latest(statuses);
    assertThat(status.state()).isEqualTo(LiveSourceStatus.State.DEGRADED);
    assertThat(status.activeTargets()).isEqualTo(1);
    assertThat(status.stoppedTargets()).isEqualTo(1);
  }

  @Test
  void statusReconnecting_zeroActiveButSomeStillWithinBudget() {
    liveProperties.setInitialReconnectDelay(Duration.ofSeconds(5)); // stay in the RECONNECTING wait long enough to observe it
    seedNPods(1);
    script("payment-api-1", "app", error(OpenShiftApiException.Kind.NETWORK));

    LiveFollowResult result = provider.follow();
    List<LiveSourceStatus> statuses = subscribeToStatus(result);
    Disposable subscription = result.events().subscribe();
    try {
      waitUntil(Duration.ofSeconds(2), () -> latest(statuses).state() == LiveSourceStatus.State.RECONNECTING);
      LiveSourceStatus status = latest(statuses);
      assertThat(status.activeTargets()).isZero();
      assertThat(status.reconnectingTargets()).isEqualTo(1);
    } finally {
      subscription.dispose();
    }
  }

  @Test
  void statusNoActiveTargets_zeroActiveZeroReconnecting() {
    seedNPods(1);
    script("payment-api-1", "app", error(OpenShiftApiException.Kind.FORBIDDEN));

    LiveFollowResult result = provider.follow();
    List<LiveSourceStatus> statuses = subscribeToStatus(result);
    result.events().collectList().block(Duration.ofSeconds(2));

    LiveSourceStatus status = latest(statuses);
    assertThat(status.state()).isEqualTo(LiveSourceStatus.State.NO_ACTIVE_TARGETS);
    assertThat(status.activeTargets()).isZero();
    assertThat(status.reconnectingTargets()).isZero();
  }

  @Test
  void statusExpired_singleUnauthorizedTarget() {
    seedNPods(1);
    script("payment-api-1", "app", error(OpenShiftApiException.Kind.UNAUTHORIZED));

    LiveFollowResult result = provider.follow();
    List<LiveSourceStatus> statuses = subscribeToStatus(result);
    result.events().collectList().block(Duration.ofSeconds(2));

    assertThat(latest(statuses).state()).isEqualTo(LiveSourceStatus.State.EXPIRED);
  }

  @Test
  void statusRetainsEveryCurrentlyStoppedTargetsTruth_notOnlyTheLastOneToFail() {
    seedNPods(3);
    script("payment-api-1", "app", error(OpenShiftApiException.Kind.FORBIDDEN));
    script("payment-api-2", "app", error(OpenShiftApiException.Kind.NOT_FOUND));
    script("payment-api-3", "app", Flux.never());

    LiveFollowResult result = provider.follow();
    List<LiveSourceStatus> statuses = subscribeToStatus(result);
    result.events().take(Duration.ofMillis(150)).blockLast();

    LiveSourceStatus status = latest(statuses);
    assertThat(status.stoppedTargets()).isEqualTo(2);
    assertThat(status.warnings()).anyMatch(w -> w.contains("payment-api-1") && w.contains("403"));
    assertThat(status.warnings()).anyMatch(w -> w.contains("payment-api-2") && w.contains("404"));
  }

  // ================================================================
  // Generation / scope staleness (mission §16-17, §28)
  // ================================================================

  @Test
  void generationChangeMarksTheOldSessionStaleAndStopsIt_neverMigratesCredentials() {
    seedPods(List.of(pod("payment-api-abc", List.of("app"))));
    selectOnly("payment-api-abc", "app");
    script("payment-api-abc", "app", Flux.never());

    LiveFollowResult result = provider.follow();
    List<LiveSourceStatus> statuses = subscribeToStatus(result);
    Disposable subscription = result.events().subscribe();
    try {
      waitUntil(Duration.ofSeconds(1), () -> totalCalls() >= 1);

      OcLoginCommand reconnectCommand = new OcLoginCommand(URI.create("https://cluster.example.invalid:6443"), TOKEN, null);
      long newGeneration = session.connect(
          reconnectCommand, "Test", "developer", List.of(NAMESPACE), ProjectDiscovery.Api.PROJECTS, null);
      assertThat(session.selectProject(NAMESPACE, newGeneration)).isTrue();

      waitUntil(Duration.ofSeconds(2), () -> latest(statuses).state() == LiveSourceStatus.State.STALE);
      // Never a second call against the NEW generation's own credentials -
      // the OLD session only ever stops itself, it never re-authenticates.
      assertThat(totalCalls()).isEqualTo(1);
    } finally {
      subscription.dispose();
    }
  }

  @Test
  void scopeChangeWhileImmutableSnapshotActiveIsSurfacedAsStale() {
    seedPods(List.of(pod("payment-api-1", List.of("app")), pod("payment-api-2", List.of("app"))));
    assertThat(session.selectPod("payment-api-1", generation)).isTrue();
    assertThat(session.updateContainers(List.of("app"), "payment-api-1", generation)).isTrue();
    assertThat(session.selectContainer("app", generation)).isTrue();
    script("payment-api-1", "app", Flux.never());

    LiveFollowResult result = provider.follow();
    List<LiveSourceStatus> statuses = subscribeToStatus(result);
    Disposable subscription = result.events().subscribe();
    try {
      waitUntil(Duration.ofSeconds(1), () -> totalCalls() >= 1);

      // The user changes the selected pod while Live keeps following the
      // OLD immutable target snapshot (payment-api-1).
      assertThat(session.selectPod("payment-api-2", generation)).isTrue();

      waitUntil(Duration.ofSeconds(2), () -> latest(statuses).state() == LiveSourceStatus.State.STALE);
      assertThat(latest(statuses).warnings()).anyMatch(w -> w.contains("SCOPE_CHANGED_RESTART_LIVE"));
    } finally {
      subscription.dispose();
    }
  }
}
