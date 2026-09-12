package com.logexplorer.source.openshift;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.logexplorer.config.DirectPodLogProperties;
import com.logexplorer.core.guard.GuardrailViolationException;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.RawToken;
import com.logexplorer.core.model.SearchRequest;
import com.logexplorer.core.model.SourceSearchOutcome;
import com.logexplorer.core.parse.LogLineParser;
import com.logexplorer.core.search.ContextTargetProofCodec;
import com.logexplorer.source.openshift.MockOpenShiftPodLogServer.Fixture;
import com.logexplorer.source.openshift.OpenShiftApiException.Kind;
import com.logexplorer.source.openshift.WorkloadDiscovery.KindOutcome;
import java.io.IOException;
import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import reactor.test.StepVerifier;

/**
 * OS-1C Layer 1/2 — direct OpenShift log search against a deterministic
 * fake pod-log endpoint ({@link MockOpenShiftPodLogServer}).
 *
 * <p>Scope is seeded directly through {@link OpenShiftSession}'s own public
 * API (exactly the shape OS-1B's {@code OpenShiftScopeService} would have
 * left behind) rather than via a workload-discovery mock — {@link
 * DirectPodLogProvider} only ever reads {@link OpenShiftSession#scope()},
 * never rediscovers it (OS-1C §4), so seeding it directly is the correct,
 * narrowest way to exercise this class's own contract in isolation.
 */
class DirectPodLogProviderTest {

  private static final String NAMESPACE = "payments";
  private static final RawToken TOKEN = RawToken.of("sha256~pod-log-test-token-0123456789");

  private MockOpenShiftPodLogServer server;
  private OpenShiftApiClient client;
  private OpenShiftSession session;
  private DirectPodLogProperties properties;
  private DirectPodLogProvider provider;
  private ContextTargetProofCodec contextTargetProofCodec;
  private long generation;

  @BeforeEach
  void setUp() throws IOException {
    server = new MockOpenShiftPodLogServer(NAMESPACE);
    client = new OpenShiftApiClient(java.util.Map.of());
    session = new OpenShiftSession();
    properties = new DirectPodLogProperties();
    LogLineParser parser = new LogLineParser(new ObjectMapper());
    contextTargetProofCodec = new ContextTargetProofCodec(new ObjectMapper());
    provider = new DirectPodLogProvider(client, session, parser, properties, contextTargetProofCodec);

    OcLoginCommand command = new OcLoginCommand(URI.create(server.baseUrl()), TOKEN, null);
    generation = session.connect(command, "Test", "developer", List.of(NAMESPACE), ProjectDiscovery.Api.PROJECTS, null);
    assertThat(session.selectProject(NAMESPACE, generation)).isTrue();
  }

  @AfterEach
  void tearDown() {
    if (server != null) {
      server.close();
    }
  }

  // ------------------------------------------------------------ helpers

  private PodSummary pod(String name, List<String> containers) {
    return new PodSummary(name, "Running", containers.size() + "/" + containers.size(), 0, containers, null);
  }

  private void seedPods(List<PodSummary> pods, boolean complete) {
    assertThat(session.updatePods(pods, complete, NAMESPACE, null, generation)).isTrue();
  }

  private void seedWorkloadOutcome(KindOutcome.Status status) {
    List<KindOutcome> outcomes = List.of(new KindOutcome(WorkloadKind.DEPLOYMENT, status));
    assertThat(session.updateWorkloads(List.of(), outcomes, NAMESPACE, generation)).isTrue();
  }

  private static String line(String timestamp, String json) {
    return timestamp + " " + json;
  }

  private static String jsonLine(String app, String level, String message) {
    return "{\"@timestamp\":\"2026-09-12T10:00:00Z\",\"application\":\"" + app + "\",\"level\":\"" + level
        + "\",\"message\":\"" + message + "\"}";
  }

  /** OS-1D — a JSON log line carrying correlation/trace/journey/event MDC fields, per LogLineParser's own contract. */
  private static String jsonLineWithMdc(
      String app, String message, String correlationId, String traceId, String journeyId, String eventId) {
    return "{\"@timestamp\":\"2026-09-12T10:00:00Z\",\"application\":\"" + app + "\",\"level\":\"INFO\""
        + ",\"message\":\"" + message + "\",\"mdc\":{"
        + "\"event.correlationId\":\"" + correlationId + "\","
        + "\"traceId\":\"" + traceId + "\","
        + "\"x-journey-trace-id\":\"" + journeyId + "\","
        + "\"eventId\":\"" + eventId + "\"}}";
  }

  private SearchRequest.Builder baseRequest() {
    return SearchRequest.builder().sourceId("openshift").direction(SearchRequest.Direction.BACKWARD);
  }

  // ------------------------------------------------------------ target resolution

