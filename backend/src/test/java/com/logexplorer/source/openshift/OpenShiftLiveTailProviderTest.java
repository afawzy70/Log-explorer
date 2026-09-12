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
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.BooleanSupplier;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import reactor.core.Disposable;
import reactor.core.publisher.Flux;

/**
 * OS-1E final implementation — connection-establishment truthfulness
 * (mission §2/§3/§6, §23 CONNECT-1..6), the {@code CONNECTING} state and
 * the exact session-state derivation formula (mission §5, §24), real
 * {@code REAL_RECOVERY} vs. mere establishment (mission §8), the exact
 * long-line boundary and partial-final-line wiring (mission §10-14,
 * §26), and staleness/generation isolation for {@link
 * OpenShiftLiveTailProvider}.
 *
 * <p>{@link OpenShiftApiClient} is mocked rather than exercised over real
 * HTTP: {@link OpenShiftApiClientLiveStreamTest} already covers the wire-
 * level streaming/decoding contract (including the exact long-line
 * boundary and partial-final-line semantics) in full; this class's own
 * job is the orchestration layer above it — in particular, that {@code
 * ACTIVE} is driven ONLY by the {@code onEstablished} callback (never by
 * data, never by the method merely being called), and that the reconnect
 * budget is driven ONLY by genuine decoded content (never by
 * establishment alone).
 */
class OpenShiftLiveTailProviderTest {

  private static final String NAMESPACE = "payments";
  private static final RawToken TOKEN = RawToken.of("sha256~live-tail-test-token-0123456789");

  /** One scripted connection attempt: the Flux it returns, and whether the mock should invoke {@code onEstablished} before returning it — mirrors exactly what a real 2xx-vs-non-2xx response would do. */
  private record ScriptedAttempt(Flux<OpenShiftApiClient.DecodedLine> flux, boolean establishes) {
  }

  private OpenShiftApiClient client;
  private OpenShiftSession session;
  private DirectPodLogProvider directPodLogProvider;
  private DirectPodLogProperties searchProperties;
  private OpenShiftLiveProperties liveProperties;
  private OpenShiftLiveTailProvider provider;
  private long generation;

  /** Queues one canned attempt per (pod, container) target, consumed in call order. */
  private final Map<String, Deque<ScriptedAttempt>> scripted = new ConcurrentHashMap<>();
  /** Every {@code tailLines} value THIS target was actually called with, in call order. */
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
    liveProperties.setConnectPermitTimeout(Duration.ofSeconds(30)); // effectively "never" for these tests unless explicitly shortened
    liveProperties.setStalenessCheckInterval(Duration.ofMillis(20));
    provider = new OpenShiftLiveTailProvider(client, session, parser, directPodLogProvider, searchProperties, liveProperties);

    when(client.followPodLog(any(), any(), any(), anyString(), anyString(), anyString(), anyInt(), anyInt(), any(), any()))
        .thenAnswer(invocation -> {
          String pod = invocation.getArgument(4);
          String container = invocation.getArgument(5);
          int tailLines = invocation.getArgument(6);
          Runnable onEstablished = invocation.getArgument(8);
          tailLinesCalls.computeIfAbsent(pod + "/" + container, k -> new CopyOnWriteArrayList<>()).add(tailLines);
          Deque<ScriptedAttempt> queue = scripted.get(pod + "/" + container);
          if (queue == null || queue.isEmpty()) {
            // A clean, immediate "no more data" completion once a test's
            // own script is exhausted - NOT Flux.never(): production code
            // always attempts a bounded reconnect after ANY stream end,
            // so a never-completing fallback would make every finite test
            // script hang forever waiting for a bounded give-up that can
            // never arrive. Deliberately does NOT call onEstablished -
            // conservative default for a fallback the test itself never
            // explicitly authored.
            return Flux.<OpenShiftApiClient.DecodedLine>empty();
          }
          ScriptedAttempt attempt = queue.poll();
          if (attempt.establishes()) {
            onEstablished.run();
          }
          return attempt.flux();
        });

