package com.logexplorer.source.docker;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.dockerjava.api.model.Container;
import com.logexplorer.api.SearchService;
import com.logexplorer.config.DockerProperties;
import com.logexplorer.config.SearchGuardrailsProperties;
import com.logexplorer.config.SourcesProperties;
import com.logexplorer.core.guard.ConcurrencyGuard;
import com.logexplorer.core.guard.SearchGuardrails;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.FollowRequest;
import com.logexplorer.core.model.SearchRequest;
import com.logexplorer.core.model.SearchResult;
import com.logexplorer.core.model.ServiceInfo;
import com.logexplorer.core.model.SourceHealth;
import com.logexplorer.core.mapping.CanonicalField;
import com.logexplorer.core.mapping.FieldMappingProfileService;
import com.logexplorer.core.mapping.JsonPath;
import com.logexplorer.core.mapping.MappingScopeKey;
import com.logexplorer.core.parse.LogLineParser;
import com.logexplorer.core.search.PageCursorCodec;
import com.logexplorer.config.DockerRemoteAllowlistProperties;
import com.logexplorer.source.LogSourceRegistry;
import com.logexplorer.source.docker.security.RemoteHostGuard;
import com.logexplorer.source.docker.security.RemoteHostRejectedException;
import java.net.InetAddress;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import reactor.test.StepVerifier;

/**
 * Behavioral tests for {@link DockerLogSource} against a mocked {@link
 * ReadOnlyDockerClient} (IMPLEMENTATION_PLAN.md "Phase C" required
 * automated test: "merge order, ..., label parsing, stopped containers").
 */
class DockerLogSourceTest {

  private ReadOnlyDockerClient mockClient;
  private DockerProperties properties;
  private DockerLogSource source;
  private RemoteHostGuard remoteHostGuard;
  private FieldMappingProfileService mappingProfileService;

  @BeforeEach
  void setUp() throws Exception {
    mockClient = mock(ReadOnlyDockerClient.class);
    properties = new DockerProperties();
    properties.setMaxContainers(200);
    properties.setDefaultTailLines(2000);

    DockerClientFactory factory = mock(DockerClientFactory.class);
    when(factory.create(properties)).thenReturn(mockClient);

    mappingProfileService = new FieldMappingProfileService();
    LogLineParser parser = new LogLineParser(new ObjectMapper(), mappingProfileService);
    remoteHostGuard = new RemoteHostGuard(new DockerRemoteAllowlistProperties(), InetAddress::getAllByName);
    source = new DockerLogSource(factory, properties, parser, remoteHostGuard);
  }

  private Container container(String id, String name, String project, String service, String state) {
    Container c = mock(Container.class);
    when(c.getId()).thenReturn(id);
    when(c.getNames()).thenReturn(new String[] {"/" + name});
    // Map.of() throws on a null value - a real non-Compose container simply
    // has no com.docker.compose.* keys at all, not a key with a null value,
    // so build the map conditionally rather than passing nulls through.
    java.util.Map<String, String> labels = new java.util.HashMap<>();
    if (project != null) {
      labels.put(ComposeLabels.PROJECT, project);
    }
    if (service != null) {
      labels.put(ComposeLabels.SERVICE, service);
    }
    when(c.getLabels()).thenReturn(labels);
    when(c.getState()).thenReturn(state);
    return c;
  }

