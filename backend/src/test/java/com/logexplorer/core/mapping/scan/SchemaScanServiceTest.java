package com.logexplorer.core.mapping.scan;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.logexplorer.config.SourcesProperties;
import com.logexplorer.core.mapping.CanonicalField;
import com.logexplorer.core.mapping.FieldMappingProfileService;
import com.logexplorer.core.mapping.JsonPath;
import com.logexplorer.core.mapping.MappingScopeKey;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.SourceCapabilities;
import com.logexplorer.source.LogSourceRegistry;
import com.logexplorer.source.StubLogSource;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Flux;

/**
 * Owner mission "Field Mapping Schema Scan + Masking Policy Extension" §A,
 * extended project-scoped by owner mission "Project-Scoped Schema Scan"
 * §1-§9 — covers both missions' exact required test lists: INFO+ERROR
 * union, ERROR-only fields discoverable, structurally-different INFO
 * events both represented, nested-path preservation, same-leaf-different-
 * parent distinctness, occurrence count/percentage correctness, INFO-only
 * source, zero/single event scans, malformed-event truthfulness (now
 * classification-based, never polluting the schema or becoming a
 * representative sample), scan-bounds enforcement, representative samples
 * are real source JSON, union never conflated with raw events, rescan
 * mapping-safety, mapped-path-disappearance detection, Docker-project
 * isolation, OpenShift-namespace isolation, project-change readiness
 * recalculation, multi-service-within-one-project inclusion, and
 * mapping-never-silently-reused-across-projects.
 *
 * <p>Required flags this file backs: {@code QUICK_SCHEMA_SCAN=PASS},
 * {@code DIVERSE_SAMPLE_SCAN=PASS}, {@code STRUCTURAL_VARIANT_DETECTION=PASS},
 * {@code DISCOVERED_SCHEMA_UNION=PASS}, {@code REPRESENTATIVE_ORIGINAL_EVENTS=PASS},
 * {@code SCAN_BOUNDS=PASS}, {@code RESCAN_MAPPING_SAFETY=PASS},
 * {@code PROJECT_SCOPED_SCHEMA_SCAN=PASS}, {@code DOCKER_PROJECT_ISOLATION=PASS},
 * {@code OPENSHIFT_NAMESPACE_ISOLATION=PASS}, {@code CROSS_PROJECT_SCHEMA_MIXING=NO},
 * {@code NON_JSON_NOISE_EXCLUDED_FROM_MAPPING_SCHEMA=YES},
 * {@code PROJECT_SCOPED_MAPPING_PROFILE=PASS}, {@code PROJECT_CHANGE_RECALCULATES_READINESS=YES}.
 */
class SchemaScanServiceTest {

  private static final Instant BASE = Instant.parse("2026-01-01T00:00:00Z");

  private SchemaScanService serviceFor(StubLogSource... sources) {
    return serviceFor(new FieldMappingProfileService(), Clock.fixed(BASE, ZoneOffset.UTC), sources);
  }

  private SchemaScanService serviceFor(FieldMappingProfileService mappingProfileService, Clock clock, StubLogSource... sources) {
    LogSourceRegistry registry = new LogSourceRegistry(List.of(sources), new SourcesProperties());
    return new SchemaScanService(registry, mappingProfileService, new ObjectMapper(), clock);
  }

  private StubLogSource source(String id, CanonicalLogEvent... events) {
    StubLogSource stub = new StubLogSource(id, id, new SourceCapabilities(true, false, false, false, false, false, false, true));
    stub.withSearchFlux(Flux.fromArray(events));
    return stub;
  }

  private CanonicalLogEvent event(String severity, String json) {
    return CanonicalLogEvent.builder()
        .timestamp(BASE)
        .sourceTimestamp(BASE)
        .severity(severity)
        .message("m")
        .originalRawJson(json)
        .build();
  }

  private CanonicalLogEvent eventWithService(String severity, String json, String service) {
    return CanonicalLogEvent.builder()
        .timestamp(BASE)
        .sourceTimestamp(BASE)
        .severity(severity)
        .service(service)
        .message("m")
        .originalRawJson(json)
        .build();
  }

  // --- INFO+ERROR produce path union / ERROR-only fields discoverable ---

