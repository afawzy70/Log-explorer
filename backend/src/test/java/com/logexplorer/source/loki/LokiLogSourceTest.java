package com.logexplorer.source.loki;

import static com.logexplorer.source.loki.MockLokiServer.stream;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.logexplorer.api.SearchService;
import com.logexplorer.config.LokiProperties;
import com.logexplorer.config.SearchGuardrailsProperties;
import com.logexplorer.config.SourcesProperties;
import com.logexplorer.core.guard.ConcurrencyGuard;
import com.logexplorer.core.guard.SearchGuardrails;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.SearchRequest;
import com.logexplorer.core.model.SearchResult;
import com.logexplorer.core.model.SourceHealth;
import com.logexplorer.core.parse.LogLineParser;
import com.logexplorer.core.query.ast.Comparison;
import com.logexplorer.core.query.ast.Operator;
import com.logexplorer.core.search.PageCursorCodec;
import com.logexplorer.source.LogSourceRegistry;
import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import reactor.test.StepVerifier;

/**
 * Behavioral tests for {@link LokiLogSource} against {@link MockLokiServer}
 * (IMPLEMENTATION_PLAN.md "Phase D" required automated test: "enrichment
 * (namespace/pod/container), merge/sort, capabilities honesty, health
 * mapping").
 */
class LokiLogSourceTest {

  private MockLokiServer mockServer;

  @AfterEach
  void tearDown() {
    if (mockServer != null) {
      mockServer.close();
    }
  }

  private LokiProperties propertiesFor(MockLokiServer server) {
    LokiProperties properties = new LokiProperties();
    properties.setBaseUrl(server.baseUrl());
    properties.setGatewayPrefix("/api/logs/v1");
    properties.setTenant("application");
    properties.setNamespaceLabelKey("namespace");
    properties.setServiceLabelKey("app");
    properties.setPodLabelKey("pod");
    properties.setContainerLabelKey("container");
    properties.setNamespace("my-namespace");
    properties.setMaxResultsPerQuery(2000);
    properties.setRequestTimeout(Duration.ofSeconds(2));
    return properties;
  }

  private LokiLogSource sourceFor(LokiProperties properties) {
    LokiQueryClient queryClient = new LokiQueryClient(properties, new LokiTokenSupplier(properties), new LokiWebClientFactory());
    LogLineParser parser = new LogLineParser(new ObjectMapper());
    return new LokiLogSource(properties, queryClient, parser);
  }

  private List<List<String>> lineAt(long nanos, String timestamp, String message, String service) {
    return List.of(List.of(String.valueOf(nanos),
        "{\"@timestamp\":\"" + timestamp + "\",\"message\":\"" + message
            + "\",\"application\":\"" + service + "\",\"mdc\":{}}"));
  }

  private static long toNanos(Instant instant) {
    return instant.getEpochSecond() * 1_000_000_000L + instant.getNano();
  }

  @Test
  void idAndDisplayNameAreStable() throws IOException {
    mockServer = new MockLokiServer("/api/logs/v1", "application", "namespace", "app");
    LokiLogSource source = sourceFor(propertiesFor(mockServer));
    assertThat(source.id()).isEqualTo("openshift-loki");
    assertThat(source.displayName()).isEqualTo("OpenShift Loki");
  }

  @Test
  void capabilitiesReflectConfiguredFlagsHonestlyWhenBothOff() throws IOException {
    mockServer = new MockLokiServer("/api/logs/v1", "application", "namespace", "app");
    LokiProperties properties = propertiesFor(mockServer);
    properties.setLiveTailSupported(false);
    properties.setRawLogQlEnabled(false);
    LokiLogSource source = sourceFor(properties);

    var capabilities = source.capabilities();
    assertThat(capabilities.historicalSearch()).isTrue();
    assertThat(capabilities.liveTail()).isFalse();
    assertThat(capabilities.rawLogQL()).isFalse();
    assertThat(capabilities.serviceDiscovery()).isFalse();
  }

  @Test
  void capabilitiesReflectConfiguredFlagsHonestlyWhenBothOn() throws IOException {
    mockServer = new MockLokiServer("/api/logs/v1", "application", "namespace", "app");
    LokiProperties properties = propertiesFor(mockServer);
    properties.setLiveTailSupported(true);
    properties.setRawLogQlEnabled(true);
    LokiLogSource source = sourceFor(properties);

    var capabilities = source.capabilities();
    assertThat(capabilities.liveTail()).isTrue();
    assertThat(capabilities.rawLogQL()).isTrue();
  }

