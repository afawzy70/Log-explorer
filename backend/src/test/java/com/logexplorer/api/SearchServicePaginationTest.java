package com.logexplorer.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.logexplorer.config.SearchGuardrailsProperties;
import com.logexplorer.config.SourcesProperties;
import com.logexplorer.core.guard.ConcurrencyGuard;
import com.logexplorer.core.guard.GuardrailViolationException;
import com.logexplorer.core.guard.SearchGuardrails;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.SearchRequest;
import com.logexplorer.core.model.SearchResult;
import com.logexplorer.core.search.PageCursorCodec;
import com.logexplorer.source.LogSourceRegistry;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;
import reactor.test.StepVerifier;

/**
 * Legacy Remediation Slice 1 — pagination correctness proofs for {@link
 * SearchService}, against a real (not stubbed-away) {@code EventFilters}
 * evaluation via {@link InMemoryFilteringLogSource}. Docker- and
 * Loki-specific multi-page traversal (against those adapters' own real,
 * mocked I/O) live in {@code DockerLogSourceTest}/{@code LokiLogSourceTest}
 * instead — this class is about the pagination *algorithm* itself, tested
 * with exact control over event timestamps.
 */
class SearchServicePaginationTest {

  private static final Instant T0 = Instant.parse("2026-01-01T12:00:00.000Z");
  private final SearchGuardrailsProperties properties = new SearchGuardrailsProperties();

  private SearchService serviceFor(String sourceId, List<CanonicalLogEvent> corpus) {
    InMemoryFilteringLogSource source = new InMemoryFilteringLogSource(sourceId, corpus);
    SearchGuardrails guardrails = new SearchGuardrails(properties);
    ConcurrencyGuard concurrencyGuard = new ConcurrencyGuard(properties);
    LogSourceRegistry registry = new LogSourceRegistry(List.of(source), new SourcesProperties());
    return new SearchService(registry, guardrails, concurrencyGuard, new PageCursorCodec(new ObjectMapper()));
  }

  /** Canonical (application/display) timestamp and source-native timestamp are the same value by default - see {@link #eventWithDivergentTimestamps} for the case where they differ. */
  private CanonicalLogEvent event(Instant timestamp, String message) {
    return CanonicalLogEvent.builder().timestamp(timestamp).sourceTimestamp(timestamp).message(message).service("gateway").build();
  }

  /**
   * Legacy Remediation Slice 1 recovery, mandatory blocker #1: the parsed
   * application timestamp and the source-native pagination position are
   * deliberately different values - pagination must follow {@code
   * sourceTimestamp} exclusively, never {@code timestamp}.
   */
  private CanonicalLogEvent eventWithDivergentTimestamps(Instant canonicalTimestamp, Instant sourceTimestamp, String message) {
    return CanonicalLogEvent.builder()
        .timestamp(canonicalTimestamp).sourceTimestamp(sourceTimestamp).message(message).service("gateway").build();
  }

  private SearchRequest.Builder baseRequest(String sourceId) {
    return SearchRequest.builder().sourceId(sourceId).start(T0.minusSeconds(3600)).end(T0.plusSeconds(3600));
  }

  @Test
  void multiPageTraversalVisitsEveryEventExactlyOnceWithNoSkipsOrDuplicatesThenExhausts() {
    List<CanonicalLogEvent> corpus = IntStream.range(0, 25)
        .mapToObj(i -> event(T0.minusSeconds(i), "event-" + i))
        .toList();
    properties.setDefaultLimit(7);
    SearchService service = serviceFor("many-events", corpus);

    Set<String> seenMessages = new HashSet<>();
    List<Integer> pageSizes = new ArrayList<>();
    String cursor = null;
    int guardAgainstInfiniteLoop = 0;
    do {
      SearchRequest request = baseRequest("many-events").cursor(cursor).build();
      SearchResult result = service.search(request).block();
      assertThat(result).isNotNull();
      for (CanonicalLogEvent e : result.events()) {
        boolean firstTimeSeen = seenMessages.add(e.message());
        assertThat(firstTimeSeen).as("event %s must never be returned twice across pages", e.message()).isTrue();
      }
      pageSizes.add(result.events().size());
      cursor = result.nextCursor();
      guardAgainstInfiniteLoop++;
      assertThat(guardAgainstInfiniteLoop).as("pagination must terminate, not loop forever").isLessThan(20);
    } while (cursor != null);

    assertThat(seenMessages).hasSize(25);
    assertThat(pageSizes).containsExactly(7, 7, 7, 4);
  }