  @Test
  void infoAndErrorEventsTogetherProduceTheUnionOfBothPathSets() {
    StubLogSource src = source("s1",
        event("INFO", "{\"cif\":\"1\"}"),
        event("ERROR", "{\"errorCode\":\"E1\"}"));

    SchemaScanResult result = serviceFor(src).scan("s1", null, null).block();

    List<String> paths = result.discoveredSchema().stream().map(DiscoveredPathEntry::path).toList();
    assertThat(paths).contains("cif", "errorCode");
  }

  @Test
  void errorOnlyFieldsRemainDiscoverableEvenWhenRareAmongManyInfoEvents() {
    List<CanonicalLogEvent> events = new java.util.ArrayList<>();
    IntStream.range(0, 9).forEach(i -> events.add(event("INFO", "{\"cif\":\"" + i + "\"}")));
    events.add(event("ERROR", "{\"cif\":\"x\",\"stackTrace\":\"boom\"}"));
    StubLogSource src = source("s1", events.toArray(new CanonicalLogEvent[0]));

    SchemaScanResult result = serviceFor(src).scan("s1", null, null).block();

    assertThat(result.discoveredSchema().stream().map(DiscoveredPathEntry::path)).contains("stackTrace");
    DiscoveredPathEntry stackTrace = result.discoveredSchema().stream()
        .filter(e -> e.path().equals("stackTrace")).findFirst().orElseThrow();
    assertThat(stackTrace.occurrenceCount()).isEqualTo(1);
  }

  // --- structural-variant / diverse-sample scan ---

  @Test
  void twoStructurallyDifferentInfoEventsAreBothRetainedAsRepresentativeSamples() {
    StubLogSource src = source("s1",
        event("INFO", "{\"cif\":\"1\"}"),
        event("INFO", "{\"customer\":{\"cif\":\"1\"}}"));

    SchemaScanResult result = serviceFor(src).scan("s1", null, null).block();

    List<OriginalEventSample> infoSamples = result.representativeEvents().stream()
        .filter(s -> s.severity().equals("INFO")).toList();
    assertThat(infoSamples).hasSize(2);
    assertThat(infoSamples.stream().map(OriginalEventSample::structuralFingerprint).distinct()).hasSize(2);
    assertThat(result.structuralVariantCount()).isEqualTo(2);
  }

  @Test
  void identicalStructureRepeatedManyTimesProducesOnlyOneRepresentativeSample() {
    CanonicalLogEvent[] events = IntStream.range(0, 10)
        .mapToObj(i -> event("INFO", "{\"cif\":\"" + i + "\"}"))
        .toArray(CanonicalLogEvent[]::new);
    StubLogSource src = source("s1", events);

    SchemaScanResult result = serviceFor(src).scan("s1", null, null).block();

    assertThat(result.representativeEvents()).hasSize(1);
    assertThat(result.totalEventsInspected()).isEqualTo(10);
    assertThat(result.structuralVariantCount()).isEqualTo(1);
  }

  // --- nested / distinct-path preservation ---

  @Test
  void nestedPathsArePreservedExactly() {
    StubLogSource src = source("s1", event("INFO", "{\"mdc\":{\"cif\":\"1\"}}"));

    SchemaScanResult result = serviceFor(src).scan("s1", null, null).block();

    List<String> paths = result.discoveredSchema().stream().map(DiscoveredPathEntry::path).toList();
    assertThat(paths).contains("mdc", "mdc.cif");
  }

  @Test
  void theSameLeafNameUnderDifferentParentsRemainsDistinct() {
    StubLogSource src = source("s1", event("INFO",
        "{\"cif\":\"a\",\"mdc\":{\"cif\":\"b\"},\"customer\":{\"cif\":\"c\"},\"customer2\":{\"identity\":{\"cif\":\"d\"}}}"));

    SchemaScanResult result = serviceFor(src).scan("s1", null, null).block();

    List<String> paths = result.discoveredSchema().stream().map(DiscoveredPathEntry::path).toList();
    assertThat(paths).contains("cif", "mdc.cif", "customer.cif", "customer2.identity.cif");
  }

  // --- occurrence count / percentage correctness ---

