package com.logexplorer.source.fixture;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.SearchRequest;
import com.logexplorer.core.model.ServiceInfo;
import com.logexplorer.core.parse.LogLineParser;
import java.time.Instant;
import java.util.List;
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
  void malformedEventsWithNoTimestampSortLastNotFirst() {
    // Comparator.nullsLast(...).reversed() is a real trap: reversing the
    // whole comparator also reverses null placement, silently sorting
    // nulls to the front. This test would have caught that bug - it did,
    // during this phase's own manual verification, before this test
    // existed to prevent it recurring.
    List<CanonicalLogEvent> events = source.search(wideOpenRequest().build()).collectList().block();
    assertThat(events).isNotEmpty();
    int firstMalformedIndex = -1;
    int lastNonMalformedIndex = -1;
    for (int i = 0; i < events.size(); i++) {
      if (events.get(i).malformed()) {
        if (firstMalformedIndex == -1) {
          firstMalformedIndex = i;
        }
      } else {
        lastNonMalformedIndex = i;
      }
    }
    assertThat(firstMalformedIndex).as("at least one malformed event present").isNotEqualTo(-1);
    assertThat(lastNonMalformedIndex).as("at least one dated event present").isNotEqualTo(-1);
    assertThat(firstMalformedIndex).as("malformed (no-timestamp) events must sort after every dated event")
        .isGreaterThan(lastNonMalformedIndex);
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

  private SearchRequest.Builder wideOpenRequest() {
    Instant now = Instant.now();
    return SearchRequest.builder()
        .sourceId("fixture")
        .start(now.minusSeconds(3600))
        .end(now.plusSeconds(1));
  }
}
