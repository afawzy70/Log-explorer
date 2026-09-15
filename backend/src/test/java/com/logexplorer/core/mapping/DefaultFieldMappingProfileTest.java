package com.logexplorer.core.mapping;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Proves the built-in default profile matches the owner-approved table
 * EXACTLY (owner mission "Service Filter, Docker Performance, and Verified
 * Default Mapping" §C) — every field, every literal path string.
 *
 * <p><b>Supersedes</b> this class's own original version (CLAUDE.md §5
 * named conflict, applied), which instead proved the profile reproduced
 * {@code core.parse.LogLineParser}'s OLD hard-coded {@code mdc.&lt;key&gt;}
 * extraction. See {@link DefaultFieldMappingProfile}'s own javadoc for the
 * full rationale.
 */
class DefaultFieldMappingProfileTest {

  private final FieldMappingProfile profile = DefaultFieldMappingProfile.build();

  @Test
  void hasExactlyOneCandidateForEveryMappedField() {
    for (CanonicalField field : CanonicalField.values()) {
      if (field == CanonicalField.JOURNEY_ID || field == CanonicalField.UI_IDENTIFIER) {
        continue;
      }
      assertThat(profile.candidates(field)).as("candidates for " + field).hasSize(1);
    }
  }

  @Test
  void journeyIdHasNoDefaultCandidate_ownerDeclinedToGuess() {
    assertThat(profile.candidates(CanonicalField.JOURNEY_ID))
        .as("JOURNEY_ID_DEFAULT_MAPPING=NONE")
        .isEmpty();
  }

  @Test
  void uiIdentifierHasNoDefaultCandidate_ownerDeclinedToGuess() {
    assertThat(profile.candidates(CanonicalField.UI_IDENTIFIER))
        .as("UI_IDENTIFIER_DEFAULT_MAPPING=NONE")
        .isEmpty();
  }

  @Test
  void correlationIdHasExactlyTheOwnerApprovedSingleCandidate() {
    // Owner mission §C: no more second/literal-dotted-key fallback - the
    // owner's real source carries this at the top level under this exact key.
    assertThat(profile.candidates(CanonicalField.CORRELATION_ID))
        .extracting(JsonPath::raw)
        .containsExactly("X-Correlation-id");
  }

  /** DEFAULT_MAPPING_MATCHES_OWNER_APPROVED_TABLE=PASS — every field, every literal path, exactly as the owner approved. */
  @Test
  void matchesTheOwnerApprovedDefaultMappingTableExactly() {
    assertOnePath(CanonicalField.TIMESTAMP, "@timestamp");
    assertOnePath(CanonicalField.SERVICE, "application");
    assertOnePath(CanonicalField.SEVERITY, "level");
    assertOnePath(CanonicalField.MESSAGE, "message");
    assertOnePath(CanonicalField.LOGGER, "logger_name");
    assertOnePath(CanonicalField.THREAD, "thread_name");
    assertOnePath(CanonicalField.EXCEPTION, "stack_trace");

    assertOnePath(CanonicalField.CIF, "cif");
    assertOnePath(CanonicalField.USERNAME, "userName");
    assertOnePath(CanonicalField.CUSTOMER_ID, "customerId");
    assertOnePath(CanonicalField.DEVICE_ID, "deviceId");
    assertOnePath(CanonicalField.DEVICE_IP, "deviceIp");

    assertOnePath(CanonicalField.CORRELATION_ID, "X-Correlation-id");
    assertOnePath(CanonicalField.TRACE_ID, "traceId");
    assertOnePath(CanonicalField.SPAN_ID, "spanId");
    assertThat(profile.candidates(CanonicalField.JOURNEY_ID)).isEmpty();
    assertOnePath(CanonicalField.JOURNEY_NAME, "journeyName");
    assertOnePath(CanonicalField.EVENT_ID, "mdc.eventId");

    assertOnePath(CanonicalField.BUSINESS_STEP, "stepName");
    assertThat(profile.candidates(CanonicalField.UI_IDENTIFIER)).isEmpty();
    assertOnePath(CanonicalField.ERROR_CODE, "mdc.ERROR_CODE");

    assertOnePath(CanonicalField.DEVICE_PLATFORM_TYPE, "devicePlatformType");
    assertOnePath(CanonicalField.LANGUAGE, "language");
    assertOnePath(CanonicalField.SERVER_IP, "serverIp");
    assertOnePath(CanonicalField.SERVER_HOST, "serverHost");
  }

  private void assertOnePath(CanonicalField field, String expectedRawPath) {
    List<JsonPath> candidates = profile.candidates(field);
    assertThat(candidates).as(field.name()).hasSize(1);
    assertThat(candidates.get(0).raw()).as(field.name()).isEqualTo(expectedRawPath);
  }
}