  @Test
  void occurrenceCountAndCoveragePercentageAreComputedCorrectly() {
    StubLogSource src = source("s1",
        event("INFO", "{\"cif\":\"1\"}"),
        event("INFO", "{\"cif\":\"2\"}"),
        event("INFO", "{\"noCif\":true}"),
        event("INFO", "{\"noCif\":true}"));

    SchemaScanResult result = serviceFor(src).scan("s1", null, null).block();

    DiscoveredPathEntry cif = result.discoveredSchema().stream().filter(e -> e.path().equals("cif")).findFirst().orElseThrow();
    assertThat(cif.occurrenceCount()).isEqualTo(2);
    assertThat(cif.coveragePercentage()).isEqualTo(50.0);
  }

  // --- source-only-INFO / zero / single event ---

  @Test
  void aSourceWithOnlyInfoEventsStillProducesAUsefulSchema() {
    StubLogSource src = source("s1", event("INFO", "{\"cif\":\"1\",\"service\":\"gateway\"}"));

    SchemaScanResult result = serviceFor(src).scan("s1", null, null).block();

    assertThat(result.discoveredSchema()).isNotEmpty();
  }

  @Test
  void aZeroEventScanCompletesTruthfullyWithNoCrash() {
    StubLogSource src = source("s1");

    SchemaScanResult result = serviceFor(src).scan("s1", null, null).block();

    assertThat(result.totalEventsInspected()).isZero();
    assertThat(result.discoveredSchema()).isEmpty();
    assertThat(result.representativeEvents()).isEmpty();
  }

  @Test
  void aSingleEventScanProducesOneHundredPercentCoverageForEveryPathItContains() {
    StubLogSource src = source("s1", event("INFO", "{\"cif\":\"1\"}"));

    SchemaScanResult result = serviceFor(src).scan("s1", null, null).block();

    assertThat(result.totalEventsInspected()).isEqualTo(1);
    assertThat(result.discoveredSchema().get(0).coveragePercentage()).isEqualTo(100.0);
  }

  // --- structured vs. non-JSON classification (mission "Project-Scoped Schema Scan" §5) ---

  @Test
  void structuredAndNonJsonLinesInTheSameProjectAreClassifiedAndSeparated() {
    StubLogSource src = source("s1",
        event("INFO", "{\"cif\":\"1\"}"),
        event("ERROR", "not valid json at all"));

    SchemaScanResult result = serviceFor(src).scan("s1", null, null).block();

    assertThat(result.totalEventsInspected()).isEqualTo(2);
    assertThat(result.structuredJsonEventCount()).isEqualTo(1);
    assertThat(result.nonJsonEventCount()).isEqualTo(1);
  }

  @Test
  void nonJsonMalformedLinesNeverAddFieldsToTheDiscoveredSchema() {
    StubLogSource src = source("s1",
        event("INFO", "{\"cif\":\"1\"}"),
        event("ERROR", "not valid json at all"));

    SchemaScanResult result = serviceFor(src).scan("s1", null, null).block();

    assertThat(result.discoveredSchema().stream().map(DiscoveredPathEntry::path)).containsOnly("cif");
  }

  @Test
  void nonJsonLinesNeverBecomeTheRepresentativeMappingSample_onlyDiagnostics() {
    StubLogSource src = source("s1",
        event("INFO", "{\"cif\":\"1\"}"),
        event("ERROR", "not valid json at all"));

    SchemaScanResult result = serviceFor(src).scan("s1", null, null).block();

    assertThat(result.representativeEvents())
        .as("mission §5: a non-JSON/infrastructure line must never become the representative mapping sample")
        .allMatch(s -> s.classification() == EventClassification.STRUCTURED_JSON_APPLICATION_EVENT);
    assertThat(result.diagnosticNonJsonSamples())
        .hasSize(1)
        .allMatch(s -> s.classification() == EventClassification.NON_JSON_OR_MALFORMED_EVENT);
    assertThat(result.diagnosticNonJsonSamples().get(0).originalJson()).isEqualTo("not valid json at all");
  }

  // --- scan bounds ---

