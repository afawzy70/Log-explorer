package com.logexplorer.source.openshift;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.logexplorer.config.DirectPodLogProperties;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.RawToken;
import com.logexplorer.core.model.SearchRequest;
import com.logexplorer.core.parse.LogLineParser;
import com.logexplorer.source.openshift.MockOpenShiftPodLogServer.Fixture;
import com.logexplorer.source.openshift.OpenShiftApiException.Kind;
import com.logexplorer.source.openshift.WorkloadDiscovery.KindOutcome;
import java.io.IOException;
import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
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
  private long generation;

  @BeforeEach
  void setUp() throws IOException {
    server = new MockOpenShiftPodLogServer(NAMESPACE);
    client = new OpenShiftApiClient(java.util.Map.of());
    session = new OpenShiftSession();
    properties = new DirectPodLogProperties();
    LogLineParser parser = new LogLineParser(new ObjectMapper());
    provider = new DirectPodLogProvider(client, session, parser, properties);

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
    // No fixture registered for this pod/container -> a 404 from the mock,
    // proving the provider only ever asks for what OS-1B resolved and does
    // not invent any other pod.
    List<CanonicalLogEvent> events = provider.search(baseRequest().build()).collectList().block();
    assertThat(events).isEmpty();
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
        new DirectPodLogProvider(client, disconnected, new LogLineParser(new ObjectMapper()), properties);
    assertThat(disconnectedProvider.describeScopeWarnings(baseRequest().build())).isEmpty();
  }

  // ------------------------------------------------------------ preconditions

  @Test
  void searchingWithoutASelectedProjectFailsFast() {
    OpenShiftSession noProject = new OpenShiftSession();
    OcLoginCommand command = new OcLoginCommand(URI.create(server.baseUrl()), TOKEN, null);
    noProject.connect(command, "Test", "developer", List.of(NAMESPACE), ProjectDiscovery.Api.PROJECTS, null);
    DirectPodLogProvider noProjectProvider =
        new DirectPodLogProvider(client, noProject, new LogLineParser(new ObjectMapper()), properties);

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
}