  @Test
  void identicalTimestampsAtAPageBoundaryAreNeverSkippedOrDuplicated() {
    // Five events tied at exactly T0, then three older events each with a
    // distinct timestamp - deliberately arranged so a page boundary must
    // land inside the tied group (mandatory architecture correction #3).
    List<CanonicalLogEvent> corpus = List.of(
        event(T0, "a"), event(T0, "b"), event(T0, "c"), event(T0, "d"), event(T0, "e"),
        event(T0.minusSeconds(1), "f"), event(T0.minusSeconds(2), "g"), event(T0.minusSeconds(3), "h"));
    properties.setDefaultLimit(3);
    SearchService service = serviceFor("boundary-source", corpus);

    SearchResult page1 = service.search(baseRequest("boundary-source").build()).block();
    assertThat(page1.events()).extracting(CanonicalLogEvent::message).containsExactly("a", "b", "c");
    assertThat(page1.counts().truncated()).isTrue();
    assertThat(page1.nextCursor()).isNotNull();

    SearchResult page2 = service.search(baseRequest("boundary-source").cursor(page1.nextCursor()).build()).block();
    assertThat(page2.events()).extracting(CanonicalLogEvent::message).containsExactly("d", "e", "f");
    assertThat(page2.nextCursor()).isNotNull();

    SearchResult page3 = service.search(baseRequest("boundary-source").cursor(page2.nextCursor()).build()).block();
    assertThat(page3.events()).extracting(CanonicalLogEvent::message).containsExactly("g", "h");
    assertThat(page3.counts().truncated()).isFalse();
    assertThat(page3.nextCursor()).isNull();

    List<String> allMessages = new ArrayList<>();
    page1.events().forEach(e -> allMessages.add(e.message()));
    page2.events().forEach(e -> allMessages.add(e.message()));
    page3.events().forEach(e -> allMessages.add(e.message()));
    assertThat(allMessages).containsExactlyInAnyOrder("a", "b", "c", "d", "e", "f", "g", "h");
    assertThat(new HashSet<>(allMessages)).hasSize(8);
  }

  /**
   * Legacy Remediation Slice 1 recovery, mandatory blocker #1's core
   * promise: pagination continuation must follow {@code sourceTimestamp}
   * (the source-native clock) exclusively, never {@code timestamp} (the
   * parsed application timestamp) - deliberately constructed so the two
   * disagree about ordering. If SearchService accidentally used {@code
   * timestamp} anywhere in its pagination logic, this would fail (wrong
   * page contents or a wrong/impossible boundary).
   */
  @Test
  void paginationFollowsSourceNativeTimestampEvenWhenTheApplicationTimestampDisagreesAboutOrder() {
    // Canonical timestamps ascend a->e (as if the JSON content were
    // written out of order / backdated); source-native timestamps
    // descend a->e (the true receive order) - deliberately inverted.
    List<CanonicalLogEvent> corpus = List.of(
        eventWithDivergentTimestamps(T0.minusSeconds(100), T0, "a"),
        eventWithDivergentTimestamps(T0.minusSeconds(99), T0.minusSeconds(1), "b"),
        eventWithDivergentTimestamps(T0.minusSeconds(98), T0.minusSeconds(2), "c"),
        eventWithDivergentTimestamps(T0.minusSeconds(97), T0.minusSeconds(3), "d"),
        eventWithDivergentTimestamps(T0.minusSeconds(96), T0.minusSeconds(4), "e"));
    properties.setDefaultLimit(2);
    SearchService service = serviceFor("divergent-source", corpus);

    SearchResult page1 = service.search(baseRequest("divergent-source").build()).block();
    // Newest-first BY SOURCE-NATIVE TIME is a,b - not e,d (which would be
    // newest-first by the application timestamp instead).
    assertThat(page1.events()).extracting(CanonicalLogEvent::message).containsExactly("a", "b");

    SearchResult page2 = service.search(baseRequest("divergent-source").cursor(page1.nextCursor()).build()).block();
    assertThat(page2.events()).extracting(CanonicalLogEvent::message).containsExactly("c", "d");

    SearchResult page3 = service.search(baseRequest("divergent-source").cursor(page2.nextCursor()).build()).block();
    assertThat(page3.events()).extracting(CanonicalLogEvent::message).containsExactly("e");
    assertThat(page3.nextCursor()).isNull();
  }