  @Test
  void eventCountIsBoundedToTheRequestedLimitAndNeverExceedsTheHardCeiling() {
    CanonicalLogEvent[] events = IntStream.range(0, SchemaScanBounds.MAX_EVENTS_INSPECTED_CEILING + 50)
        .mapToObj(i -> event("INFO", "{\"cif\":\"" + i + "\"}"))
        .toArray(CanonicalLogEvent[]::new);
    StubLogSource src = source("s1", events);

    SchemaScanResult uncapped = serviceFor(src).scan("s1", null, SchemaScanBounds.MAX_EVENTS_INSPECTED_CEILING + 50).block();
    assertThat(uncapped.totalEventsInspected()).isEqualTo(SchemaScanBounds.MAX_EVENTS_INSPECTED_CEILING);
    assertThat(uncapped.eventLimitReached()).isTrue();

    SchemaScanResult explicit = serviceFor(src).scan("s1", null, 3).block();
    assertThat(explicit.totalEventsInspected()).isEqualTo(3);
    assertThat(explicit.eventLimitReached()).isTrue();
  }

  @Test
  void aByteBudgetThatIsExceededStopsTheScanEarlyRatherThanReadingUnboundedData() {
    // Each event alone is ~6KB; MAX_EVENTS_INSPECTED_CEILING (500) events
    // at that size would total ~3MB, comfortably past MAX_BYTES_INSPECTED
    // (2MB) - so the byte bound, not the event-count bound, is what stops
    // this scan early.
    String bigValue = "x".repeat(6000);
    int eventCount = SchemaScanBounds.MAX_EVENTS_INSPECTED_CEILING;
    CanonicalLogEvent[] events = IntStream.range(0, eventCount)
        .mapToObj(i -> event("INFO", "{\"cif\":\"" + bigValue + i + "\"}"))
        .toArray(CanonicalLogEvent[]::new);
    StubLogSource src = source("s1", events);

    SchemaScanResult result = serviceFor(src).scan("s1", null, eventCount).block();

    assertThat(result.byteLimitReached()).isTrue();
    assertThat(result.totalEventsInspected()).isLessThan(eventCount);
    assertThat(result.totalBytesInspected()).isLessThanOrEqualTo(SchemaScanBounds.MAX_BYTES_INSPECTED);
  }

  @Test
  void aScanThatRunsPastTheDurationBudgetStopsEarlyRatherThanRunningForever() {
    // A Clock whose instant() advances well past MAX_SCAN_DURATION on every
    // call after the first makes the duration check trip immediately after
    // the first event is processed - deterministic, no real sleeping.
    java.util.concurrent.atomic.AtomicInteger calls = new java.util.concurrent.atomic.AtomicInteger(0);
    Clock advancingClock = new Clock() {
      @Override
      public java.time.ZoneId getZone() {
        return ZoneOffset.UTC;
      }

      @Override
      public Clock withZone(java.time.ZoneId zone) {
        return this;
      }

      @Override
      public Instant instant() {
        int call = calls.getAndIncrement();
        // Call 0 is scan()'s own "now" for the search window; call 1
        // establishes buildResult's scanStart; every call from the first
        // in-loop duration check onward jumps far beyond the budget.
        return call <= 1 ? BASE : BASE.plus(SchemaScanBounds.MAX_SCAN_DURATION).plusSeconds(1);
      }
    };
    CanonicalLogEvent[] events = IntStream.range(0, 20)
        .mapToObj(i -> event("INFO", "{\"cif\":\"" + i + "\"}"))
        .toArray(CanonicalLogEvent[]::new);
    StubLogSource src = source("s1", events);

    SchemaScanResult result = serviceFor(new FieldMappingProfileService(), advancingClock, src).scan("s1", null, 20).block();

    assertThat(result.durationLimitReached()).isTrue();
    assertThat(result.totalEventsInspected()).isLessThan(20);
  }

  // --- representative samples are real source JSON ---

  @Test
  void representativeSamplesAreTheActualUnmodifiedSourceJson_notNormalizedOrReshaped() {
    String raw = "{\"cif\":\"1\",\"mdc\":{\"x\":1}}";
    StubLogSource src = source("s1", event("INFO", raw));

    SchemaScanResult result = serviceFor(src).scan("s1", null, null).block();

    assertThat(result.representativeEvents().get(0).originalJson()).isEqualTo(raw);
  }

  // --- union is metadata, never confused with a raw original event ---

