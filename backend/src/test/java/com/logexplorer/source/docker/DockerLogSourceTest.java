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
import com.logexplorer.config.DockerProperties;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.SearchRequest;
import com.logexplorer.core.model.ServiceInfo;
import com.logexplorer.core.model.SourceHealth;
import com.logexplorer.core.parse.LogLineParser;
import java.time.Instant;
import java.util.List;
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

  @BeforeEach
  void setUp() throws Exception {
    mockClient = mock(ReadOnlyDockerClient.class);
    properties = new DockerProperties();
    properties.setMaxContainers(200);
    properties.setDefaultTailLines(2000);

    DockerClientFactory factory = mock(DockerClientFactory.class);
    when(factory.create(properties)).thenReturn(mockClient);

    LogLineParser parser = new LogLineParser(new ObjectMapper());
    source = new DockerLogSource(factory, properties, parser);
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
  void capabilitiesReportLiveTailFalseUntilPhaseJWiresTheEndpoint() {
    var caps = source.capabilities();
    assertThat(caps.historicalSearch()).isTrue();
    assertThat(caps.serviceDiscovery()).isTrue();
    assertThat(caps.liveTail()).isFalse();
    assertThat(caps.rawLogQL()).isFalse();
  }

  @Test
  void healthReportsUpWhenPingSucceeds() {
    // mockClient.ping() is a no-op void call by default (Mockito) - succeeds.
    StepVerifier.create(source.health())
        .assertNext(h -> assertThat(h.status()).isEqualTo(SourceHealth.Status.UP))
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