  @Test
  void forwardDirectionPaginationAdvancesTowardNewerEventsAndNeverSkipsOrDuplicates() {
    // Legacy Remediation Slice 1 recovery, mandatory blocker #2: FORWARD
    // must move the boundary toward *newer* source-native timestamps, the
    // mirror image of BACKWARD - never silently treated as BACKWARD.
    List<CanonicalLogEvent> corpus = IntStream.range(0, 11)
        .mapToObj(i -> event(T0.minusSeconds(10 - i), "event-" + i)) // event-0 oldest .. event-10 newest
        .toList();
    properties.setDefaultLimit(4);
    SearchService service = serviceFor("forward-source", corpus);
    SearchRequest.Builder request = baseRequest("forward-source").direction(SearchRequest.Direction.FORWARD);

    SearchResult page1 = service.search(request.build()).block();
    assertThat(page1.events()).extracting(CanonicalLogEvent::message)
        .containsExactly("event-0", "event-1", "event-2", "event-3");
    assertThat(page1.nextCursor()).isNotNull();

    SearchResult page2 = service.search(request.cursor(page1.nextCursor()).build()).block();
    assertThat(page2.events()).extracting(CanonicalLogEvent::message)
        .containsExactly("event-4", "event-5", "event-6", "event-7");

    SearchResult page3 = service.search(request.cursor(page2.nextCursor()).build()).block();
    assertThat(page3.events()).extracting(CanonicalLogEvent::message)
        .containsExactly("event-8", "event-9", "event-10");
    assertThat(page3.counts().truncated()).isFalse();
    assertThat(page3.nextCursor()).isNull();
  }

  @Test
  void forwardDirectionHandlesTiedSourceTimestampsAtAPageBoundaryWithNoSkipOrDuplicate() {
    List<CanonicalLogEvent> corpus = List.of(
        event(T0.minusSeconds(3), "a"), event(T0.minusSeconds(2), "b"),
        event(T0, "c"), event(T0, "d"), event(T0, "e"), event(T0, "f"), event(T0, "g"));
    properties.setDefaultLimit(3);
    SearchService service = serviceFor("forward-tie-source", corpus);
    SearchRequest.Builder request = baseRequest("forward-tie-source").direction(SearchRequest.Direction.FORWARD);

    SearchResult page1 = service.search(request.build()).block();
    assertThat(page1.events()).extracting(CanonicalLogEvent::message).containsExactly("a", "b", "c");

    SearchResult page2 = service.search(request.cursor(page1.nextCursor()).build()).block();
    assertThat(page2.events()).extracting(CanonicalLogEvent::message).containsExactly("d", "e", "f");

    SearchResult page3 = service.search(request.cursor(page2.nextCursor()).build()).block();
    assertThat(page3.events()).extracting(CanonicalLogEvent::message).containsExactly("g");
    assertThat(page3.nextCursor()).isNull();

    List<String> all = new ArrayList<>();
    page1.events().forEach(e -> all.add(e.message()));
    page2.events().forEach(e -> all.add(e.message()));
    page3.events().forEach(e -> all.add(e.message()));
    assertThat(all).containsExactly("a", "b", "c", "d", "e", "f", "g");
  }

