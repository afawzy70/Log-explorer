package com.logexplorer.core.search;

import static org.assertj.core.api.Assertions.assertThat;

import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.RawSensitiveFields;
import com.logexplorer.core.model.SearchRequest;
import com.logexplorer.core.query.ast.And;
import com.logexplorer.core.query.ast.Comparison;
import com.logexplorer.core.query.ast.Operator;
import com.logexplorer.core.query.ast.Or;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Direct unit tests for the shared predicate every {@code LogSource} search
 * uses. Includes the fields ({@code traceId}, {@code correlationId}, ...)
 * that {@code DockerLogSource} (Phase C) never actually filtered on before
 * this extraction — this is the coverage gap that let that bug ship.
 */
class EventFiltersTest {

  private CanonicalLogEvent.Builder baseEvent() {
    return CanonicalLogEvent.builder()
        .timestamp(Instant.parse("2026-01-01T12:00:00Z"))
        .service("gateway")
        .severity("INFO")
        .message("hello world")
        .logger("com.example.Gateway")
        .traceId("trace-1")
        .spanId("span-1")
        .correlationId("corr-1")
        .journeyId("journey-1")
        .eventId("event-1")
        .errorCode("ERR_1")
        .businessStep("step-1")
        .uiIdentifier("ui-1")
        .devicePlatformType("WEB")
        .language("en")
        .sensitive(new RawSensitiveFields("cif-1", "user-1", "cust-1", "dev-1", "1.2.3.4"));
  }

  private SearchRequest.Builder baseRequest() {
    Instant now = Instant.parse("2026-01-01T12:00:00Z");
    return SearchRequest.builder().sourceId("x").start(now.minusSeconds(3600)).end(now.plusSeconds(3600));
  }

  @Test
  void noFiltersMatchesEverything() {
    assertThat(EventFilters.matches(baseEvent().build(), baseRequest().build())).isTrue();
  }

  @Test
  void filtersByTraceId() {
    assertThat(EventFilters.matches(baseEvent().build(), baseRequest().traceId("trace-1").build())).isTrue();
    assertThat(EventFilters.matches(baseEvent().build(), baseRequest().traceId("other").build())).isFalse();
  }

  @Test
  void filtersByCorrelationId() {
    assertThat(EventFilters.matches(baseEvent().build(), baseRequest().correlationId("corr-1").build())).isTrue();
    assertThat(EventFilters.matches(baseEvent().build(), baseRequest().correlationId("other").build())).isFalse();
  }

  @Test
  void filtersByJourneyIdSpanIdEventIdErrorCodeBusinessStepUiIdentifier() {
    SearchRequest matching = baseRequest()
        .journeyId("journey-1").spanId("span-1").eventId("event-1")
        .errorCode("ERR_1").businessStep("step-1").uiIdentifier("ui-1").build();
    assertThat(EventFilters.matches(baseEvent().build(), matching)).isTrue();

    assertThat(EventFilters.matches(baseEvent().build(), baseRequest().journeyId("nope").build())).isFalse();
    assertThat(EventFilters.matches(baseEvent().build(), baseRequest().spanId("nope").build())).isFalse();
    assertThat(EventFilters.matches(baseEvent().build(), baseRequest().eventId("nope").build())).isFalse();
    assertThat(EventFilters.matches(baseEvent().build(), baseRequest().errorCode("nope").build())).isFalse();
    assertThat(EventFilters.matches(baseEvent().build(), baseRequest().businessStep("nope").build())).isFalse();
    assertThat(EventFilters.matches(baseEvent().build(), baseRequest().uiIdentifier("nope").build())).isFalse();
  }

  @Test
  void filtersByContainerIdAndPod() {
    // These two only ever arrive via api.SearchController's /context
    // endpoint (HANDOVER.md 16.7) - no UI-facing filter on the general
    // search sets them, but EventFilters itself is source-agnostic.
    CanonicalLogEvent scoped = baseEvent().containerId("c1").pod("pod-abc").build();
    assertThat(EventFilters.matches(scoped, baseRequest().containerId("c1").build())).isTrue();
    assertThat(EventFilters.matches(scoped, baseRequest().containerId("other").build())).isFalse();
    assertThat(EventFilters.matches(scoped, baseRequest().pod("pod-abc").build())).isTrue();
    assertThat(EventFilters.matches(scoped, baseRequest().pod("other").build())).isFalse();
  }

