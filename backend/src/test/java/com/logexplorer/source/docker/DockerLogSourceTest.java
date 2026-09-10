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
import com.logexplorer.core.model.SearchRequest;
import com.logexplorer.core.model.SearchResult;
import com.logexplorer.core.model.ServiceInfo;
import com.logexplorer.core.model.SourceHealth;
import com.logexplorer.core.parse.LogLineParser;
import com.logexplorer.core.search.PageCursorCodec;
import com.logexplorer.config.DockerRemoteAllowlistProperties;
import com.logexplorer.source.LogSourceRegistry;
import com.logexplorer.source.docker.security.RemoteHostGuard;
import com.logexplorer.source.docker.security.RemoteHostRejectedException;
import java.net.InetAddress;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
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

  @BeforeEach
  void setUp() throws Exception {
    mockClient = mock(ReadOnlyDockerClient.class);
    properties = new DockerProperties();
    properties.setMaxContainers(200);
    properties.setDefaultTailLines(2000);

    DockerClientFactory factory = mock(DockerClientFactory.class);
    when(factory.create(properties)).thenReturn(mockClient);

    LogLineParser parser = new LogLineParser(new ObjectMapper());
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

  private String jsonLine(String timestamp, String service, String message) {
    return timestamp + " {\"@timestamp\":\"" + timestamp + "\",\"message\":\"" + message
        + "\",\"application\":\"" + service + "\",\"mdc\":{}}\n";
  }

  private String jsonLineWithTraceId(String timestamp, String service, String message, String traceId) {
    return timestamp + " {\"@timestamp\":\"" + timestamp + "\",\"message\":\"" + message
        + "\",\"application\":\"" + service + "\",\"mdc\":{\"traceId\":\"" + traceId + "\"}}\n";
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
    return new SearchService(registry, guardrails, concurrencyGuard, new PageCursorCodec(new ObjectMapper()));
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
}