  @Test
  void theDiscoveredSchemaUnionIsMetadataOnly_neverRawEventContent() {
    StubLogSource src = source("s1", event("INFO", "{\"cif\":\"1\"}"));

    SchemaScanResult result = serviceFor(src).scan("s1", null, null).block();

    for (DiscoveredPathEntry entry : result.discoveredSchema()) {
      assertThat(entry.path()).doesNotContain("{").doesNotContain("}");
      assertThat(result.representativeEvents().stream().map(OriginalEventSample::originalJson))
          .doesNotContain(entry.path());
    }
  }

  // --- rescan mapping safety ---

  @Test
  void rescanningNeverMutatesTheSavedFieldMappingProfile() {
    MappingScopeKey scope = MappingScopeKey.of("s1", null);
    FieldMappingProfileService mappingService = new FieldMappingProfileService();
    mappingService.updateCandidates(scope, CanonicalField.CIF, List.of(JsonPath.parse("cif")));
    mappingService.confirmSave(scope, true);
    boolean readyBefore = mappingService.isSearchReady(scope);
    var profileBefore = mappingService.activeProfile(scope);

    StubLogSource src = source("s1", event("INFO", "{\"cif\":\"1\"}"), event("INFO", "{\"cifId\":\"2\"}"));
    SchemaScanService scanService = serviceFor(mappingService, Clock.fixed(BASE, ZoneOffset.UTC), src);
    scanService.scan("s1", null, null).block();
    scanService.scan("s1", null, null).block();

    assertThat(mappingService.activeProfile(scope)).isSameAs(profileBefore);
    assertThat(mappingService.isSearchReady(scope)).isEqualTo(readyBefore);
  }

  @Test
  void aSavedMappedPathThatIsNoLongerObservedInTheCurrentScanIsReportedAsMissing() {
    MappingScopeKey scope = MappingScopeKey.of("s1", null);
    FieldMappingProfileService mappingService = new FieldMappingProfileService();
    mappingService.updateCandidates(scope, CanonicalField.CIF, List.of(JsonPath.parse("mdc.cif")));
    mappingService.confirmSave(scope, true);

    // Current source data no longer has mdc.cif anywhere - the field shape moved.
    StubLogSource src = source("s1", event("INFO", "{\"cif\":\"1\"}"));
    SchemaScanService scanService = serviceFor(mappingService, Clock.fixed(BASE, ZoneOffset.UTC), src);

    SchemaScanResult result = scanService.scan("s1", null, null).block();

    assertThat(result.mappedPathsNotObserved()).contains("mdc.cif");
  }

  @Test
  void aSavedMappedPathThatIsStillObservedIsNotReportedAsMissing() {
    MappingScopeKey scope = MappingScopeKey.of("s1", null);
    FieldMappingProfileService mappingService = new FieldMappingProfileService();
    mappingService.updateCandidates(scope, CanonicalField.CIF, List.of(JsonPath.parse("cif")));
    mappingService.confirmSave(scope, true);

    StubLogSource src = source("s1", event("INFO", "{\"cif\":\"1\"}"));
    SchemaScanService scanService = serviceFor(mappingService, Clock.fixed(BASE, ZoneOffset.UTC), src);

    SchemaScanResult result = scanService.scan("s1", null, null).block();

    assertThat(result.mappedPathsNotObserved()).doesNotContain("cif");
  }

  // --- consecutive scans reflect real, changed source data (basis for frontend newly-discovered-path detection) ---

  @Test
  void consecutiveScansAgainstChangedSourceDataProduceDifferentDiscoveredSchemas() {
    StubLogSource src = source("s1", event("INFO", "{\"cif\":\"1\"}"));
    SchemaScanService scanService = serviceFor(src);
    SchemaScanResult first = scanService.scan("s1", null, null).block();

    src.withSearchFlux(Flux.just(event("INFO", "{\"cif\":\"1\",\"newField\":\"x\"}")));
    SchemaScanResult second = scanService.scan("s1", null, null).block();

    List<String> firstPaths = first.discoveredSchema().stream().map(DiscoveredPathEntry::path).toList();
    List<String> secondPaths = second.discoveredSchema().stream().map(DiscoveredPathEntry::path).toList();
    assertThat(firstPaths).doesNotContain("newField");
    assertThat(secondPaths).contains("newField");
  }

