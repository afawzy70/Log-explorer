package com.logexplorer.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.logexplorer.api.dto.ContextRequestDto;
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
    SearchRequest request = mapper.toContextDomain(new ContextRequestDto("local-docker", TIMESTAMP, null, null, null));

    assertThat(request.start()).isEqualTo(TIMESTAMP.minus(Duration.ofSeconds(30)));
    assertThat(request.end()).isEqualTo(TIMESTAMP.plus(Duration.ofSeconds(30)));
  }

  @Test
  void serviceIsCarriedAsASingleElementServicesFilterWhenPresent() {
    SearchRequest request = mapper.toContextDomain(new ContextRequestDto("local-docker", TIMESTAMP, "gateway", null, null));
    assertThat(request.services()).containsExactly("gateway");
  }

  @Test
  void aBlankOrMissingServiceProducesNoServiceFilterRatherThanAnEmptyStringFilter() {
    assertThat(mapper.toContextDomain(new ContextRequestDto("local-docker", TIMESTAMP, null, null, null)).services()).isEmpty();
    assertThat(mapper.toContextDomain(new ContextRequestDto("local-docker", TIMESTAMP, "  ", null, null)).services()).isEmpty();
  }

  @Test
  void containerIdAndPodAreCarriedThroughUnchanged() {
    SearchRequest request = mapper.toContextDomain(new ContextRequestDto("local-docker", TIMESTAMP, null, "c1", "pod-abc"));
    assertThat(request.containerId()).isEqualTo("c1");
    assertThat(request.pod()).isEqualTo("pod-abc");
  }

  @Test
  void sourceIdIsCarriedThroughUnchanged() {
    SearchRequest request = mapper.toContextDomain(new ContextRequestDto("openshift-loki", TIMESTAMP, null, null, null));
    assertThat(request.sourceId()).isEqualTo("openshift-loki");
  }
}
