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
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import reactor.core.Disposable;
import reactor.core.publisher.Flux;
import reactor.test.StepVerifier;

/**
 * OS-1E mission §37/§38/§39 — multi-target merge, generation isolation,
 * and reconnect classification for {@link OpenShiftLiveTailProvider}.
 *
 * <p>{@link OpenShiftApiClient} is mocked rather than exercised over real
 * HTTP: {@link OpenShiftApiClientLiveStreamTest} already covers the wire-
 * level streaming/decoding contract in full; this class's own job is the
 * orchestration layer above it (target resolution reuse, one atomic
 * snapshot, per-target reconnect classification, multi-target merge,
 * truthful warnings) — deliberately isolated from that lower layer, the
 * same layering {@code DirectPodLogProviderTest} (real fake HTTP server)
 * and this class's own peers already establish for search.
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

  /** Queues one canned Flux<String> per (pod, container) target, consumed in call order — lets a test script exactly what each successive connect attempt to that target returns. */
  private final Map<String, Deque<Flux<String>>> scripted = new ConcurrentHashMap<>();

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
    provider = new OpenShiftLiveTailProvider(client, session, parser, directPodLogProvider, searchProperties, liveProperties);

    when(client.followPodLog(any(), any(), any(), anyString(), anyString(), anyString(), anyInt(), anyInt()))
        .thenAnswer(invocation -> {
          String pod = invocation.getArgument(4);
          String container = invocation.getArgument(5);
          Deque<Flux<String>> queue = scripted.get(pod + "/" + container);
          if (queue == null || queue.isEmpty()) {
            // A clean, immediate "no more data" completion once a test's
            // own script is exhausted - NOT Flux.never(): production code
            // always attempts a bounded reconnect after ANY stream end
            // (mission §18 "a clean stream end is treated as transient"),
            // so a never-completing fallback would make every finite test
            // script hang forever waiting for a bounded give-up that can
            // never arrive. This fallback lets that same real give-up
            // behavior actually run to completion within a test.
            return Flux.empty();
          }
          return queue.poll();
        });

    OcLoginCommand command = new OcLoginCommand(URI.create("https://cluster.example.invalid:6443"), TOKEN, null);
    generation = session.connect(command, "Test", "developer", List.of(NAMESPACE), ProjectDiscovery.Api.PROJECTS, null);
    assertThat(session.selectProject(NAMESPACE, generation)).isTrue();
  }

  private void script(String pod, String container, Flux<String>... attempts) {
    Deque<Flux<String>> queue = new ArrayDeque<>(List.of(attempts));
    scripted.put(pod + "/" + container, queue);
  }

  private PodSummary pod(String name, List<String> containers) {
    return new PodSummary(name, "Running", containers.size() + "/" + containers.size(), 0, containers, null);
  }

  private void seedPods(List<PodSummary> pods) {
    assertThat(session.updatePods(pods, true, NAMESPACE, null, generation)).isTrue();
  }

  /**
   * Subscribes to {@code result.warnings()} immediately, before the
   * caller ever touches {@code result.events()} - required because the
   * warnings sink is a hot multicast channel: a warning emitted
   * synchronously at live-session start (e.g. {@code NO_LIVE_TARGETS},
   * {@code TARGET_CAP_REACHED}) would otherwise be missed by a subscriber
   * that only attaches after {@code events()} has already been driven.
   */
  private static List<List<String>> subscribeToWarnings(LiveFollowResult result) {
    List<List<String>> collected = new ArrayList<>();
    result.warnings().subscribe(collected::add);
    return collected;
  }

  private static String rawLine(String timestamp, String message) {
    return timestamp + " {\"@timestamp\":\"2026-09-12T10:00:00Z\",\"application\":\"payments\",\"level\":\"INFO\""
        + ",\"message\":\"" + message + "\"}";
  }

  // ------------------------------------------------------------ single target normal follow

  @Test
  void oneTargetNormalFollowEmitsFullyEnrichedCanonicalLogEvents() {
    seedPods(List.of(pod("payment-api-abc", List.of("app"))));
    assertThat(session.selectPod("payment-api-abc", generation)).isTrue();
    assertThat(session.updateContainers(List.of("app"), "payment-api-abc", generation)).isTrue();
    assertThat(session.selectContainer("app", generation)).isTrue();

    script("payment-api-abc", "app", Flux.just(rawLine("2026-09-12T10:00:00.000000000Z", "hello")));

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

  // ------------------------------------------------------------ multi-target merge (mission §37)

  @Test
  void multipleTargetsAreMergedIntoOneEventStream_neverJoinedOrDropped() {
    seedPods(List.of(
        pod("payment-api-1", List.of("app")),
        pod("payment-api-2", List.of("app"))));
    // Pod=All + Workload=All -> every discovered pod's own containers.

    script("payment-api-1", "app", Flux.just(rawLine("2026-09-12T10:00:00.000000000Z", "from-1")));
    script("payment-api-2", "app", Flux.just(rawLine("2026-09-12T10:00:00.000000000Z", "from-2")));

    LiveFollowResult result = provider.follow();
    List<CanonicalLogEvent> events = result.events().collectList().block(Duration.ofSeconds(2));

    assertThat(events).hasSize(2);
    assertThat(events.stream().map(CanonicalLogEvent::pod)).containsExactlyInAnyOrder("payment-api-1", "payment-api-2");
  }

  @Test
  void oneTargetPermanentlyFailingNeverStopsTheOtherHealthyTargets() {
    seedPods(List.of(
        pod("payment-api-1", List.of("app")),
        pod("payment-api-2", List.of("app"))));

    script("payment-api-1", "app", Flux.error(new OpenShiftApiException(OpenShiftApiException.Kind.FORBIDDEN, "no")));
    script("payment-api-2", "app", Flux.just(rawLine("2026-09-12T10:00:00.000000000Z", "still-alive")));

    LiveFollowResult result = provider.follow();
    List<List<String>> warnings = subscribeToWarnings(result);
    List<CanonicalLogEvent> events = result.events().collectList().block(Duration.ofSeconds(2));

    assertThat(events).hasSize(1);
    assertThat(events.get(0).pod()).isEqualTo("payment-api-2");
    assertThat(warnings).isNotEmpty();
    assertThat(warnings.get(0).get(0)).contains("payment-api-1").contains("403");
  }

  // ------------------------------------------------------------ target cap (reuse of resolveTargets/maxTargets)

  @Test
  void targetCapReachedIsReportedTruthfullyOnWarnings() {
    searchProperties.setMaxTargets(1);
    seedPods(List.of(
        pod("payment-api-1", List.of("app")),
        pod("payment-api-2", List.of("app"))));
    script("payment-api-1", "app", Flux.never());
    script("payment-api-2", "app", Flux.never());

    LiveFollowResult result = provider.follow();
    List<List<String>> warnings = subscribeToWarnings(result);
    result.events().take(Duration.ofMillis(100)).blockLast();

    assertThat(warnings).isNotEmpty();
    assertThat(warnings.get(0).get(0)).contains("TARGET_CAP_REACHED");
  }

  @Test
  void zeroResolvedTargetsCompletesTheStreamAndWarnsRatherThanHanging() {
    // No pods seeded at all - scope resolves to zero targets.
    LiveFollowResult result = provider.follow();
    List<List<String>> warnings = subscribeToWarnings(result);

    StepVerifier.create(result.events()).expectComplete().verify(Duration.ofSeconds(2));

    assertThat(warnings).isNotEmpty();
    assertThat(warnings.get(0).get(0)).contains("NO_LIVE_TARGETS");
  }

  // ------------------------------------------------------------ generation isolation (mission §38)

  @Test
  void aUnauthorizedFailureExpiresTheSessionOnlyWhenGenerationStillMatches() {
    seedPods(List.of(pod("payment-api-abc", List.of("app"))));
    assertThat(session.selectPod("payment-api-abc", generation)).isTrue();
    assertThat(session.updateContainers(List.of("app"), "payment-api-abc", generation)).isTrue();
    assertThat(session.selectContainer("app", generation)).isTrue();

    script("payment-api-abc", "app", Flux.error(new OpenShiftApiException(OpenShiftApiException.Kind.UNAUTHORIZED, "expired")));

    LiveFollowResult result = provider.follow();
    result.events().collectList().block(Duration.ofSeconds(2));

    assertThat(session.state()).isEqualTo(OpenShiftConnectionState.EXPIRED);
  }

  @Test
  void aUnauthorizedFailureFromAStaleGenerationNeverExpiresTheCurrentConnection() {
    seedPods(List.of(pod("payment-api-abc", List.of("app"))));
    assertThat(session.selectPod("payment-api-abc", generation)).isTrue();
    assertThat(session.updateContainers(List.of("app"), "payment-api-abc", generation)).isTrue();
    assertThat(session.selectContainer("app", generation)).isTrue();

    script("payment-api-abc", "app", Flux.error(new OpenShiftApiException(OpenShiftApiException.Kind.UNAUTHORIZED, "expired")));

    LiveFollowResult result = provider.follow();

    // A reconnect happens BEFORE the stale 401 is observed - the live
    // session's own captured generation is now behind the session's real
    // current generation, exactly the race this test proves is handled
    // safely (mirrors ConnectionOperationSnapshotTest's own real-
    // interleaving technique one layer up).
    OcLoginCommand reconnectCommand = new OcLoginCommand(URI.create("https://cluster.example.invalid:6443"), TOKEN, null);
    long newGeneration = session.connect(
        reconnectCommand, "Test", "developer", List.of(NAMESPACE), ProjectDiscovery.Api.PROJECTS, null);
    assertThat(session.selectProject(NAMESPACE, newGeneration)).isTrue();

    result.events().collectList().block(Duration.ofSeconds(2));

    // The 401 belonged to the OLD (now-replaced) connection - the NEW
    // connection must remain CONNECTED, never collaterally expired.
    assertThat(session.state()).isEqualTo(OpenShiftConnectionState.CONNECTED);
    assertThat(session.generation()).isEqualTo(newGeneration);
  }

  // ------------------------------------------------------------ reconnect classification (mission §39)

  @Test
  void aForbiddenFailureStopsPermanentlyWithoutAnyReconnectAttempt() {
    seedPods(List.of(pod("payment-api-abc", List.of("app"))));
    assertThat(session.selectPod("payment-api-abc", generation)).isTrue();
    assertThat(session.updateContainers(List.of("app"), "payment-api-abc", generation)).isTrue();
    assertThat(session.selectContainer("app", generation)).isTrue();

    script("payment-api-abc", "app", Flux.error(new OpenShiftApiException(OpenShiftApiException.Kind.FORBIDDEN, "no")));

    provider.follow().events().collectList().block(Duration.ofSeconds(2));

    verify(client, times(1))
        .followPodLog(any(), any(), any(), eq(NAMESPACE), eq("payment-api-abc"), eq("app"), anyInt(), anyInt());
  }

  @Test
  void aNotFoundFailureStopsPermanentlyWithoutAnyReconnectAttempt() {
    seedPods(List.of(pod("payment-api-abc", List.of("app"))));
    assertThat(session.selectPod("payment-api-abc", generation)).isTrue();
    assertThat(session.updateContainers(List.of("app"), "payment-api-abc", generation)).isTrue();
    assertThat(session.selectContainer("app", generation)).isTrue();

    script("payment-api-abc", "app", Flux.error(new OpenShiftApiException(OpenShiftApiException.Kind.NOT_FOUND, "gone")));

    provider.follow().events().collectList().block(Duration.ofSeconds(2));

    verify(client, times(1))
        .followPodLog(any(), any(), any(), eq(NAMESPACE), eq("payment-api-abc"), eq("app"), anyInt(), anyInt());
  }

  @Test
  void aTransientFailureReconnectsAndCanSucceedOnALaterAttempt() {
    seedPods(List.of(pod("payment-api-abc", List.of("app"))));
    assertThat(session.selectPod("payment-api-abc", generation)).isTrue();
    assertThat(session.updateContainers(List.of("app"), "payment-api-abc", generation)).isTrue();
    assertThat(session.selectContainer("app", generation)).isTrue();

    script(
        "payment-api-abc", "app",
        Flux.error(new OpenShiftApiException(OpenShiftApiException.Kind.NETWORK, "reset")),
        Flux.just(rawLine("2026-09-12T10:00:00.000000000Z", "recovered")));

    List<CanonicalLogEvent> events = provider.follow().events().collectList().block(Duration.ofSeconds(2));

    assertThat(events).hasSize(1);
    assertThat(events.get(0).message()).isEqualTo("recovered");
    // At least: the first (failing) attempt + the second (recovering) one.
    // The stream keeps this bounded reconnect budget available afterward
    // too (mission §18 - a fresh disconnect after a real recovery gets a
    // fresh budget), so further give-up attempts against the now-empty
    // script may follow - this test's own concern is only "did it actually
    // recover and emit the event," not the exact trailing call count.
    verify(client, org.mockito.Mockito.atLeast(2))
        .followPodLog(any(), any(), any(), eq(NAMESPACE), eq("payment-api-abc"), eq("app"), anyInt(), anyInt());
  }

  @Test
  void aPersistentTransientFailureGivesUpAfterMaxReconnectAttemptsAndWarns() {
    seedPods(List.of(pod("payment-api-abc", List.of("app"))));
    assertThat(session.selectPod("payment-api-abc", generation)).isTrue();
    assertThat(session.updateContainers(List.of("app"), "payment-api-abc", generation)).isTrue();
    assertThat(session.selectContainer("app", generation)).isTrue();

    Flux<String> alwaysFails = Flux.error(new OpenShiftApiException(OpenShiftApiException.Kind.TIMEOUT, "slow"));
    script("payment-api-abc", "app", alwaysFails, alwaysFails, alwaysFails, alwaysFails, alwaysFails);

    LiveFollowResult result = provider.follow();
    List<List<String>> warnings = subscribeToWarnings(result);
    List<CanonicalLogEvent> events = new ArrayList<>();
    StepVerifier.create(result.events().doOnNext(events::add))
        .expectComplete()
        .verify(Duration.ofSeconds(5));

    assertThat(events).isEmpty();
    assertThat(warnings).isNotEmpty();
    assertThat(warnings.get(warnings.size() - 1).get(0)).contains("gave up reconnecting");
    // initial attempt (0) + maxReconnectAttempts(2) retries = 3 real calls.
    verify(client, times(3))
        .followPodLog(any(), any(), any(), eq(NAMESPACE), eq("payment-api-abc"), eq("app"), anyInt(), anyInt());
  }
}