  @Test
  void discoverServicesReturnsNothingByDeliberateScopeBoundary() throws IOException {
    mockServer = new MockLokiServer("/api/logs/v1", "application", "namespace", "app");
    LokiLogSource source = sourceFor(propertiesFor(mockServer));

    StepVerifier.create(source.discoverServices()).verifyComplete();
  }

  @Test
  void healthIsUpWhenTheGatewayRespondsSuccessfully() throws IOException {
    mockServer = new MockLokiServer("/api/logs/v1", "application", "namespace", "app");
    LokiLogSource source = sourceFor(propertiesFor(mockServer));

    StepVerifier.create(source.health())
        .assertNext(health -> assertThat(health.status()).isEqualTo(SourceHealth.Status.UP))
        .verifyComplete();
  }

  @Test
  void healthIsDownWithASanitizedMessageWhenTheGatewayFails() throws IOException {
    mockServer = new MockLokiServer("/api/logs/v1", "application", "namespace", "app");
    mockServer.setScenario("401");
    LokiLogSource source = sourceFor(propertiesFor(mockServer));

    StepVerifier.create(source.health())
        .assertNext(health -> {
          assertThat(health.status()).isEqualTo(SourceHealth.Status.DOWN);
          assertThat(health.message()).isNotBlank();
        })
        .verifyComplete();
  }

  @Test
  void searchEnrichesEventsWithNamespacePodContainerNameStreamAndSourceIdFromStreamLabels() throws IOException {
    mockServer = new MockLokiServer("/api/logs/v1", "application", "namespace", "app");
    LokiProperties properties = propertiesFor(mockServer);

    Map<String, String> labels = Map.of(
        "namespace", "prod-ns", "app", "gateway", "pod", "gateway-abc123", "container", "gateway");
    mockServer.respondWithStreams(List.of(
        stream(labels, lineAt(1_700_000_000_000_000_000L, "2026-01-01T00:00:00Z", "hello", "gateway"))));

    LokiLogSource source = sourceFor(properties);
    SearchRequest request = SearchRequest.builder()
        .sourceId(source.id())
        .start(Instant.parse("2025-01-01T00:00:00Z"))
        .end(Instant.parse("2027-01-01T00:00:00Z"))
        .build();

    StepVerifier.create(source.search(request))
        .assertNext(event -> {
          assertThat(event.sourceId()).isEqualTo("openshift-loki");
          assertThat(event.namespace()).isEqualTo("prod-ns");
          assertThat(event.pod()).isEqualTo("gateway-abc123");
          assertThat(event.containerName()).isEqualTo("gateway");
          assertThat(event.stream()).isEqualTo("stdout");
          assertThat(event.message()).isEqualTo("hello");
        })
        .verifyComplete();
  }

  @Test
  void searchMergesAndSortsEventsAcrossMultipleStreamsNewestFirst() throws IOException {
    // Legacy Remediation Slice 1 recovery, mandatory blocker #1: sort is
    // now keyed on the source-native timestamp (value[0], real
    // nanoseconds-since-epoch per Loki's own API contract), not the
    // parsed application timestamp - so the nanos passed to lineAt() must
    // genuinely correlate with "oldest"/"middle"/"newest" here (small
    // placeholder integers like 1/2/3 previously worked only because sort
    // ignored value[0] entirely; they no longer would).
    mockServer = new MockLokiServer("/api/logs/v1", "application", "namespace", "app");
    LokiProperties properties = propertiesFor(mockServer);

    long oldestNanos = toNanos(Instant.parse("2026-01-01T00:00:00Z"));
    long middleNanos = toNanos(Instant.parse("2026-01-01T00:01:00Z"));
    long newestNanos = toNanos(Instant.parse("2026-01-01T00:02:00Z"));

    Map<String, String> gatewayLabels = Map.of("namespace", "prod-ns", "app", "gateway");
    Map<String, String> authLabels = Map.of("namespace", "prod-ns", "app", "auth");
    mockServer.respondWithStreams(List.of(
        stream(gatewayLabels, lineAt(oldestNanos, "2026-01-01T00:00:00Z", "oldest", "gateway")),
        stream(authLabels, lineAt(newestNanos, "2026-01-01T00:02:00Z", "newest", "auth")),
        stream(gatewayLabels, lineAt(middleNanos, "2026-01-01T00:01:00Z", "middle", "gateway"))));

    LokiLogSource source = sourceFor(properties);
    SearchRequest request = SearchRequest.builder()
        .sourceId(source.id())
        .start(Instant.parse("2025-01-01T00:00:00Z"))
        .end(Instant.parse("2027-01-01T00:00:00Z"))
        .build();

    StepVerifier.create(source.search(request))
        .assertNext(event -> assertThat(event.message()).isEqualTo("newest"))
        .assertNext(event -> assertThat(event.message()).isEqualTo("middle"))
        .assertNext(event -> assertThat(event.message()).isEqualTo("oldest"))
        .verifyComplete();
  }