  @Test
  void aCursorIssuedForOneDirectionIsRejectedWhenReplayedWithTheOppositeDirection() {
    // Mandatory blocker #2's own binding requirement: direction is part
    // of "what this search means" - a BACKWARD cursor must not be usable
    // to continue a FORWARD search or vice versa.
    List<CanonicalLogEvent> corpus = IntStream.range(0, 5)
        .mapToObj(i -> event(T0.minusSeconds(i), "event-" + i))
        .toList();
    properties.setDefaultLimit(2);
    SearchService service = serviceFor("direction-rebind-source", corpus);

    SearchResult backwardPage1 = service.search(
        baseRequest("direction-rebind-source").direction(SearchRequest.Direction.BACKWARD).build()).block();
    assertThat(backwardPage1.nextCursor()).isNotNull();

    SearchRequest flippedDirection = baseRequest("direction-rebind-source")
        .direction(SearchRequest.Direction.FORWARD)
        .cursor(backwardPage1.nextCursor())
        .build();
    assertThatThrownBy(() -> service.search(flippedDirection).block())
        .isInstanceOf(GuardrailViolationException.class)
        .satisfies(e -> assertThat(((GuardrailViolationException) e).reason())
            .isEqualTo(GuardrailViolationException.Reason.INVALID_CURSOR));
  }

  /**
   * A real edge case found via this slice's own live-Docker verification
   * (containers whose log lines don't parse to the expected schema, so
   * every returned event is a malformed fallback with no parsed
   * application timestamp - see {@code docs/verification/LEGACY_REMEDIATION_SLICE_1_REPORT.md}):
   * before mandatory blocker #1's fix, that also meant no *source-native*
   * timestamp was tracked at all, so no safe cursor boundary could be
   * derived even though Docker itself always knows a receive time. This
   * test now covers the residual, genuinely-defensive-only case: an event
   * with no source-native timestamp either (should never happen for any
   * real adapter after this recovery, since every one of them always sets
   * it - see {@code DockerLogSourceTest}/{@code LokiLogSourceTest} for the
   * proof that malformed/plain-text lines are now pageable via the native
   * clock). When every event on a page still has no source-native
   * timestamp, no safe cursor boundary exists (so {@code nextCursor} is
   * honestly {@code null}), but more matching events genuinely remain
   * beyond the page limit - {@code truncated} must still say so, and
   * {@code estimatedTotal} must never claim the page was the complete,
   * exact total.
   */
  @Test
  void aPageOfEntirelySourceTimestamplessEventsReportsTruncatedHonestlyEvenThoughNoCursorCanBeOffered() {
    List<CanonicalLogEvent> corpus = IntStream.range(0, 5)
        .mapToObj(i -> event(null, "malformed-" + i))
        .toList();
    properties.setDefaultLimit(3);
    SearchService service = serviceFor("all-malformed-source", corpus);

    SearchResult result = service.search(baseRequest("all-malformed-source").build()).block();

    assertThat(result.events()).hasSize(3);
    assertThat(result.nextCursor())
        .as("no safe boundary can be derived from timestampless events")
        .isNull();
    assertThat(result.counts().truncated())
        .as("2 more matching events exist beyond the page limit - this must never be reported as complete")
        .isTrue();
    assertThat(result.counts().estimatedTotal())
        .as("the true total (5) is not knowable from a 3-event page - must never be reported as page.size()=3")
        .isNull();
  }

  @Test
  void estimatedTotalIsExactWhenTheFirstPageIsNotTruncated() {
    List<CanonicalLogEvent> corpus = List.of(event(T0, "a"), event(T0.minusSeconds(1), "b"));
    properties.setDefaultLimit(50);
    SearchService service = serviceFor("small-source", corpus);

    SearchResult result = service.search(baseRequest("small-source").build()).block();
    assertThat(result.counts().truncated()).isFalse();
    assertThat(result.counts().estimatedTotal()).isEqualTo(2);
    assertThat(result.nextCursor()).isNull();
  }

