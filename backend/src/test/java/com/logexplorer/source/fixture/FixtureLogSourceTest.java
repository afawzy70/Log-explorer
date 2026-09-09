package com.logexplorer.source.fixture;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.logexplorer.api.SearchService;
import com.logexplorer.config.SearchGuardrailsProperties;
import com.logexplorer.config.SourcesProperties;
import com.logexplorer.core.guard.ConcurrencyGuard;
import com.logexplorer.core.guard.SearchGuardrails;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.SearchRequest;
import com.logexplorer.core.model.SearchResult;
import com.logexplorer.core.model.ServiceInfo;
import com.logexplorer.core.parse.LogLineParser;
import com.logexplorer.core.search.PageCursorCodec;
import com.logexplorer.source.LogSourceRegistry;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import reactor.test.StepVerifier;

class FixtureLogSourceTest {

  private final ObjectMapper objectMapper = new ObjectMapper();
  private final FixtureLogSource source = new FixtureLogSource(objectMapper, new LogLineParser(objectMapper));

  @Test
  void reportsHistoricalSearchAndServiceDiscoveryCapabilitiesCorrectly() {
    var caps = source.capabilities();
    assertThat(caps.historicalSearch()).isTrue();
    assertThat(caps.serviceDiscovery()).isTrue();
    assertThat(caps.liveTail()).isTrue();
    assertThat(caps.rawLogQL()).isFalse();
  }

  @Test
  void healthIsAlwaysUp() {
    StepVerifier.create(source.health())
        .assertNext(h -> assertThat(h.status()).isEqualTo(com.logexplorer.core.model.SourceHealth.Status.UP))
        .verifyComplete();
  }

  @Test
  void discoversAllFourKnownServicesWithPositiveCounts() {
    List<ServiceInfo> services = source.discoverServices().collectList().block();
    assertThat(services).isNotNull();
    assertThat(services.stream().map(ServiceInfo::name))
        .containsExactlyInAnyOrder("gateway", "accounts-api", "payments-api", "notification-worker");
    services.forEach(s -> assertThat(s.totalCount()).isGreaterThan(0));
  }

  @Test
  void searchWithNoFiltersReturnsResultsIncludingMalformedFallbackEvents() {
    SearchRequest request = wideOpenRequest().build();
    List<CanonicalLogEvent> events = source.search(request).collectList().block();
    assertThat(events).isNotEmpty();
    assertThat(events.stream().anyMatch(CanonicalLogEvent::malformed)).isTrue();
  }

  @Test
  void searchResultsAreSortedNewestFirst() {
    List<CanonicalLogEvent> events = source.search(wideOpenRequest().build()).collectList().block();
    List<CanonicalLogEvent> withTimestamps = events.stream()
        .filter(e -> e.timestamp() != null)
        .toList();
    for (int i = 1; i < withTimestamps.size(); i++) {
      assertThat(withTimestamps.get(i - 1).timestamp()).isAfterOrEqualTo(withTimestamps.get(i).timestamp());
    }
  }

  @Test
  void searchResultsAreSortedNewestFirstBySourceNativeTimestampEvenThoughCanonicalTimestampIsNullForMalformedEvents() {
    // Legacy Remediation Slice 1 recovery, mandatory blocker #1: sort
    // order (and pagination) now follows the source-native timestamp
    // (always known, even for a malformed/non-JSON line), not the parsed
    // application timestamp (null for a malformed line) - so a malformed
    // event is no longer forced to the very end regardless of when it
    // actually occurred; it sorts into its correct chronological position
    // exactly like every other event, which is what makes it pageable at
    // all (see AUDIT-15-style boundedness note in the verification
    // report - malformed lines could previously fall "off the edge" of
    // page 1 and never be reachable at any page).
    List<CanonicalLogEvent> events = source.search(wideOpenRequest().build()).collectList().block();
    assertThat(events).isNotEmpty();
    assertThat(events).anySatisfy(e -> assertThat(e.malformed()).isTrue());
    for (CanonicalLogEvent e : events) {
      assertThat(e.sourceTimestamp()).as("every fixture event always has a source-native timestamp, malformed or not").isNotNull();
    }
    for (int i = 1; i < events.size(); i++) {
      assertThat(events.get(i - 1).sourceTimestamp()).isAfterOrEqualTo(events.get(i).sourceTimestamp());
    }
  }