  @Test
  void searchAppliesStructuredEventFiltersLikeTraceIdNotJustTheServerSideSelector() throws IOException {
    // Real bug once found in DockerLogSource (Phase C): container-level
    // filtering isn't the same as per-event filtering. Same shared
    // EventFilters.matches() call must be exercised here too.
    mockServer = new MockLokiServer("/api/logs/v1", "application", "namespace", "app");
    LokiProperties properties = propertiesFor(mockServer);

    Map<String, String> labels = Map.of("namespace", "prod-ns", "app", "gateway");
    String matchingLine = "{\"@timestamp\":\"2026-01-01T00:00:00Z\",\"message\":\"has trace\","
        + "\"application\":\"gateway\",\"mdc\":{\"traceId\":\"trace-abc\"}}";
    String nonMatchingLine = "{\"@timestamp\":\"2026-01-01T00:01:00Z\",\"message\":\"no matching trace\","
        + "\"application\":\"gateway\",\"mdc\":{\"traceId\":\"trace-xyz\"}}";
    mockServer.respondWithStreams(List.of(
        stream(labels, List.of(List.of("1", matchingLine), List.of("2", nonMatchingLine)))));

    LokiLogSource source = sourceFor(properties);
    SearchRequest request = SearchRequest.builder()
        .sourceId(source.id())
        .start(Instant.parse("2025-01-01T00:00:00Z"))
        .end(Instant.parse("2027-01-01T00:00:00Z"))
        .traceId("trace-abc")
        .build();

    StepVerifier.create(source.search(request))
        .assertNext(event -> assertThat(event.message()).isEqualTo("has trace"))
        .verifyComplete();
  }

  @Test
  void searchKeepsMalformedLinesAsRawFallbackEventsRatherThanDroppingThem() throws IOException {
    mockServer = new MockLokiServer("/api/logs/v1", "application", "namespace", "app");
    LokiProperties properties = propertiesFor(mockServer);

    Map<String, String> labels = Map.of("namespace", "prod-ns", "app", "gateway");
    mockServer.respondWithStreams(List.of(
        stream(labels, List.of(List.of("1", "not valid json at all")))));

    LokiLogSource source = sourceFor(properties);
    SearchRequest request = SearchRequest.builder()
        .sourceId(source.id())
        .start(Instant.parse("2025-01-01T00:00:00Z"))
        .end(Instant.parse("2027-01-01T00:00:00Z"))
        .build();

    StepVerifier.create(source.search(request))
        .assertNext(event -> {
          assertThat(event.malformed()).isTrue();
          assertThat(event.rawLine()).isEqualTo("not valid json at all");
          assertThat(event.sourceId()).isEqualTo("openshift-loki");
        })
        .verifyComplete();
  }

  @Test
  void multiServiceRequestsCannotPushDownButAreStillCorrectlyPostFilteredEventByEvent() throws IOException {
    // LogQlSelectorBuilder only pushes a service label down when exactly
    // one is requested (server-side pushdown would be lossy/unsafe for
    // multiple values) - IMPLEMENTATION_PLAN.md "Phase D" required
    // automated test: "pushdown vs post-filter equivalence". Two requested
    // services, three streams (one matching neither) must still yield
    // exactly the two matching events, proving EventFilters.matches()
    // does the equivalent filtering job when pushdown can't.
    mockServer = new MockLokiServer("/api/logs/v1", "application", "namespace", "app");
    LokiProperties properties = propertiesFor(mockServer);

    Map<String, String> gatewayLabels = Map.of("namespace", "prod-ns", "app", "gateway");
    Map<String, String> authLabels = Map.of("namespace", "prod-ns", "app", "auth");
    Map<String, String> billingLabels = Map.of("namespace", "prod-ns", "app", "billing");
    mockServer.respondWithStreams(List.of(
        stream(gatewayLabels, lineAt(1L, "2026-01-01T00:00:00Z", "from gateway", "gateway")),
        stream(authLabels, lineAt(2L, "2026-01-01T00:01:00Z", "from auth", "auth")),
        stream(billingLabels, lineAt(3L, "2026-01-01T00:02:00Z", "from billing", "billing"))));

    LokiLogSource source = sourceFor(properties);
    SearchRequest request = SearchRequest.builder()
        .sourceId(source.id())
        .start(Instant.parse("2025-01-01T00:00:00Z"))
        .end(Instant.parse("2027-01-01T00:00:00Z"))
        .services(List.of("gateway", "auth"))
        .build();

    StepVerifier.create(source.search(request))
        .assertNext(event -> assertThat(event.message()).isEqualTo("from auth"))
        .assertNext(event -> assertThat(event.message()).isEqualTo("from gateway"))
        .verifyComplete();

    Map<String, String> params = parseQuery(mockServer.lastQueryString());
    assertThat(params.get("query")).isEqualTo("{namespace=\"my-namespace\"}");
  }