  @Test
  void filtersByDevicePlatformAndLanguage() {
    assertThat(EventFilters.matches(baseEvent().build(), baseRequest().devicePlatform("WEB").build())).isTrue();
    assertThat(EventFilters.matches(baseEvent().build(), baseRequest().devicePlatform("IOS").build())).isFalse();
    assertThat(EventFilters.matches(baseEvent().build(), baseRequest().language("en").build())).isTrue();
    assertThat(EventFilters.matches(baseEvent().build(), baseRequest().language("ar").build())).isFalse();
  }

  @Test
  void filtersByServiceAndLevelCaseInsensitively() {
    assertThat(EventFilters.matches(baseEvent().build(), baseRequest().services(List.of("gateway")).build())).isTrue();
    assertThat(EventFilters.matches(baseEvent().build(), baseRequest().services(List.of("other")).build())).isFalse();
    assertThat(EventFilters.matches(baseEvent().build(), baseRequest().levels(List.of("info")).build())).isTrue();
    assertThat(EventFilters.matches(baseEvent().build(), baseRequest().levels(List.of("error")).build())).isFalse();
  }

  @Test
  void filtersByTextAgainstMessageCaseInsensitively() {
    assertThat(EventFilters.matches(baseEvent().build(), baseRequest().text("HELLO").build())).isTrue();
    assertThat(EventFilters.matches(baseEvent().build(), baseRequest().text("nope").build())).isFalse();
  }

  @Test
  void filtersBySensitiveRawValues() {
    SearchRequest request = baseRequest().sensitiveFilters("cif-1", null, null, null, null).build();
    assertThat(EventFilters.matches(baseEvent().build(), request)).isTrue();
    SearchRequest mismatch = baseRequest().sensitiveFilters("wrong-cif", null, null, null, null).build();
    assertThat(EventFilters.matches(baseEvent().build(), mismatch)).isFalse();
  }

  @Test
  void timeRangeExcludesEventsOutsideTheWindow() {
    CanonicalLogEvent event = baseEvent().timestamp(Instant.parse("2026-01-01T00:00:00Z")).build();
    SearchRequest narrowElsewhere = SearchRequest.builder()
        .sourceId("x")
        .start(Instant.parse("2026-06-01T00:00:00Z"))
        .end(Instant.parse("2026-06-02T00:00:00Z"))
        .build();
    assertThat(EventFilters.matches(event, narrowElsewhere)).isFalse();
  }

  @Test
  void malformedEventsWithNoTimestampAreExemptFromTimeRangeFiltering() {
    CanonicalLogEvent malformed = CanonicalLogEvent.builder().malformed(true).rawLine("garbage").build();
    SearchRequest anyRange = SearchRequest.builder()
        .sourceId("x")
        .start(Instant.parse("2026-06-01T00:00:00Z"))
        .end(Instant.parse("2026-06-02T00:00:00Z"))
        .build();
    assertThat(EventFilters.matches(malformed, anyRange)).isTrue();
  }

  @Test
  void nullServiceDoesNotThrowWhenAServiceFilterIsActive() {
    CanonicalLogEvent noService = CanonicalLogEvent.builder().malformed(true).build();
    assertThat(EventFilters.matches(noService, baseRequest().services(List.of("gateway")).build())).isFalse();
  }

  @Test
  void loggerContainsFiltersAgainstTheLoggerFieldCaseInsensitively() {
    // Real bug found while touching this file for Phase E: loggerContains
    // arrives on SearchRequest/the DTO but was never actually checked here
    // - a previously-shipped no-op filter.
    assertThat(EventFilters.matches(baseEvent().build(), baseRequest().loggerContains("EXAMPLE").build())).isTrue();
    assertThat(EventFilters.matches(baseEvent().build(), baseRequest().loggerContains("nope").build())).isFalse();
  }