  @SuppressWarnings("unchecked")
  private void stubLogs(String containerId, String... rawLinesWithTimestamp) {
    doAnswer(invocation -> {
      DockerFrameCollectingCallback callback = invocation.getArgument(7);
      for (String line : rawLinesWithTimestamp) {
        callback.onNext(new com.github.dockerjava.api.model.Frame(
            com.github.dockerjava.api.model.StreamType.STDOUT,
            line.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
      }
      callback.onComplete();
      return callback;
    }).when(mockClient).readLogs(eq(containerId), anyBoolean(), anyBoolean(), anyBoolean(), any(), any(), any(), any());
  }

  /**
   * Owner mission "Service Filter, Docker Performance, and Verified
   * Default Mapping" §B - simulates a real, artificially slow container
   * read by blocking the calling (boundedElastic) thread for {@code
   * delayMillis} before completing, tracking the observed peak number of
   * simultaneously-in-flight reads via {@code maxActiveReads}. This is the
   * deterministic, non-wall-clock-dependent proof mechanism the mission
   * itself recommends ("max-active-read-counter").
   */
  @SuppressWarnings("unchecked")
  private void stubLogsWithDelay(
      String containerId, long delayMillis, AtomicInteger activeReads, AtomicInteger maxActiveReads,
      String... rawLinesWithTimestamp) {
    doAnswer(invocation -> {
      int active = activeReads.incrementAndGet();
      maxActiveReads.accumulateAndGet(active, Math::max);
      try {
        Thread.sleep(delayMillis);
      } finally {
        activeReads.decrementAndGet();
      }
      DockerFrameCollectingCallback callback = invocation.getArgument(7);
      for (String line : rawLinesWithTimestamp) {
        callback.onNext(new com.github.dockerjava.api.model.Frame(
            com.github.dockerjava.api.model.StreamType.STDOUT,
            line.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
      }
      callback.onComplete();
      return callback;
    }).when(mockClient).readLogs(eq(containerId), anyBoolean(), anyBoolean(), anyBoolean(), any(), any(), any(), any());
  }

  /**
   * Owner mission "Service Filter, Docker Performance, and Verified
   * Default Mapping" §B - a stronger, still-deterministic proof than a
   * counter: {@code barrier} requires exactly {@code barrier.getParties()}
   * reads to be simultaneously in-flight before any of them can complete.
   * If reads ran sequentially (the pre-fix behavior), no more than one
   * thread could ever reach the barrier at once, it would never trip, and
   * every participating read would fail with a timeout - a real,
   * deterministic failure signal, not a flaky wall-clock race.
   */
  @SuppressWarnings("unchecked")
  private void stubLogsWithBarrier(String containerId, CyclicBarrier barrier, String... rawLinesWithTimestamp) {
    doAnswer(invocation -> {
      barrier.await(5, java.util.concurrent.TimeUnit.SECONDS);
      DockerFrameCollectingCallback callback = invocation.getArgument(7);
      for (String line : rawLinesWithTimestamp) {
        callback.onNext(new com.github.dockerjava.api.model.Frame(
            com.github.dockerjava.api.model.StreamType.STDOUT,
            line.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
      }
      callback.onComplete();
      return callback;
    }).when(mockClient).readLogs(eq(containerId), anyBoolean(), anyBoolean(), anyBoolean(), any(), any(), any(), any());
  }

  private String jsonLine(String timestamp, String service, String message) {
    return timestamp + " {\"@timestamp\":\"" + timestamp + "\",\"message\":\"" + message
        + "\",\"application\":\"" + service + "\",\"mdc\":{}}\n";
  }

  // Top-level "traceId" - owner mission "Service Filter, Docker
  // Performance, and Verified Default Mapping" §C default (was "mdc.traceId").
  private String jsonLineWithTraceId(String timestamp, String service, String message, String traceId) {
    return timestamp + " {\"@timestamp\":\"" + timestamp + "\",\"message\":\"" + message
        + "\",\"application\":\"" + service + "\",\"traceId\":\"" + traceId + "\",\"mdc\":{}}\n";
  }

  /**
   * Legacy Remediation Slice 1 recovery, mandatory blocker #1's own
   * required test #1: the Docker receive-timestamp prefix (parsed as
   * {@code dockerTimestamp}/{@code sourceTimestamp}) and the JSON
   * payload's own {@code @timestamp} (parsed as the canonical, displayed
   * {@code timestamp}) are deliberately different values.
   */
  private String jsonLineDivergentTimestamps(String dockerTimestamp, String appTimestamp, String service, String message) {
    return dockerTimestamp + " {\"@timestamp\":\"" + appTimestamp + "\",\"message\":\"" + message
        + "\",\"application\":\"" + service + "\",\"mdc\":{}}\n";
  }

  /**
   * A real, plain-text (non-JSON) line - Docker still supplies a real
   * receive timestamp for it (the leading prefix), but {@code
   * LogLineParser} cannot extract any application {@code @timestamp} from
   * it, so the parsed canonical {@code timestamp} is {@code null} - the
   * exact shape found via this slice's own real-Docker verification
   * (mandatory blocker #1's required test #3).
   */
  private String malformedLine(String dockerTimestamp, String content) {
    return dockerTimestamp + " " + content + "\n";
  }

  @Test
  void discoverServicesOnlyIncludesComposeManagedContainersAndCountsRunningVsTotal() {
    // Build every mock container BEFORE starting the listContainers stub -
    // container() itself calls when(...), and nesting a when() call inside
    // another unfinished when(...).thenReturn(...) confuses Mockito's
    // stubbing state (a real bug this exact test hit on first run).
    List<Container> containers = List.of(
        container("c1", "proj-gateway-1", "proj", "gateway", "running"),
        container("c2", "proj-gateway-2", "proj", "gateway", "exited"),
        container("c3", "proj-accounts-1", "proj", "accounts-api", "running"),
        container("c4", "unrelated", null, null, "running")); // no compose labels
    when(mockClient.listContainers(true)).thenReturn(containers);

    List<ServiceInfo> services = source.discoverServices().collectList().block();

    assertThat(services).hasSize(2);
    ServiceInfo gateway = services.stream().filter(s -> s.name().equals("gateway")).findFirst().orElseThrow();
    assertThat(gateway.runningCount()).isEqualTo(1);
    assertThat(gateway.totalCount()).isEqualTo(2); // stopped container still counted
    ServiceInfo accounts = services.stream().filter(s -> s.name().equals("accounts-api")).findFirst().orElseThrow();
    assertThat(accounts.runningCount()).isEqualTo(1);
    assertThat(accounts.totalCount()).isEqualTo(1);
  }

  @Test
  void stoppedContainersAreStillReadableForSearch() {
    Container stopped = container("c1", "proj-gateway-1", "proj", "gateway", "exited");
    when(mockClient.listContainers(true)).thenReturn(List.of(stopped));
    stubLogs("c1", jsonLine("2026-01-01T00:00:00.000000000Z", "gateway", "from a stopped container"));

    List<CanonicalLogEvent> events = source.search(wideOpenRequest().build()).collectList().block();

    assertThat(events).hasSize(1);
    assertThat(events.get(0).message()).isEqualTo("from a stopped container");
  }

  @Test
  void mergesMultipleContainersInDeterministicNewestFirstOrder() {
    Container gateway = container("c1", "proj-gateway-1", "proj", "gateway", "running");
    Container accounts = container("c2", "proj-accounts-1", "proj", "accounts-api", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(gateway, accounts));

    stubLogs("c1",
        jsonLine("2026-01-01T00:00:00.000000000Z", "gateway", "gateway older"),
        jsonLine("2026-01-01T00:00:02.000000000Z", "gateway", "gateway newer"));
    stubLogs("c2",
        jsonLine("2026-01-01T00:00:01.000000000Z", "accounts-api", "accounts middle"));

    List<CanonicalLogEvent> events = source.search(wideOpenRequest().build()).collectList().block();

    assertThat(events).extracting(CanonicalLogEvent::message)
        .containsExactly("gateway newer", "accounts middle", "gateway older");
  }

  @Test
  void mergeOrderIsDeterministicAcrossRepeatedRunsNotJustCoincidentallySorted() {
    Container a = container("c1", "proj-gateway-1", "proj", "gateway", "running");
    Container b = container("c2", "proj-accounts-1", "proj", "accounts-api", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(a, b));
    stubLogs("c1", jsonLine("2026-01-01T00:00:00.000000000Z", "gateway", "same-instant-a"));
    stubLogs("c2", jsonLine("2026-01-01T00:00:00.000000000Z", "accounts-api", "same-instant-b"));

    List<CanonicalLogEvent> first = source.search(wideOpenRequest().build()).collectList().block();
    List<CanonicalLogEvent> second = source.search(wideOpenRequest().build()).collectList().block();

    assertThat(first).extracting(CanonicalLogEvent::message).isEqualTo(
        second.stream().map(CanonicalLogEvent::message).toList());
  }

  @Test
  void enrichesEventsWithComposeProjectContainerAndStream() {
    Container gateway = container("c1", "proj-gateway-1", "proj", "gateway", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(gateway));
    stubLogs("c1", jsonLine("2026-01-01T00:00:00.000000000Z", "gateway", "hello"));

    CanonicalLogEvent event = source.search(wideOpenRequest().build()).blockFirst();

    assertThat(event.sourceId()).isEqualTo("local-docker");
    assertThat(event.composeProject()).isEqualTo("proj");
    assertThat(event.containerId()).isEqualTo("c1");
    assertThat(event.containerName()).isEqualTo("proj-gateway-1");
    assertThat(event.stream()).isEqualTo("stdout");
  }

  @Test
  void composeProjectFilterExcludesContainersFromOtherProjects() {
    properties.setComposeProjectFilter("proj-a");
    Container inProject = container("c1", "a-gateway-1", "proj-a", "gateway", "running");
    Container otherProject = container("c2", "b-gateway-1", "proj-b", "gateway", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(inProject, otherProject));
    stubLogs("c1", jsonLine("2026-01-01T00:00:00.000000000Z", "gateway", "in project"));

    List<CanonicalLogEvent> events = source.search(wideOpenRequest().build()).collectList().block();

    assertThat(events).hasSize(1);
    assertThat(events.get(0).composeProject()).isEqualTo("proj-a");
  }

  @Test
  void aBlankComposeProjectFilterIsTreatedAsNoFilterNotAsAnEmptyProjectName() {
    // Regression test for a real bug found via Phase K's own Compose
    // end-to-end verification: docker-compose's `env_file` mechanism
    // passes a declared-but-empty .env line through as the literal empty
    // string, not an absent variable, which Spring binds as "" here, not
    // null - every real container was previously silently excluded
    // because "" never equals a real project name.
    properties.setComposeProjectFilter("");
    Container container = container("c1", "a-gateway-1", "proj-a", "gateway", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(container));
    stubLogs("c1", jsonLine("2026-01-01T00:00:00.000000000Z", "gateway", "still discovered"));

    List<CanonicalLogEvent> events = source.search(wideOpenRequest().build()).collectList().block();

    assertThat(events).hasSize(1);
  }

  private Container excludedContainer(String id, String name, String project, String service, String state) {
    Container c = container(id, name, project, service, state);
    java.util.Map<String, String> labels = new java.util.HashMap<>(c.getLabels());
    labels.put(ComposeLabels.EXCLUDED, "true");
    when(c.getLabels()).thenReturn(labels);
    return c;
  }

  // --- composeService metadata (Legacy Remediation Slice 3) --------------

  @Test
  void composeServiceIsPopulatedOnSearchedEventsAlongsideComposeProject() {
    Container gateway = container("c1", "proj-gateway-1", "proj", "gateway", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(gateway));
    stubLogs("c1", jsonLine("2026-01-01T00:00:00.000000000Z", "gateway", "hello"));

    CanonicalLogEvent event = source.search(wideOpenRequest().build()).blockFirst();

    assertThat(event.composeProject()).isEqualTo("proj");
    assertThat(event.composeService()).isEqualTo("gateway");
  }

  @Test
  void composeServiceIsPopulatedOnFollowedEvents() throws Exception {
    Container gateway = container("c1", "proj-gateway-1", "proj", "gateway", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(gateway));
    stubFollow("c1", jsonLine("2026-01-01T00:00:00.000000000Z", "gateway", "hello"));

    CanonicalLogEvent event = source.follow(new com.logexplorer.core.model.FollowRequest("local-docker", List.of()))
        .blockFirst(java.time.Duration.ofSeconds(2));

    assertThat(event.composeProject()).isEqualTo("proj");
    assertThat(event.composeService()).isEqualTo("gateway");
  }

  // --- Compose project hard boundary matrix (Legacy Remediation Slice 3) -
  // "Add deterministic tests with at least TWO Compose projects... both
  // must include overlapping Compose service names, e.g. project-a/payments
  // and project-b/payments."

  private Container paymentsContainer(String project, String containerId) {
    return container(containerId, project + "-payments-1", project, "payments", "running");
  }

  @Test
  void selectingProjectAReturnsZeroProjectBContainersInDiscoverServices() {
    properties.setComposeProjectFilter("project-a");
    Container aPayments = paymentsContainer("project-a", "ca");
    Container bPayments = paymentsContainer("project-b", "cb");
    when(mockClient.listContainers(true)).thenReturn(List.of(aPayments, bPayments));

    List<ServiceInfo> services = source.discoverServices().collectList().block();

    assertThat(services).hasSize(1);
    assertThat(services.get(0).name()).isEqualTo("payments");
    assertThat(services.get(0).totalCount()).isEqualTo(1); // only project-a's one container, never project-b's
  }

  @Test
  void selectingProjectAReturnsZeroProjectBEventsInSearch() {
    properties.setComposeProjectFilter("project-a");
    Container aPayments = paymentsContainer("project-a", "ca");
    Container bPayments = paymentsContainer("project-b", "cb");
    when(mockClient.listContainers(true)).thenReturn(List.of(aPayments, bPayments));
    stubLogs("ca", jsonLine("2026-01-01T00:00:00.000000000Z", "payments", "project-a event"));
    stubLogs("cb", jsonLine("2026-01-01T00:00:01.000000000Z", "payments", "project-b event"));

    List<CanonicalLogEvent> events = source.search(wideOpenRequest().build()).collectList().block();

    assertThat(events).hasSize(1);
    assertThat(events.get(0).composeProject()).isEqualTo("project-a");
    assertThat(events.get(0).message()).isEqualTo("project-a event");
    verify(mockClient, never()).readLogs(eq("cb"), anyBoolean(), anyBoolean(), anyBoolean(), any(), any(), any(), any());
  }

  @Test
  void selectingProjectAReturnsZeroProjectBEventsInFollow() throws Exception {
    // A real live-tail Flux never completes on its own (it only ever
    // terminates via cancellation - HANDOVER.md §18.2), so this proves
    // isolation the same way the pre-existing followOnlyFollowsContainersMatchingTheRequestedServices
    // test already does: subscribe (non-blocking) and verify which
    // container(s) followLogs() was actually invoked for, rather than
    // blocking for a completion signal that will never arrive.
    properties.setComposeProjectFilter("project-a");
    Container aPayments = paymentsContainer("project-a", "ca");
    Container bPayments = paymentsContainer("project-b", "cb");
    when(mockClient.listContainers(true)).thenReturn(List.of(aPayments, bPayments));
    when(mockClient.followLogs(any(), any())).thenAnswer(invocation -> invocation.getArgument(1));

    source.follow(new com.logexplorer.core.model.FollowRequest("local-docker", List.of())).subscribe();

    verify(mockClient, org.mockito.Mockito.timeout(2000)).followLogs(eq("ca"), any());
    verify(mockClient, never()).followLogs(eq("cb"), any());
  }

  @Test
  void selectingProjectBIsTheExactReverseAndReturnsZeroProjectAResults() {
    properties.setComposeProjectFilter("project-b");
    Container aPayments = paymentsContainer("project-a", "ca");
    Container bPayments = paymentsContainer("project-b", "cb");
    when(mockClient.listContainers(true)).thenReturn(List.of(aPayments, bPayments));
    stubLogs("cb", jsonLine("2026-01-01T00:00:00.000000000Z", "payments", "project-b event"));

    List<CanonicalLogEvent> events = source.search(wideOpenRequest().build()).collectList().block();
    List<ServiceInfo> services = source.discoverServices().collectList().block();

    assertThat(events).hasSize(1);
    assertThat(events.get(0).composeProject()).isEqualTo("project-b");
    assertThat(services).hasSize(1);
    assertThat(services.get(0).totalCount()).isEqualTo(1);
  }

  @Test
  void sameServiceNameInTwoDifferentProjectsNeverMergesIdentityWhenNoProjectFilterIsConfigured() {
    // No project filter: both containers are legitimately discovered, but
    // they must never be merged into one another's identity - each event
    // still carries its own real composeProject, and discoverServices'
    // per-service running/total count spans both (that is the documented,
    // correct "no filter configured" behavior - isolation is what the
    // project filter itself provides, not an implicit default).
    Container aPayments = paymentsContainer("project-a", "ca");
    Container bPayments = paymentsContainer("project-b", "cb");
    when(mockClient.listContainers(true)).thenReturn(List.of(aPayments, bPayments));
    stubLogs("ca", jsonLine("2026-01-01T00:00:00.000000000Z", "payments", "a"));
    stubLogs("cb", jsonLine("2026-01-01T00:00:01.000000000Z", "payments", "b"));

    List<CanonicalLogEvent> events = source.search(wideOpenRequest().build()).collectList().block();
    List<ServiceInfo> services = source.discoverServices().collectList().block();

    assertThat(events).hasSize(2);
    assertThat(events.stream().map(CanonicalLogEvent::composeProject)).containsExactlyInAnyOrder("project-a", "project-b");
    assertThat(services).hasSize(1); // one logical "payments" service name...
    assertThat(services.get(0).totalCount()).isEqualTo(2); // ...spanning both projects' containers, honestly
  }

  @Test
  void aBlankComposeProjectFilterBehavesIdenticallyToNoFilterAcrossBothProjects() {
    properties.setComposeProjectFilter("");
    Container aPayments = paymentsContainer("project-a", "ca");
    Container bPayments = paymentsContainer("project-b", "cb");
    when(mockClient.listContainers(true)).thenReturn(List.of(aPayments, bPayments));
    stubLogs("ca", jsonLine("2026-01-01T00:00:00.000000000Z", "payments", "a"));
    stubLogs("cb", jsonLine("2026-01-01T00:00:01.000000000Z", "payments", "b"));

    List<CanonicalLogEvent> events = source.search(wideOpenRequest().build()).collectList().block();

    assertThat(events).hasSize(2);
  }

  @Test
  void aTargetProjectWithNoRunningContainersYieldsEmptyResultsNeverAnError() {
    properties.setComposeProjectFilter("project-with-nothing-running");
    Container aPayments = paymentsContainer("project-a", "ca");
    when(mockClient.listContainers(true)).thenReturn(List.of(aPayments));

    List<CanonicalLogEvent> events = source.search(wideOpenRequest().build()).collectList().block();
    List<ServiceInfo> services = source.discoverServices().collectList().block();

    assertThat(events).isEmpty();
    assertThat(services).isEmpty();
  }

  @Test
  void stoppedContainersRemainReadableWithinAProjectFilterTheSameAsWithoutOne() {
    properties.setComposeProjectFilter("project-a");
    Container stopped = container("ca", "project-a-payments-1", "project-a", "payments", "exited");
    when(mockClient.listContainers(true)).thenReturn(List.of(stopped));
    stubLogs("ca", jsonLine("2026-01-01T00:00:00.000000000Z", "payments", "from a stopped container"));

    List<CanonicalLogEvent> events = source.search(wideOpenRequest().build()).collectList().block();

    assertThat(events).hasSize(1);
  }

  // --- self-exclusion (Legacy Remediation Slice 3) ------------------------

  @Test
  void selfExcludedContainerIsAbsentFromDiscoverServices() {
    Container excluded = excludedContainer("app", "log-explorer-app-1", "log-explorer", "app", "running");
    Container ordinary = container("c1", "log-explorer-gateway-1", "log-explorer", "gateway", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(excluded, ordinary));

    List<ServiceInfo> services = source.discoverServices().collectList().block();

    assertThat(services).extracting(ServiceInfo::name).containsExactly("gateway");
  }

  @Test
  void selfExcludedContainerIsAbsentFromSearch() {
    Container excluded = excludedContainer("app", "log-explorer-app-1", "log-explorer", "app", "running");
    Container ordinary = container("c1", "log-explorer-gateway-1", "log-explorer", "gateway", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(excluded, ordinary));
    stubLogs("app", jsonLine("2026-01-01T00:00:00.000000000Z", "app", "own log line - must never appear"));
    stubLogs("c1", jsonLine("2026-01-01T00:00:01.000000000Z", "gateway", "unrelated container - must appear"));

    List<CanonicalLogEvent> events = source.search(wideOpenRequest().build()).collectList().block();

    assertThat(events).hasSize(1);
    assertThat(events.get(0).message()).isEqualTo("unrelated container - must appear");
    verify(mockClient, never()).readLogs(eq("app"), anyBoolean(), anyBoolean(), anyBoolean(), any(), any(), any(), any());
  }

  @Test
  void selfExcludedContainerIsAbsentFromLiveTail() throws Exception {
    Container excluded = excludedContainer("app", "log-explorer-app-1", "log-explorer", "app", "running");
    Container ordinary = container("c1", "log-explorer-gateway-1", "log-explorer", "gateway", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(excluded, ordinary));
    when(mockClient.followLogs(any(), any())).thenAnswer(invocation -> invocation.getArgument(1));

    source.follow(new com.logexplorer.core.model.FollowRequest("local-docker", List.of())).subscribe();

    verify(mockClient, org.mockito.Mockito.timeout(2000)).followLogs(eq("c1"), any());
    verify(mockClient, never()).followLogs(eq("app"), any());
  }

  @Test
  void selfExclusionAppliesRegardlessOfAnyConfiguredProjectFilter() {
    properties.setComposeProjectFilter("log-explorer");
    Container excluded = excludedContainer("app", "log-explorer-app-1", "log-explorer", "app", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(excluded));

    List<ServiceInfo> services = source.discoverServices().collectList().block();

    assertThat(services).isEmpty();
  }

  // --- REMOTE mode SSRF-guard integration (Legacy Remediation Slice 3) ---
  // Exhaustive policy behavior itself lives in RemoteHostGuardTest; these
  // prove DockerLogSource actually *calls* the guard, fresh, before every
  // real operation, for a genuinely rejected host.

  @Test
  void remoteModeWithAForbiddenHostFailsSearchViaTheSharedGuard() {
    properties.setMode(DockerProperties.Mode.REMOTE);
    properties.setHost("127.0.0.1"); // loopback - rejected by the real guard's default policy

    org.junit.jupiter.api.Assertions.assertThrows(RemoteHostRejectedException.class,
        () -> source.search(wideOpenRequest().build()).collectList().block());
  }

  @Test
  void remoteModeWithAForbiddenHostFailsDiscoverServicesViaTheSharedGuard() {
    properties.setMode(DockerProperties.Mode.REMOTE);
    properties.setHost("169.254.169.254"); // link-local / cloud metadata

    org.junit.jupiter.api.Assertions.assertThrows(RemoteHostRejectedException.class,
        () -> source.discoverServices().collectList().block());
  }

  @Test
  void remoteModeWithAForbiddenHostFailsFollowViaTheSharedGuard() {
    properties.setMode(DockerProperties.Mode.REMOTE);
    properties.setHost("10.0.0.5"); // private LAN, not allowlisted by default

    org.junit.jupiter.api.Assertions.assertThrows(RemoteHostRejectedException.class,
        () -> source.follow(new com.logexplorer.core.model.FollowRequest("local-docker", List.of())).blockFirst());
  }

  @Test
  void remoteModeWithAnAllowedPublicHostNeverConsultsTheGuardNegatively() {
    properties.setMode(DockerProperties.Mode.REMOTE);
    properties.setHost("192.0.2.10"); // TEST-NET-1 documentation range - not forbidden by default policy
    when(mockClient.listContainers(true)).thenReturn(List.of());

    List<ServiceInfo> services = source.discoverServices().collectList().block();

    assertThat(services).isEmpty(); // succeeded (no exception), simply nothing to discover
  }

  @Test
  void localModeNeverConsultsTheRemoteHostGuardEvenWithAHostSetToAForbiddenValue() {
    // LOCAL mode ignores host/port entirely - a stray/leftover host value
    // must never cause LOCAL mode to fail via the REMOTE-only guard.
    properties.setMode(DockerProperties.Mode.LOCAL);
    properties.setHost("127.0.0.1");
    when(mockClient.listContainers(true)).thenReturn(List.of());

    List<ServiceInfo> services = source.discoverServices().collectList().block();

    assertThat(services).isEmpty();
  }

  @SuppressWarnings("unchecked")
  private void stubFollow(String containerId, String... rawLinesWithTimestamp) {
    doAnswer(invocation -> {
      DockerFollowCallback callback = invocation.getArgument(1);
      for (String line : rawLinesWithTimestamp) {
        callback.onNext(new com.github.dockerjava.api.model.Frame(
            com.github.dockerjava.api.model.StreamType.STDOUT,
            line.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
      }
      return callback;
    }).when(mockClient).followLogs(eq(containerId), any());
  }

  @Test
  void serviceFilterOnTheSearchRequestOnlyQueriesMatchingContainers() {
    Container gateway = container("c1", "proj-gateway-1", "proj", "gateway", "running");
    Container accounts = container("c2", "proj-accounts-1", "proj", "accounts-api", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(gateway, accounts));
    stubLogs("c1", jsonLine("2026-01-01T00:00:00.000000000Z", "gateway", "gateway line"));

    SearchRequest request = wideOpenRequest().services(List.of("gateway")).build();
    List<CanonicalLogEvent> events = source.search(request).collectList().block();

    assertThat(events).hasSize(1);
    assertThat(events.get(0).service()).isEqualTo("gateway");
    verify(mockClient, never()).readLogs(eq("c2"), anyBoolean(), anyBoolean(), anyBoolean(), any(), any(), any(), any());
  }

  // ------------------------------------------------------------ owner mission
  // "Service Filter, Docker Performance, and Verified Default Mapping" §A

  @Test
  void excludeModeNeverReadsTheExcludedServicesContainersAtAll_dockerExcludedServicesReadCountIsZero() {
    // Required proof: DOCKER_EXCLUDED_SERVICES_READ_COUNT=0 - excluded
    // services' containers must never even reach a readLogs() call, not
    // merely have their events discarded after the fact.
    Container gateway = container("c1", "proj-gateway-1", "proj", "gateway", "running");
    Container accounts = container("c2", "proj-accounts-1", "proj", "accounts-api", "running");
    Container audit = container("c3", "proj-audit-1", "proj", "audit", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(gateway, accounts, audit));
    stubLogs("c2", jsonLine("2026-01-01T00:00:00.000000000Z", "accounts-api", "accounts line"));

    SearchRequest request = wideOpenRequest()
        .services(List.of("gateway", "audit"))
        .serviceFilterMode(SearchRequest.ServiceFilterMode.EXCLUDE)
        .build();
    List<CanonicalLogEvent> events = source.search(request).collectList().block();

    assertThat(events).hasSize(1);
    assertThat(events.get(0).service()).isEqualTo("accounts-api");
    // DOCKER_EXCLUDED_SERVICES_READ_COUNT=0 - neither excluded container's
    // service was ever passed to readLogs().
    verify(mockClient, never()).readLogs(eq("c1"), anyBoolean(), anyBoolean(), anyBoolean(), any(), any(), any(), any());
    verify(mockClient, never()).readLogs(eq("c3"), anyBoolean(), anyBoolean(), anyBoolean(), any(), any(), any(), any());
  }

  @Test
  void excludeModeWithAnEmptyListAppliesNoRestriction_readsEveryEligibleContainer() {
    Container gateway = container("c1", "proj-gateway-1", "proj", "gateway", "running");
    Container accounts = container("c2", "proj-accounts-1", "proj", "accounts-api", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(gateway, accounts));
    stubLogs("c1", jsonLine("2026-01-01T00:00:00.000000000Z", "gateway", "gateway line"));
    stubLogs("c2", jsonLine("2026-01-01T00:00:01.000000000Z", "accounts-api", "accounts line"));

    SearchRequest request = wideOpenRequest()
        .services(List.of())
        .serviceFilterMode(SearchRequest.ServiceFilterMode.EXCLUDE)
        .build();
    List<CanonicalLogEvent> events = source.search(request).collectList().block();

    assertThat(events).hasSize(2);
    verify(mockClient).readLogs(eq("c1"), anyBoolean(), anyBoolean(), anyBoolean(), any(), any(), any(), any());
    verify(mockClient).readLogs(eq("c2"), anyBoolean(), anyBoolean(), anyBoolean(), any(), any(), any(), any());
  }

  @Test
  void excludeModeRespectsTheComposeProjectBoundary_neverExcludesAcrossProjects() {
    // A container in another Compose project is already excluded by the
    // project filter regardless of the service exclude list - proves the
    // two filters compose correctly rather than one silently overriding
    // the other.
    Container projectAGateway = container("c1", "projA-gateway-1", "projA", "gateway", "running");
    Container projectBGateway = container("c2", "projB-gateway-1", "projB", "gateway", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(projectAGateway, projectBGateway));
    stubLogs("c1", jsonLine("2026-01-01T00:00:00.000000000Z", "gateway", "project A line"));

    SearchRequest request = wideOpenRequest()
        .services(List.of("audit"))
        .serviceFilterMode(SearchRequest.ServiceFilterMode.EXCLUDE)
        .composeProject("projA")
        .build();
    List<CanonicalLogEvent> events = source.search(request).collectList().block();

    assertThat(events).hasSize(1);
    assertThat(events.get(0).message()).isEqualTo("project A line");
    verify(mockClient, never()).readLogs(eq("c2"), anyBoolean(), anyBoolean(), anyBoolean(), any(), any(), any(), any());
  }

  @Test
  void switchingFromExcludeBackToIncludeOnANewRequestNeverLeaksThePriorModesRestriction() {
    // Each SearchRequest is immutable and self-contained - proves the
    // adapter carries no residual mode state between two independent
    // search() calls (no cross-filter interference / no source-switch
    // state leak).
    Container gateway = container("c1", "proj-gateway-1", "proj", "gateway", "running");
    Container audit = container("c2", "proj-audit-1", "proj", "audit", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(gateway, audit));
    stubLogs("c1", jsonLine("2026-01-01T00:00:00.000000000Z", "gateway", "gateway line"));
    stubLogs("c2", jsonLine("2026-01-01T00:00:01.000000000Z", "audit", "audit line"));

    SearchRequest excludeAudit = wideOpenRequest()
        .services(List.of("audit"))
        .serviceFilterMode(SearchRequest.ServiceFilterMode.EXCLUDE)
        .build();
    List<CanonicalLogEvent> excludeResults = source.search(excludeAudit).collectList().block();
    assertThat(excludeResults).extracting(CanonicalLogEvent::service).containsExactly("gateway");

    SearchRequest includeAudit = wideOpenRequest()
        .services(List.of("audit"))
        .serviceFilterMode(SearchRequest.ServiceFilterMode.INCLUDE)
        .build();
    List<CanonicalLogEvent> includeResults = source.search(includeAudit).collectList().block();
    assertThat(includeResults).extracting(CanonicalLogEvent::service).containsExactly("audit");
  }

  @Test
  void structuredFiltersLikeTraceIdAreActuallyAppliedToEvents() {
    // Real bug found while extracting core.search.EventFilters: this
    // adapter previously filtered containers by service only and never
    // applied any per-event structured filter (traceId, correlationId,
    // text, sensitive filters, ...) at all - a request for one specific
    // traceId would have silently returned every event from the matching
    // containers/time-range instead.
    Container gateway = container("c1", "proj-gateway-1", "proj", "gateway", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(gateway));
    stubLogs("c1",
        jsonLineWithTraceId("2026-01-01T00:00:00.000000000Z", "gateway", "matching trace", "trace-abc"),
        jsonLineWithTraceId("2026-01-01T00:00:01.000000000Z", "gateway", "other trace", "trace-xyz"));

    SearchRequest request = wideOpenRequest().traceId("trace-abc").build();
    List<CanonicalLogEvent> events = source.search(request).collectList().block();

    assertThat(events).hasSize(1);
    assertThat(events.get(0).message()).isEqualTo("matching trace");
    assertThat(events.get(0).traceId()).isEqualTo("trace-abc");
  }

  @Test
  void oneUnreadableContainerDoesNotFailTheWholeSearch() {
    Container ok = container("c1", "proj-gateway-1", "proj", "gateway", "running");
    Container broken = container("c2", "proj-accounts-1", "proj", "accounts-api", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(ok, broken));
    stubLogs("c1", jsonLine("2026-01-01T00:00:00.000000000Z", "gateway", "still works"));
    doThrow(new RuntimeException("boom"))
        .when(mockClient).readLogs(eq("c2"), anyBoolean(), anyBoolean(), anyBoolean(), any(), any(), any(), any());

    List<CanonicalLogEvent> events = source.search(wideOpenRequest().build()).collectList().block();

    assertThat(events).hasSize(1);
    assertThat(events.get(0).message()).isEqualTo("still works");
  }

  @Test
  void perContainerLogReadIsBoundedByTheConfiguredDefaultTailLines() {
    properties.setDefaultTailLines(500);
    Container gateway = container("c1", "proj-gateway-1", "proj", "gateway", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(gateway));
    stubLogs("c1", jsonLine("2026-01-01T00:00:00.000000000Z", "gateway", "x"));

    source.search(wideOpenRequest().build()).collectList().block();

    verify(mockClient).readLogs(eq("c1"), anyBoolean(), anyBoolean(), anyBoolean(), any(), any(), eq(500), any());
  }

  @Test
  void localModeReportsLocalDisplayName() {
    properties.setMode(DockerProperties.Mode.LOCAL);
    assertThat(source.displayName()).isEqualTo("Local Docker Compose");
    assertThat(source.id()).isEqualTo("local-docker");
  }

  @Test
  void remoteModeReportsHostInDisplayNameButKeepsTheSameStableId() {
    properties.setMode(DockerProperties.Mode.REMOTE);
    properties.setHost("192.0.2.10");
    properties.setPort(2375);
    assertThat(source.displayName()).contains("192.0.2.10").contains("2375");
    assertThat(source.id()).isEqualTo("local-docker");
  }

  @Test
  void capabilitiesReportLiveTailTrueNowThatPhaseJWiresTheEndpoint() {
    var caps = source.capabilities();
    assertThat(caps.historicalSearch()).isTrue();
    assertThat(caps.serviceDiscovery()).isTrue();
    assertThat(caps.liveTail()).isTrue();
    assertThat(caps.rawLogQL()).isFalse();
  }

  @Test
  void capabilitiesReportComposeProjectScopingTrueUxR3() {
    assertThat(source.capabilities().composeProjectScoping()).isTrue();
  }

  // --- UX-R3: per-request Compose project scope, overlapping service names ---

  /**
   * The mission's own mandatory scenario: two real Compose projects, each
   * with a service named identically ("api"), overlapping on purpose.
   * Proves the per-request {@code composeProject} - not just the static
   * deployment-time filter already covered above - is a genuine hard
   * boundary that a same-named service in the *other* project can never
   * cross, in either direction.
   */
  @Test
  void perRequestComposeProjectIsolatesOverlappingSameNamedServicesInEitherDirection() {
    Container projectAApi = container("a1", "project-a-api-1", "project-a", "api", "running");
    Container projectBApi = container("b1", "project-b-api-1", "project-b", "api", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(projectAApi, projectBApi));
    stubLogs("a1", jsonLine("2026-01-01T00:00:00.000000000Z", "api", "MARKER-PROJECT-A-ONLY"));
    stubLogs("b1", jsonLine("2026-01-01T00:00:00.000000000Z", "api", "MARKER-PROJECT-B-ONLY"));

    List<CanonicalLogEvent> fromA = source.search(wideOpenRequest().composeProject("project-a").build())
        .collectList().block();
    assertThat(fromA).extracting(CanonicalLogEvent::message).containsExactly("MARKER-PROJECT-A-ONLY");
    assertThat(fromA).extracting(CanonicalLogEvent::composeProject).containsOnly("project-a");

    List<CanonicalLogEvent> fromB = source.search(wideOpenRequest().composeProject("project-b").build())
        .collectList().block();
    assertThat(fromB).extracting(CanonicalLogEvent::message).containsExactly("MARKER-PROJECT-B-ONLY");
    assertThat(fromB).extracting(CanonicalLogEvent::composeProject).containsOnly("project-b");
  }

  @Test
  void eachContainersOwnRealComposeProjectDrivesWhichFieldMappingProfileParsesItsEvents() {
    // Owner mission "Project-Scoped Schema Scan" §2/§7/§8 - a saved
    // mapping edit for project-a's own scope must apply to project-a's
    // events and MUST NOT leak into project-b's events read in the SAME,
    // unfiltered (no composeProject requested) search - each event is
    // keyed by its OWN container's real Compose project label, never a
    // single global profile.
    MappingScopeKey scopeA = MappingScopeKey.of("local-docker", "project-a");
    mappingProfileService.updateCandidates(scopeA, CanonicalField.CIF, List.of(JsonPath.parse("topLevelCif")));

    Container projectAApi = container("a1", "project-a-api-1", "project-a", "api", "running");
    Container projectBApi = container("b1", "project-b-api-1", "project-b", "api", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(projectAApi, projectBApi));
    String lineWithTopLevelCif = "2026-01-01T00:00:00.000000000Z "
        + "{\"@timestamp\":\"2026-01-01T00:00:00.000000000Z\",\"message\":\"m\",\"application\":\"api\","
        + "\"topLevelCif\":\"RAW-CIF-A\",\"mdc\":{}}\n";
    stubLogs("a1", lineWithTopLevelCif);
    stubLogs("b1", lineWithTopLevelCif);

    // No composeProject filter - both containers' events are returned together.
    List<CanonicalLogEvent> events = source.search(wideOpenRequest().build()).collectList().block();

    CanonicalLogEvent fromProjectA = events.stream().filter(e -> "project-a".equals(e.composeProject())).findFirst().orElseThrow();
    CanonicalLogEvent fromProjectB = events.stream().filter(e -> "project-b".equals(e.composeProject())).findFirst().orElseThrow();

    assertThat(fromProjectA.sensitive().cif())
        .as("project-a's own saved mapping (topLevelCif) resolves CIF for project-a's event")
        .isEqualTo("RAW-CIF-A");
    assertThat(fromProjectB.sensitive().cif())
        .as("project-b's event is untouched by project-a's mapping edit - still the untouched default (mdc.cif), which this line doesn't have")
        .isNull();
  }

  @Test
  void perRequestComposeProjectTakesPrecedenceOverTheStaticDeploymentTimeFilter() {
    properties.setComposeProjectFilter("project-a"); // deployment-time default
    Container projectAApi = container("a1", "project-a-api-1", "project-a", "api", "running");
    Container projectBApi = container("b1", "project-b-api-1", "project-b", "api", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(projectAApi, projectBApi));
    stubLogs("b1", jsonLine("2026-01-01T00:00:00.000000000Z", "api", "from b"));

    // The caller explicitly selected project-b for this one request -
    // that always wins over whatever the deployer's own static default is.
    List<CanonicalLogEvent> events = source.search(wideOpenRequest().composeProject("project-b").build())
        .collectList().block();
    assertThat(events).extracting(CanonicalLogEvent::composeProject).containsOnly("project-b");
  }

  @Test
  void aMaliciousOrInvalidComposeProjectStringSafelyMatchesZeroContainersRatherThanFailingOpen() {
    Container projectAApi = container("a1", "project-a-api-1", "project-a", "api", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(projectAApi));
    stubLogs("a1", jsonLine("2026-01-01T00:00:00.000000000Z", "api", "should never be returned"));

    // Deliberately excludes blank/whitespace-only strings - those mean "no
    // selection" by this codebase's own established convention (see
    // `aBlankComposeProjectFilterIsTreatedAsNoFilterNotAsAnEmptyProjectName`
    // above), not an attack; every value here is non-blank but still
    // guaranteed to never equal a real project's own label.
    for (String malicious : new String[] {
        "project-a; DROP TABLE x", "../../etc/passwd", "*", "project-a ", "does-not-exist",
    }) {
      List<CanonicalLogEvent> events = source.search(wideOpenRequest().composeProject(malicious).build())
          .collectList().block();
      assertThat(events).as("composeProject=%s must fail safe (zero results), never leak project-a", malicious).isEmpty();
    }
  }

  @Test
  void discoverComposeProjectsReturnsEveryRealDistinctProjectSortedNeverScopedByAPreviouslySelectedProject() {
    properties.setComposeProjectFilter("project-a"); // must not narrow discovery itself
    Container a = container("a1", "project-a-api-1", "project-a", "api", "running");
    Container b = container("b1", "project-b-api-1", "project-b", "api", "running");
    Container excluded = excludedContainer("x1", "log-explorer-1", "log-explorer", "app", "running");
    Container nonCompose = container("n1", "some-plain-container", null, null, "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(b, a, excluded, nonCompose, a));

    List<String> projects = source.discoverComposeProjects();

    assertThat(projects).containsExactly("project-a", "project-b"); // sorted, distinct, self-excluded/non-Compose omitted
  }

  @Test
  void discoverComposeProjectsReturnsEmptyTruthfullyWhenNoneExist() {
    when(mockClient.listContainers(true)).thenReturn(List.of());
    assertThat(source.discoverComposeProjects()).isEmpty();
  }

  @Test
  void discoverServicesScopedToOneProjectNeverSeesTheOverlappingSameNamedServiceInTheOtherProject() {
    Container projectAApi = container("a1", "project-a-api-1", "project-a", "api", "running");
    Container projectAWeb = container("a2", "project-a-web-1", "project-a", "web", "running");
    Container projectBApi = container("b1", "project-b-api-1", "project-b", "api", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(projectAApi, projectAWeb, projectBApi));

    List<ServiceInfo> servicesA = source.discoverServices("project-a").collectList().block();
    assertThat(servicesA).extracting(ServiceInfo::name).containsExactlyInAnyOrder("api", "web");

    List<ServiceInfo> servicesB = source.discoverServices("project-b").collectList().block();
    assertThat(servicesB).extracting(ServiceInfo::name).containsExactly("api");
    // Same service *name* in both projects, but discovering project-b's
    // "api" must never be conflated with project-a's own "api" container -
    // proven by project-a having exactly 2 services (api+web) and
    // project-b having exactly 1 (api), never 2 or 3.
  }

  @Test
  void unscopedDiscoverServicesStillWorksUnchangedForBackwardCompatibility() {
    Container container = container("c1", "proj-gateway-1", "proj", "gateway", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(container));
    List<ServiceInfo> services = source.discoverServices().collectList().block();
    assertThat(services).extracting(ServiceInfo::name).containsExactly("gateway");
  }

  @Test
  void followRespectsThePerRequestComposeProjectForOverlappingSameNamedServices() {
    // The mission's overlapping-service-name scenario, for Live: both
    // projects have a container running a service literally named "api" -
    // selecting project-a must only ever start following project-a's own
    // container, never project-b's, even though the service name alone
    // cannot tell them apart.
    Container projectAApi = container("a1", "project-a-api-1", "project-a", "api", "running");
    Container projectBApi = container("b1", "project-b-api-1", "project-b", "api", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(projectAApi, projectBApi));
    when(mockClient.followLogs(any(), any())).thenAnswer(invocation -> invocation.getArgument(1));

    source.follow(new com.logexplorer.core.model.FollowRequest("local-docker", List.of(), "project-a"))
        .subscribe();

    verify(mockClient, org.mockito.Mockito.timeout(2000)).followLogs(eq("a1"), any());
    verify(mockClient, never()).followLogs(eq("b1"), any());
  }

  @Test
  void healthReportsUpWhenPingSucceedsAndAtLeastOneContainerMatches() {
    // mockClient.ping() is a no-op void call by default (Mockito) - succeeds.
    Container gateway = container("c1", "proj-gateway-1", "proj", "gateway", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(gateway));

    StepVerifier.create(source.health())
        .assertNext(h -> {
          assertThat(h.status()).isEqualTo(SourceHealth.Status.UP);
          assertThat(h.warnings()).isEmpty();
        })
        .verifyComplete();
  }

  /**
   * Legacy Remediation Slice 6 — reachable but nothing to search is a real,
   * observable degradation (any search against this source will silently
   * return zero results), distinct from an actual connectivity failure.
   */
  @Test
  void healthReportsDegradedWhenPingSucceedsButNoContainersMatch() {
    when(mockClient.listContainers(true)).thenReturn(List.of());

    StepVerifier.create(source.health())
        .assertNext(h -> {
          assertThat(h.status()).isEqualTo(SourceHealth.Status.DEGRADED);
          assertThat(h.message()).contains("no containers matched");
          assertThat(h.warnings()).hasSize(1);
          assertThat(h.warnings().get(0)).doesNotContain("Exception"); // fixed, sanitized text, never a raw error
        })
        .verifyComplete();
  }

  /** A non-Compose-managed container present in the daemon must not count as "matched" - reuses the exact same {@code relevantContainers} filter every other operation goes through. */
  @Test
  void healthReportsDegradedWhenOnlyNonMatchingContainersArePresent() {
    Container unmanaged = container("c1", "some-unrelated-container", null, null, "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(unmanaged));

    StepVerifier.create(source.health())
        .assertNext(h -> assertThat(h.status()).isEqualTo(SourceHealth.Status.DEGRADED))
        .verifyComplete();
  }

  @Test
  void healthReportsDownWithASanitizedMessageWhenPingFails() {
    doThrow(new RuntimeException("Connection refused")).when(mockClient).ping();

    StepVerifier.create(source.health())
        .assertNext(h -> {
          assertThat(h.status()).isEqualTo(SourceHealth.Status.DOWN);
          assertThat(h.message()).doesNotContain("RuntimeException"); // sanitized, not the raw exception
        })
        .verifyComplete();
  }

  @Test
  void followEmitsRealParsedEnrichedEventsFromContainerFrames() throws Exception {
    Container c1 = container("c1", "proj-gateway-1", "proj", "gateway", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(c1));
    doAnswer(invocation -> {
      DockerFollowCallback callback = invocation.getArgument(1);
      callback.onNext(new com.github.dockerjava.api.model.Frame(
          com.github.dockerjava.api.model.StreamType.STDOUT,
          jsonLine("2026-01-01T12:00:00.000Z", "gateway", "live event").getBytes(java.nio.charset.StandardCharsets.UTF_8)));
      return callback;
    }).when(mockClient).followLogs(eq("c1"), any());

    CanonicalLogEvent event = source.follow(new com.logexplorer.core.model.FollowRequest("local-docker", List.of()))
        .blockFirst(java.time.Duration.ofSeconds(2));

    assertThat(event).isNotNull();
    assertThat(event.message()).isEqualTo("live event");
    assertThat(event.service()).isEqualTo("gateway");
    assertThat(event.sourceId()).isEqualTo("local-docker");
    assertThat(event.composeProject()).isEqualTo("proj");
    assertThat(event.containerId()).isEqualTo("c1");
  }

  @Test
  void followOnlyFollowsContainersMatchingTheRequestedServices() {
    Container gateway = container("c1", "proj-gateway-1", "proj", "gateway", "running");
    Container accounts = container("c2", "proj-accounts-1", "proj", "accounts-api", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(gateway, accounts));
    when(mockClient.followLogs(any(), any())).thenAnswer(invocation -> invocation.getArgument(1));

    source.follow(new com.logexplorer.core.model.FollowRequest("local-docker", List.of("gateway")))
        .subscribe();

    verify(mockClient, org.mockito.Mockito.timeout(2000)).followLogs(eq("c1"), any());
    verify(mockClient, never()).followLogs(eq("c2"), any());
  }

  /**
   * LIVE_TIME_INSPECTOR_AND_DOCUMENTATION_RECOVERY - the real root cause behind "historical search
   * returns events but Live delivers nothing": {@code relevantContainers} (shared with Search, where a
   * stopped container's own already-written log lines are correctly still readable) never filtered by
   * container state, and {@code listContainers(true)} includes stopped/exited containers - so a stale
   * exited container still carrying the requested service's Compose label was silently selected as a
   * live-tail target, opened and completed its follow callback almost instantly, and (if it was the
   * only match) ended the whole stream with zero events, no error. A follow target must be a container
   * that is actually running right now.
   */
  @Test
  void followNeverSelectsAStoppedContainerAsAFollowTarget() {
    Container runningGateway = container("c1", "proj-gateway-1", "proj", "gateway", "running");
    Container staleExitedGateway = container("c2", "proj-gateway-0", "proj", "gateway", "exited");
    when(mockClient.listContainers(true)).thenReturn(List.of(runningGateway, staleExitedGateway));
    when(mockClient.followLogs(any(), any())).thenAnswer(invocation -> invocation.getArgument(1));

    source.follow(new FollowRequest("local-docker", List.of("gateway"))).subscribe();

    verify(mockClient, org.mockito.Mockito.timeout(2000)).followLogs(eq("c1"), any());
    verify(mockClient, never()).followLogs(eq("c2"), any());
  }

  @Test
  void followCompletesWithoutEverAttemptingAFollowWhenTheOnlyMatchingContainerIsStopped() {
    Container staleExitedGateway = container("c1", "proj-gateway-0", "proj", "gateway", "exited");
    when(mockClient.listContainers(true)).thenReturn(List.of(staleExitedGateway));

    java.util.List<CanonicalLogEvent> received = source
        .follow(new FollowRequest("local-docker", List.of("gateway")))
        .collectList()
        .block(java.time.Duration.ofSeconds(2));

    assertThat(received).isEmpty();
    verify(mockClient, never()).followLogs(any(), any());
  }

  @Test
  void followRespectsExcludeServiceFilterMode() {
    Container gateway = container("c1", "proj-gateway-1", "proj", "gateway", "running");
    Container accounts = container("c2", "proj-accounts-1", "proj", "accounts-api", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(gateway, accounts));
    when(mockClient.followLogs(any(), any())).thenAnswer(invocation -> invocation.getArgument(1));

    source.follow(new FollowRequest(
            "local-docker", List.of("gateway"), SearchRequest.ServiceFilterMode.EXCLUDE, null))
        .subscribe();

    verify(mockClient, org.mockito.Mockito.timeout(2000)).followLogs(eq("c2"), any());
    verify(mockClient, never()).followLogs(eq("c1"), any());
  }

  @Test
  void cancellationClosesTheUnderlyingDockerFollowCallback() throws Exception {
    // HANDOVER.md §18.2: "Disconnect must cancel upstream callback/resource" -
    // verified directly (the mock Closeable's close() was actually
    // invoked), not just inferred from the Flux no longer emitting.
    Container c1 = container("c1", "proj-gateway-1", "proj", "gateway", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(c1));

    java.io.Closeable mockCloseable = mock(java.io.Closeable.class);
    java.util.concurrent.CountDownLatch started = new java.util.concurrent.CountDownLatch(1);
    doAnswer(invocation -> {
      DockerFollowCallback callback = invocation.getArgument(1);
      callback.onStart(mockCloseable);
      started.countDown();
      return callback;
    }).when(mockClient).followLogs(eq("c1"), any());

    reactor.core.Disposable subscription = source
        .follow(new com.logexplorer.core.model.FollowRequest("local-docker", List.of()))
        .subscribe();
    assertThat(started.await(2, java.util.concurrent.TimeUnit.SECONDS)).isTrue();

    subscription.dispose();

    verify(mockCloseable, org.mockito.Mockito.timeout(2000)).close();
  }

  /**
   * Legacy Remediation Slice 1 - real multi-page traversal against {@link
   * DockerLogSource} (mocked I/O, real merge/sort/{@code EventFilters})
   * driven by a real {@link SearchService}, including two containers
   * logging at the exact same instant straddling every page boundary -
   * mandatory architecture correction #3 ("Loki duplicate-timestamp
   * safety") applies identically to Docker's own cross-container ties.
   */
  @Test
  void searchServicePaginationAcrossTwoContainersWithTiedTimestampsVisitsEveryEventExactlyOnce() {
    Container c1 = container("c1", "proj-gateway-1", "proj", "gateway", "running");
    Container c2 = container("c2", "proj-accounts-1", "proj", "accounts-api", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(c1, c2));

    stubLogs("c1",
        jsonLine("2026-01-01T00:00:00.000000000Z", "gateway", "c1-a"),
        jsonLine("2025-12-31T23:59:59.000000000Z", "gateway", "c1-b"),
        jsonLine("2025-12-31T23:59:58.000000000Z", "gateway", "c1-c"));
    stubLogs("c2",
        jsonLine("2026-01-01T00:00:00.000000000Z", "accounts-api", "c2-a"),
        jsonLine("2025-12-31T23:59:59.000000000Z", "accounts-api", "c2-b"),
        jsonLine("2025-12-31T23:59:58.000000000Z", "accounts-api", "c2-c"));

    SearchGuardrailsProperties properties = new SearchGuardrailsProperties();
    properties.setDefaultLimit(2);
    properties.setMaxTimeRange(java.time.Duration.ofDays(800)); // wideOpenRequest() itself spans ~2 years
    SearchService searchService = searchServiceFor(properties);

    SearchResult page1 = searchService.search(wideOpenRequest().build()).block();
    assertThat(page1.events()).extracting(CanonicalLogEvent::message).containsExactlyInAnyOrder("c1-a", "c2-a");
    assertThat(page1.nextCursor()).isNotNull();

    SearchResult page2 = searchService.search(wideOpenRequest().cursor(page1.nextCursor()).build()).block();
    assertThat(page2.events()).extracting(CanonicalLogEvent::message).containsExactlyInAnyOrder("c1-b", "c2-b");
    assertThat(page2.nextCursor()).isNotNull();

    SearchResult page3 = searchService.search(wideOpenRequest().cursor(page2.nextCursor()).build()).block();
    assertThat(page3.events()).extracting(CanonicalLogEvent::message).containsExactlyInAnyOrder("c1-c", "c2-c");
    assertThat(page3.counts().truncated()).isFalse();
    assertThat(page3.nextCursor()).isNull();

    List<String> all = new ArrayList<>();
    page1.events().forEach(e -> all.add(e.message()));
    page2.events().forEach(e -> all.add(e.message()));
    page3.events().forEach(e -> all.add(e.message()));
    assertThat(new HashSet<>(all)).as("no event skipped or duplicated across pages").hasSize(6);
  }

  @Test
  void paginationThroughSearchServiceEventuallyExhaustsAndTerminates() {
    Container c1 = container("c1", "proj-gateway-1", "proj", "gateway", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(c1));
    String[] lines = new String[12];
    for (int i = 0; i < 12; i++) {
      lines[i] = jsonLine(String.format("2026-01-01T00:00:%02d.000000000Z", 59 - i), "gateway", "event-" + i);
    }
    stubLogs("c1", lines);

    SearchGuardrailsProperties properties = new SearchGuardrailsProperties();
    properties.setDefaultLimit(5);
    properties.setMaxTimeRange(java.time.Duration.ofDays(800)); // wideOpenRequest() itself spans ~2 years
    SearchService searchService = searchServiceFor(properties);

    Set<String> seen = new HashSet<>();
    String cursor = null;
    int guardAgainstInfiniteLoop = 0;
    do {
      SearchResult page = searchService.search(wideOpenRequest().cursor(cursor).build()).block();
      for (CanonicalLogEvent e : page.events()) {
        assertThat(seen.add(e.message())).as("no duplicate across pages").isTrue();
      }
      cursor = page.nextCursor();
      guardAgainstInfiniteLoop++;
      assertThat(guardAgainstInfiniteLoop).isLessThan(20);
    } while (cursor != null);

    assertThat(seen).hasSize(12);
  }

  /**
   * Legacy Remediation Slice 1 recovery, mandatory blocker #1's required
   * tests #1/#2: pagination must follow Docker's own engine (receive)
   * timestamp, never the JSON payload's {@code @timestamp} - here they
   * actively disagree about ordering (two events sharing the *same*
   * application timestamp but with genuinely different engine
   * timestamps), so a canonical-timestamp-based implementation would
   * produce the wrong page contents/boundary.
   */
  @Test
  void paginationFollowsDockerEngineTimestampEvenWhenTheApplicationTimestampDisagreesAboutOrder() {
    Container c1 = container("c1", "proj-gateway-1", "proj", "gateway", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(c1));

    // All four share the exact same JSON @timestamp; engine timestamps
    // genuinely differ and descend a -> d (the true receive order).
    stubLogs("c1",
        jsonLineDivergentTimestamps("2026-01-01T00:00:00.000000000Z", "2025-06-01T00:00:00.000000000Z", "gateway", "a"),
        jsonLineDivergentTimestamps("2025-12-31T23:59:59.000000000Z", "2025-06-01T00:00:00.000000000Z", "gateway", "b"),
        jsonLineDivergentTimestamps("2025-12-31T23:59:58.000000000Z", "2025-06-01T00:00:00.000000000Z", "gateway", "c"),
        jsonLineDivergentTimestamps("2025-12-31T23:59:57.000000000Z", "2025-06-01T00:00:00.000000000Z", "gateway", "d"));

    SearchGuardrailsProperties properties = new SearchGuardrailsProperties();
    properties.setDefaultLimit(2);
    properties.setMaxTimeRange(java.time.Duration.ofDays(800));
    SearchService searchService = searchServiceFor(properties);

    SearchResult page1 = searchService.search(wideOpenRequest().build()).block();
    // Newest-first BY ENGINE TIME is a,b - all four share the same
    // application timestamp, so this would be an arbitrary/undefined
    // order if pagination (wrongly) used the canonical timestamp instead.
    assertThat(page1.events()).extracting(CanonicalLogEvent::message).containsExactly("a", "b");

    SearchResult page2 = searchService.search(wideOpenRequest().cursor(page1.nextCursor()).build()).block();
    assertThat(page2.events()).extracting(CanonicalLogEvent::message).containsExactly("c", "d");
    assertThat(page2.counts().truncated()).isFalse();
    assertThat(page2.nextCursor()).isNull();
  }

  /**
   * Legacy Remediation Slice 1 recovery, mandatory blocker #1's required
   * test #3: plain-text/malformed Docker lines have canonical {@code
   * timestamp=null} but a real, valid Docker engine timestamp - real
   * multi-page traversal through several such lines proves they are now
   * pageable (before this recovery, an all-malformed page could not
   * produce a safe cursor boundary at all - the exact real bug found via
   * this slice's own live-Docker verification, see the verification
   * report).
   */
  @Test
  void malformedNonJsonDockerLinesAreRealPageableAcrossMultiplePagesUsingTheEngineTimestamp() {
    Container c1 = container("c1", "proj-gateway-1", "proj", "gateway", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(c1));

    String[] lines = new String[7];
    for (int i = 0; i < 7; i++) {
      lines[i] = malformedLine(String.format("2026-01-01T00:00:%02d.000000000Z", 59 - i), "plain text log line " + i);
    }
    stubLogs("c1", lines);

    SearchGuardrailsProperties properties = new SearchGuardrailsProperties();
    properties.setDefaultLimit(3);
    properties.setMaxTimeRange(java.time.Duration.ofDays(800));
    SearchService searchService = searchServiceFor(properties);

    Set<String> seen = new HashSet<>();
    String cursor = null;
    int guardAgainstInfiniteLoop = 0;
    do {
      SearchResult page = searchService.search(wideOpenRequest().cursor(cursor).build()).block();
      assertThat(page.events()).as("every event is a malformed fallback with no canonical timestamp")
          .allSatisfy(e -> {
            assertThat(e.malformed()).isTrue();
            assertThat(e.timestamp()).isNull();
            assertThat(e.sourceTimestamp()).as("but the Docker engine timestamp is always known").isNotNull();
          });
      for (CanonicalLogEvent e : page.events()) {
        assertThat(seen.add(e.rawLine())).as("no duplicate across pages").isTrue();
      }
      cursor = page.nextCursor();
      guardAgainstInfiniteLoop++;
      assertThat(guardAgainstInfiniteLoop)
          .as("malformed lines must be genuinely pageable now, not stuck on page 1 forever")
          .isLessThan(10);
    } while (cursor != null);

    assertThat(seen).hasSize(7);
  }

  @Test
  void forwardDirectionPaginationAgainstDockerAdvancesTowardNewerEngineTimestampsWithNoSkipOrDuplicate() {
    // Legacy Remediation Slice 1 recovery, mandatory blocker #2: FORWARD
    // must move the boundary toward *newer* engine timestamps - never
    // silently treated as BACKWARD.
    Container c1 = container("c1", "proj-gateway-1", "proj", "gateway", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(c1));

    String[] lines = new String[7];
    for (int i = 0; i < 7; i++) {
      // event-0 has the oldest engine timestamp, event-6 the newest.
      lines[i] = jsonLine(String.format("2026-01-01T00:00:%02d.000000000Z", i), "gateway", "event-" + i);
    }
    stubLogs("c1", lines);

    SearchGuardrailsProperties properties = new SearchGuardrailsProperties();
    properties.setDefaultLimit(3);
    properties.setMaxTimeRange(java.time.Duration.ofDays(800));
    SearchService searchService = searchServiceFor(properties);

    SearchRequest.Builder request = wideOpenRequest().direction(SearchRequest.Direction.FORWARD);

    SearchResult page1 = searchService.search(request.build()).block();
    assertThat(page1.events()).extracting(CanonicalLogEvent::message)
        .containsExactly("event-0", "event-1", "event-2");

    SearchResult page2 = searchService.search(request.cursor(page1.nextCursor()).build()).block();
    assertThat(page2.events()).extracting(CanonicalLogEvent::message)
        .containsExactly("event-3", "event-4", "event-5");

    SearchResult page3 = searchService.search(request.cursor(page2.nextCursor()).build()).block();
    assertThat(page3.events()).extracting(CanonicalLogEvent::message).containsExactly("event-6");
    assertThat(page3.counts().truncated()).isFalse();
    assertThat(page3.nextCursor()).isNull();
  }

  private SearchService searchServiceFor(SearchGuardrailsProperties properties) {
    SearchGuardrails guardrails = new SearchGuardrails(properties);
    ConcurrencyGuard concurrencyGuard = new ConcurrencyGuard(properties);
    LogSourceRegistry registry = new LogSourceRegistry(List.of(source), new SourcesProperties());
    return new SearchService(registry, guardrails, concurrencyGuard, new PageCursorCodec(new ObjectMapper()), new com.logexplorer.core.mapping.FieldMappingProfileService());
  }

  private SearchRequest.Builder wideOpenRequest() {
    // Genuinely wide - EventFilters (extracted this phase) now applies
    // real time-range post-filtering on each event's parsed content
    // timestamp, not just the (irrelevant, fully-mocked) Docker API
    // since/until args. A narrow window here previously went untested
    // against real content timestamps and silently passed regardless.
    return SearchRequest.builder()
        .sourceId("local-docker")
        .start(Instant.parse("2025-01-01T00:00:00Z"))
        .end(Instant.parse("2027-01-01T00:00:00Z"));
  }

  // ------------------------------------------------------------ owner mission
  // "Service Filter, Docker Performance, and Verified Default Mapping" §B
  // - bounded-parallelism proof tests.

  private List<Container> manyContainers(int count) {
    List<Container> containers = new ArrayList<>();
    for (int i = 0; i < count; i++) {
      containers.add(container("c" + i, "proj-svc" + i + "-1", "proj", "svc" + i, "running"));
    }
    return containers;
  }

  @Test
  void oneContainerReadsSuccessfullyAndTimingIsRecorded() {
    Container c1 = container("c1", "proj-gateway-1", "proj", "gateway", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(c1));
    stubLogs("c1", jsonLine("2026-01-01T00:00:00.000000000Z", "gateway", "line"));

    List<CanonicalLogEvent> events = source.search(wideOpenRequest().build()).collectList().block();

    assertThat(events).hasSize(1);
    DockerLogSource.HistoricalSearchTiming timing = source.lastHistoricalSearchTiming();
    assertThat(timing.targetContainerCount()).isEqualTo(1);
    assertThat(timing.containersActuallyRead()).isEqualTo(1);
    assertThat(timing.effectiveConcurrency()).isEqualTo(properties.getHistoricalSearchConcurrency());
    // Owner mission "Service Filter, Docker Performance, and Verified
    // Default Mapping" §B - "suggested default: 6," verified against a
    // fresh, never-touched DockerProperties instance (not the test's own
    // properties field, which other tests in this class mutate).
    assertThat(new DockerProperties().getHistoricalSearchConcurrency()).isEqualTo(6);
  }

  @Test
  void fiveContainersAllReadSimultaneously_dockerReadsAreParallel() throws Exception {
    int containerCount = 5;
    List<Container> containers = manyContainers(containerCount);
    when(mockClient.listContainers(true)).thenReturn(containers);

    CyclicBarrier barrier = new CyclicBarrier(containerCount);
    for (Container c : containers) {
      stubLogsWithBarrier(c.getId(), barrier,
          jsonLine("2026-01-01T00:00:00.000000000Z", ComposeLabels.service(c.getLabels()), "line"));
    }

    // DOCKER_READS_ARE_PARALLEL=YES - the default concurrency (6) covers
    // all 5 containers, so every read can be in flight at once; if reads
    // ran sequentially (the pre-fix behavior), the 5-party barrier could
    // never trip and this call would return fewer than 5 events (each
    // barrier participant that times out is caught and skipped, exactly
    // like any other unreadable container).
    List<CanonicalLogEvent> events = source.search(wideOpenRequest().build()).collectList().block();

    assertThat(events).hasSize(containerCount);
  }

  @Test
  void twentyContainersNeverExceedTheConfiguredConcurrencyBound() {
    properties.setHistoricalSearchConcurrency(4);
    int containerCount = 20;
    List<Container> containers = manyContainers(containerCount);
    when(mockClient.listContainers(true)).thenReturn(containers);

    AtomicInteger activeReads = new AtomicInteger();
    AtomicInteger maxActiveReads = new AtomicInteger();
    for (Container c : containers) {
      stubLogsWithDelay(c.getId(), 50, activeReads, maxActiveReads,
          jsonLine("2026-01-01T00:00:00.000000000Z", ComposeLabels.service(c.getLabels()), "line"));
    }

    List<CanonicalLogEvent> events = source.search(wideOpenRequest().build()).collectList().block();

    assertThat(events).hasSize(containerCount);
    // DOCKER_PARALLELISM_IS_BOUNDED=YES / MAX_ACTIVE_READS_NEVER_EXCEEDS_CONFIG=YES
    assertThat(maxActiveReads.get()).isLessThanOrEqualTo(4);
    // Genuinely parallel, not accidentally serialized down to 1 despite the bound.
    assertThat(maxActiveReads.get()).isGreaterThan(1);

    DockerLogSource.HistoricalSearchTiming timing = source.lastHistoricalSearchTiming();
    assertThat(timing.targetContainerCount()).isEqualTo(20);
    assertThat(timing.containersActuallyRead()).isEqualTo(20);
    assertThat(timing.effectiveConcurrency()).isEqualTo(4);
  }

  @Test
  void oneSlowContainerNeverSerializesTheIndependentFastContainers() {
    properties.setHistoricalSearchConcurrency(6);
    Container slow = container("slow", "proj-slow-1", "proj", "slow-svc", "running");
    List<Container> fast = new ArrayList<>();
    for (int i = 0; i < 9; i++) {
      fast.add(container("fast" + i, "proj-fastsvc" + i + "-1", "proj", "fast-svc" + i, "running"));
    }
    List<Container> all = new ArrayList<>();
    all.add(slow);
    all.addAll(fast);
    when(mockClient.listContainers(true)).thenReturn(all);

    AtomicInteger activeReads = new AtomicInteger();
    AtomicInteger maxActiveReads = new AtomicInteger();
    stubLogsWithDelay("slow", 300, activeReads, maxActiveReads,
        jsonLine("2026-01-01T00:00:00.000000000Z", "slow-svc", "slow line"));
    for (Container c : fast) {
      stubLogsWithDelay(c.getId(), 50, activeReads, maxActiveReads,
          jsonLine("2026-01-01T00:00:00.000000000Z", ComposeLabels.service(c.getLabels()), "fast line"));
    }

    long startNanos = System.nanoTime();
    List<CanonicalLogEvent> events = source.search(wideOpenRequest().build()).collectList().block();
    long elapsedMillis = Duration.ofNanos(System.nanoTime() - startNanos).toMillis();

    assertThat(events).hasSize(10);
    // Sequential would be 300 + 9*50 = 750ms; bounded-parallel (concurrency
    // 6 >= 10 target containers is false here, but 6 still lets the slow
    // read and 5 fast reads start together, with the remaining 4 fast
    // reads picked up as slots free almost immediately) finishes close to
    // the slow container's own 300ms - a generous ceiling well under the
    // sequential sum proves the slow container never serialized the rest.
    assertThat(elapsedMillis).isLessThan(550);
  }

  /**
   * Owner mission "Service Filter, Docker Performance, and Verified
   * Default Mapping" §B review recovery - a real, previously-unreported
   * bug: {@code readContainerLogs} discarded {@code awaitCompletion}'s own
   * boolean return value entirely, so a genuinely timed-out read was
   * silently treated as a normal, complete one. This proves the truthful-
   * failure-semantics fix: a read that never signals completion within
   * the configured timeout still returns whatever partial lines had
   * already arrived (never fabricates zero), and the overall search still
   * completes promptly (bounded by the timeout, never hangs).
   */
  @SuppressWarnings("unchecked")
  @Test
  void aReadThatNeverCompletesWithinTheTimeoutStillReturnsItsPartialLines_neverFabricatesZero() {
    properties.setRequestTimeout(Duration.ofMillis(100));
    Container c1 = container("c1", "proj-gateway-1", "proj", "gateway", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(c1));

    doAnswer(invocation -> {
      DockerFrameCollectingCallback callback = invocation.getArgument(7);
      // A full line arrives and is already collected internally by the
      // callback - but onComplete() is deliberately never called, so
      // awaitCompletion(...) will time out (return false) rather than
      // ever being satisfied normally.
      callback.onNext(new com.github.dockerjava.api.model.Frame(
          com.github.dockerjava.api.model.StreamType.STDOUT,
          jsonLine("2026-01-01T00:00:00.000000000Z", "gateway", "partial line").getBytes(java.nio.charset.StandardCharsets.UTF_8)));
      return callback;
    }).when(mockClient).readLogs(eq("c1"), anyBoolean(), anyBoolean(), anyBoolean(), any(), any(), any(), any());

    long startNanos = System.nanoTime();
    List<CanonicalLogEvent> events = source.search(wideOpenRequest().build()).collectList().block();
    long elapsedMillis = Duration.ofNanos(System.nanoTime() - startNanos).toMillis();

    // Never silently reports zero logs for a read that actually delivered
    // data before timing out.
    assertThat(events).hasSize(1);
    assertThat(events.get(0).message()).isEqualTo("partial line");
    // Bounded by the configured timeout, never hangs indefinitely.
    assertThat(elapsedMillis).isLessThan(2000);
  }

  @Test
  void maxContainersCapIsAppliedBeforeTheParallelReadFanOut() {
    // Owner mission "Service Filter, Docker Performance, and Verified
    // Default Mapping" §B - the maxContainers cap (pre-existing, Phase C)
    // must still be enforced exactly the same way with the new parallel
    // read path: the cap narrows `targets` BEFORE readAllContainersInParallel
    // ever runs, so only the capped subset is ever read, never all of them
    // with results silently truncated afterward.
    properties.setMaxContainers(2);
    List<Container> containers = manyContainers(5);
    when(mockClient.listContainers(true)).thenReturn(containers);
    for (Container c : containers) {
      stubLogs(c.getId(), jsonLine("2026-01-01T00:00:00.000000000Z", ComposeLabels.service(c.getLabels()), "line"));
    }

    List<CanonicalLogEvent> events = source.search(wideOpenRequest().build()).collectList().block();

    assertThat(events).hasSize(2);
    DockerLogSource.HistoricalSearchTiming timing = source.lastHistoricalSearchTiming();
    assertThat(timing.targetContainerCount()).isEqualTo(2);
    assertThat(timing.containersActuallyRead()).isEqualTo(2);
    verify(mockClient, never()).readLogs(eq("c2"), anyBoolean(), anyBoolean(), anyBoolean(), any(), any(), any(), any());
    verify(mockClient, never()).readLogs(eq("c3"), anyBoolean(), anyBoolean(), anyBoolean(), any(), any(), any(), any());
    verify(mockClient, never()).readLogs(eq("c4"), anyBoolean(), anyBoolean(), anyBoolean(), any(), any(), any(), any());
  }

  @Test
  void multipleSimultaneousTimeoutsAreEachHandledSafelyWithoutHangingOrThrowing() {
    // Cancellation/timeout cleanup safety under parallelism - several
    // containers time out at once (not just one), and the search must
    // still complete promptly with the containers that DID succeed,
    // rather than hanging or propagating an exception that would fail the
    // whole search over a subset of unreadable containers.
    properties.setRequestTimeout(Duration.ofMillis(80));
    List<Container> containers = manyContainers(4);
    when(mockClient.listContainers(true)).thenReturn(containers);
    // c0, c1: never call onComplete - both will time out.
    doAnswer(invocation -> invocation.getArgument(7))
        .when(mockClient).readLogs(eq("c0"), anyBoolean(), anyBoolean(), anyBoolean(), any(), any(), any(), any());
    doAnswer(invocation -> invocation.getArgument(7))
        .when(mockClient).readLogs(eq("c1"), anyBoolean(), anyBoolean(), anyBoolean(), any(), any(), any(), any());
    // c2, c3: succeed normally.
    stubLogs("c2", jsonLine("2026-01-01T00:00:00.000000000Z", "svc2", "ok-2"));
    stubLogs("c3", jsonLine("2026-01-01T00:00:00.000000000Z", "svc3", "ok-3"));

    long startNanos = System.nanoTime();
    List<CanonicalLogEvent> events = source.search(wideOpenRequest().build()).collectList().block();
    long elapsedMillis = Duration.ofNanos(System.nanoTime() - startNanos).toMillis();

    assertThat(events).extracting(CanonicalLogEvent::message).containsExactlyInAnyOrder("ok-2", "ok-3");
    assertThat(elapsedMillis).isLessThan(2000);
  }

  // Owner mission "Event Classification, Extraction, and Portable Rules": Docker events take the same parser-level
  // classification path as every other source, keep their adapter enrichment, and tag filtering applies to the
  // events this adapter actually retrieved.
  @Test
  void dockerEventsAreClassifiedByTheSharedEngineAndTagFilteredAfterRetrieval() throws Exception {
    com.logexplorer.core.classify.ClassificationEngine engine = new com.logexplorer.core.classify.ClassificationEngine(new ObjectMapper());
    engine.activate(com.logexplorer.core.classify.CompiledRuleSet.ofEnabled(1, List.of(
        new com.logexplorer.core.classify.RuleCompiler().compile(com.logexplorer.core.classify.ClassificationTestRules.middlewareRule()))));
    DockerClientFactory factory = mock(DockerClientFactory.class);
    when(factory.create(properties)).thenReturn(mockClient);
    DockerLogSource classifying = new DockerLogSource(factory, properties,
        new LogLineParser(new ObjectMapper(), mappingProfileService, engine), remoteHostGuard);
    Container gateway = container("c1", "proj-gateway-1", "proj", "gateway", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(gateway));
    stubLogs("c1",
        jsonLine("2026-01-01T00:00:00.000000000Z", "gateway", "Make webhook call to /payments requestId=req-1 responseCode=200 duration=12ms"),
        jsonLine("2026-01-01T00:00:01.000000000Z", "gateway", "Make webhook configuration reload requested"));

    List<CanonicalLogEvent> all = classifying.search(wideOpenRequest().build()).collectList().block();
    assertThat(all).hasSize(2);
    CanonicalLogEvent tagged = all.stream().filter(e -> !e.tags().isEmpty()).findFirst().orElseThrow();
    assertThat(tagged.tags()).containsExactly("middleware");
    assertThat(tagged.composeProject()).isEqualTo("proj");
    assertThat(tagged.classifications().get(0).extracted().get(1).value()).isEqualTo("200");

    List<CanonicalLogEvent> filtered = classifying.search(wideOpenRequest().tags(List.of("middleware")).build())
        .collectList().block();
    assertThat(filtered).singleElement().satisfies(e -> assertThat(e.message()).startsWith("Make webhook call to"));
  }

  /**
   * SEARCH_LATENCY_INVESTIGATION_AND_SAFE_OPTIMIZATION — the algorithmic
   * property the optimization actually depends on: classification (the
   * single most expensive step in the per-line loop, per {@code
   * SearchPipelinePerformanceTest}) must run only for events that survive
   * every non-tag {@code EventFilters} condition, never for one a severity
   * filter alone already rejects. This is deliberately NOT a millisecond
   * assertion (CLAUDE.md "do not add brittle CI tests asserting exact
   * milliseconds") - it counts real classifier invocations instead, so a
   * future change that accidentally reintroduces eager classification
   * fails this test even though the *results* would still be correct.
   */
  @Test
  void classificationIsSkippedForEventsRejectedByANonTagFilterButResultsStayIdentical() {
    AtomicInteger classifyCalls = new AtomicInteger();
    com.logexplorer.core.classify.EventClassifier countingClassifier = new com.logexplorer.core.classify.EventClassifier() {
      @Override
      public CanonicalLogEvent classify(CanonicalLogEvent event) {
        classifyCalls.incrementAndGet();
        return event;
      }

      @Override
      public long generation() {
        return 0;
      }
    };
    DockerClientFactory factory = mock(DockerClientFactory.class);
    when(factory.create(properties)).thenReturn(mockClient);
    DockerLogSource counting = new DockerLogSource(factory, properties,
        new LogLineParser(new ObjectMapper(), mappingProfileService, countingClassifier), remoteHostGuard);
    Container gateway = container("c1", "proj-gateway-1", "proj", "gateway", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(gateway));
    // 5 raw lines, only 1 of which is INFO - a severity filter for INFO
    // alone must reject the other 4 using only their already-parsed
    // severity field, never touching the (mocked) classifier for them.
    stubLogs("c1",
        severityLine("2026-01-01T00:00:00.000000000Z", "gateway", "kept", "INFO"),
        severityLine("2026-01-01T00:00:01.000000000Z", "gateway", "dropped-1", "ERROR"),
        severityLine("2026-01-01T00:00:02.000000000Z", "gateway", "dropped-2", "ERROR"),
        severityLine("2026-01-01T00:00:03.000000000Z", "gateway", "dropped-3", "WARN"),
        severityLine("2026-01-01T00:00:04.000000000Z", "gateway", "dropped-4", "ERROR"));

    List<CanonicalLogEvent> events = counting.search(wideOpenRequest().levels(List.of("INFO")).build())
        .collectList().block();

    assertThat(events).extracting(CanonicalLogEvent::message).containsExactly("kept");
    assertThat(classifyCalls.get())
        .as("only the 1 event surviving the severity filter should ever reach classification, not all 5 raw lines")
        .isEqualTo(1);
  }

  private String severityLine(String timestamp, String service, String message, String level) {
    return timestamp + " {\"@timestamp\":\"" + timestamp + "\",\"message\":\"" + message
        + "\",\"application\":\"" + service + "\",\"level\":\"" + level + "\",\"mdc\":{}}\n";
  }

  // ------------------------------------------------------------ PR65_FRESH_SEARCH_CUSTOM_TIME_AND_BATCH_RECOVERY
  // (defect 1) - progressive per-container scan tests. Real root cause:
  // every prior release read at most `defaultTailLines` lines ONCE per
  // container, so a genuine match sitting further back in the same
  // requested window - even though it is well within `start()`/`end()` -
  // was structurally unreachable no matter how many times a fresh,
  // correctly-built Search was issued. These tests prove the fix reads
  // further when (and only when) a container's own read comes back at the
  // tail cap, stays bounded by `maxHistoricalScanChunks`, and reports a
  // truthful runtime warning when the round budget runs out before the
  // window is provably fully covered.

  private record FakeDockerLine(Instant timestamp, String raw) {
  }

  /**
   * A faithful fake of real Docker's own {@code since}/{@code until}/
   * {@code tail} semantics — built directly from real-Docker verification
   * during this mission (see {@code DockerLogSource#searchBlocking}'s own
   * "review recovery" comment): {@code tail}, when set, selects the last N
   * lines of the container's WHOLE log stream FIRST, and ONLY THEN
   * intersects that selection with {@code since}/{@code until} — it is
   * NOT "the last N lines within the requested window". A plain mock that
   * ignores this (as every other {@code stubLogs*} helper in this file
   * does, by design, for tests that don't care about it) would let a
   * progressive-scan test pass for the wrong reason; this one would catch
   * a regression back to the broken "combine a narrowed until with tail"
   * design.
   *
   * @param linesOldestFirst every raw {@code "<timestamp> {json}"} line
   *     this container ever logged, in real chronological order (oldest
   *     first) — exactly how a real container's own log file is ordered.
   */
  @SuppressWarnings("unchecked")
  private void stubLogsLikeRealDocker(String containerId, List<String> linesOldestFirst) {
    List<FakeDockerLine> all = linesOldestFirst.stream()
        .map(line -> new FakeDockerLine(Instant.parse(line.substring(0, line.indexOf(' '))), line))
        .toList();
    doAnswer(invocation -> {
      Integer since = invocation.getArgument(4);
      Integer until = invocation.getArgument(5);
      Integer tail = invocation.getArgument(6);
      List<FakeDockerLine> base = tail != null && all.size() > tail
          ? all.subList(all.size() - tail, all.size())
          : all;
      List<String> result = base.stream()
          .filter(l -> since == null || !l.timestamp().isBefore(Instant.ofEpochSecond(since)))
          .filter(l -> until == null || l.timestamp().isBefore(Instant.ofEpochSecond(until)))
          .map(FakeDockerLine::raw)
          .toList();
      DockerFrameCollectingCallback callback = invocation.getArgument(7);
      for (String line : result) {
        callback.onNext(new com.github.dockerjava.api.model.Frame(
            com.github.dockerjava.api.model.StreamType.STDOUT,
            line.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
      }
      callback.onComplete();
      return callback;
    }).when(mockClient).readLogs(eq(containerId), anyBoolean(), anyBoolean(), anyBoolean(), any(), any(), any(), any());
  }

  /**
   * The shared fixture for the next two tests: one container whose real
   * (chronological, oldest-first) log is a single ERROR marker at the very
   * start of the window, followed by 60 quiet minutes, followed by a dense
   * burst of 200 newest INFO lines filling out the tail. A tailCap of 20
   * means the newest-tail read alone can never reach the ERROR - it sits
   * far below the absolute-newest 20 lines - so finding it requires
   * genuinely narrowing further back in time, not just reading once.
   */
  private List<String> errorBeyondTailFixtureLines() {
    List<String> lines = new ArrayList<>();
    lines.add(severityLine("2025-01-01T00:00:00.000000000Z", "gateway", "the-error", "ERROR"));
    // 200 lines, one per second, from 02:00:00 through 02:03:19 - all well
    // inside the request window below and all strictly newer than the
    // ERROR marker, so the newest-tailCap read can never reach it.
    Instant base = Instant.parse("2025-01-01T02:00:00Z");
    for (int i = 0; i < 200; i++) {
      lines.add(severityLine(base.plusSeconds(i).toString(), "gateway", "recent-" + i, "INFO"));
    }
    return lines;
  }

  @Test
  void anErrorEventBeyondTheDefaultTailLinesIsDiscoveredByAFreshSelectiveSearch() {
    // Adversarial reproduction from the owner mission: a broad first
    // Search's raw tail (the newest tailCap lines) contains no ERROR
    // event; a real ERROR event exists further back, still inside the
    // requested [start, end) window. A fresh, ERROR-only Search must find
    // it - proving this is genuinely a re-scan of the source, not a
    // client-side filter over whatever the first (INFO-only) raw tail
    // happened to contain. Uses `stubLogsLikeRealDocker` (a faithful fake
    // of Docker's own since/until/tail semantics, verified against a real
    // Docker daemon during this mission) rather than a hand-picked
    // per-round switch, so this test does not depend on - and cannot be
    // gamed by - the exact bucket boundaries the progressive scan chooses.
    properties.setDefaultTailLines(20);
    properties.setMaxHistoricalScanChunks(10);
    Container gateway = container("c1", "proj-gateway-1", "proj", "gateway", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(gateway));
    stubLogsLikeRealDocker("c1", errorBeyondTailFixtureLines());

    SearchRequest request = SearchRequest.builder()
        .sourceId("local-docker")
        .start(Instant.parse("2025-01-01T00:00:00Z")).end(Instant.parse("2025-01-01T03:00:00Z"))
        .levels(List.of("ERROR"))
        .effectiveLimit(5)
        .build();

    List<CanonicalLogEvent> events = source.search(request).collectList().block();

    assertThat(events).extracting(CanonicalLogEvent::message).containsExactly("the-error");
    verify(mockClient, org.mockito.Mockito.atLeast(2))
        .readLogs(eq("c1"), anyBoolean(), anyBoolean(), anyBoolean(), any(), any(), any(), any());
  }

  @Test
  void theSameAdversarialScenarioFailsWhenTheScanIsForcedBackToOneRoundProvingTheFixIsTheProgressiveScanItself() {
    // Same exact fixture/request as
    // anErrorEventBeyondTheDefaultTailLinesIsDiscoveredByAFreshSelectiveSearch
    // above, except the round budget is forced to 1 - i.e. exactly the
    // pre-fix behavior (one bounded read per container, no narrowing).
    // This must reproduce the original defect: the ERROR event is never
    // found, proving the fix above is genuinely the progressive scan
    // itself and not some other incidental change.
    properties.setDefaultTailLines(20);
    properties.setMaxHistoricalScanChunks(1);
    Container gateway = container("c1", "proj-gateway-1", "proj", "gateway", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(gateway));
    stubLogsLikeRealDocker("c1", errorBeyondTailFixtureLines());

    SearchRequest request = SearchRequest.builder()
        .sourceId("local-docker")
        .start(Instant.parse("2025-01-01T00:00:00Z")).end(Instant.parse("2025-01-01T03:00:00Z"))
        .levels(List.of("ERROR"))
        .effectiveLimit(5)
        .build();

    com.logexplorer.core.model.SourceSearchOutcome outcome = source.searchWithOutcome(request).block();

    assertThat(outcome.events())
        .as("with the round budget forced to 1 (the pre-fix shape), the ERROR event beyond the raw tail is invisible - reproducing the original defect")
        .isEmpty();
    assertThat(outcome.runtimeWarnings())
        .as("a single-round scan that never proved the window was fully covered must say so honestly")
        .isNotEmpty();
    verify(mockClient, org.mockito.Mockito.times(1))
        .readLogs(eq("c1"), anyBoolean(), anyBoolean(), anyBoolean(), any(), any(), any(), any());
  }

  @Test
  void aFreshSelectiveSearchReadsTheSourceAgainEvenWhenTheFirstSearchAlreadyRan() {
    // "Running Search after changing filters must query the source again,
    // not just filter the previously loaded page" - proven directly: two
    // independent source.search() calls against the SAME mocked client,
    // the second with a narrower severity filter, both cause their own
    // real readLogs invocation - never a cached/reused result.
    properties.setDefaultTailLines(500);
    Container gateway = container("c1", "proj-gateway-1", "proj", "gateway", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(gateway));
    stubLogs("c1",
        severityLine("2025-06-01T00:00:00.000000000Z", "gateway", "info-event", "INFO"),
        severityLine("2025-06-01T00:00:01.000000000Z", "gateway", "error-event", "ERROR"));

    List<CanonicalLogEvent> broad = source.search(wideOpenRequest().build()).collectList().block();
    assertThat(broad).hasSize(2);

    List<CanonicalLogEvent> errorOnly = source.search(wideOpenRequest().levels(List.of("ERROR")).build())
        .collectList().block();
    assertThat(errorOnly).extracting(CanonicalLogEvent::message).containsExactly("error-event");

    verify(mockClient, org.mockito.Mockito.times(2)).listContainers(true);
    verify(mockClient, org.mockito.Mockito.times(2))
        .readLogs(eq("c1"), anyBoolean(), anyBoolean(), anyBoolean(), any(), any(), any(), any());
  }

  @Test
  void progressiveScanIsBoundedByMaxHistoricalScanChunksAndReportsAPartialWarningWhenTheBudgetRunsOut() {
    // The container in this test NEVER exhausts on its own (every round
    // returns exactly tailCap fresh, strictly-older lines, so it always
    // looks like "may be more") and nothing it returns ever matches the
    // ERROR filter - proving (a) the scan really does stop at the
    // configured round budget rather than reading forever, and (b) the
    // honest result is a runtime warning (never a silent, possibly-wrong
    // "nothing more to find").
    properties.setDefaultTailLines(3);
    properties.setMaxHistoricalScanChunks(2);
    Container gateway = container("c1", "proj-gateway-1", "proj", "gateway", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(gateway));

    AtomicInteger callCount = new AtomicInteger();
    doAnswer(invocation -> {
      int round = callCount.getAndIncrement();
      DockerFrameCollectingCallback callback = invocation.getArgument(7);
      for (int i = 0; i < 3; i++) {
        String ts = String.format("2025-01-01T00:%02d:%02d.000000000Z", 40 - (round * 5), i);
        callback.onNext(new com.github.dockerjava.api.model.Frame(
            com.github.dockerjava.api.model.StreamType.STDOUT,
            severityLine(ts, "gateway", "never-matches-" + round + "-" + i, "INFO")
                .getBytes(java.nio.charset.StandardCharsets.UTF_8)));
      }
      callback.onComplete();
      return callback;
    }).when(mockClient).readLogs(eq("c1"), anyBoolean(), anyBoolean(), anyBoolean(), any(), any(), any(), any());

    SearchRequest request = SearchRequest.builder()
        .sourceId("local-docker")
        .start(Instant.parse("2025-01-01T00:00:00Z")).end(Instant.parse("2025-01-01T01:00:00Z"))
        .levels(List.of("ERROR"))
        .effectiveLimit(5)
        .build();

    com.logexplorer.core.model.SourceSearchOutcome outcome = source.searchWithOutcome(request).block();

    assertThat(outcome.events()).isEmpty();
    assertThat(callCount.get())
        .as("progressive scan must stop at the configured round budget, never read forever")
        .isEqualTo(2);
    assertThat(outcome.runtimeWarnings())
        .as("the round budget ran out while the container was still capped/active - this must be reported, never silently presented as a complete zero-result answer")
        .isNotEmpty();
  }

  @Test
  void progressiveScanReportsNoWarningWhenTheWholeWindowIsGenuinelyFullyCovered() {
    // The mirror-image proof: once a container's read comes back UNDER
    // the tail cap, its window is genuinely, provably fully read - no
    // runtime warning, and estimatedTotal (api.SearchService's own logic)
    // is allowed to be exact.
    properties.setDefaultTailLines(500);
    Container gateway = container("c1", "proj-gateway-1", "proj", "gateway", "running");
    when(mockClient.listContainers(true)).thenReturn(List.of(gateway));
    stubLogs("c1", jsonLine("2025-01-01T00:00:00.000000000Z", "gateway", "only line"));

    com.logexplorer.core.model.SourceSearchOutcome outcome =
        source.searchWithOutcome(wideOpenRequest().effectiveLimit(500).build()).block();

    assertThat(outcome.events()).hasSize(1);
    assertThat(outcome.runtimeWarnings()).isEmpty();
  }
}