  @Test
  void searchSendsMaxResultsPerQueryAsTheLimitParam() throws IOException {
    mockServer = new MockLokiServer("/api/logs/v1", "application", "namespace", "app");
    LokiProperties properties = propertiesFor(mockServer);
    properties.setMaxResultsPerQuery(77);

    LokiLogSource source = sourceFor(properties);
    SearchRequest request = SearchRequest.builder()
        .sourceId(source.id())
        .start(Instant.parse("2025-01-01T00:00:00Z"))
        .end(Instant.parse("2027-01-01T00:00:00Z"))
        .build();

    StepVerifier.create(source.search(request)).expectNextCount(1).verifyComplete();

    Map<String, String> params = parseQuery(mockServer.lastQueryString());
    assertThat(params.get("limit")).isEqualTo("77");
  }

  @Test
  void searchSelectorPushesDownNamespaceAlwaysAndServiceOnlyWhenExactlyOneRequested() throws IOException {
    mockServer = new MockLokiServer("/api/logs/v1", "application", "namespace", "app");
    LokiProperties properties = propertiesFor(mockServer);

    // The response's own event must actually match the requested service -
    // EventFilters.matches() (correctly) filters by event-level service too,
    // separately from what selector text was sent server-side.
    Map<String, String> labels = Map.of("namespace", "my-namespace", "app", "gateway");
    mockServer.respondWithStreams(List.of(
        stream(labels, lineAt(1L, "2026-01-01T00:00:00Z", "hello", "gateway"))));

    LokiLogSource source = sourceFor(properties);
    SearchRequest request = SearchRequest.builder()
        .sourceId(source.id())
        .start(Instant.parse("2025-01-01T00:00:00Z"))
        .end(Instant.parse("2027-01-01T00:00:00Z"))
        .services(List.of("gateway"))
        .build();

    StepVerifier.create(source.search(request)).expectNextCount(1).verifyComplete();

    Map<String, String> params = parseQuery(mockServer.lastQueryString());
    assertThat(params.get("query")).isEqualTo("{namespace=\"my-namespace\",app=\"gateway\"}");
  }

  @Test
  void aBareServiceEqualityDslQueryIsPushedDownIntoTheSelectorWhenNoServicesListIsSet() throws IOException {
    // IMPLEMENTATION_PLAN.md "Phase E" scope item 4, "Loki path" -
    // LogQlDslPlanner narrows the fetch as an optimization only; the full
    // DSL predicate still applies afterward regardless (proven by the
    // response actually matching in the next test).
    mockServer = new MockLokiServer("/api/logs/v1", "application", "namespace", "app");
    LokiProperties properties = propertiesFor(mockServer);

    Map<String, String> labels = Map.of("namespace", "my-namespace", "app", "gateway");
    mockServer.respondWithStreams(List.of(
        stream(labels, lineAt(1L, "2026-01-01T00:00:00Z", "hello", "gateway"))));

    LokiLogSource source = sourceFor(properties);
    SearchRequest request = SearchRequest.builder()
        .sourceId(source.id())
        .start(Instant.parse("2025-01-01T00:00:00Z"))
        .end(Instant.parse("2027-01-01T00:00:00Z"))
        .query(new Comparison("service", Operator.EQ, "gateway"))
        .build();

    StepVerifier.create(source.search(request)).expectNextCount(1).verifyComplete();

    Map<String, String> params = parseQuery(mockServer.lastQueryString());
    assertThat(params.get("query")).isEqualTo("{namespace=\"my-namespace\",app=\"gateway\"}");
  }