  @Test
  void selectedPodAndSelectedContainerIsExactlyOneTarget() {
    seedPods(List.of(pod("payment-api-abc", List.of("app", "sidecar"))), true);
    assertThat(session.selectPod("payment-api-abc", generation)).isTrue();
    assertThat(session.updateContainers(List.of("app", "sidecar"), "payment-api-abc", generation)).isTrue();
    assertThat(session.selectContainer("app", generation)).isTrue();

    server.setFixture("payment-api-abc", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "started"))));

    List<CanonicalLogEvent> events = provider.search(baseRequest().build()).collectList().block();

    assertThat(events).hasSize(1);
    assertThat(events.get(0).pod()).isEqualTo("payment-api-abc");
    assertThat(events.get(0).containerName()).isEqualTo("app");
    assertThat(server.requestCount()).isEqualTo(1);
  }

  @Test
  void selectedPodWithContainerAllFetchesEveryRuntimeContainerInThatPod() {
    seedPods(List.of(pod("payment-api-abc", List.of("app", "sidecar"))), true);
    assertThat(session.selectPod("payment-api-abc", generation)).isTrue();

    server.setFixture("payment-api-abc", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "from app"))));
    server.setFixture("payment-api-abc", "sidecar", Fixture.ok(line("2026-09-12T10:00:01.000000000Z", jsonLine("payments", "INFO", "from sidecar"))));

    List<CanonicalLogEvent> events = provider.search(baseRequest().build()).collectList().block();

    assertThat(events).extracting(CanonicalLogEvent::containerName).containsExactlyInAnyOrder("app", "sidecar");
  }

  @Test
  void podAllWithSelectedWorkloadFetchesEveryResolvedPodItsOwnContainers() {
    seedPods(List.of(
        pod("payment-api-1", List.of("app")),
        pod("payment-api-2", List.of("app", "metrics"))), true);

    server.setFixture("payment-api-1", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "one"))));
    server.setFixture("payment-api-2", "app", Fixture.ok(line("2026-09-12T10:00:01.000000000Z", jsonLine("payments", "INFO", "two-app"))));
    server.setFixture("payment-api-2", "metrics", Fixture.ok(line("2026-09-12T10:00:02.000000000Z", jsonLine("payments", "INFO", "two-metrics"))));

    List<CanonicalLogEvent> events = provider.search(baseRequest().build()).collectList().block();

    assertThat(events).hasSize(3);
    assertThat(events).filteredOn(e -> e.pod().equals("payment-api-1")).extracting(CanonicalLogEvent::containerName)
        .containsExactly("app");
    assertThat(events).filteredOn(e -> e.pod().equals("payment-api-2")).extracting(CanonicalLogEvent::containerName)
        .containsExactlyInAnyOrder("app", "metrics");
  }

  @Test
  void deselectingWorkloadStillOnlyQueriesWhatOs1bResolvedNeverEveryNamespacePod() {
    // Workload=All is indistinguishable from a selected workload at this
    // layer - scope.pods() is already OS-1B's own resolved set either way
    // (OS-1C §4/§10) - this asserts that DirectPodLogProvider never
    // broadens beyond scope.pods() regardless of why it is small.
    seedPods(List.of(pod("standalone-untouched", List.of("app"))), true);
    // No fixture registered for this pod/container -> a 404 from the mock.
    // With exactly one resolved target and it 404s, every target failed -
    // OS-1C review recovery mission §7 case C: this is now an explicit
    // "no readable target" failure, never a silent complete-empty success
    // (see everyTargetNotFoundIsAnExplicitFailureNeverASilentEmptySearch
    // below for the dedicated coverage of that behavior) - the request
    // count here still proves the provider only ever asked for the one pod
    // OS-1B actually resolved, never invented any other.
    StepVerifier.create(provider.search(baseRequest().build()))
        .expectErrorMatches(e -> e instanceof OpenShiftApiException ex && ex.kind() == Kind.UPSTREAM_UNAVAILABLE)
        .verify();
    assertThat(server.requestCount()).isEqualTo(1);
  }

  // ------------------------------------------------------------ deterministic merge

  @Test
  void mergesMultiplePodsDeterministicallyByTimestampThenNamespacePodContainer() {
    seedPods(List.of(
        pod("pod-b", List.of("app")),
        pod("pod-a", List.of("app"))), true);

    // Same timestamp across two pods - tie-break must be deterministic
    // (namespace, pod, container) never Flux/HTTP arrival order.
    server.setFixture("pod-b", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "b")), 150));
    server.setFixture("pod-a", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "a")), 10));

    List<CanonicalLogEvent> events = provider.search(baseRequest().build()).collectList().block();

    assertThat(events).extracting(CanonicalLogEvent::pod).containsExactly("pod-a", "pod-b");
  }

  @Test
  void resultOrderDoesNotDependOnWhichUpstreamRequestCompletesFirst() {
    seedPods(List.of(
        pod("slow-pod", List.of("app")),
        pod("fast-pod", List.of("app"))), true);

    // slow-pod's own line is chronologically EARLIER but its HTTP response
    // arrives LATER (artificial delay) - the merged order must reflect the
    // timestamp, never completion order.
    server.setFixture("slow-pod", "app", Fixture.ok(line("2026-09-12T09:00:00.000000000Z", jsonLine("payments", "INFO", "earlier-but-slow")), 200));
    server.setFixture("fast-pod", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "later-but-fast")), 0));

    List<CanonicalLogEvent> events = provider.search(baseRequest().direction(SearchRequest.Direction.FORWARD).build())
        .collectList().block();

    assertThat(events).extracting(CanonicalLogEvent::message).containsExactly("earlier-but-slow", "later-but-fast");
  }

  @Test
  void newestFirstAndOldestFirstBothOperateOnTheSameBoundedCandidateSet() {
    seedPods(List.of(pod("pod-a", List.of("app"))), true);
    String body = line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "first"))
        + "\n" + line("2026-09-12T10:00:01.000000000Z", jsonLine("payments", "INFO", "second"));
    server.setFixture("pod-a", "app", Fixture.ok(body));

    List<CanonicalLogEvent> newest = provider.search(baseRequest().direction(SearchRequest.Direction.BACKWARD).build())
        .collectList().block();
    List<CanonicalLogEvent> oldest = provider.search(baseRequest().direction(SearchRequest.Direction.FORWARD).build())
        .collectList().block();

    assertThat(newest).extracting(CanonicalLogEvent::message).containsExactly("second", "first");
    assertThat(oldest).extracting(CanonicalLogEvent::message).containsExactly("first", "second");
  }

  // ------------------------------------------------------------ parsing reuse

  @Test
  void plainTextNonJsonLineBecomesARawFallbackEventNeverDropped() {
    seedPods(List.of(pod("pod-a", List.of("app"))), true);
    server.setFixture("pod-a", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", "not json at all")));

    List<CanonicalLogEvent> events = provider.search(baseRequest().build()).collectList().block();

    assertThat(events).hasSize(1);
    assertThat(events.get(0).malformed()).isTrue();
    assertThat(events.get(0).rawLine()).isEqualTo("not json at all");
    assertThat(events.get(0).pod()).isEqualTo("pod-a");
  }

  @Test
  void multilineExceptionEmbeddedInOneJsonObjectStaysOneLogicalEvent() {
    seedPods(List.of(pod("pod-a", List.of("app"))), true);
    String exceptionJson = "{\"@timestamp\":\"2026-09-12T10:00:00Z\",\"application\":\"payments\",\"level\":\"ERROR\","
        + "\"message\":\"boom\",\"exception\":\"java.lang.RuntimeException: boom\\n\\tat com.example.Foo.bar(Foo.java:10)\"}";
    server.setFixture("pod-a", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", exceptionJson)));

    List<CanonicalLogEvent> events = provider.search(baseRequest().build()).collectList().block();

    assertThat(events).hasSize(1);
    assertThat(events.get(0).exception()).contains("java.lang.RuntimeException: boom", "Foo.java:10");
  }

  @Test
  void sensitiveFieldsAreCarriedRawForSourceSideMatchingNeverDroppedByParsing() {
    seedPods(List.of(pod("pod-a", List.of("app"))), true);
    String json = "{\"@timestamp\":\"2026-09-12T10:00:00Z\",\"application\":\"payments\",\"level\":\"INFO\","
        + "\"message\":\"login\",\"mdc\":{\"cif\":\"12345678\",\"UserName\":\"jdoe\"}}";
    server.setFixture("pod-a", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", json)));

    List<CanonicalLogEvent> events = provider.search(baseRequest().build()).collectList().block();

    assertThat(events).hasSize(1);
    assertThat(events.get(0).sensitive().cif()).isEqualTo("12345678");
    assertThat(events.get(0).sensitive().userName()).isEqualTo("jdoe");
  }

  @Test
  void structuredFilterIsAppliedAfterParsingExactlyLikeEveryOtherSource() {
    seedPods(List.of(pod("pod-a", List.of("app"))), true);
    String body = line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "keep me"))
        + "\n" + line("2026-09-12T10:00:01.000000000Z", jsonLine("payments", "ERROR", "drop me"));
    server.setFixture("pod-a", "app", Fixture.ok(body));

    SearchRequest request = baseRequest().levels(List.of("INFO")).build();
    List<CanonicalLogEvent> events = provider.search(request).collectList().block();

    assertThat(events).extracting(CanonicalLogEvent::message).containsExactly("keep me");
  }

  // ------------------------------------------------------------ pod/container churn and RBAC

  @Test
  void oneDisappearedPodDoesNotFailTheWholeSearch() {
    seedPods(List.of(pod("gone-pod", List.of("app")), pod("healthy-pod", List.of("app"))), true);
    server.setFixture("gone-pod", "app", Fixture.notFound());
    server.setFixture("healthy-pod", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "still here"))));

    List<CanonicalLogEvent> events = provider.search(baseRequest().build()).collectList().block();

    assertThat(events).extracting(CanonicalLogEvent::message).containsExactly("still here");
  }

  @Test
  void oneForbiddenTargetIsPartialWhenOthersAreReadable() {
    seedPods(List.of(pod("forbidden-pod", List.of("app")), pod("healthy-pod", List.of("app"))), true);
    server.setFixture("forbidden-pod", "app", Fixture.forbidden());
    server.setFixture("healthy-pod", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "readable"))));

    List<CanonicalLogEvent> events = provider.search(baseRequest().build()).collectList().block();

    assertThat(events).extracting(CanonicalLogEvent::message).containsExactly("readable");
  }

  @Test
  void everyTargetForbiddenIsAnExplicitForbiddenResultNeverASilentEmptySearch() {
    seedPods(List.of(pod("forbidden-pod", List.of("app"))), true);
    server.setFixture("forbidden-pod", "app", Fixture.forbidden());

    StepVerifier.create(provider.search(baseRequest().build()))
        .expectErrorMatches(e -> e instanceof OpenShiftApiException ex && ex.kind() == Kind.FORBIDDEN)
        .verify();
  }

  @Test
  void oneSlowPodExceedingItsPerTargetTimeoutIsExcludedButOthersStillReturn() {
    properties.setPerTargetTimeout(Duration.ofMillis(100));
    seedPods(List.of(pod("slow-pod", List.of("app")), pod("fast-pod", List.of("app"))), true);
    server.setFixture("slow-pod", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "too slow")), 2000));
    server.setFixture("fast-pod", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "on time"))));

    List<CanonicalLogEvent> events = provider.search(baseRequest().build()).collectList().block();

    assertThat(events).extracting(CanonicalLogEvent::message).containsExactly("on time");
  }

  @Test
  void aMissingContainerIsExcludedLikeAnyOtherFourOhFour() {
    seedPods(List.of(pod("pod-a", List.of("app", "sidecar"))), true);
    server.setFixture("pod-a", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "app-line"))));
    server.setFixture("pod-a", "sidecar", Fixture.notFound());

    List<CanonicalLogEvent> events = provider.search(baseRequest().build()).collectList().block();

    assertThat(events).extracting(CanonicalLogEvent::message).containsExactly("app-line");
  }

  @Test
  void unauthorizedAbortsTheSearchAndExpiresTheSession() {
    seedPods(List.of(pod("pod-a", List.of("app"))), true);
    server.setUnauthorized(true);

    StepVerifier.create(provider.search(baseRequest().build()))
        .expectErrorMatches(e -> e instanceof OpenShiftApiException ex && ex.kind() == Kind.UNAUTHORIZED)
        .verify();
    assertThat(session.state()).isEqualTo(OpenShiftConnectionState.EXPIRED);
  }

  // ------------------------------------------------------------ bounds

  @Test
  void neverQueriesMoreThanTheConfiguredTargetCapAndSkippedTargetsAreNamedNotSilentlyDropped() {
    properties.setMaxTargets(1);
    seedPods(List.of(pod("pod-a", List.of("app")), pod("pod-b", List.of("app"))), true);
    server.setFixture("pod-a", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "a"))));
    server.setFixture("pod-b", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "b"))));

    provider.search(baseRequest().build()).collectList().block();

    assertThat(server.requestCount()).isEqualTo(1);
    List<String> warnings = provider.describeScopeWarnings(baseRequest().build());
    assertThat(warnings).anySatisfy(w -> assertThat(w).contains("TARGET_CAP_REACHED"));
  }

  @Test
  void neverConsidersMoreDistinctPodsThanTheConfiguredPodCap() {
    properties.setMaxPods(1);
    seedPods(List.of(pod("pod-a", List.of("app")), pod("pod-b", List.of("app"))), true);
    server.setFixture("pod-a", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "a"))));
    server.setFixture("pod-b", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "b"))));

    List<CanonicalLogEvent> events = provider.search(baseRequest().build()).collectList().block();

    assertThat(events).hasSize(1);
    List<String> warnings = provider.describeScopeWarnings(baseRequest().build());
    assertThat(warnings).anySatisfy(w -> assertThat(w).contains("TARGET_CAP_REACHED"));
  }

  @Test
  void neverReturnsMoreThanMaxEventsOverallSoNoFakePaginationCursorCanEverBeBuilt() {
    properties.setMaxEventsOverall(1);
    seedPods(List.of(pod("pod-a", List.of("app"))), true);
    String body = line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "one"))
        + "\n" + line("2026-09-12T10:00:01.000000000Z", jsonLine("payments", "INFO", "two"));
    server.setFixture("pod-a", "app", Fixture.ok(body));

    List<CanonicalLogEvent> events = provider.search(baseRequest().build()).collectList().block();

    assertThat(events).hasSize(1);
  }

  @Test
  void fanOutNeverExceedsTheConfiguredMaxConcurrency() {
    properties.setMaxConcurrency(2);
    seedPods(List.of(pod("pod-a", List.of("app")), pod("pod-b", List.of("app")), pod("pod-c", List.of("app"))), true);
    for (String podName : List.of("pod-a", "pod-b", "pod-c")) {
      server.setFixture(podName, "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", podName)), 150));
    }

    provider.search(baseRequest().build()).collectList().block();

    assertThat(server.maxConcurrentRequests()).isLessThanOrEqualTo(2);
  }

  @Test
  void sinceTimeIsPushedDownAsAnOptimizationOnly() {
    seedPods(List.of(pod("pod-a", List.of("app"))), true);
    server.setFixture("pod-a", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "x"))));
    Instant start = Instant.parse("2026-09-12T09:00:00Z");

    provider.search(baseRequest().start(start).build()).collectList().block();

    assertThat(server.lastQuery("pod-a", "app")).contains("sinceTime");
  }

  // ------------------------------------------------------------ OS-1C review recovery: runtime completeness (searchWithOutcome)

  @Test
  void oneOkPlusOneNotFoundIsPartialWithATargetNotFoundReason() {
    seedPods(List.of(pod("healthy-pod", List.of("app")), pod("gone-pod", List.of("app"))), true);
    server.setFixture("healthy-pod", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "readable"))));
    server.setFixture("gone-pod", "app", Fixture.notFound());

    SourceSearchOutcome outcome = provider.searchWithOutcome(baseRequest().build()).block();

    assertThat(outcome.events()).extracting(CanonicalLogEvent::message).containsExactly("readable");
    assertThat(outcome.runtimeWarnings()).anySatisfy(w -> assertThat(w).contains("TARGET_NOT_FOUND"));
  }

  @Test
  void oneOkPlusOneForbiddenIsPartialWithAPermissionDeniedReason() {
    seedPods(List.of(pod("healthy-pod", List.of("app")), pod("forbidden-pod", List.of("app"))), true);
    server.setFixture("healthy-pod", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "readable"))));
    server.setFixture("forbidden-pod", "app", Fixture.forbidden());

    SourceSearchOutcome outcome = provider.searchWithOutcome(baseRequest().build()).block();

    assertThat(outcome.events()).extracting(CanonicalLogEvent::message).containsExactly("readable");
    assertThat(outcome.runtimeWarnings()).anySatisfy(w -> assertThat(w).contains("PERMISSION_DENIED"));
  }

  @Test
  void oneOkPlusOneTimeoutIsPartialWithATargetTimeoutReason() {
    properties.setPerTargetTimeout(Duration.ofMillis(100));
    seedPods(List.of(pod("healthy-pod", List.of("app")), pod("slow-pod", List.of("app"))), true);
    server.setFixture("healthy-pod", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "readable"))));
    server.setFixture("slow-pod", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "too slow")), 2000));

    SourceSearchOutcome outcome = provider.searchWithOutcome(baseRequest().build()).block();

    assertThat(outcome.events()).extracting(CanonicalLogEvent::message).containsExactly("readable");
    assertThat(outcome.runtimeWarnings()).anySatisfy(w -> assertThat(w).contains("TARGET_TIMEOUT"));
  }

  @Test
  void oneOkPlusOneGenericUpstreamErrorIsPartialWithAnUpstreamErrorReason() {
    seedPods(List.of(pod("healthy-pod", List.of("app")), pod("broken-pod", List.of("app"))), true);
    server.setFixture("healthy-pod", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "readable"))));
    server.setFixture("broken-pod", "app", Fixture.error());

    SourceSearchOutcome outcome = provider.searchWithOutcome(baseRequest().build()).block();

    assertThat(outcome.events()).extracting(CanonicalLogEvent::message).containsExactly("readable");
    assertThat(outcome.runtimeWarnings()).anySatisfy(w -> assertThat(w).contains("UPSTREAM_ERROR"));
  }

  @Test
  void oneOkPlusOneByteCappedTargetIsPartialWithABytesCapReachedReason() {
    // Large enough to comfortably fit the healthy pod's own one-line
    // response whole, small enough that the noisy pod's own much larger
    // line still genuinely exceeds it.
    properties.setMaxBytesPerTarget(300);
    seedPods(List.of(pod("healthy-pod", List.of("app")), pod("noisy-pod", List.of("app"))), true);
    server.setFixture("healthy-pod", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "readable"))));
    server.setFixture("noisy-pod", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", "z".repeat(500))));

    SourceSearchOutcome outcome = provider.searchWithOutcome(baseRequest().build()).block();

    assertThat(outcome.events()).extracting(CanonicalLogEvent::message).containsExactly("readable");
    assertThat(outcome.runtimeWarnings()).anySatisfy(w -> assertThat(w).contains("BYTE_CAP_REACHED"));
  }

  @Test
  void aTargetReturningExactlyTheLineLimitIsFlaggedLineCapPossiblyReached() {
    properties.setMaxLinesPerTarget(2);
    seedPods(List.of(pod("pod-a", List.of("app"))), true);
    String body = line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "one"))
        + "\n" + line("2026-09-12T10:00:01.000000000Z", jsonLine("payments", "INFO", "two"));
    server.setFixture("pod-a", "app", Fixture.ok(body));

    SourceSearchOutcome outcome = provider.searchWithOutcome(baseRequest().build()).block();

    assertThat(outcome.events()).hasSize(2);
    assertThat(outcome.runtimeWarnings()).anySatisfy(w -> assertThat(w).contains("LINE_CAP_REACHED_OR_POSSIBLE"));
  }

  @Test
  void fewerLinesThanTheLimitIsNeverFlaggedAsLineCapped() {
    properties.setMaxLinesPerTarget(50);
    seedPods(List.of(pod("pod-a", List.of("app"))), true);
    server.setFixture("pod-a", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "only one line"))));

    SourceSearchOutcome outcome = provider.searchWithOutcome(baseRequest().build()).block();

    assertThat(outcome.runtimeWarnings()).noneSatisfy(w -> assertThat(w).contains("LINE_CAP"));
  }

  @Test
  void noRuntimeWarningsWhenEveryTargetSucceedsCleanly() {
    seedPods(List.of(pod("pod-a", List.of("app"))), true);
    server.setFixture("pod-a", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "clean"))));

    SourceSearchOutcome outcome = provider.searchWithOutcome(baseRequest().build()).block();

    assertThat(outcome.runtimeWarnings()).isEmpty();
  }

  @Test
  void everyTargetNotFoundIsAnExplicitFailureNeverASilentCompleteEmptyResult() {
    seedPods(List.of(pod("gone-1", List.of("app")), pod("gone-2", List.of("app"))), true);
    server.setFixture("gone-1", "app", Fixture.notFound());
    server.setFixture("gone-2", "app", Fixture.notFound());

    StepVerifier.create(provider.searchWithOutcome(baseRequest().build()))
        .expectErrorMatches(e -> e instanceof OpenShiftApiException ex && ex.kind() == Kind.UPSTREAM_UNAVAILABLE)
        .verify();
  }

  @Test
  void everyTargetTimedOutOrErroredIsAnExplicitFailureNeverASilentCompleteEmptyResult() {
    properties.setPerTargetTimeout(Duration.ofMillis(100));
    seedPods(List.of(pod("slow-pod", List.of("app")), pod("broken-pod", List.of("app"))), true);
    server.setFixture("slow-pod", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "x")), 2000));
    server.setFixture("broken-pod", "app", Fixture.error());

    StepVerifier.create(provider.searchWithOutcome(baseRequest().build()))
        .expectErrorMatches(e -> e instanceof OpenShiftApiException ex && ex.kind() == Kind.UPSTREAM_UNAVAILABLE)
        .verify();
  }

  @Test
  void targetCapAndByteCapReasonsBothSurviveTogether() {
    // OS-1C review recovery mission §10 - "target-cap + byte-cap -> both
    // reasons preserved." Target-cap is a pre-search (describeScopeWarnings)
    // reason; byte-cap is a runtime (searchWithOutcome) reason - both must
    // independently still be true/observable for the exact same search.
    properties.setMaxTargets(1);
    properties.setMaxBytesPerTarget(50);
    seedPods(List.of(pod("pod-a", List.of("app")), pod("pod-b", List.of("app"))), true);
    server.setFixture("pod-a", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", "z".repeat(500))));
    server.setFixture("pod-b", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "never queried"))));

    SourceSearchOutcome outcome = provider.searchWithOutcome(baseRequest().build()).block();
    List<String> scopeWarnings = provider.describeScopeWarnings(baseRequest().build());

    assertThat(scopeWarnings).anySatisfy(w -> assertThat(w).contains("TARGET_CAP_REACHED"));
    assertThat(outcome.runtimeWarnings()).anySatisfy(w -> assertThat(w).contains("BYTE_CAP_REACHED"));
  }

  @Test
  void internalOverallEventCapIsExposedAsARuntimeWarningWhenItActuallyControlsTrimming() {
    properties.setMaxEventsOverall(1);
    seedPods(List.of(pod("pod-a", List.of("app"))), true);
    String body = line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "one"))
        + "\n" + line("2026-09-12T10:00:01.000000000Z", jsonLine("payments", "INFO", "two"));
    server.setFixture("pod-a", "app", Fixture.ok(body));

    SourceSearchOutcome outcome = provider.searchWithOutcome(baseRequest().build()).block();

    assertThat(outcome.events()).hasSize(1);
    assertThat(outcome.runtimeWarnings()).anySatisfy(w -> assertThat(w).contains("OVERALL_EVENT_CAP"));
  }

  @Test
  void theCallersOwnSmallerRequestedLimitTrimmingIsNeverFlaggedAsOverallEventCap() {
    // The internal safety cap (maxEventsOverall) is generous here - the
    // caller's own explicit, smaller request.limit() is what trims, which
    // is ordinary requested-limit behavior, not a safety-cap surprise.
    properties.setMaxEventsOverall(1000);
    seedPods(List.of(pod("pod-a", List.of("app"))), true);
    String body = line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "one"))
        + "\n" + line("2026-09-12T10:00:01.000000000Z", jsonLine("payments", "INFO", "two"));
    server.setFixture("pod-a", "app", Fixture.ok(body));

    SourceSearchOutcome outcome = provider.searchWithOutcome(baseRequest().limit(1).build()).block();

    assertThat(outcome.events()).hasSize(1);
    assertThat(outcome.runtimeWarnings()).noneSatisfy(w -> assertThat(w).contains("OVERALL_EVENT_CAP"));
  }

  @Test
  void aByteCappedTargetIsCancelledWhileOtherTargetsContinueNormally() {
    // OS-1C review recovery mission §11 - concurrency/cancellation
    // regression coverage: one target's own byte cap firing must never
    // disturb another, genuinely different target's normal completion.
    // Large enough to comfortably fit the normal pod's own one-line
    // response whole, small enough that the noisy pod's own much larger
    // line still genuinely exceeds it.
    properties.setMaxBytesPerTarget(300);
    seedPods(List.of(pod("noisy-pod", List.of("app")), pod("normal-pod", List.of("app"))), true);
    server.setFixture("noisy-pod", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", "n".repeat(5000))));
    server.setFixture("normal-pod", "app", Fixture.ok(line("2026-09-12T10:00:01.000000000Z", jsonLine("payments", "INFO", "unaffected"))));

    SourceSearchOutcome outcome = provider.searchWithOutcome(baseRequest().build()).block();

    assertThat(outcome.events()).extracting(CanonicalLogEvent::message).containsExactly("unaffected");
    assertThat(outcome.runtimeWarnings()).anySatisfy(w -> assertThat(w).contains("BYTE_CAP_REACHED"));
  }

  @Test
  void concurrentSearchesOnTheSameProviderInstanceNeverCrossContaminateOutcomes() {
    // OS-1C review recovery mission §4/§10 - runtime metadata is carried
    // entirely by each call's own SourceSearchOutcome return value, never
    // a shared/mutable field on this provider instance - proven here by
    // actually running two overlapping searches concurrently (Mono.zip
    // subscribes to both before either necessarily finishes) with
    // deliberately different failure profiles, and asserting neither
    // result's warnings ever mention the other's target.
    properties.setPerTargetTimeout(Duration.ofSeconds(5));
    seedPods(List.of(pod("pod-a", List.of("app")), pod("pod-b", List.of("app"))), true);
    server.setFixture("pod-a", "app", Fixture.notFound());
    server.setFixture("pod-b", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "b-event")), 80));

    // Two different requests naturally target this test's one shared
    // scope - the isolation property under test is about the RETURN VALUE
    // never being shared, not about differing scopes (OpenShiftSession's
    // own single-connection-per-user model makes differing concurrent
    // scopes on one provider instance a scenario that does not arise in
    // this application - see DirectPodLogProvider's own "Immutable scope
    // snapshot" class javadoc).
    reactor.core.publisher.Mono<SourceSearchOutcome[]> both = reactor.core.publisher.Mono.zip(
            provider.searchWithOutcome(baseRequest().build()),
            provider.searchWithOutcome(baseRequest().build()))
        .map(tuple -> new SourceSearchOutcome[] {tuple.getT1(), tuple.getT2()});

    StepVerifier.create(both)
        .assertNext(outcomes -> {
          for (SourceSearchOutcome outcome : outcomes) {
            assertThat(outcome.events()).extracting(CanonicalLogEvent::message).containsExactly("b-event");
            assertThat(outcome.runtimeWarnings()).anySatisfy(w -> assertThat(w).contains("TARGET_NOT_FOUND"));
          }
        })
        .verifyComplete();
  }

  @Test
  void cancellingTheOverallSearchCancelsAnInFlightSlowPodLogBodySubscription() {
    // OS-1C final review recovery §4 requirement D - the same downstream
    // cancellation bridge unit-tested directly against
    // OpenShiftApiClient#readBounded must also work transitively through
    // this provider's own Flux composition (flatMap/collectList/timeout):
    // cancelling the overall search must not leave an in-flight, slow
    // pod-log HTTP body still being drained. Proven the same way as the
    // per-target-timeout test above - a fixture far slower (3s) than how
    // long this test is allowed to run (well under 1s) - if cancellation
    // were not actually propagated all the way down to the raw body
    // subscription, this test would hang for the full 3s fixture delay.
    seedPods(List.of(pod("slow-pod", List.of("app"))), true);
    server.setFixture("slow-pod", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "too slow to matter")), 3000));

    Instant startedAt = Instant.now();
    StepVerifier.create(provider.search(baseRequest().build()))
        .thenAwait(Duration.ofMillis(50))
        .thenCancel()
        .verify(Duration.ofSeconds(1));
    Duration elapsed = Duration.between(startedAt, Instant.now());

    assertThat(elapsed).isLessThan(Duration.ofSeconds(1)); // nowhere near the fixture's 3s delay
  }

  // ------------------------------------------------------------ scope completeness / warnings

  @Test
  void describesNoWarningsWhenScopeIsFullyComplete() {
    seedPods(List.of(pod("pod-a", List.of("app"))), true);
    assertThat(provider.describeScopeWarnings(baseRequest().build())).isEmpty();
  }

  @Test
  void describesAPartialPodScopeWarningWhenOs1bCouldNotResolveEveryPod() {
    seedPods(List.of(pod("pod-a", List.of("app"))), false);
    assertThat(provider.describeScopeWarnings(baseRequest().build()))
        .anySatisfy(w -> assertThat(w).contains("Pod scope may be incomplete"));
  }

  @Test
  void describesAPartialWorkloadScopeWarningWhenAKindWasForbidden() {
    seedPods(List.of(pod("pod-a", List.of("app"))), true);
    seedWorkloadOutcome(KindOutcome.Status.FORBIDDEN);
    assertThat(provider.describeScopeWarnings(baseRequest().build()))
        .anySatisfy(w -> assertThat(w).contains("Workload scope may be incomplete"));
  }

  @Test
  void noWarningsWhenNotConnectedOrNoProjectSelected() {
    OpenShiftSession disconnected = new OpenShiftSession();
    DirectPodLogProvider disconnectedProvider =
        new DirectPodLogProvider(
            client, disconnected, new LogLineParser(new ObjectMapper()), properties, contextTargetProofCodec);
    assertThat(disconnectedProvider.describeScopeWarnings(baseRequest().build())).isEmpty();
  }

  // ------------------------------------------------------------ preconditions

  @Test
  void searchingWithoutASelectedProjectFailsFast() {
    OpenShiftSession noProject = new OpenShiftSession();
    OcLoginCommand command = new OcLoginCommand(URI.create(server.baseUrl()), TOKEN, null);
    noProject.connect(command, "Test", "developer", List.of(NAMESPACE), ProjectDiscovery.Api.PROJECTS, null);
    DirectPodLogProvider noProjectProvider =
        new DirectPodLogProvider(
            client, noProject, new LogLineParser(new ObjectMapper()), properties, contextTargetProofCodec);

    assertThatThrownBy(() -> noProjectProvider.search(baseRequest().build()).collectList().block())
        .isInstanceOf(IllegalStateException.class);
  }

  @Test
  void emptyResolvedScopeReturnsZeroEventsNeverAnError() {
    // No updatePods call at all - scope.pods() is genuinely empty, exactly
    // "the user has not yet visited scope controls" (OS-1C class javadoc).
    List<CanonicalLogEvent> events = provider.search(baseRequest().build()).collectList().block();
    assertThat(events).isEmpty();
    assertThat(server.requestCount()).isZero();
  }

  // ------------------------------------------------------------ OS-1D: narrow "Show surrounding logs" context

  @Test
  void aContextRequestNamingPodAndContainerQueriesOnlyThatOneTargetEvenWithManyPodsInScope() {
    // Workload=All/Pod=All currently resolves three pods - a context call
    // naming exactly one (pod, container) must query only that one, never
    // the full currently-resolved scope (mission §8 "same pod/container by
    // default", §16 "never broaden scope implicitly").
    seedPods(List.of(pod("pod-a", List.of("app")), pod("pod-b", List.of("app")), pod("pod-c", List.of("app"))), true);
    server.setFixture("pod-a", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "a"))));
    server.setFixture("pod-b", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "b"))));
    server.setFixture("pod-c", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "c"))));

    List<CanonicalLogEvent> events =
        provider.search(baseRequest().pod("pod-b").containerName("app").build()).collectList().block();

    assertThat(events).extracting(CanonicalLogEvent::message).containsExactly("b");
    assertThat(server.requestCount()).isEqualTo(1); // only pod-b/app was ever asked about
  }

  @Test
  void aContextRequestNarrowsToTheNamedContainerEvenWhenAnotherContainerInThatSamePodMatchesTimeWindow() {
    seedPods(List.of(pod("pod-a", List.of("app", "sidecar"))), true);
    server.setFixture("pod-a", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "from-app"))));
    server.setFixture("pod-a", "sidecar", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "from-sidecar"))));

    List<CanonicalLogEvent> events =
        provider.search(baseRequest().pod("pod-a").containerName("app").build()).collectList().block();

    assertThat(events).extracting(CanonicalLogEvent::message).containsExactly("from-app");
    assertThat(server.requestCount()).isEqualTo(1);
  }

  @Test
  void aContextRequestForAPodThatHasDisappearedFromCurrentScopeStillAsksTheRealApiRatherThanSilentlyReturningEmpty() {
    // "Pod disappeared between the original search and Show surrounding
    // logs" (mission §9/§19/§32) - the pod is NOT in current OS-1B scope at
    // all (never seeded), but the context request carries a VALID
    // server-issued historical proof (OS-1D review recovery - a bare
    // pod/containerName pair is no longer, by itself, sufficient), and the
    // target is queried for real rather than assumed absent because a
    // local cache does not currently list it.
    server.setFixture("ghost-pod", "app", Fixture.notFound());
    String proof = contextTargetProofCodec.encode("openshift", generation, NAMESPACE, "ghost-pod", "app");

    StepVerifier.create(provider.search(baseRequest().pod("ghost-pod").containerName("app").contextTargetProof(proof).build()))
        .expectErrorMatches(e -> e instanceof OpenShiftApiException ex && ex.kind() == Kind.UPSTREAM_UNAVAILABLE)
        .verify();
    assertThat(server.requestCount()).isEqualTo(1); // a real API call was made, not a silent local decision
  }

  @Test
  void aContextRequestForAForbiddenPodIsAnExplicitForbiddenResultNeverASilentEmptyContext() {
    seedPods(List.of(pod("pod-a", List.of("app"))), true);
    server.setFixture("pod-a", "app", Fixture.forbidden());

    StepVerifier.create(provider.search(baseRequest().pod("pod-a").containerName("app").build()))
        .expectErrorMatches(e -> e instanceof OpenShiftApiException ex && ex.kind() == Kind.FORBIDDEN)
        .verify();
  }

  @Test
  void aContextRequestStillSurfacesByteAndLineCapTruncationOnTheSingleNarrowedTarget() {
    properties.setMaxBytesPerTarget(50);
    seedPods(List.of(pod("pod-a", List.of("app"))), true);
    server.setFixture("pod-a", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", "y".repeat(500))));

    SourceSearchOutcome outcome =
        provider.searchWithOutcome(baseRequest().pod("pod-a").containerName("app").build()).block();

    assertThat(outcome.runtimeWarnings()).anySatisfy(w -> assertThat(w).contains("BYTE_CAP_REACHED"));
  }

  @Test
  void ordinaryFullScopeSearchIsUnaffectedWhenNeitherPodNorContainerNameIsSet() {
    // Regression guard: the OS-1D narrow-context override must only ever
    // trigger when BOTH pod and containerName are present - an ordinary
    // search/correlation/trace/journey call (neither field set) still
    // queries the full currently-resolved scope exactly as before OS-1D.
    seedPods(List.of(pod("pod-a", List.of("app")), pod("pod-b", List.of("app"))), true);
    server.setFixture("pod-a", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "a"))));
    server.setFixture("pod-b", "app", Fixture.ok(line("2026-09-12T10:00:01.000000000Z", jsonLine("payments", "INFO", "b"))));

    List<CanonicalLogEvent> events = provider.search(baseRequest().build()).collectList().block();

    assertThat(events).extracting(CanonicalLogEvent::message).containsExactlyInAnyOrder("a", "b");
    assertThat(server.requestCount()).isEqualTo(2);
  }

  @Test
  void aPodOnlyContextHintWithoutAContainerNameIsTreatedAsAnOrdinaryFullScopeSearch() {
    // Defensive: OpenShift events always carry both pod and containerName,
    // so a real "Show surrounding logs" call always sets both together.
    // pod-without-containerName is not a real OpenShift product scenario
    // (it is how Docker/Loki's own context calls are shaped instead) - it
    // must never be misinterpreted as a narrow-context signal, which could
    // otherwise construct an unqueryable single target with an empty
    // container name.
    seedPods(List.of(pod("pod-a", List.of("app")), pod("pod-b", List.of("app"))), true);
    server.setFixture("pod-a", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "a"))));
    server.setFixture("pod-b", "app", Fixture.ok(line("2026-09-12T10:00:01.000000000Z", jsonLine("payments", "INFO", "b"))));

    // request.pod() alone still acts as the pre-existing generic
    // EventFilters post-filter (unchanged since before OS-1D), narrowing
    // the RESULT to pod-a even though both pods were queried.
    List<CanonicalLogEvent> events = provider.search(baseRequest().pod("pod-a").build()).collectList().block();

    assertThat(events).extracting(CanonicalLogEvent::message).containsExactly("a");
    assertThat(server.requestCount()).isEqualTo(2); // both pods queried - not narrowed at the fetch level
  }

  // ------------------------------------------------------------ OS-1D review recovery: context target authorization (mission §14)

  private String validProof(String podName, String containerName) {
    return contextTargetProofCodec.encode("openshift", generation, NAMESPACE, podName, containerName);
  }

  @Test
  void a_currentScopeTargetIsAllowedWithNoProofAtAll() {
    // §14.A - ordinary path, unchanged: still-in-scope targets never need
    // (or consult) a proof.
    seedPods(List.of(pod("pod-a", List.of("app"))), true);
    server.setFixture("pod-a", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "in-scope"))));

    List<CanonicalLogEvent> events =
        provider.search(baseRequest().pod("pod-a").containerName("app").build()).collectList().block();

    assertThat(events).extracting(CanonicalLogEvent::message).containsExactly("in-scope");
  }

  @Test
  void b_aDisappearedPodWithAValidProofStillReachesTheRealApiAndGetsATruthfulNotFound() {
    // §14.B - proof issued for a target that has since left scope; the
    // real cluster call is attempted and its genuine 404 becomes the
    // truthful failure - never a silent empty result, never a blind trust
    // of the request fields alone.
    server.setFixture("ghost-pod", "app", Fixture.notFound());
    String proof = validProof("ghost-pod", "app");

    StepVerifier.create(provider.search(baseRequest().pod("ghost-pod").containerName("app").contextTargetProof(proof).build()))
        .expectErrorMatches(e -> e instanceof OpenShiftApiException ex && ex.kind() == Kind.UPSTREAM_UNAVAILABLE)
        .verify();
    assertThat(server.requestCount()).isEqualTo(1);
  }

  @Test
  void c_anArbitraryOutOfScopePodWithNoProofIsRejectedWithZeroClusterCalls() {
    // §14.C - the core defect this recovery fixes: a crafted pod/container
    // name that was never part of any resolved scope, and no proof at all.
    server.setFixture("attacker-named-pod", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "should never be readable"))));

    StepVerifier.create(provider.search(baseRequest().pod("attacker-named-pod").containerName("app").build()))
        .expectErrorMatches(e -> e instanceof GuardrailViolationException ex
            && ex.reason() == GuardrailViolationException.Reason.INVALID_CONTEXT_TARGET)
        .verify();
    assertThat(server.requestCount()).isZero(); // the cluster was never called
  }

  @Test
  void d_anArbitraryOutOfScopePodWithAForgedOrTamperedProofIsRejectedWithZeroClusterCalls() {
    // §14.D
    server.setFixture("attacker-named-pod", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "should never be readable"))));
    String tampered = validProof("attacker-named-pod", "app") + "tampered";
    String forgedFromScratch = "not-a-real-proof.also-not-real";

    StepVerifier.create(provider.search(baseRequest().pod("attacker-named-pod").containerName("app").contextTargetProof(tampered).build()))
        .expectErrorMatches(e -> e instanceof GuardrailViolationException ex
            && ex.reason() == GuardrailViolationException.Reason.INVALID_CONTEXT_TARGET)
        .verify();
    StepVerifier.create(provider.search(baseRequest().pod("attacker-named-pod").containerName("app").contextTargetProof(forgedFromScratch).build()))
        .expectErrorMatches(e -> e instanceof GuardrailViolationException ex
            && ex.reason() == GuardrailViolationException.Reason.INVALID_CONTEXT_TARGET)
        .verify();
    assertThat(server.requestCount()).isZero();
  }

  @Test
  void e_aValidProofForADifferentContainerIsRejected() {
    // §14.E - proof for pod-a/app must never authorize pod-a/privileged-sidecar.
    String proofForApp = validProof("pod-a", "app");

    StepVerifier.create(provider.search(baseRequest().pod("pod-a").containerName("privileged-sidecar").contextTargetProof(proofForApp).build()))
        .expectErrorMatches(e -> e instanceof GuardrailViolationException ex
            && ex.reason() == GuardrailViolationException.Reason.INVALID_CONTEXT_TARGET)
        .verify();
    assertThat(server.requestCount()).isZero();
  }

  @Test
  void f_aValidProofForADifferentNamespaceIsRejected() {
    // §14.F - a proof minted for this namespace must never authorize a
    // pod name replayed against a different namespace.
    String proofForAnotherNamespace = contextTargetProofCodec.encode("openshift", generation, "project-a", "pod-x", "app");

    StepVerifier.create(provider.search(baseRequest().pod("pod-x").containerName("app").contextTargetProof(proofForAnotherNamespace).build()))
        .expectErrorMatches(e -> e instanceof GuardrailViolationException ex
            && ex.reason() == GuardrailViolationException.Reason.INVALID_CONTEXT_TARGET)
        .verify();
    assertThat(server.requestCount()).isZero();
  }

  @Test
  void g_aProofFromAnOldConnectionGenerationIsRejectedAfterReconnect() {
    // §14.G - reconnecting invalidates every previously-issued proof.
    String staleProof = validProof("pod-a", "app");
    OcLoginCommand reconnect = new OcLoginCommand(URI.create(server.baseUrl()), TOKEN, null);
    long newGeneration =
        session.connect(reconnect, "Test", "developer", List.of(NAMESPACE), ProjectDiscovery.Api.PROJECTS, null);
    assertThat(session.selectProject(NAMESPACE, newGeneration)).isTrue();
    assertThat(newGeneration).isNotEqualTo(generation);

    StepVerifier.create(provider.search(baseRequest().pod("pod-a").containerName("app").contextTargetProof(staleProof).build()))
        .expectErrorMatches(e -> e instanceof GuardrailViolationException ex
            && ex.reason() == GuardrailViolationException.Reason.INVALID_CONTEXT_TARGET)
        .verify();
    assertThat(server.requestCount()).isZero();
  }

  @Test
  void h_aProofIssuedForAnotherSourceIdIsRejected() {
    // §14.H
    String proofForAnotherSource = contextTargetProofCodec.encode("openshift-loki", generation, NAMESPACE, "pod-a", "app");

    StepVerifier.create(provider.search(baseRequest().pod("pod-a").containerName("app").contextTargetProof(proofForAnotherSource).build()))
        .expectErrorMatches(e -> e instanceof GuardrailViolationException ex
            && ex.reason() == GuardrailViolationException.Reason.INVALID_CONTEXT_TARGET)
        .verify();
    assertThat(server.requestCount()).isZero();
  }

  @Test
  void i_aJobOwnedPodOutsideSupportedWorkloadScopeCannotBeReadViaACraftedContextRequest() {
    // §14.I - OS-1B never resolves Job/CronJob pods into scope at all, so
    // scope.findPod always misses, and no legitimate search could ever
    // have issued a proof for one either.
    server.setFixture("payment-job-27182818", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "job output should never leak"))));

    StepVerifier.create(provider.search(baseRequest().pod("payment-job-27182818").containerName("app").build()))
        .expectErrorMatches(e -> e instanceof GuardrailViolationException ex
            && ex.reason() == GuardrailViolationException.Reason.INVALID_CONTEXT_TARGET)
        .verify();
    assertThat(server.requestCount()).isZero();
  }

  @Test
  void j_aStandalonePodOutsideScopeCannotBeReadViaACraftedContextRequest() {
    // §14.J
    server.setFixture("manually-created-debug-pod", "shell", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "should never leak"))));

    StepVerifier.create(provider.search(baseRequest().pod("manually-created-debug-pod").containerName("shell").build()))
        .expectErrorMatches(e -> e instanceof GuardrailViolationException ex
            && ex.reason() == GuardrailViolationException.Reason.INVALID_CONTEXT_TARGET)
        .verify();
    assertThat(server.requestCount()).isZero();
  }

  @Test
  void k_anOperatorOrUnknownControllerPodCannotBeReadViaACraftedContextRequest() {
    // §14.K
    server.setFixture("some-operator-controller-manager-7d8f", "manager", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "should never leak"))));

    StepVerifier.create(provider.search(baseRequest().pod("some-operator-controller-manager-7d8f").containerName("manager").build()))
        .expectErrorMatches(e -> e instanceof GuardrailViolationException ex
            && ex.reason() == GuardrailViolationException.Reason.INVALID_CONTEXT_TARGET)
        .verify();
    assertThat(server.requestCount()).isZero();
  }

  @Test
  void l_theProofMechanismDoesNotBreakTheNormalContextWorkflowWhenTheTargetIsStillInScope() {
    // §14.L - the authorization gate must be invisible/no-op for the
    // common, everyday case: target still in scope, no proof supplied at
    // all (mirrors the pre-existing "same pod/container by default" test).
    seedPods(List.of(pod("pod-a", List.of("app")), pod("pod-b", List.of("app")), pod("pod-c", List.of("app"))), true);
    server.setFixture("pod-b", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "b"))));

    List<CanonicalLogEvent> events =
        provider.search(baseRequest().pod("pod-b").containerName("app").build()).collectList().block();

    assertThat(events).extracting(CanonicalLogEvent::message).containsExactly("b");
    assertThat(server.requestCount()).isEqualTo(1);
  }

  @Test
  void anIssuedProofRoundTripsThroughSearchWithOutcomeOntoEachOpenShiftEvent() {
    // Proves the proof is actually ISSUED (not just verified) - every OK
    // OpenShift event carries a non-blank contextTargetProof usable on a
    // later "Show surrounding logs" call for exactly that event's own
    // (pod, container).
    seedPods(List.of(pod("pod-a", List.of("app"))), true);
    server.setFixture("pod-a", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "hello"))));

    CanonicalLogEvent event = provider.search(baseRequest().build()).blockFirst();

    assertThat(event.contextTargetProof()).isNotBlank();
    // The issued proof is itself independently valid against the exact
    // target it was issued for - proven by using it as a real disappeared-
    // pod proof for that same (pod, container).
    server.setFixture("pod-a", "app", Fixture.notFound());
    session.updatePods(List.of(), true, NAMESPACE, null, generation); // pod-a rotates out of scope
    StepVerifier.create(provider.search(
            baseRequest().pod("pod-a").containerName("app").contextTargetProof(event.contextTargetProof()).build()))
        .expectErrorMatches(e -> e instanceof OpenShiftApiException ex && ex.kind() == Kind.UPSTREAM_UNAVAILABLE)
        .verify();
  }

  // ------------------------------------------------------------ OS-1D final review recovery: generation snapshot consistency (mission §7)

  @Test
  void inFlight_aProofPathContextOperationCompletesAgainstItsCapturedConnectionEvenWhenTheSessionReconnectsMidFlight()
      throws Exception {
    // §7.A/§7.D - "ghost-pod" is not in current scope, so this exercises
    // the proof-verification path (Rule B). The synchronous capture
    // (generation/server/token) and the authorization decision both
    // happen before the HTTP call is even dispatched - by the time
    // subscribe() returns control here, only the slow (300ms) fixture
    // response is still pending. Reconnecting to a second, independent
    // mock cluster ("Connection B") right after subscribe() simulates the
    // session moving on strictly AFTER this operation's own snapshot was
    // already captured and already used to authorize the target - the
    // operation must still complete against Connection A's server/token,
    // and Connection B's server must never be contacted at all.
    server.setFixture("ghost-pod", "app",
        Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "from-connection-A")), 300));
    String proofForA = validProof("ghost-pod", "app");

    try (MockOpenShiftPodLogServer serverB = new MockOpenShiftPodLogServer("other-namespace")) {
      CompletableFuture<CanonicalLogEvent> future = new CompletableFuture<>();
      provider.search(baseRequest().pod("ghost-pod").containerName("app").contextTargetProof(proofForA).build())
          .next()
          .subscribe(future::complete, future::completeExceptionally);

      OcLoginCommand reconnectToB = new OcLoginCommand(URI.create(serverB.baseUrl()), TOKEN, null);
      long generationB =
          session.connect(reconnectToB, "Other", "developer", List.of("other-namespace"), ProjectDiscovery.Api.PROJECTS, null);
      assertThat(generationB).isNotEqualTo(generation);

      CanonicalLogEvent event = future.get(5, TimeUnit.SECONDS);

      assertThat(event.message()).isEqualTo("from-connection-A");
      assertThat(serverB.requestCount()).isZero(); // Connection A's operation never touched Connection B
      assertThat(server.requestCount()).isEqualTo(1); // exactly the one real call, to Connection A
    }
  }

  @Test
  void inFlight_theCurrentScopePathAlsoCompletesAgainstItsCapturedConnectionEvenWhenTheSessionReconnectsMidFlight()
      throws Exception {
    // §7.E - the same proof as above, but for a target still in current
    // OS-1B scope (Rule A, no proof consulted at all) - proves that path
    // is equally immune to a mid-flight reconnect, not merely the
    // proof-verification path.
    seedPods(List.of(pod("pod-a", List.of("app"))), true);
    server.setFixture("pod-a", "app",
        Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "in-scope-from-A")), 300));

    try (MockOpenShiftPodLogServer serverB = new MockOpenShiftPodLogServer("other-namespace")) {
      CompletableFuture<CanonicalLogEvent> future = new CompletableFuture<>();
      provider.search(baseRequest().pod("pod-a").containerName("app").build())
          .next()
          .subscribe(future::complete, future::completeExceptionally);

      OcLoginCommand reconnectToB = new OcLoginCommand(URI.create(serverB.baseUrl()), TOKEN, null);
      long generationB =
          session.connect(reconnectToB, "Other", "developer", List.of("other-namespace"), ProjectDiscovery.Api.PROJECTS, null);
      assertThat(generationB).isNotEqualTo(generation);

      CanonicalLogEvent event = future.get(5, TimeUnit.SECONDS);

      assertThat(event.message()).isEqualTo("in-scope-from-A");
      assertThat(serverB.requestCount()).isZero();
    }
  }

  @Test
  void aProofNamingADifferentGenerationThanTheOperationsOwnCapturedSnapshotIsRejected() {
    // §7.C - the operation's own captured generation (this test's
    // `generation` field, set once in setUp()) governs authorization, not
    // whatever the live session happens to report. A proof minted for any
    // other generation number is rejected purely on that mismatch,
    // independent of live session state.
    String proofForADifferentGeneration =
        contextTargetProofCodec.encode("openshift", generation + 1, NAMESPACE, "ghost-pod", "app");

    StepVerifier.create(provider.search(
            baseRequest().pod("ghost-pod").containerName("app").contextTargetProof(proofForADifferentGeneration).build()))
        .expectErrorMatches(e -> e instanceof GuardrailViolationException ex
            && ex.reason() == GuardrailViolationException.Reason.INVALID_CONTEXT_TARGET)
        .verify();
    assertThat(server.requestCount()).isZero();
  }

  @Test
  void anOperationStartedAfterAReconnectFullyAdoptsTheNewConnectionsServerNamespaceAndScope() throws Exception {
    // Mission (snapshot atomicity recovery) §10.B, positive case: once a
    // reconnect has happened BEFORE an operation's own atomic snapshot
    // read, every field of that operation - not merely "the old proof is
    // rejected" - genuinely becomes the new connection's own. Proven by
    // actually completing a real search against Connection B and
    // asserting it used exactly B's server (never A's).
    try (MockOpenShiftPodLogServer serverB = new MockOpenShiftPodLogServer("other-namespace")) {
      OcLoginCommand reconnectToB = new OcLoginCommand(URI.create(serverB.baseUrl()), TOKEN, null);
      long generationB = session.connect(
          reconnectToB, "Other", "developer", List.of("other-namespace"), ProjectDiscovery.Api.PROJECTS, null);
      assertThat(session.selectProject("other-namespace", generationB)).isTrue();
      assertThat(session.updatePods(List.of(pod("pod-b", List.of("app"))), true, "other-namespace", null, generationB))
          .isTrue();
      serverB.setFixture("pod-b", "app",
          Fixture.ok(line("2026-09-12T10:00:00.000000000Z", jsonLine("payments", "INFO", "from-connection-B"))));

      List<CanonicalLogEvent> events =
          provider.search(baseRequest().pod("pod-b").containerName("app").build()).collectList().block();

      assertThat(events).extracting(CanonicalLogEvent::message).containsExactly("from-connection-B");
      assertThat(serverB.requestCount()).isEqualTo(1);
      assertThat(server.requestCount()).isZero(); // Connection A's own server was never touched
    }
  }

  // ------------------------------------------------------------ OS-1D: correlation / trace / journey search

  @Test
  void correlationIdMatchesEventsAcrossDifferentPodsWithinTheCurrentlyResolvedScope() {
    seedPods(List.of(pod("pod-a", List.of("app")), pod("pod-b", List.of("app"))), true);
    server.setFixture("pod-a", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z",
        jsonLineWithMdc("gateway", "start", "corr-1", "trace-1", "", ""))));
    server.setFixture("pod-b", "app", Fixture.ok(line("2026-09-12T10:00:01.000000000Z",
        jsonLineWithMdc("payment-service", "processed", "corr-1", "trace-2", "", ""))));

    List<CanonicalLogEvent> events =
        provider.search(baseRequest().correlationId("corr-1").build()).collectList().block();

    assertThat(events).extracting(CanonicalLogEvent::message).containsExactlyInAnyOrder("start", "processed");
    assertThat(events).allSatisfy(e -> assertThat(e.correlationId()).isEqualTo("corr-1"));
  }

  @Test
  void traceIdMatchesEventsAcrossMultipleServicesAndPods() {
    seedPods(List.of(pod("pod-a", List.of("app")), pod("pod-b", List.of("app"))), true);
    server.setFixture("pod-a", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z",
        jsonLineWithMdc("gateway", "start", "", "trace-shared", "", ""))));
    server.setFixture("pod-b", "app", Fixture.ok(line("2026-09-12T10:00:01.000000000Z",
        jsonLineWithMdc("ledger-service", "committed", "", "trace-shared", "", ""))));

    List<CanonicalLogEvent> events = provider.search(baseRequest().traceId("trace-shared").build()).collectList().block();

    assertThat(events).extracting(CanonicalLogEvent::message).containsExactlyInAnyOrder("start", "committed");
  }

  @Test
  void journeyIdMatchesEventsWithinTheCurrentOpenShiftResolvedScope() {
    seedPods(List.of(pod("pod-a", List.of("app"))), true);
    server.setFixture("pod-a", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z",
        jsonLineWithMdc("gateway", "journey-event", "", "", "journey-42", ""))));

    List<CanonicalLogEvent> events = provider.search(baseRequest().journeyId("journey-42").build()).collectList().block();

    assertThat(events).extracting(CanonicalLogEvent::message).containsExactly("journey-event");
  }

  @Test
  void aCorrelationIdWithNoMatchesIsAnOrdinaryEmptyResultNeverAnError() {
    seedPods(List.of(pod("pod-a", List.of("app"))), true);
    server.setFixture("pod-a", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z",
        jsonLineWithMdc("gateway", "unrelated", "corr-other", "", "", ""))));

    List<CanonicalLogEvent> events =
        provider.search(baseRequest().correlationId("corr-missing").build()).collectList().block();

    assertThat(events).isEmpty();
  }

  @Test
  void correlationSearchWithOneForbiddenTargetStillReturnsMatchesFromTheReadableOneWithAPartialWarning() {
    // Mission §42 - 1 success + 1 forbidden -> correlated results AND a
    // partial warning, never a silent complete-looking result.
    seedPods(List.of(pod("pod-a", List.of("app")), pod("pod-b", List.of("app"))), true);
    server.setFixture("pod-a", "app", Fixture.ok(line("2026-09-12T10:00:00.000000000Z",
        jsonLineWithMdc("gateway", "readable", "corr-9", "", "", ""))));
    server.setFixture("pod-b", "app", Fixture.forbidden());

    SourceSearchOutcome outcome = provider.searchWithOutcome(baseRequest().correlationId("corr-9").build()).block();

    assertThat(outcome.events()).extracting(CanonicalLogEvent::message).containsExactly("readable");
    assertThat(outcome.runtimeWarnings()).anySatisfy(w -> assertThat(w).contains("PERMISSION_DENIED"));
  }

  @Test
  void correlationSearchWithAllTargetsUnavailableIsAnExplicitFailureNeverASilentNoReadableTargetsSuccess() {
    seedPods(List.of(pod("pod-a", List.of("app")), pod("pod-b", List.of("app"))), true);
    server.setFixture("pod-a", "app", Fixture.notFound());
    server.setFixture("pod-b", "app", Fixture.notFound());

    StepVerifier.create(provider.search(baseRequest().correlationId("corr-1").build()))
        .expectErrorMatches(e -> e instanceof OpenShiftApiException ex && ex.kind() == Kind.UPSTREAM_UNAVAILABLE)
        .verify();
  }
}