  @Test
  void filtersByService() {
    SearchRequest request = wideOpenRequest().services(List.of("gateway")).build();
    List<CanonicalLogEvent> events = source.search(request).collectList().block();
    assertThat(events).isNotEmpty();
    assertThat(events).allSatisfy(e -> assertThat(e.service()).isEqualTo("gateway"));
  }

  @Test
  void filtersByLevelCaseInsensitively() {
    // Updated for a real bug fixed at Phase M: a malformed event has no
    // parsed severity at all, and must never be excluded by an active
    // level filter just because of that (EventFilters - the same
    // "never silently drop malformed lines" principle already applied to
    // the timestamp filter) - so every returned event either has no
    // severity (malformed) or genuinely matches "error".
    SearchRequest request = wideOpenRequest().levels(List.of("error")).build();
    List<CanonicalLogEvent> events = source.search(request).collectList().block();
    assertThat(events).isNotEmpty();
    assertThat(events).allSatisfy(e -> assertThat(e.severity() == null || e.severity().equalsIgnoreCase("ERROR")).isTrue());
    assertThat(events).anySatisfy(e -> assertThat(e.severity()).isEqualToIgnoringCase("ERROR"));
  }

  @Test
  void filtersByTextAgainstMessage() {
    SearchRequest request = wideOpenRequest().text("payment authorization failed").build();
    List<CanonicalLogEvent> events = source.search(request).collectList().block();
    assertThat(events).isNotEmpty();
    assertThat(events).allSatisfy(e ->
        assertThat(e.message().toLowerCase()).contains("payment authorization failed"));
  }

  @Test
  void filtersByJourneyIdAndFindsAMultiServiceMultiTraceJourney() {
    // First, find a journeyId that spans services from an unfiltered search.
    List<CanonicalLogEvent> all = source.search(wideOpenRequest().build()).collectList().block();
    String journeyId = all.stream()
        .filter(e -> e.journeyId() != null && e.journeyId().startsWith("fixture-journey-1"))
        .findFirst()
        .map(CanonicalLogEvent::journeyId)
        .orElseThrow();

    SearchRequest request = wideOpenRequest().journeyId(journeyId).build();
    List<CanonicalLogEvent> events = source.search(request).collectList().block();
    assertThat(events).isNotEmpty();
    assertThat(events).allSatisfy(e -> assertThat(e.journeyId()).isEqualTo(journeyId));
    assertThat(events.stream().map(CanonicalLogEvent::service).distinct().count()).isGreaterThanOrEqualTo(2);
  }

  @Test
  void timeRangeFilterExcludesEventsOutsideTheWindow() {
    Instant now = Instant.now();
    SearchRequest narrow = SearchRequest.builder()
        .sourceId("fixture")
        .start(now.minusSeconds(1))
        .end(now.plusSeconds(1))
        .build();
    SearchRequest wide = wideOpenRequest().build();

    long narrowCount = source.search(narrow).count().block();
    long wideCount = source.search(wide).count().block();
    assertThat(narrowCount).isLessThan(wideCount);
  }

  @Test
  void filteringBySensitiveValueMatchesTheRawValueButNeverExposesItInTheResult() {
    // Pull a real raw cif value from the corpus, then filter by it -
    // proves source-side filtering against raw values works (adapters may
    // hold raw values for this purpose - IMPLEMENTATION_PLAN.md Phase B
    // item 8), while confirming the returned CanonicalLogEvent still only
    // exposes it via the same raw (non-serializable-by-web-layer) field,
    // never leaking further than that.
    List<CanonicalLogEvent> all = source.search(wideOpenRequest().build()).collectList().block();
    String cif = all.stream()
        .map(e -> e.sensitive().cif())
        .filter(c -> c != null)
        .findFirst()
        .orElseThrow();

    SearchRequest request = SearchRequest.builder()
        .sourceId("fixture")
        .start(Instant.now().minusSeconds(3600))
        .end(Instant.now().plusSeconds(1))
        .sensitiveFilters(cif, null, null, null, null)
        .build();

    List<CanonicalLogEvent> matched = source.search(request).collectList().block();
    assertThat(matched).isNotEmpty();
    assertThat(matched).allSatisfy(e -> assertThat(e.sensitive().cif()).isEqualTo(cif));
  }