  @Test
  void anExplicitServicesListTakesPrecedenceOverTheDslPushdownHint() throws IOException {
    // A DSL query naming a *different* field than "service" so the two
    // constraints don't conflict - this test is purely about which value
    // wins in the selector, not about the DSL post-filter outcome.
    mockServer = new MockLokiServer("/api/logs/v1", "application", "namespace", "app");
    LokiProperties properties = propertiesFor(mockServer);

    Map<String, String> labels = Map.of("namespace", "my-namespace", "app", "auth");
    mockServer.respondWithStreams(List.of(
        stream(labels, lineAt(1L, "2026-01-01T00:00:00Z", "hello", "auth"))));

    LokiLogSource source = sourceFor(properties);
    SearchRequest request = SearchRequest.builder()
        .sourceId(source.id())
        .start(Instant.parse("2025-01-01T00:00:00Z"))
        .end(Instant.parse("2027-01-01T00:00:00Z"))
        .services(List.of("auth"))
        .query(new Comparison("message", Operator.CONTAINS, "hello"))
        .build();

    StepVerifier.create(source.search(request)).expectNextCount(1).verifyComplete();

    Map<String, String> params = parseQuery(mockServer.lastQueryString());
    assertThat(params.get("query")).isEqualTo("{namespace=\"my-namespace\",app=\"auth\"}");
  }

  @Test
  void rawLogQlIsUsedVerbatimAsTheSelectorWhenEnabled() throws IOException {
    mockServer = new MockLokiServer("/api/logs/v1", "application", "namespace", "app");
    LokiProperties properties = propertiesFor(mockServer);
    properties.setRawLogQlEnabled(true);

    Map<String, String> labels = Map.of("namespace", "my-namespace", "app", "gateway");
    mockServer.respondWithStreams(List.of(
        stream(labels, lineAt(1L, "2026-01-01T00:00:00Z", "hello", "gateway"))));

    LokiLogSource source = sourceFor(properties);
    String raw = "{namespace=\"my-namespace\",app=\"gateway\"}";
    SearchRequest request = SearchRequest.builder()
        .sourceId(source.id())
        .start(Instant.parse("2025-01-01T00:00:00Z"))
        .end(Instant.parse("2027-01-01T00:00:00Z"))
        .rawLogQl(raw)
        .build();

    StepVerifier.create(source.search(request)).expectNextCount(1).verifyComplete();

    Map<String, String> params = parseQuery(mockServer.lastQueryString());
    assertThat(params.get("query")).isEqualTo(raw);
  }

  @Test
  void rawLogQlStillPassesThroughTheSameEventFiltersPostFilterAfterward() throws IOException {
    mockServer = new MockLokiServer("/api/logs/v1", "application", "namespace", "app");
    LokiProperties properties = propertiesFor(mockServer);
    properties.setRawLogQlEnabled(true);

    Map<String, String> labels = Map.of("namespace", "my-namespace", "app", "gateway");
    mockServer.respondWithStreams(List.of(
        stream(labels, List.of(
            List.of("1", "{\"@timestamp\":\"2026-01-01T00:00:00Z\",\"message\":\"keep me\",\"application\":\"gateway\",\"mdc\":{}}"),
            List.of("2", "{\"@timestamp\":\"2026-01-01T00:01:00Z\",\"message\":\"drop me\",\"application\":\"gateway\",\"mdc\":{}}")))));

    LokiLogSource source = sourceFor(properties);
    SearchRequest request = SearchRequest.builder()
        .sourceId(source.id())
        .start(Instant.parse("2025-01-01T00:00:00Z"))
        .end(Instant.parse("2027-01-01T00:00:00Z"))
        .rawLogQl("{namespace=\"my-namespace\"}")
        .text("keep")
        .build();

    StepVerifier.create(source.search(request))
        .assertNext(event -> assertThat(event.message()).isEqualTo("keep me"))
        .verifyComplete();
  }

  @Test
  void rawLogQlThrowsDefensivelyWhenNotEnabledEvenThoughSearchServiceShouldHaveAlreadyBlockedIt() throws IOException {
    mockServer = new MockLokiServer("/api/logs/v1", "application", "namespace", "app");
    LokiProperties properties = propertiesFor(mockServer);
    properties.setRawLogQlEnabled(false);

    LokiLogSource source = sourceFor(properties);
    SearchRequest request = SearchRequest.builder()
        .sourceId(source.id())
        .start(Instant.parse("2025-01-01T00:00:00Z"))
        .end(Instant.parse("2027-01-01T00:00:00Z"))
        .rawLogQl("{namespace=\"x\"}")
        .build();

    assertThatThrownBy(() -> source.search(request).blockLast())
        .isInstanceOf(IllegalStateException.class);
  }