  @Test
  void estimatedTotalIsUnknownWhenTheFirstPageIsTruncated() {
    List<CanonicalLogEvent> corpus = IntStream.range(0, 10)
        .mapToObj(i -> event(T0.minusSeconds(i), "event-" + i))
        .toList();
    properties.setDefaultLimit(3);
    SearchService service = serviceFor("truncated-source", corpus);

    SearchResult result = service.search(baseRequest("truncated-source").build()).block();
    assertThat(result.counts().truncated()).isTrue();
    assertThat(result.counts().estimatedTotal()).isNull();
  }

  @Test
  void estimatedTotalStaysUnknownOnEveryContinuationPageEvenTheLastOne() {
    List<CanonicalLogEvent> corpus = IntStream.range(0, 5)
        .mapToObj(i -> event(T0.minusSeconds(i), "event-" + i))
        .toList();
    properties.setDefaultLimit(3);
    SearchService service = serviceFor("two-page-source", corpus);

    SearchResult page1 = service.search(baseRequest("two-page-source").build()).block();
    assertThat(page1.counts().estimatedTotal()).isNull(); // truncated (5 > 3)

    SearchResult page2 = service.search(baseRequest("two-page-source").cursor(page1.nextCursor()).build()).block();
    assertThat(page2.events()).hasSize(2);
    assertThat(page2.counts().truncated()).isFalse(); // this is genuinely the last page
    assertThat(page2.counts().estimatedTotal())
        .as("a continuation page never reports a fabricated/partial total, even when it is the last page")
        .isNull();
  }

  @Test
  void aCursorFromOneSearchIsRejectedWhenReplayedAgainstAWidenedFilterSet() {
    List<CanonicalLogEvent> corpus = IntStream.range(0, 5)
        .mapToObj(i -> event(T0.minusSeconds(i), "event-" + i))
        .toList();
    properties.setDefaultLimit(2);
    SearchService service = serviceFor("rebind-source", corpus);

    SearchResult page1 = service.search(
        baseRequest("rebind-source").services(List.of("gateway")).build()).block();
    assertThat(page1.nextCursor()).isNotNull();

    SearchRequest widened = baseRequest("rebind-source")
        .services(List.of()) // dropping the service filter widens the search
        .cursor(page1.nextCursor())
        .build();
    StepVerifier.create(service.search(widened))
        .expectErrorSatisfies(e -> {
          assertThat(e).isInstanceOf(GuardrailViolationException.class);
          assertThat(((GuardrailViolationException) e).reason())
              .isEqualTo(GuardrailViolationException.Reason.INVALID_CURSOR);
        })
        .verify(java.time.Duration.ofSeconds(2));
  }

  @Test
  void aMalformedCursorNeverSilentlyFallsBackToPage1() {
    List<CanonicalLogEvent> corpus = List.of(event(T0, "a"));
    SearchService service = serviceFor("malformed-cursor-source", corpus);

    SearchRequest request = baseRequest("malformed-cursor-source").cursor("not-a-real-cursor").build();
    assertThatThrownBy(() -> service.search(request).block())
        .isInstanceOf(GuardrailViolationException.class);
  }

  @Test
  void aFreshSearchWithNoCursorAlwaysStartsFromPage1RegardlessOfAnyPriorPagination() {
    // "Refresh" (Slice 1) is exactly this: build a request with no cursor -
    // SearchService is stateless, so this must return page 1 identically
    // whether or not the caller had previously paged deeper into the
    // same search.
    List<CanonicalLogEvent> corpus = IntStream.range(0, 10)
        .mapToObj(i -> event(T0.minusSeconds(i), "event-" + i))
        .toList();
    properties.setDefaultLimit(3);
    SearchService service = serviceFor("refresh-source", corpus);

    SearchResult page1 = service.search(baseRequest("refresh-source").build()).block();
    service.search(baseRequest("refresh-source").cursor(page1.nextCursor()).build()).block(); // page deeper

    SearchResult refreshed = service.search(baseRequest("refresh-source").build()).block();
    assertThat(refreshed.events()).extracting(CanonicalLogEvent::message)
        .containsExactlyElementsOf(page1.events().stream().map(CanonicalLogEvent::message).toList());
  }
}