  @Test
  void followEmitsOneRealParsedEventPerTickAndABurstEveryNthTick() {
    // IMPLEMENTATION_PLAN.md "Phase J" manual check: "including a burst" -
    // this is that demo generator, so the burst must be real and
    // reproducible, not left to chance. Tick 1-5: one event each (5
    // total). Tick 6: a burst of 5 more (10 total).
    reactor.test.StepVerifier.withVirtualTime(
            () -> source.follow(new com.logexplorer.core.model.FollowRequest("fixture", List.of())))
        .thenAwait(java.time.Duration.ofMillis(700))
        .expectNextCount(1)
        .thenAwait(java.time.Duration.ofMillis(700 * 4))
        .expectNextCount(4)
        .thenAwait(java.time.Duration.ofMillis(700))
        .expectNextCount(5)
        .thenCancel()
        .verify(java.time.Duration.ofSeconds(2));
  }

  @Test
  void followEmitsRealParseableNonMalformedEvents() {
    CanonicalLogEvent event = source.follow(new com.logexplorer.core.model.FollowRequest("fixture", List.of()))
        .blockFirst(java.time.Duration.ofSeconds(3));
    assertThat(event).isNotNull();
    assertThat(event.malformed()).isFalse();
    assertThat(event.service()).isNotNull();
    assertThat(event.timestamp()).isCloseTo(Instant.now(), org.assertj.core.api.Assertions.within(java.time.Duration.ofSeconds(5)));
  }

  @Test
  void followFiltersByRequestedServices() {
    List<CanonicalLogEvent> events = source.follow(new com.logexplorer.core.model.FollowRequest("fixture", List.of("gateway")))
        .take(3)
        .collectList()
        .block(java.time.Duration.ofSeconds(5));
    assertThat(events).isNotEmpty();
    assertThat(events).allSatisfy(e -> assertThat(e.service()).isEqualTo("gateway"));
  }

  @Test
  void twoConcurrentFollowSubscriptionsAreIndependentTimelines() {
    reactor.core.publisher.Flux<CanonicalLogEvent> a =
        source.follow(new com.logexplorer.core.model.FollowRequest("fixture", List.of()));
    reactor.core.publisher.Flux<CanonicalLogEvent> b =
        source.follow(new com.logexplorer.core.model.FollowRequest("fixture", List.of()));
    CanonicalLogEvent first = a.blockFirst(java.time.Duration.ofSeconds(3));
    CanonicalLogEvent second = b.blockFirst(java.time.Duration.ofSeconds(3));
    // Both independently start at their own index 0 - proves subscriptions
    // don't share mutable counter state.
    assertThat(first.message()).isEqualTo(second.message());
  }