  /**
   * Legacy Remediation Slice 1, mandatory architecture correction #3
   * ("Loki duplicate-timestamp safety") — the concrete proof this was
   * written for: multiple Loki entries sharing the exact same content
   * timestamp, straddling a page boundary, driven by a real {@link
   * SearchService} against the real {@link LokiLogSource} (mocked HTTP
   * transport only).
   */
  @Test
  void identicalTimestampsAtALokiPageBoundaryAreNeverSkippedOrDuplicated() throws IOException {
    mockServer = new MockLokiServer("/api/logs/v1", "application", "namespace", "app");
    LokiProperties properties = propertiesFor(mockServer);
    Map<String, String> labels = Map.of("namespace", "prod-ns", "app", "gateway");

    // Legacy Remediation Slice 1 recovery, mandatory blocker #1's own
    // required test #5 ("multiple Loki events share identical
    // source-native timestamp"): five entries genuinely tied at the exact
    // same value[0] nanos (not merely the same parsed @timestamp - the
    // nanos value is what pagination actually keys on now), then three
    // older entries each with a distinct native timestamp.
    long tiedNanos = toNanos(Instant.parse("2026-01-01T00:00:00.000Z"));
    long fNanos = toNanos(Instant.parse("2025-12-31T23:59:59.000Z"));
    long gNanos = toNanos(Instant.parse("2025-12-31T23:59:58.000Z"));
    long hNanos = toNanos(Instant.parse("2025-12-31T23:59:57.000Z"));

    List<List<String>> values = new ArrayList<>();
    values.add(List.of(String.valueOf(tiedNanos), lokiLine("2026-01-01T00:00:00.000Z", "gateway", "a")));
    values.add(List.of(String.valueOf(tiedNanos), lokiLine("2026-01-01T00:00:00.000Z", "gateway", "b")));
    values.add(List.of(String.valueOf(tiedNanos), lokiLine("2026-01-01T00:00:00.000Z", "gateway", "c")));
    values.add(List.of(String.valueOf(tiedNanos), lokiLine("2026-01-01T00:00:00.000Z", "gateway", "d")));
    values.add(List.of(String.valueOf(tiedNanos), lokiLine("2026-01-01T00:00:00.000Z", "gateway", "e")));
    values.add(List.of(String.valueOf(fNanos), lokiLine("2025-12-31T23:59:59.000Z", "gateway", "f")));
    values.add(List.of(String.valueOf(gNanos), lokiLine("2025-12-31T23:59:58.000Z", "gateway", "g")));
    values.add(List.of(String.valueOf(hNanos), lokiLine("2025-12-31T23:59:57.000Z", "gateway", "h")));
    mockServer.respondWithStreams(List.of(stream(labels, values)));

    LokiLogSource source = sourceFor(properties);
    SearchGuardrailsProperties guardrailsProperties = new SearchGuardrailsProperties();
    guardrailsProperties.setDefaultLimit(3);
    guardrailsProperties.setMaxTimeRange(Duration.ofDays(800));
    SearchService searchService = searchServiceFor(source, guardrailsProperties);

    SearchRequest.Builder request = SearchRequest.builder()
        .sourceId(source.id())
        .start(Instant.parse("2025-01-01T00:00:00Z"))
        .end(Instant.parse("2027-01-01T00:00:00Z"));

    SearchResult page1 = searchService.search(request.build()).block();
    assertThat(page1.events()).extracting(CanonicalLogEvent::message).containsExactly("a", "b", "c");
    assertThat(page1.nextCursor()).isNotNull();

    SearchResult page2 = searchService.search(request.cursor(page1.nextCursor()).build()).block();
    assertThat(page2.events()).extracting(CanonicalLogEvent::message).containsExactly("d", "e", "f");
    assertThat(page2.nextCursor()).isNotNull();

    SearchResult page3 = searchService.search(request.cursor(page2.nextCursor()).build()).block();
    assertThat(page3.events()).extracting(CanonicalLogEvent::message).containsExactly("g", "h");
    assertThat(page3.counts().truncated()).isFalse();
    assertThat(page3.nextCursor()).isNull();

    List<String> all = new ArrayList<>();
    page1.events().forEach(e -> all.add(e.message()));
    page2.events().forEach(e -> all.add(e.message()));
    page3.events().forEach(e -> all.add(e.message()));
    assertThat(new HashSet<>(all)).as("no event skipped or duplicated across pages").hasSize(8);
  }