    OcLoginCommand command = new OcLoginCommand(URI.create("https://cluster.example.invalid:6443"), TOKEN, null);
    generation = session.connect(command, "Test", "developer", List.of(NAMESPACE), ProjectDiscovery.Api.PROJECTS, null);
    assertThat(session.selectProject(NAMESPACE, generation)).isTrue();
  }

  private void script(String pod, String container, ScriptedAttempt... attempts) {
    scripted.put(pod + "/" + container, new ArrayDeque<>(List.of(attempts)));
  }

  private static ScriptedAttempt established(Flux<OpenShiftApiClient.DecodedLine> flux) {
    return new ScriptedAttempt(flux, true);
  }

  private static ScriptedAttempt notEstablished(Flux<OpenShiftApiClient.DecodedLine> flux) {
    return new ScriptedAttempt(flux, false);
  }

  /** A real 2xx connection that immediately delivers one line - the common case. */
  private static ScriptedAttempt justLine(String rawLine) {
    return established(Flux.just(new OpenShiftApiClient.DecodedLine(rawLine, false, false)));
  }

  /** A real 2xx connection that stays open and silent forever (a genuinely quiet, healthy stream). */
  private static ScriptedAttempt quietlyEstablished() {
    return established(Flux.never());
  }

  /** Never even receives a response - the connection attempt itself fails (e.g. DNS/connect failure), so onEstablished must never fire. */
  private static ScriptedAttempt neverEstablished(OpenShiftApiException.Kind kind) {
    return notEstablished(Flux.error(new OpenShiftApiException(kind, "test")));
  }

  /** A real 2xx connection that later fails mid-stream (e.g. a connection reset) - onEstablished fires, then the stream errors. */
  private static ScriptedAttempt establishedThenFails(OpenShiftApiException.Kind kind) {
    return established(Flux.error(new OpenShiftApiException(kind, "test")));
  }

  /** A permanent-classification failure (401/403/404) is always a genuine HTTP response - never established as a live stream, by definition. */
  private static ScriptedAttempt permanentFailure(OpenShiftApiException.Kind kind) {
    return notEstablished(Flux.error(new OpenShiftApiException(kind, "test")));
  }

  private PodSummary pod(String name, List<String> containers) {
    return new PodSummary(name, "Running", containers.size() + "/" + containers.size(), 0, containers, null);
  }

  private void seedPods(List<PodSummary> pods) {
    assertThat(session.updatePods(pods, true, NAMESPACE, null, generation)).isTrue();
  }

  private void seedNPods(int n) {
    List<PodSummary> pods = new ArrayList<>();
    for (int i = 1; i <= n; i++) {
      pods.add(pod("payment-api-" + i, List.of("app")));
    }
    seedPods(pods);
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
    script("payment-api-1", "app", permanentFailure(OpenShiftApiException.Kind.FORBIDDEN));
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
    script("payment-api-1", "app", quietlyEstablished());
    script("payment-api-2", "app", quietlyEstablished());

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

    List<CanonicalLogEvent> events = result.events().collectList().block(Duration.ofSeconds(2));
    assertThat(events).isEmpty();

    LiveSourceStatus status = latest(statuses);
    assertThat(status.state()).isEqualTo(LiveSourceStatus.State.NO_ACTIVE_TARGETS);
    assertThat(status.warnings()).anyMatch(w -> w.contains("NO_LIVE_TARGETS"));
  }

  // ------------------------------------------------------------ initial tail truthfulness

  @Test
  void initialTailTruthfulnessNoticeIsIncludedOnceWhenTargetsExist() {
    seedPods(List.of(pod("payment-api-abc", List.of("app"))));
    selectOnly("payment-api-abc", "app");
    script("payment-api-abc", "app", quietlyEstablished());

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
    script("payment-api-abc", "app", permanentFailure(OpenShiftApiException.Kind.UNAUTHORIZED));

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
    script("payment-api-abc", "app", permanentFailure(OpenShiftApiException.Kind.UNAUTHORIZED));

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
    script("payment-api-abc", "app", permanentFailure(OpenShiftApiException.Kind.FORBIDDEN));

    provider.follow().events().collectList().block(Duration.ofSeconds(2));

    verify(client, times(1)).followPodLog(
        any(), any(), any(), eq(NAMESPACE), eq("payment-api-abc"), eq("app"), anyInt(), anyInt(), any(), any());
  }

  @Test
  void aNotFoundFailureStopsPermanentlyWithoutAnyReconnectAttempt() {
    seedPods(List.of(pod("payment-api-abc", List.of("app"))));
    selectOnly("payment-api-abc", "app");
    script("payment-api-abc", "app", permanentFailure(OpenShiftApiException.Kind.NOT_FOUND));

    provider.follow().events().collectList().block(Duration.ofSeconds(2));

    verify(client, times(1)).followPodLog(
        any(), any(), any(), eq(NAMESPACE), eq("payment-api-abc"), eq("app"), anyInt(), anyInt(), any(), any());
  }

  @Test
  void aTlsFailureIsBoundedRatherThanRetriedForever() {
    liveProperties.setMaxReconnectAttempts(2);
    seedPods(List.of(pod("payment-api-abc", List.of("app"))));
    selectOnly("payment-api-abc", "app");
    ScriptedAttempt tlsFailure = establishedThenFails(OpenShiftApiException.Kind.TLS);
    script("payment-api-abc", "app", tlsFailure, tlsFailure, tlsFailure, tlsFailure, tlsFailure);

    LiveFollowResult result = provider.follow();
    result.events().collectList().block(Duration.ofSeconds(5));

    // initial attempt (0) + maxReconnectAttempts(2) retries = 3 real calls, never more.
    verify(client, times(3)).followPodLog(
        any(), any(), any(), eq(NAMESPACE), eq("payment-api-abc"), eq("app"), anyInt(), anyInt(), any(), any());
  }

  @Test
  void aPersistentTransientFailureGivesUpAfterMaxReconnectAttemptsAndWarns() {
    seedPods(List.of(pod("payment-api-abc", List.of("app"))));
    selectOnly("payment-api-abc", "app");
    ScriptedAttempt alwaysFails = establishedThenFails(OpenShiftApiException.Kind.TIMEOUT);
    script("payment-api-abc", "app", alwaysFails, alwaysFails, alwaysFails, alwaysFails, alwaysFails);

    LiveFollowResult result = provider.follow();
    List<LiveSourceStatus> statuses = subscribeToStatus(result);
    List<CanonicalLogEvent> events = result.events().collectList().block(Duration.ofSeconds(5));

    assertThat(events).isEmpty();
    assertThat(latest(statuses).state()).isEqualTo(LiveSourceStatus.State.NO_ACTIVE_TARGETS);
    assertThat(latest(statuses).warnings()).anyMatch(w -> w.contains("gave up reconnecting"));
    verify(client, times(3)).followPodLog(
        any(), any(), any(), eq(NAMESPACE), eq("payment-api-abc"), eq("app"), anyInt(), anyInt(), any(), any());
  }

  // ================================================================
  // Initial tail / reconnect (mission §7/§8/§9)
  // ================================================================

  @Test
  void initialTailUsesConfiguredValueEveryReconnectUsesZero() {
    liveProperties.setInitialTailLines(5);
    seedPods(List.of(pod("payment-api-abc", List.of("app"))));
    selectOnly("payment-api-abc", "app");
    ScriptedAttempt h = justLine(rawLine("2026-09-12T10:00:00.000000000Z", "H"));
    ScriptedAttempt fail = establishedThenFails(OpenShiftApiException.Kind.NETWORK);
    script("payment-api-abc", "app", h, fail, fail, fail);

    provider.follow().events().collectList().block(Duration.ofSeconds(2));

    List<Integer> calls = tailLinesCalls.get("payment-api-abc/app");
    assertThat(calls).isNotEmpty();
    assertThat(calls.get(0)).isEqualTo(5); // attempt 0 - the real, configured initial tail
    assertThat(calls.subList(1, calls.size())).allMatch(v -> v == 0); // every reconnect - never replays history
  }

  @Test
  void historicalTailEventCannotResetTheReconnectBudget() {
    liveProperties.setMaxReconnectAttempts(2);
    seedPods(List.of(pod("payment-api-abc", List.of("app"))));
    selectOnly("payment-api-abc", "app");
    ScriptedAttempt h = justLine(rawLine("2026-09-12T10:00:00.000000000Z", "H"));
    ScriptedAttempt emptyClose = established(Flux.empty());
    script("payment-api-abc", "app", h, emptyClose, emptyClose, emptyClose, emptyClose);

    List<CanonicalLogEvent> events = provider.follow().events().collectList().block(Duration.ofSeconds(2));

    assertThat(events).hasSize(1); // H, exactly once - never replayed
    // attempt0 (H) + 2 reconnect attempts = exactly 3 calls, never more.
    verify(client, times(3)).followPodLog(
        any(), any(), any(), eq(NAMESPACE), eq("payment-api-abc"), eq("app"), anyInt(), anyInt(), any(), any());
  }

  @Test
  void establishmentAloneWithoutGenuineDataDoesNotResetTheReconnectBudget() {
    // Mission §8 - a 2xx re-establishment alone (no genuine post-reconnect
    // line) must NOT reset the outage budget, only proven data does.
    liveProperties.setMaxReconnectAttempts(2);
    seedPods(List.of(pod("payment-api-abc", List.of("app"))));
    selectOnly("payment-api-abc", "app");
    ScriptedAttempt fail = establishedThenFails(OpenShiftApiException.Kind.NETWORK);
    // Every attempt establishes (2xx) but never delivers a line before
    // failing again - if establishment alone counted as REAL_RECOVERY,
    // this target would never exhaust its budget.
    script("payment-api-abc", "app", fail, fail, fail, fail, fail);

    provider.follow().events().collectList().block(Duration.ofSeconds(5));

    // initial attempt (0) + maxReconnectAttempts(2) retries = exactly 3 calls.
    verify(client, times(3)).followPodLog(
        any(), any(), any(), eq(NAMESPACE), eq("payment-api-abc"), eq("app"), anyInt(), anyInt(), any(), any());
  }

  @Test
  void aGenuinePostReconnectEventResetsTheBudget() {
    liveProperties.setMaxReconnectAttempts(2);
    seedPods(List.of(pod("payment-api-abc", List.of("app"))));
    selectOnly("payment-api-abc", "app");
    ScriptedAttempt fail = establishedThenFails(OpenShiftApiException.Kind.NETWORK);
    ScriptedAttempt recoveredThenFails = established(Flux.concat(
        Flux.just(new OpenShiftApiClient.DecodedLine(rawLine("2026-09-12T10:00:00.000000000Z", "recovered"), false, false)),
        Flux.error(new OpenShiftApiException(OpenShiftApiException.Kind.NETWORK, "again"))));
    // attempt0: fail (1/2). attempt1 (reconnect): delivers a REAL event,
    // then fails - REAL_RECOVERY, budget resets to 0. attempts2,3: fail
    // (a fresh 1/2, 2/2 - would have been exhausted at attempt3 WITHOUT
    // the reset). attempt4: fail -> now exceeds the fresh budget.
    script("payment-api-abc", "app", fail, recoveredThenFails, fail, fail, fail, fail);

    List<CanonicalLogEvent> events = provider.follow().events().collectList().block(Duration.ofSeconds(2));

    assertThat(events).hasSize(1);
    assertThat(events.get(0).message()).isEqualTo("recovered");
    // Without the reset, exhaustion would occur at 3 total calls.
    List<Integer> calls = tailLinesCalls.get("payment-api-abc/app");
    assertThat(calls.size()).isGreaterThan(3);
  }

  @Test
  void retryExhaustionIsExactlyDeterministic() {
    liveProperties.setMaxReconnectAttempts(4);
    seedPods(List.of(pod("payment-api-abc", List.of("app"))));
    selectOnly("payment-api-abc", "app");
    ScriptedAttempt fails = establishedThenFails(OpenShiftApiException.Kind.TIMEOUT);
    script("payment-api-abc", "app", fails, fails, fails, fails, fails, fails, fails);

    provider.follow().events().collectList().block(Duration.ofSeconds(5));

    // initial attempt (0) + maxReconnectAttempts(4) retries = exactly 5 calls.
    verify(client, times(5)).followPodLog(
        any(), any(), any(), eq(NAMESPACE), eq("payment-api-abc"), eq("app"), anyInt(), anyInt(), any(), any());
  }

  @Test
  void stopDuringReconnectBackoffCancelsTheRetry() {
    liveProperties.setInitialReconnectDelay(Duration.ofSeconds(5)); // long enough to reliably dispose mid-wait
    seedPods(List.of(pod("payment-api-abc", List.of("app"))));
    selectOnly("payment-api-abc", "app");
    script("payment-api-abc", "app", establishedThenFails(OpenShiftApiException.Kind.NETWORK));

    Disposable subscription = provider.follow().events().subscribe();
    waitUntil(Duration.ofSeconds(1), () -> tailLinesCalls.getOrDefault("payment-api-abc/app", List.of()).size() >= 1);
    subscription.dispose(); // Stop, while the target is waiting out its backoff delay

    try {
      Thread.sleep(200);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }
    assertThat(tailLinesCalls.get("payment-api-abc/app")).hasSize(1);
  }

  // ================================================================
  // Overlong / unterminated / dropped-partial-line status propagation
  // ================================================================

  @Test
  void overlongLineTruncationReachesRuntimeStatusAsABoundedCount() {
    seedPods(List.of(pod("payment-api-abc", List.of("app"))));
    selectOnly("payment-api-abc", "app");
    script(
        "payment-api-abc", "app",
        established(Flux.just(
            new OpenShiftApiClient.DecodedLine("y".repeat(16), true, false),
            new OpenShiftApiClient.DecodedLine("z".repeat(16), true, false),
            new OpenShiftApiClient.DecodedLine("normal", false, false))));

    LiveFollowResult result = provider.follow();
    List<LiveSourceStatus> statuses = subscribeToStatus(result);
    List<CanonicalLogEvent> events = result.events().collectList().block(Duration.ofSeconds(2));

    assertThat(events).hasSize(3); // truncated lines are still real events, just marked - never dropped silently
    assertThat(latest(statuses).warnings()).anyMatch(w -> w.contains("2 overlong log lines") && w.contains("LIVE_LINE_TRUNCATED"));
  }

  @Test
  void unterminatedFinalLineBecomesAnEventAndReachesRuntimeStatusAsABoundedCount() {
    seedPods(List.of(pod("payment-api-abc", List.of("app"))));
    selectOnly("payment-api-abc", "app");
    String trailingFragment = rawLine("2026-09-12T10:00:00.000000000Z", "trailing-no-newline");
    script(
        "payment-api-abc", "app",
        established(Flux.just(new OpenShiftApiClient.DecodedLine(trailingFragment, false, true))));

    LiveFollowResult result = provider.follow();
    List<LiveSourceStatus> statuses = subscribeToStatus(result);
    List<CanonicalLogEvent> events = result.events().collectList().block(Duration.ofSeconds(2));

    assertThat(events).hasSize(1);
    assertThat(events.get(0).message()).isEqualTo("trailing-no-newline");
    assertThat(latest(statuses).warnings()).anyMatch(w -> w.contains("UNTERMINATED_LIVE_LINE"));
  }

  @Test
  void partialLineDroppedByTransportErrorReachesRuntimeStatusAsABoundedCount() {
    seedPods(List.of(pod("payment-api-abc", List.of("app"))));
    selectOnly("payment-api-abc", "app");
    // Directly exercises the provider's own wiring of onPartialDroppedByError
    // into SessionRuntimeState - the decoder-level mechanics that decide
    // WHEN this callback fires are already fully covered by
    // OpenShiftApiClientLiveStreamTest.
    when(client.followPodLog(any(), any(), any(), anyString(), anyString(), anyString(), anyInt(), anyInt(), any(), any()))
        .thenAnswer(invocation -> {
          Runnable onEstablished = invocation.getArgument(8);
          Runnable onPartialDroppedByError = invocation.getArgument(9);
          onEstablished.run();
          onPartialDroppedByError.run();
          return Flux.error(new OpenShiftApiException(OpenShiftApiException.Kind.NETWORK, "reset"));
        });
    liveProperties.setMaxReconnectAttempts(0);

    LiveFollowResult result = provider.follow();
    List<LiveSourceStatus> statuses = subscribeToStatus(result);
    result.events().collectList().block(Duration.ofSeconds(2));

    assertThat(latest(statuses).warnings()).anyMatch(w -> w.contains("PARTIAL_LINE_DROPPED"));
  }

  // ================================================================
  // CONNECT-1..6 — connection-establishment truthfulness (mission §2/§3/§6/§23)
  // ================================================================

  @Test
  void connect1_statusStartsAllConnectingZeroActive_neverRunningInitially() {
    searchProperties.setMaxConcurrency(2);
    seedNPods(10);
    for (int i = 1; i <= 10; i++) {
      script("payment-api-" + i, "app", notEstablished(Flux.never())); // stuck, never resolves either way
    }

    LiveFollowResult result = provider.follow();
    List<LiveSourceStatus> statuses = subscribeToStatus(result);
    Disposable subscription = result.events().subscribe();
    try {
      LiveSourceStatus first = statuses.get(0);
      assertThat(first.connectingTargets()).isEqualTo(10);
      assertThat(first.activeTargets()).isZero();
      assertThat(first.state()).isEqualTo(LiveSourceStatus.State.CONNECTING);
      // Never observed RUNNING at any point during a bounded window.
      Thread.sleep(200);
      assertThat(statuses).noneMatch(s -> s.state() == LiveSourceStatus.State.RUNNING);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    } finally {
      subscription.dispose();
    }
  }

  @Test
  void connect2_onlyMaxConcurrencySimultaneousConnectionAttemptsAreAdmitted() {
    searchProperties.setMaxConcurrency(2);
    seedNPods(10);
    for (int i = 1; i <= 10; i++) {
      script("payment-api-" + i, "app", notEstablished(Flux.never()));
    }

    Disposable subscription = provider.follow().events().subscribe();
    try {
      waitUntil(Duration.ofSeconds(2), () -> totalCalls() >= 2);
      Thread.sleep(200); // give an incorrectly-unbounded implementation a real chance to over-admit
      assertThat(totalCalls()).as("no more than maxConcurrency targets may be admitted at once").isEqualTo(2);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    } finally {
      subscription.dispose();
    }
  }

  @Test
  void connect3_http2xxEstablishedWithNoLogLinesStillBecomesActive() {
    seedPods(List.of(pod("payment-api-abc", List.of("app"))));
    selectOnly("payment-api-abc", "app");
    script("payment-api-abc", "app", quietlyEstablished()); // 2xx, then silent forever - no data ever

    LiveFollowResult result = provider.follow();
    List<LiveSourceStatus> statuses = subscribeToStatus(result);
    Disposable subscription = result.events().subscribe();
    try {
      waitUntil(Duration.ofSeconds(2), () -> latest(statuses).activeTargets() == 1);
      assertThat(latest(statuses).state()).isEqualTo(LiveSourceStatus.State.RUNNING);
    } finally {
      subscription.dispose();
    }
  }

  @Test
  void connect4_quietActiveTargetReleasesItsConnectPermitPromptly_noStarvation() {
    searchProperties.setMaxConcurrency(1);
    seedPods(List.of(pod("payment-api-1", List.of("app")), pod("payment-api-2", List.of("app"))));
    script("payment-api-1", "app", quietlyEstablished()); // establishes immediately, then silent forever
    script("payment-api-2", "app", quietlyEstablished());

    LiveFollowResult result = provider.follow();
    List<LiveSourceStatus> statuses = subscribeToStatus(result);
    Disposable subscription = result.events().subscribe();
    try {
      // Both must eventually become ACTIVE even though neither ever sends
      // data and neither ever completes - proving the permit released on
      // establishment, not on data, so the second target was never
      // starved by the first's own permanently-open, silent connection.
      waitUntil(Duration.ofSeconds(2), () -> latest(statuses).activeTargets() == 2);
      assertThat(latest(statuses).connectingTargets()).isZero();
    } finally {
      subscription.dispose();
    }
  }

  @Test
  void connect5_httpFailureBeforeEstablishmentNeverBecomesActive() {
    seedPods(List.of(pod("payment-api-abc", List.of("app"))));
    selectOnly("payment-api-abc", "app");
    script("payment-api-abc", "app", neverEstablished(OpenShiftApiException.Kind.NETWORK));
    liveProperties.setMaxReconnectAttempts(0);

    LiveFollowResult result = provider.follow();
    List<LiveSourceStatus> statuses = subscribeToStatus(result);
    result.events().collectList().block(Duration.ofSeconds(2));

    assertThat(statuses).noneMatch(s -> s.activeTargets() > 0);
  }

  @Test
  void connect6_permitTimeoutReleasesConcurrencyCapacityButNeverMarksActive() {
    liveProperties.setConnectPermitTimeout(Duration.ofMillis(50));
    searchProperties.setMaxConcurrency(1);
    seedPods(List.of(pod("payment-api-1", List.of("app")), pod("payment-api-2", List.of("app"))));
    script("payment-api-1", "app", notEstablished(Flux.never())); // never resolves either way - holds its permit only via timeout
    script("payment-api-2", "app", quietlyEstablished());

    LiveFollowResult result = provider.follow();
    List<LiveSourceStatus> statuses = subscribeToStatus(result);
    Disposable subscription = result.events().subscribe();
    try {
      // target 2 can only ever be admitted if target 1's permit was
      // released by the timeout (target 1 itself never establishes,
      // never errors) - proves the timeout genuinely frees capacity.
      waitUntil(Duration.ofSeconds(2), () -> tailLinesCalls.getOrDefault("payment-api-2/app", List.of()).size() >= 1);
      // target 1 must still never be reported ACTIVE - the timeout only
      // ever released the PERMIT, it never called onEstablished.
      try {
        Thread.sleep(100);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      }
      assertThat(latest(statuses).activeTargets()).isLessThanOrEqualTo(1); // at most target 2, never target 1 too
    } finally {
      subscription.dispose();
    }
  }

  private int totalCalls() {
    return tailLinesCalls.values().stream().mapToInt(List::size).sum();
  }

  @Test
  void cancellationReleasesAPendingConnectPermit_freshSessionAdmitsCleanly() {
    searchProperties.setMaxConcurrency(1);
    seedPods(List.of(pod("payment-api-1", List.of("app")), pod("payment-api-2", List.of("app"))));
    script("payment-api-1", "app", notEstablished(Flux.never()));
    script("payment-api-2", "app", notEstablished(Flux.never()));

    Disposable subscription = provider.follow().events().subscribe();
    waitUntil(Duration.ofSeconds(2), () -> totalCalls() >= 1);
    assertThat(totalCalls()).isEqualTo(1); // the second target is still queued, waiting for a permit

    subscription.dispose();

    // A brand new session must start cleanly and immediately admit its
    // own first target - proving no global/shared permit state leaked
    // across sessions (each session owns its own fresh Semaphore).
    tailLinesCalls.clear();
    scripted.clear();
    script("payment-api-1", "app", justLine(rawLine("2026-09-12T10:00:00.000000000Z", "fresh")));
    script("payment-api-2", "app", notEstablished(Flux.never()));
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
    // Permanent failure (403) - never established, target 1 never
    // retries, so its permit release is unambiguous.
    script("payment-api-1", "app", permanentFailure(OpenShiftApiException.Kind.FORBIDDEN));
    script("payment-api-2", "app", notEstablished(Flux.never()));

    provider.follow().events().subscribe();

    waitUntil(Duration.ofSeconds(2), () -> totalCalls() >= 2);
    assertThat(tailLinesCalls.get("payment-api-2/app")).isNotEmpty();
  }

  // ================================================================
  // Session-state derivation formula (mission §5/§24)
  // ================================================================

  @Test
  void stateRunning_everyResolvedTargetActive() {
    seedNPods(3);
    for (int i = 1; i <= 3; i++) {
      script("payment-api-" + i, "app", quietlyEstablished());
    }
    LiveFollowResult result = provider.follow();
    List<LiveSourceStatus> statuses = subscribeToStatus(result);
    Disposable subscription = result.events().subscribe();
    try {
      waitUntil(Duration.ofSeconds(2), () -> latest(statuses).activeTargets() == 3);
      LiveSourceStatus status = latest(statuses);
      assertThat(status.state()).isEqualTo(LiveSourceStatus.State.RUNNING);
      assertThat(status.resolvedTargets()).isEqualTo(3);
      assertThat(status.connectingTargets()).isZero();
      // Invariant: R = C + A + Rc + S
      assertThat(status.resolvedTargets())
          .isEqualTo(status.connectingTargets() + status.activeTargets() + status.reconnectingTargets() + status.stoppedTargets());
    } finally {
      subscription.dispose();
    }
  }

  @Test
  void stateConnecting_noneActiveNoneReconnectingNoneStopped() {
    seedNPods(3);
    for (int i = 1; i <= 3; i++) {
      script("payment-api-" + i, "app", notEstablished(Flux.never()));
    }
    LiveFollowResult result = provider.follow();
    List<LiveSourceStatus> statuses = subscribeToStatus(result);
    Disposable subscription = result.events().subscribe();
    try {
      LiveSourceStatus status = statuses.get(0);
      assertThat(status.state()).isEqualTo(LiveSourceStatus.State.CONNECTING);
      assertThat(status.connectingTargets()).isEqualTo(3);
      assertThat(status.resolvedTargets())
          .isEqualTo(status.connectingTargets() + status.activeTargets() + status.reconnectingTargets() + status.stoppedTargets());
    } finally {
      subscription.dispose();
    }
  }

  @Test
  void stateDegraded_someActiveSomeStillConnecting() {
    seedPods(List.of(pod("payment-api-1", List.of("app")), pod("payment-api-2", List.of("app"))));
    script("payment-api-1", "app", quietlyEstablished());
    script("payment-api-2", "app", notEstablished(Flux.never()));

    LiveFollowResult result = provider.follow();
    List<LiveSourceStatus> statuses = subscribeToStatus(result);
    Disposable subscription = result.events().subscribe();
    try {
      waitUntil(Duration.ofSeconds(2), () -> latest(statuses).activeTargets() == 1);
      LiveSourceStatus status = latest(statuses);
      assertThat(status.state()).isEqualTo(LiveSourceStatus.State.DEGRADED);
      assertThat(status.activeTargets()).isEqualTo(1);
      assertThat(status.connectingTargets()).isEqualTo(1);
    } finally {
      subscription.dispose();
    }
  }

  @Test
  void stateDegraded_someActiveSomePermanentlyStopped() {
    seedNPods(2);
    script("payment-api-1", "app", quietlyEstablished());
    script("payment-api-2", "app", permanentFailure(OpenShiftApiException.Kind.FORBIDDEN));

    LiveFollowResult result = provider.follow();
    List<LiveSourceStatus> statuses = subscribeToStatus(result);
    Disposable subscription = result.events().subscribe();
    try {
      waitUntil(Duration.ofSeconds(2), () -> latest(statuses).stoppedTargets() == 1 && latest(statuses).activeTargets() == 1);
      LiveSourceStatus status = latest(statuses);
      assertThat(status.state()).isEqualTo(LiveSourceStatus.State.DEGRADED);
    } finally {
      subscription.dispose();
    }
  }

  @Test
  void stateReconnecting_zeroActiveButSomeStillWithinBudget() {
    liveProperties.setInitialReconnectDelay(Duration.ofSeconds(5)); // stay in the wait long enough to observe it
    seedNPods(1);
    script("payment-api-1", "app", establishedThenFails(OpenShiftApiException.Kind.NETWORK));

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
  void stateNoActiveTargets_zeroActiveZeroConnectingZeroReconnecting() {
    seedNPods(1);
    script("payment-api-1", "app", permanentFailure(OpenShiftApiException.Kind.FORBIDDEN));

    LiveFollowResult result = provider.follow();
    List<LiveSourceStatus> statuses = subscribeToStatus(result);
    result.events().collectList().block(Duration.ofSeconds(2));

    LiveSourceStatus status = latest(statuses);
    assertThat(status.state()).isEqualTo(LiveSourceStatus.State.NO_ACTIVE_TARGETS);
    assertThat(status.activeTargets()).isZero();
    assertThat(status.connectingTargets()).isZero();
    assertThat(status.reconnectingTargets()).isZero();
  }

  @Test
  void stateConnecting_evenWithSomeAlreadyPermanentlyStopped_untilTheOutcomeIsFullyKnown() {
    // The one documented completion of the mission's own literal formula
    // (see SessionRuntimeState#snapshot's own javadoc): some targets
    // already permanently stopped on their very first attempt while
    // OTHERS are still connecting, none ever active or reconnecting - the
    // session's outcome is not yet fully known, so CONNECTING remains the
    // truthful label rather than falling through unhandled.
    seedNPods(2);
    script("payment-api-1", "app", permanentFailure(OpenShiftApiException.Kind.FORBIDDEN));
    script("payment-api-2", "app", notEstablished(Flux.never()));

    LiveFollowResult result = provider.follow();
    List<LiveSourceStatus> statuses = subscribeToStatus(result);
    Disposable subscription = result.events().subscribe();
    try {
      waitUntil(Duration.ofSeconds(2), () -> latest(statuses).stoppedTargets() == 1);
      LiveSourceStatus status = latest(statuses);
      assertThat(status.activeTargets()).isZero();
      assertThat(status.reconnectingTargets()).isZero();
      assertThat(status.connectingTargets()).isEqualTo(1);
      assertThat(status.stoppedTargets()).isEqualTo(1);
      assertThat(status.state()).isEqualTo(LiveSourceStatus.State.CONNECTING);
    } finally {
      subscription.dispose();
    }
  }

  @Test
  void stateExpired_singleUnauthorizedTarget() {
    seedNPods(1);
    script("payment-api-1", "app", permanentFailure(OpenShiftApiException.Kind.UNAUTHORIZED));

    LiveFollowResult result = provider.follow();
    List<LiveSourceStatus> statuses = subscribeToStatus(result);
    result.events().collectList().block(Duration.ofSeconds(2));

    assertThat(latest(statuses).state()).isEqualTo(LiveSourceStatus.State.EXPIRED);
  }

  @Test
  void statusRetainsEveryCurrentlyStoppedTargetsTruth_notOnlyTheLastOneToFail() {
    seedNPods(3);
    script("payment-api-1", "app", permanentFailure(OpenShiftApiException.Kind.FORBIDDEN));
    script("payment-api-2", "app", permanentFailure(OpenShiftApiException.Kind.NOT_FOUND));
    script("payment-api-3", "app", notEstablished(Flux.never()));

    LiveFollowResult result = provider.follow();
    List<LiveSourceStatus> statuses = subscribeToStatus(result);
    Disposable subscription = result.events().subscribe();
    try {
      waitUntil(Duration.ofSeconds(2), () -> latest(statuses).stoppedTargets() == 2);
      LiveSourceStatus status = latest(statuses);
      assertThat(status.warnings()).anyMatch(w -> w.contains("payment-api-1") && w.contains("403"));
      assertThat(status.warnings()).anyMatch(w -> w.contains("payment-api-2") && w.contains("404"));
    } finally {
      subscription.dispose();
    }
  }

  // ================================================================
  // Generation / scope staleness
  // ================================================================

  @Test
  void generationChangeMarksTheOldSessionStaleAndStopsIt_neverMigratesCredentials() {
    seedPods(List.of(pod("payment-api-abc", List.of("app"))));
    selectOnly("payment-api-abc", "app");
    script("payment-api-abc", "app", notEstablished(Flux.never()));

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
    script("payment-api-1", "app", notEstablished(Flux.never()));

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

  // ================================================================
  // Sinks / warnings channel deliver the latest connecting-status snapshot too
  // ================================================================

  @Test
  void statusChannelIsARequestScopedReplayOfOneLatestSnapshot_neverAGlobalField() {
    // Two independent sessions from the same provider bean must never
    // observe each other's target health.
    seedPods(List.of(pod("payment-api-abc", List.of("app"))));
    selectOnly("payment-api-abc", "app");
    script("payment-api-abc", "app", permanentFailure(OpenShiftApiException.Kind.FORBIDDEN));

    LiveFollowResult first = provider.follow();
    List<LiveSourceStatus> firstStatuses = subscribeToStatus(first);
    first.events().collectList().block(Duration.ofSeconds(2));
    assertThat(latest(firstStatuses).state()).isEqualTo(LiveSourceStatus.State.NO_ACTIVE_TARGETS);

    // A fresh session for the SAME target, now healthy - must start with
    // its own fresh CONNECTING truth, never inheriting the first
    // session's own STOPPED history.
    script("payment-api-abc", "app", quietlyEstablished());
    LiveFollowResult second = provider.follow();
    List<LiveSourceStatus> secondStatuses = subscribeToStatus(second);
    Disposable subscription = second.events().subscribe();
    try {
      waitUntil(Duration.ofSeconds(2), () -> latest(secondStatuses).activeTargets() == 1);
      assertThat(secondStatuses.get(0).stoppedTargets()).isZero();
    } finally {
      subscription.dispose();
    }
  }
}