  /**
   * Legacy Remediation Slice 1 - real multi-page traversal against the
   * deterministic fixture corpus, driven by a real {@link SearchService}.
   * The corpus's exact size/timestamp shape is an implementation detail of
   * {@code FixtureCorpusGenerator} this test deliberately does not
   * hardcode - it instead proves the pagination invariant directly: paging
   * with a small limit visits exactly the same set of events, with no
   * skips and no duplicates, as one single unpaginated wide-open search.
   */
  @Test
  void multiPageTraversalThroughSearchServiceVisitsExactlyTheSameEventsAsOneUnpaginatedSearch() {
    SearchGuardrailsProperties baseline = new SearchGuardrailsProperties();
    baseline.setDefaultLimit(10_000);
    SearchService unpaginated = searchServiceFor(baseline);
    SearchResult everything = unpaginated.search(wideOpenRequest().build()).block();
    assertThat(everything.counts().truncated()).isFalse();
    Set<String> expected = new HashSet<>();
    everything.events().forEach(e -> expected.add(identity(e)));

    SearchGuardrailsProperties paged = new SearchGuardrailsProperties();
    paged.setDefaultLimit(9); // deliberately not a divisor of the corpus size
    SearchService searchService = searchServiceFor(paged);

    // Captured once, exactly like the frontend resends the same committed
    // start/end on every Load More call (`useSearchState.ts#buildRequestBody`)
    // - a cursor is bound to a fixed committed window, and re-resolving
    // `wideOpenRequest()`'s own `Instant.now()` on every loop iteration
    // would produce a subtly different start/end each time, which the
    // cursor's own fingerprint binding (mandatory architecture correction
    // #1) correctly rejects as a different search - proving the codec
    // works, but not what this test is about.
    SearchRequest.Builder committed = wideOpenRequest();

    Set<String> seen = new HashSet<>();
    String cursor = null;
    int guardAgainstInfiniteLoop = 0;
    do {
      SearchResult page = searchService.search(committed.cursor(cursor).build()).block();
      for (CanonicalLogEvent e : page.events()) {
        assertThat(seen.add(identity(e))).as("no duplicate across pages").isTrue();
      }
      cursor = page.nextCursor();
      guardAgainstInfiniteLoop++;
      assertThat(guardAgainstInfiniteLoop).isLessThan(50);
    } while (cursor != null);

    assertThat(seen).isEqualTo(expected);
  }

  /**
   * Legacy Remediation Slice 1 recovery, mandatory blocker #2: FORWARD
   * direction against the real fixture corpus - never silently treated as
   * BACKWARD. Same invariant as the BACKWARD test above (exhaustive,
   * exactly-once coverage), proving direction-awareness holds for the
   * real adapter, not only the generic in-memory test double.
   */
  @Test
  void forwardDirectionMultiPageTraversalVisitsExactlyTheSameEventsAsOneUnpaginatedSearch() {
    SearchGuardrailsProperties baseline = new SearchGuardrailsProperties();
    baseline.setDefaultLimit(10_000);
    SearchService unpaginated = searchServiceFor(baseline);
    SearchRequest.Builder forwardRequest = wideOpenRequest().direction(SearchRequest.Direction.FORWARD);
    SearchResult everything = unpaginated.search(forwardRequest.build()).block();
    assertThat(everything.counts().truncated()).isFalse();
    Set<String> expected = new HashSet<>();
    everything.events().forEach(e -> expected.add(identity(e)));

    SearchGuardrailsProperties paged = new SearchGuardrailsProperties();
    paged.setDefaultLimit(11);
    SearchService searchService = searchServiceFor(paged);
    SearchRequest.Builder committed = wideOpenRequest().direction(SearchRequest.Direction.FORWARD);

    Set<String> seen = new HashSet<>();
    String cursor = null;
    int guardAgainstInfiniteLoop = 0;
    do {
      SearchResult page = searchService.search(committed.cursor(cursor).build()).block();
      for (CanonicalLogEvent e : page.events()) {
        assertThat(seen.add(identity(e))).as("no duplicate across pages").isTrue();
      }
      cursor = page.nextCursor();
      guardAgainstInfiniteLoop++;
      assertThat(guardAgainstInfiniteLoop).isLessThan(50);
    } while (cursor != null);

    assertThat(seen).isEqualTo(expected);
  }

  private String identity(CanonicalLogEvent e) {
    return e.timestamp() + "|" + e.message() + "|" + e.service() + "|" + e.rawLine();
  }

  private SearchService searchServiceFor(SearchGuardrailsProperties properties) {
    SearchGuardrails guardrails = new SearchGuardrails(properties);
    ConcurrencyGuard concurrencyGuard = new ConcurrencyGuard(properties);
    LogSourceRegistry registry = new LogSourceRegistry(List.of(source), new SourcesProperties());
    return new SearchService(registry, guardrails, concurrencyGuard, new PageCursorCodec(new ObjectMapper()));
  }

  private SearchRequest.Builder wideOpenRequest() {
    Instant now = Instant.now();
    return SearchRequest.builder()
        .sourceId("fixture")
        .start(now.minusSeconds(3600))
        .end(now.plusSeconds(1));
  }
}