  // =====================================================================
  // Owner mission "Project-Scoped Schema Scan" §1-§9
  // =====================================================================

  @Test
  void theScanRequestCarriesTheExplicitlySelectedProjectScope() {
    // Mission §1: SCAN_SCOPE_EXPLICIT.
    StubLogSource src = source("local-docker");
    serviceFor(src).scan("local-docker", "boubyan-platform", null).block();

    assertThat(src.lastRequest.composeProject()).isEqualTo("boubyan-platform");
  }

  @Test
  void theResultReportsTheRealResolvedScopeLabel() {
    StubLogSource src = source("local-docker");
    SchemaScanResult withProject = serviceFor(src).scan("local-docker", "boubyan-platform", null).block();
    SchemaScanResult withoutProject = serviceFor(src).scan("local-docker", null, null).block();

    assertThat(withProject.scopeLabel()).isEqualTo("boubyan-platform");
    assertThat(withoutProject.scopeLabel()).isNull();
  }

  @Test
  void twoDockerComposeProjectsWithDifferentSchemasDoNotMix() {
    // Mission §2/§9: "two Docker compose projects with different schemas
    // do not mix" / "selected Docker project returns only its schema."
    // Simulates DockerLogSource's own real per-project filtering
    // (relevantContainers) at the search-response level.
    StubLogSource src = source("local-docker");
    src.withSearchFluxFn(request -> {
      if ("boubyan-platform".equals(request.composeProject())) {
        return Flux.just(event("INFO", "{\"iamField\":\"1\"}"));
      }
      if ("other-project".equals(request.composeProject())) {
        return Flux.just(event("INFO", "{\"otherField\":\"2\"}"));
      }
      return Flux.empty();
    });
    SchemaScanService service = serviceFor(src);

    SchemaScanResult boubyan = service.scan("local-docker", "boubyan-platform", null).block();
    SchemaScanResult other = service.scan("local-docker", "other-project", null).block();

    assertThat(boubyan.discoveredSchema().stream().map(DiscoveredPathEntry::path)).containsExactly("iamField");
    assertThat(other.discoveredSchema().stream().map(DiscoveredPathEntry::path)).containsExactly("otherField");
  }

  @Test
  void representativeEventsBelongOnlyToTheSelectedScope() {
    // Mission §9: "representative events belong only to selected scope."
    StubLogSource src = source("local-docker");
    src.withSearchFluxFn(request -> "project-a".equals(request.composeProject())
        ? Flux.just(event("INFO", "{\"aOnly\":1}"))
        : Flux.just(event("INFO", "{\"bOnly\":2}")));

    SchemaScanResult a = serviceFor(src).scan("local-docker", "project-a", null).block();

    assertThat(a.representativeEvents()).allSatisfy(sample -> assertThat(sample.originalJson()).contains("aOnly"));
    assertThat(a.representativeEvents().stream().map(OriginalEventSample::originalJson)).noneMatch(json -> json.contains("bOnly"));
  }

  @Test
  void multipleServicesInsideTheSameProjectAreAllIncluded() {
    // Mission §4/§9: service diversity WITHIN the selected project.
    StubLogSource src = source("local-docker",
        eventWithService("INFO", "{\"a\":1}", "iam"),
        eventWithService("INFO", "{\"b\":2}", "gateway"),
        eventWithService("INFO", "{\"c\":3}", "payments"));

    SchemaScanResult result = serviceFor(src).scan("local-docker", "boubyan-platform", null).block();

    assertThat(result.servicesObserved()).containsExactly("gateway", "iam", "payments");
  }