  @Test
  void multiPageTraversalThroughSearchServiceAgainstLokiVisitsEveryEventExactlyOnceThenExhausts() throws IOException {
    mockServer = new MockLokiServer("/api/logs/v1", "application", "namespace", "app");
    LokiProperties properties = propertiesFor(mockServer);
    Map<String, String> labels = Map.of("namespace", "prod-ns", "app", "gateway");

    List<List<String>> values = new ArrayList<>();
    for (int i = 0; i < 11; i++) {
      values.add(List.of(String.valueOf(i), lokiLine(String.format("2026-01-01T00:00:%02dZ", 59 - i), "gateway", "event-" + i)));
    }
    mockServer.respondWithStreams(List.of(stream(labels, values)));

    LokiLogSource source = sourceFor(properties);
    SearchGuardrailsProperties guardrailsProperties = new SearchGuardrailsProperties();
    guardrailsProperties.setDefaultLimit(4);
    guardrailsProperties.setMaxTimeRange(Duration.ofDays(800));
    SearchService searchService = searchServiceFor(source, guardrailsProperties);

    SearchRequest.Builder request = SearchRequest.builder()
        .sourceId(source.id())
        .start(Instant.parse("2025-01-01T00:00:00Z"))
        .end(Instant.parse("2027-01-01T00:00:00Z"));

    Set<String> seen = new HashSet<>();
    String cursor = null;
    int guardAgainstInfiniteLoop = 0;
    do {
      SearchResult page = searchService.search(request.cursor(cursor).build()).block();
      for (CanonicalLogEvent e : page.events()) {
        assertThat(seen.add(e.message())).as("no duplicate across pages").isTrue();
      }
      cursor = page.nextCursor();
      guardAgainstInfiniteLoop++;
      assertThat(guardAgainstInfiniteLoop).isLessThan(20);
    } while (cursor != null);

    assertThat(seen).hasSize(11);
  }

  /**
   * Legacy Remediation Slice 1 recovery, mandatory blocker #1's required
   * test #4: {@code value[0]} (the source-native pagination position)
   * intentionally differs from the JSON payload's own {@code @timestamp}
   * - pagination must follow {@code value[0]} exclusively.
   */
  @Test
  void paginationFollowsLokiValueZeroEvenWhenTheApplicationTimestampDisagreesAboutOrder() throws IOException {
    mockServer = new MockLokiServer("/api/logs/v1", "application", "namespace", "app");
    LokiProperties properties = propertiesFor(mockServer);
    Map<String, String> labels = Map.of("namespace", "prod-ns", "app", "gateway");

    // All four share the exact same JSON @timestamp; value[0] genuinely
    // differs and descends a -> d (the true native order).
    String sharedAppTimestamp = "2025-06-01T00:00:00.000Z";
    List<List<String>> values = List.of(
        List.of(String.valueOf(toNanos(Instant.parse("2026-01-01T00:00:00.000Z"))), lokiLine(sharedAppTimestamp, "gateway", "a")),
        List.of(String.valueOf(toNanos(Instant.parse("2025-12-31T23:59:59.000Z"))), lokiLine(sharedAppTimestamp, "gateway", "b")),
        List.of(String.valueOf(toNanos(Instant.parse("2025-12-31T23:59:58.000Z"))), lokiLine(sharedAppTimestamp, "gateway", "c")),
        List.of(String.valueOf(toNanos(Instant.parse("2025-12-31T23:59:57.000Z"))), lokiLine(sharedAppTimestamp, "gateway", "d")));
    mockServer.respondWithStreams(List.of(stream(labels, values)));

    LokiLogSource source = sourceFor(properties);
    SearchGuardrailsProperties guardrailsProperties = new SearchGuardrailsProperties();
    guardrailsProperties.setDefaultLimit(2);
    guardrailsProperties.setMaxTimeRange(Duration.ofDays(800));
    SearchService searchService = searchServiceFor(source, guardrailsProperties);

    SearchRequest.Builder request = SearchRequest.builder()
        .sourceId(source.id())
        .start(Instant.parse("2025-01-01T00:00:00Z"))
        .end(Instant.parse("2027-01-01T00:00:00Z"));

    SearchResult page1 = searchService.search(request.build()).block();
    assertThat(page1.events()).extracting(CanonicalLogEvent::message).containsExactly("a", "b");

    SearchResult page2 = searchService.search(request.cursor(page1.nextCursor()).build()).block();
    assertThat(page2.events()).extracting(CanonicalLogEvent::message).containsExactly("c", "d");
    assertThat(page2.counts().truncated()).isFalse();
    assertThat(page2.nextCursor()).isNull();
  }

