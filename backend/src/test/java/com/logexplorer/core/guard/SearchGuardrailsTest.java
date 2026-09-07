package com.logexplorer.core.guard;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.logexplorer.config.SearchGuardrailsProperties;
import com.logexplorer.core.model.SearchRequest;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.Test;

class SearchGuardrailsTest {

  private final SearchGuardrailsProperties properties = new SearchGuardrailsProperties();
  private final SearchGuardrails guardrails = new SearchGuardrails(properties);

  private SearchRequest.Builder baseRequest() {
    Instant now = Instant.parse("2026-01-01T12:00:00Z");
    return SearchRequest.builder()
        .sourceId("local-docker")
        .start(now.minusSeconds(3600))
        .end(now);
  }

  @Test
  void missingStartIsRejected() {
    SearchRequest request = baseRequest().start(null).build();
    assertThatThrownBy(() -> guardrails.validate(request))
        .isInstanceOf(GuardrailViolationException.class)
        .satisfies(e -> assertThat(((GuardrailViolationException) e).reason())
            .isEqualTo(GuardrailViolationException.Reason.MISSING_RANGE));
  }

  @Test
  void missingEndIsRejected() {
    SearchRequest request = baseRequest().end(null).build();
    assertThatThrownBy(() -> guardrails.validate(request))
        .isInstanceOf(GuardrailViolationException.class)
        .satisfies(e -> assertThat(((GuardrailViolationException) e).reason())
            .isEqualTo(GuardrailViolationException.Reason.MISSING_RANGE));
  }

  @Test
  void startEqualToEndIsRejected() {
    Instant t = Instant.parse("2026-01-01T12:00:00Z");
    SearchRequest request = baseRequest().start(t).end(t).build();
    assertThatThrownBy(() -> guardrails.validate(request))
        .isInstanceOf(GuardrailViolationException.class)
        .satisfies(e -> assertThat(((GuardrailViolationException) e).reason())
            .isEqualTo(GuardrailViolationException.Reason.INVALID_RANGE));
  }

  @Test
  void startAfterEndIsRejected() {
    Instant t = Instant.parse("2026-01-01T12:00:00Z");
    SearchRequest request = baseRequest().start(t).end(t.minusSeconds(60)).build();
    assertThatThrownBy(() -> guardrails.validate(request))
        .isInstanceOf(GuardrailViolationException.class)
        .satisfies(e -> assertThat(((GuardrailViolationException) e).reason())
            .isEqualTo(GuardrailViolationException.Reason.INVALID_RANGE));
  }

  @Test
  void rangeWiderThanConfiguredMaxIsRejected() {
    properties.setMaxTimeRange(Duration.ofMinutes(30));
    SearchRequest request = baseRequest().build(); // 1 hour range
    assertThatThrownBy(() -> guardrails.validate(request))
        .isInstanceOf(GuardrailViolationException.class)
        .satisfies(e -> assertThat(((GuardrailViolationException) e).reason())
            .isEqualTo(GuardrailViolationException.Reason.MAX_RANGE_EXCEEDED));
  }

  @Test
  void perSourceMaxTimeRangeOverridesTheDefaultAndIsEnforced() {
    properties.setMaxTimeRange(Duration.ofDays(7)); // generous default
    properties.setPerSourceMaxTimeRange(Map.of("local-docker", Duration.ofMinutes(10)));
    SearchRequest request = baseRequest().build(); // 1 hour range, exceeds the 10-minute override
    assertThatThrownBy(() -> guardrails.validate(request))
        .isInstanceOf(GuardrailViolationException.class)
        .satisfies(e -> assertThat(((GuardrailViolationException) e).reason())
            .isEqualTo(GuardrailViolationException.Reason.MAX_RANGE_EXCEEDED));
  }

  @Test
  void perSourceMaxTimeRangeCanBeMorePermissiveThanTheDefault() {
    properties.setMaxTimeRange(Duration.ofMinutes(1)); // tight default
    properties.setPerSourceMaxTimeRange(Map.of("local-docker", Duration.ofDays(1)));
    SearchRequest request = baseRequest().build(); // 1 hour range, fine under the override
    ValidatedSearch validated = guardrails.validate(request);
    assertThat(validated).isNotNull();
  }

  @Test
  void negativeOrZeroLimitIsRejected() {
    SearchRequest request = baseRequest().limit(0).build();
    assertThatThrownBy(() -> guardrails.validate(request))
        .isInstanceOf(GuardrailViolationException.class)
        .satisfies(e -> assertThat(((GuardrailViolationException) e).reason())
            .isEqualTo(GuardrailViolationException.Reason.INVALID_LIMIT));
  }

  @Test
  void nullLimitUsesTheConfiguredDefault() {
    properties.setDefaultLimit(150);
    SearchRequest request = baseRequest().limit(null).build();
    ValidatedSearch validated = guardrails.validate(request);
    assertThat(validated.effectiveLimit()).isEqualTo(150);
  }

  @Test
  void limitAboveConfiguredMaxIsClampedNotRejected() {
    properties.setMaxLimit(500);
    SearchRequest request = baseRequest().limit(999_999).build();
    ValidatedSearch validated = guardrails.validate(request);
    assertThat(validated.effectiveLimit()).isEqualTo(500);
  }

  @Test
  void limitWithinBoundsIsUsedAsRequested() {
    properties.setMaxLimit(500);
    SearchRequest request = baseRequest().limit(42).build();
    ValidatedSearch validated = guardrails.validate(request);
    assertThat(validated.effectiveLimit()).isEqualTo(42);
  }

  @Test
  void validatedTimeoutComesFromConfiguration() {
    properties.setRequestTimeout(Duration.ofSeconds(7));
    SearchRequest request = baseRequest().build();
    ValidatedSearch validated = guardrails.validate(request);
    assertThat(validated.timeout()).isEqualTo(Duration.ofSeconds(7));
  }
}