  @Test
  void twoOpenShiftNamespacesDoNotMix() {
    // Mission §3/§9: OpenShift's real scope is session-based, never
    // request-supplied - StubLogSource#withResolveMappingScopeLabelFn
    // simulates that (ignores composeProject, returns whatever the
    // "session" - here a mutable AtomicReference - currently holds).
    AtomicReference<String> currentNamespace = new AtomicReference<>("namespace-a");
    StubLogSource src = source("openshift");
    src.withResolveMappingScopeLabelFn(request -> currentNamespace.get());
    src.withSearchFluxFn(request -> "namespace-a".equals(currentNamespace.get())
        ? Flux.just(event("INFO", "{\"nsAField\":\"1\"}"))
        : Flux.just(event("INFO", "{\"nsBField\":\"2\"}")));
    SchemaScanService service = serviceFor(src);

    SchemaScanResult a = service.scan("openshift", null, null).block();
    currentNamespace.set("namespace-b");
    SchemaScanResult b = service.scan("openshift", null, null).block();

    assertThat(a.scopeLabel()).isEqualTo("namespace-a");
    assertThat(b.scopeLabel()).isEqualTo("namespace-b");
    assertThat(a.discoveredSchema().stream().map(DiscoveredPathEntry::path)).containsExactly("nsAField");
    assertThat(b.discoveredSchema().stream().map(DiscoveredPathEntry::path)).containsExactly("nsBField");
  }

  @Test
  void projectChangeChangesActiveMappingAndReadiness() {
    // Mission §8/§9: PROJECT_CHANGE_RECALCULATES_READINESS.
    FieldMappingProfileService mappingService = new FieldMappingProfileService();
    MappingScopeKey projectA = MappingScopeKey.of("local-docker", "project-a");
    MappingScopeKey projectB = MappingScopeKey.of("local-docker", "project-b");

    mappingService.updateCandidates(projectA, CanonicalField.CIF, List.of(JsonPath.parse("cif")));

    assertThat(mappingService.isSearchReady(projectA)).isFalse();
    assertThat(mappingService.isSearchReady(projectB))
        .as("mission §7/§8: project B's own readiness is untouched by an edit to project A's")
        .isTrue();
    assertThat(mappingService.activeProfile(projectA).candidates(CanonicalField.CIF))
        .extracting(JsonPath::raw).containsExactly("cif");
    assertThat(mappingService.activeProfile(projectB).candidates(CanonicalField.CIF))
        .as("project B's own profile is the untouched default, unaffected by project A's edit")
        .extracting(JsonPath::raw).containsExactly("cif");
  }

  @Test
  void mappingSavedForProjectAIsNotSilentlyReusedForProjectB() {
    // Mission §7/§9: PROJECT_SCOPED_MAPPING_PROFILE.
    FieldMappingProfileService mappingService = new FieldMappingProfileService();
    MappingScopeKey projectA = MappingScopeKey.of("local-docker", "project-a");
    MappingScopeKey projectB = MappingScopeKey.of("local-docker", "project-b");

    mappingService.updateCandidates(projectA, CanonicalField.CIF, List.of(JsonPath.parse("mdc.cif"), JsonPath.parse("cif")));
    mappingService.confirmSave(projectA, true);

    assertThat(mappingService.activeProfile(projectA).candidates(CanonicalField.CIF))
        .extracting(JsonPath::raw).containsExactly("mdc.cif", "cif");
    assertThat(mappingService.activeProfile(projectB).candidates(CanonicalField.CIF))
        .as("project B's own mapping stays the untouched default - project A's save never leaked into it")
        .extracting(JsonPath::raw).containsExactly("cif");
  }

  @Test
  void mappedPathsNotObservedIsCrossReferencedAgainstTheScannedScopeOwnProfile_notAnotherScope() {
    // A saved mapping for a DIFFERENT project must never generate a
    // mappedPathsNotObserved warning against THIS scan's own scope.
    FieldMappingProfileService mappingService = new FieldMappingProfileService();
    MappingScopeKey otherProject = MappingScopeKey.of("local-docker", "other-project");
    mappingService.updateCandidates(otherProject, CanonicalField.CIF, List.of(JsonPath.parse("some.other.path")));
    mappingService.confirmSave(otherProject, true);

    StubLogSource src = source("local-docker", event("INFO", "{\"cif\":\"1\"}"));
    SchemaScanService scanService = serviceFor(mappingService, Clock.fixed(BASE, ZoneOffset.UTC), src);

    SchemaScanResult result = scanService.scan("local-docker", "boubyan-platform", null).block();

    assertThat(result.mappedPathsNotObserved())
        .as("a different project's own mapped-but-absent path must never leak into this scan's warnings")
        .doesNotContain("some.other.path");
  }
}