  @Test
  void forwardDirectionPaginationAgainstLokiAdvancesTowardNewerValueZeroTimestampsWithTiedBoundariesAndNoSkipOrDuplicate() throws IOException {
    // Legacy Remediation Slice 1 recovery, mandatory blocker #2: FORWARD
    // must move the boundary toward *newer* value[0] timestamps - never
    // silently treated as BACKWARD - including a tied-timestamp group at
    // the page boundary (mandatory blocker #1's duplicate-timestamp
    // safety, mirrored for the forward direction).
    mockServer = new MockLokiServer("/api/logs/v1", "application", "namespace", "app");
    LokiProperties properties = propertiesFor(mockServer);
    Map<String, String> labels = Map.of("namespace", "prod-ns", "app", "gateway");

    long tiedNanos = toNanos(Instant.parse("2026-01-01T00:00:03.000Z"));
    List<List<String>> values = new ArrayList<>();
    values.add(List.of(String.valueOf(toNanos(Instant.parse("2026-01-01T00:00:00.000Z"))), lokiLine("2026-01-01T00:00:00.000Z", "gateway", "a")));
    values.add(List.of(String.valueOf(toNanos(Instant.parse("2026-01-01T00:00:01.000Z"))), lokiLine("2026-01-01T00:00:01.000Z", "gateway", "b")));
    values.add(List.of(String.valueOf(tiedNanos), lokiLine("2026-01-01T00:00:03.000Z", "gateway", "c")));
    values.add(List.of(String.valueOf(tiedNanos), lokiLine("2026-01-01T00:00:03.000Z", "gateway", "d")));
    values.add(List.of(String.valueOf(tiedNanos), lokiLine("2026-01-01T00:00:03.000Z", "gateway", "e")));
    mockServer.respondWithStreams(List.of(stream(labels, values)));

    LokiLogSource source = sourceFor(properties);
    SearchGuardrailsProperties guardrailsProperties = new SearchGuardrailsProperties();
    guardrailsProperties.setDefaultLimit(2);
    guardrailsProperties.setMaxTimeRange(Duration.ofDays(800));
    SearchService searchService = searchServiceFor(source, guardrailsProperties);

    SearchRequest.Builder request = SearchRequest.builder()
        .sourceId(source.id())
        .start(Instant.parse("2025-01-01T00:00:00Z"))
        .end(Instant.parse("2027-01-01T00:00:00Z"))
        .direction(SearchRequest.Direction.FORWARD);

    SearchResult page1 = searchService.search(request.build()).block();
    assertThat(page1.events()).extracting(CanonicalLogEvent::message).containsExactly("a", "b");

    SearchResult page2 = searchService.search(request.cursor(page1.nextCursor()).build()).block();
    assertThat(page2.events()).extracting(CanonicalLogEvent::message).containsExactly("c", "d");

    SearchResult page3 = searchService.search(request.cursor(page2.nextCursor()).build()).block();
    assertThat(page3.events()).extracting(CanonicalLogEvent::message).containsExactly("e");
    assertThat(page3.counts().truncated()).isFalse();
    assertThat(page3.nextCursor()).isNull();
  }

  private String lokiLine(String timestamp, String service, String message) {
    return "{\"@timestamp\":\"" + timestamp + "\",\"message\":\"" + message
        + "\",\"application\":\"" + service + "\",\"mdc\":{}}";
  }

  private SearchService searchServiceFor(LokiLogSource source, SearchGuardrailsProperties properties) {
    SearchGuardrails guardrails = new SearchGuardrails(properties);
    ConcurrencyGuard concurrencyGuard = new ConcurrencyGuard(properties);
    LogSourceRegistry registry = new LogSourceRegistry(List.of(source), new SourcesProperties());
    return new SearchService(registry, guardrails, concurrencyGuard, new PageCursorCodec(new ObjectMapper()));
  }

  private Map<String, String> parseQuery(String rawQuery) {
    Map<String, String> result = new java.util.LinkedHashMap<>();
    if (rawQuery == null) {
      return result;
    }
    for (String pair : rawQuery.split("&")) {
      int idx = pair.indexOf('=');
      if (idx < 0) {
        continue;
      }
      String key = java.net.URLDecoder.decode(pair.substring(0, idx), java.nio.charset.StandardCharsets.UTF_8);
      String value = java.net.URLDecoder.decode(pair.substring(idx + 1), java.nio.charset.StandardCharsets.UTF_8);
      result.put(key, value);
    }
    return result;
  }
}