  @Test
  void loggerContainsIsExemptWhenTheEventHasNoLogger() {
    CanonicalLogEvent noLogger = CanonicalLogEvent.builder().malformed(true).build();
    assertThat(EventFilters.matches(noLogger, baseRequest().loggerContains("anything").build())).isFalse();
  }

  @Test
  void dslQueryIsAndedWithEveryStructuredFilter() {
    // HANDOVER.md §9: "Structured filters are ANDed with parsed expression."
    SearchRequest structuralMatchDslMatch = baseRequest()
        .services(List.of("gateway"))
        .query(new Comparison("level", Operator.EQ, "INFO"))
        .build();
    assertThat(EventFilters.matches(baseEvent().build(), structuralMatchDslMatch)).isTrue();

    SearchRequest structuralMatchDslMismatch = baseRequest()
        .services(List.of("gateway"))
        .query(new Comparison("level", Operator.EQ, "ERROR"))
        .build();
    assertThat(EventFilters.matches(baseEvent().build(), structuralMatchDslMismatch)).isFalse();

    SearchRequest structuralMismatchDslMatch = baseRequest()
        .services(List.of("other-service"))
        .query(new Comparison("level", Operator.EQ, "INFO"))
        .build();
    assertThat(EventFilters.matches(baseEvent().build(), structuralMismatchDslMatch)).isFalse();
  }

  @Test
  void dslQueryAloneFiltersWithNoStructuredFiltersSet() {
    SearchRequest matching = baseRequest().query(new Comparison("service", Operator.EQ, "gateway")).build();
    assertThat(EventFilters.matches(baseEvent().build(), matching)).isTrue();

    SearchRequest mismatch = baseRequest().query(new Comparison("service", Operator.EQ, "auth")).build();
    assertThat(EventFilters.matches(baseEvent().build(), mismatch)).isFalse();
  }

  @Test
  void dslOrAndCombinationsEvaluateCorrectlyThroughEventFilters() {
    SearchRequest orMatch = baseRequest()
        .query(new Or(new Comparison("service", Operator.EQ, "auth"), new Comparison("service", Operator.EQ, "gateway")))
        .build();
    assertThat(EventFilters.matches(baseEvent().build(), orMatch)).isTrue();

    SearchRequest andMismatch = baseRequest()
        .query(new And(new Comparison("service", Operator.EQ, "gateway"), new Comparison("level", Operator.EQ, "ERROR")))
        .build();
    assertThat(EventFilters.matches(baseEvent().build(), andMismatch)).isFalse();
  }

  /**
   * Predicate/planner equivalence (IMPLEMENTATION_PLAN.md "Phase E"
   * required automated test) is structural here, not incidental: {@code
   * EventFilters.matches} is the exact same call every adapter (fixture,
   * Docker, Loki) makes. This proves that adapter-specific enrichment
   * fields (Docker's {@code containerName}, Loki's {@code namespace}, ...)
   * never influence DSL evaluation - only the fields the DSL actually
   * names do, regardless of which source produced the event.
   */
  @Test
  void dslResultIsIdenticalRegardlessOfWhichAdaptersEnrichmentFieldsAreSet() {
    CanonicalLogEvent dockerShaped = baseEvent()
        .sourceId("local-docker").composeProject("demo").containerId("c1")
        .containerName("gateway-1").stream("stdout")
        .build();
    CanonicalLogEvent lokiShaped = baseEvent()
        .sourceId("openshift-loki").namespace("prod-ns").pod("gateway-abc123")
        .containerName("gateway").stream("stdout")
        .build();

    SearchRequest request = baseRequest()
        .query(new And(new Comparison("service", Operator.EQ, "gateway"), new Comparison("level", Operator.EQ, "INFO")))
        .build();

    assertThat(EventFilters.matches(dockerShaped, request)).isTrue();
    assertThat(EventFilters.matches(lokiShaped, request)).isTrue();
    assertThat(EventFilters.matches(dockerShaped, request))
        .isEqualTo(EventFilters.matches(lokiShaped, request));
  }
}
