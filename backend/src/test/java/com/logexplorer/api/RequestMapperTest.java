package com.logexplorer.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.logexplorer.api.dto.ContextRequestDto;
import com.logexplorer.api.dto.JourneyRequestDto;
import com.logexplorer.core.guard.GuardrailViolationException;
import com.logexplorer.core.model.SearchRequest;
import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.Test;

/**
 * {@link RequestMapper#toContextDomain} - "Show ±30 seconds" (HANDOVER.md
 * §16.7) builds a fixed, server-enforced window regardless of what a
 * caller might wish were different; there is no field on {@link
 * ContextRequestDto} that can widen it.
 */
class RequestMapperTest {

  private final RequestMapper mapper = new RequestMapper();

  private static final Instant TIMESTAMP = Instant.parse("2026-01-01T12:00:00Z");

  @Test
  void windowIsExactlyThirtySecondsOnEachSideOfTheTimestamp() {
    SearchRequest request = mapper.toContextDomain(new ContextRequestDto("local-docker", TIMESTAMP, null, null, null, null, null));

    assertThat(request.start()).isEqualTo(TIMESTAMP.minus(Duration.ofSeconds(30)));
    assertThat(request.end()).isEqualTo(TIMESTAMP.plus(Duration.ofSeconds(30)));
  }

  @Test
  void serviceIsCarriedAsASingleElementServicesFilterWhenPresent() {
    SearchRequest request = mapper.toContextDomain(new ContextRequestDto("local-docker", TIMESTAMP, "gateway", null, null, null, null));
    assertThat(request.services()).containsExactly("gateway");
  }

  @Test
  void aBlankOrMissingServiceProducesNoServiceFilterRatherThanAnEmptyStringFilter() {
    assertThat(mapper.toContextDomain(new ContextRequestDto("local-docker", TIMESTAMP, null, null, null, null, null)).services()).isEmpty();
    assertThat(mapper.toContextDomain(new ContextRequestDto("local-docker", TIMESTAMP, "  ", null, null, null, null)).services()).isEmpty();
  }

  @Test
  void containerIdAndPodAreCarriedThroughUnchanged() {
    SearchRequest request = mapper.toContextDomain(new ContextRequestDto("local-docker", TIMESTAMP, null, "c1", "pod-abc", null, null));
    assertThat(request.containerId()).isEqualTo("c1");
    assertThat(request.pod()).isEqualTo("pod-abc");
  }

  @Test
  void containerNameIsCarriedThroughUnchangedForOs1dOpenshiftNarrowContext() {
    SearchRequest request =
        mapper.toContextDomain(new ContextRequestDto("openshift", TIMESTAMP, null, null, "pod-abc", null, "app"));
    assertThat(request.pod()).isEqualTo("pod-abc");
    assertThat(request.containerName()).isEqualTo("app");
    assertThat(request.containerId()).isNull();
  }

  @Test
  void sourceIdIsCarriedThroughUnchanged() {
    SearchRequest request = mapper.toContextDomain(new ContextRequestDto("openshift-loki", TIMESTAMP, null, null, null, null, null));
    assertThat(request.sourceId()).isEqualTo("openshift-loki");
  }

  @Test
  void composeProjectIsCarriedThroughUnchangedForContextUxR3() {
    SearchRequest request = mapper.toContextDomain(new ContextRequestDto("local-docker", TIMESTAMP, null, null, null, "project-a", null));
    assertThat(request.composeProject()).isEqualTo("project-a");
  }

  private static final Instant START = Instant.parse("2026-01-01T00:00:00Z");
  private static final Instant END = Instant.parse("2026-01-02T00:00:00Z");

  @Test
  void journeyIdFieldMapsToTheJourneyIdFilterOnly() {
    SearchRequest request = mapper.toJourneyDomain(new JourneyRequestDto("local-docker", START, END, "journeyId", "j-1", null));
    assertThat(request.journeyId()).isEqualTo("j-1");
    assertThat(request.correlationId()).isNull();
    assertThat(request.traceId()).isNull();
    assertThat(request.eventId()).isNull();
  }

  @Test
  void correlationIdFieldMapsToTheCorrelationIdFilterOnly() {
    SearchRequest request = mapper.toJourneyDomain(new JourneyRequestDto("local-docker", START, END, "correlationId", "c-1", null));
    assertThat(request.correlationId()).isEqualTo("c-1");
    assertThat(request.journeyId()).isNull();
  }

  @Test
  void traceIdFieldMapsToTheTraceIdFilterOnly() {
    SearchRequest request = mapper.toJourneyDomain(new JourneyRequestDto("local-docker", START, END, "traceId", "t-1", null));
    assertThat(request.traceId()).isEqualTo("t-1");
    assertThat(request.journeyId()).isNull();
  }

  @Test
  void eventIdFieldMapsToTheEventIdFilterOnly() {
    SearchRequest request = mapper.toJourneyDomain(new JourneyRequestDto("local-docker", START, END, "eventId", "e-1", null));
    assertThat(request.eventId()).isEqualTo("e-1");
    assertThat(request.journeyId()).isNull();
  }

  @Test
  void sourceIdAndTimeRangeAreCarriedThroughUnchangedNeverWidened() {
    SearchRequest request = mapper.toJourneyDomain(new JourneyRequestDto("openshift-loki", START, END, "traceId", "t-1", null));
    assertThat(request.sourceId()).isEqualTo("openshift-loki");
    assertThat(request.start()).isEqualTo(START);
    assertThat(request.end()).isEqualTo(END);
  }

  @Test
  void composeProjectIsCarriedThroughUnchangedForJourneyUxR3() {
    SearchRequest request = mapper.toJourneyDomain(new JourneyRequestDto("local-docker", START, END, "traceId", "t-1", "project-b"));
    assertThat(request.composeProject()).isEqualTo("project-b");
  }

  @Test
  void anyFieldOutsideTheFourNonSensitiveIdentifiersIsRejected() {
    // The exact "never a raw customer-identifier click-search" guarantee
    // (CLAUDE.md §2 rule 1 / IMPLEMENTATION_PLAN.md "Phase I") - enforced
    // structurally, not just by convention: nothing else is even a legal
    // value for `field`.
    for (String sensitive : new String[] {"cif", "userName", "customerId", "deviceId", "deviceIp", "bogus"}) {
      assertThatThrownBy(() -> mapper.toJourneyDomain(new JourneyRequestDto("local-docker", START, END, sensitive, "x", null)))
          .isInstanceOf(GuardrailViolationException.class)
          .satisfies(e -> assertThat(((GuardrailViolationException) e).reason())
              .isEqualTo(GuardrailViolationException.Reason.INVALID_JOURNEY_FIELD));
    }
  }
}
