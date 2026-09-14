package com.logexplorer.core.mapping;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Proves the built-in default profile reproduces {@code
 * core.parse.LogLineParser}'s previous hard-coded extraction exactly
 * (mission §11/§23) — every field, every literal path string.
 */
class DefaultFieldMappingProfileTest {

  private final FieldMappingProfile profile = DefaultFieldMappingProfile.build();

  @Test
  void hasExactlyOneCandidateForEveryFieldExceptCorrelationIdAndJourneyName() {
    for (CanonicalField field : CanonicalField.values()) {
      if (field == CanonicalField.CORRELATION_ID || field == CanonicalField.JOURNEY_NAME) {
        continue;
      }
      assertThat(profile.candidates(field)).as("candidates for " + field).hasSize(1);
    }
  }

  @Test
  void correlationIdHasExactlyTheOldTwoCandidatePrecedence() {
    assertThat(profile.candidates(CanonicalField.CORRELATION_ID))
        .extracting(JsonPath::raw)
        .containsExactly("mdc.X-Correlation-id", "mdc[\"event.correlationId\"]");
  }

  @Test
  void journeyNameHasNoDefaultCandidate_ownerConfirmationPending() {
    assertThat(profile.candidates(CanonicalField.JOURNEY_NAME)).isEmpty();
  }

  @Test
  void reproducesEveryOldHardCodedPathExactly() {
    assertOnePath(CanonicalField.TIMESTAMP, "@timestamp");
    assertOnePath(CanonicalField.SERVICE, "application");
    assertOnePath(CanonicalField.SEVERITY, "level");
    assertOnePath(CanonicalField.MESSAGE, "message");
    assertOnePath(CanonicalField.LOGGER, "logger_name");
    assertOnePath(CanonicalField.THREAD, "thread_name");
    assertOnePath(CanonicalField.EXCEPTION, "exception");

    assertOnePath(CanonicalField.CIF, "mdc.cif");
    assertOnePath(CanonicalField.USERNAME, "mdc.UserName");
    assertOnePath(CanonicalField.CUSTOMER_ID, "mdc.CustomerId");
    assertOnePath(CanonicalField.DEVICE_ID, "mdc.deviceId");
    assertOnePath(CanonicalField.DEVICE_IP, "mdc.deviceIp");

    assertOnePath(CanonicalField.TRACE_ID, "mdc.traceId");
    assertOnePath(CanonicalField.SPAN_ID, "mdc.spanId");
    assertOnePath(CanonicalField.JOURNEY_ID, "mdc.x-journey-trace-id");
    assertOnePath(CanonicalField.EVENT_ID, "mdc.eventId");

    assertOnePath(CanonicalField.BUSINESS_STEP, "mdc.stepName");
    assertOnePath(CanonicalField.UI_IDENTIFIER, "mdc.UIIdentifier");
    assertOnePath(CanonicalField.ERROR_CODE, "mdc.ERROR_CODE");

    assertOnePath(CanonicalField.DEVICE_PLATFORM_TYPE, "mdc.devicePlatformType");
    assertOnePath(CanonicalField.LANGUAGE, "mdc.language");
    assertOnePath(CanonicalField.SERVER_IP, "mdc.serverIp");
    assertOnePath(CanonicalField.SERVER_HOST, "mdc.serverHost");
  }

  private void assertOnePath(CanonicalField field, String expectedRawPath) {
    List<JsonPath> candidates = profile.candidates(field);
    assertThat(candidates).as(field.name()).hasSize(1);
    assertThat(candidates.get(0).raw()).as(field.name()).isEqualTo(expectedRawPath);
  }
}
