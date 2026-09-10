package com.logexplorer.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.logexplorer.api.dto.EventDto;
import com.logexplorer.core.mask.MaskingService;
import com.logexplorer.core.mask.TextRedactor;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.RawSensitiveFields;
import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.autoconfigure.json.JsonTest;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * Serializes a fully-populated event through the real API mapper and the
 * production-configured Jackson {@link ObjectMapper}, then asserts none of
 * the five raw sensitive values appear anywhere in the resulting JSON —
 * IMPLEMENTATION_PLAN.md "Phase B" required automated test.
 */
@JsonTest
class SerializationLeakTest {

  private static final String RAW_CIF = "RAW-CIF-SENTINEL-9f3a";
  private static final String RAW_USERNAME = "RAW-USERNAME-SENTINEL-9f3a";
  private static final String RAW_CUSTOMER_ID = "RAW-CUSTOMERID-SENTINEL-9f3a";
  private static final String RAW_DEVICE_ID = "RAW-DEVICEID-SENTINEL-9f3a";
  private static final String RAW_DEVICE_IP = "203.0.113.42";

  @Autowired
  private ObjectMapper objectMapper;

  private final EventMapper eventMapper = new EventMapper(new MaskingService(), new TextRedactor());

  @Test
  void serializedEventDtoNeverContainsAnyRawSensitiveValue() throws Exception {
    CanonicalLogEvent event = fullyPopulatedEvent();

    EventDto dto = eventMapper.toDto(event);
    String json = objectMapper.writeValueAsString(dto);

    assertThat(json).doesNotContain(RAW_CIF, RAW_USERNAME, RAW_CUSTOMER_ID, RAW_DEVICE_ID, RAW_DEVICE_IP);

    // Sanity: the test would catch a real leak — a masked marker is present.
    assertThat(json).contains("****");
  }

  @Test
  void serializedEventDtoAlsoDoesNotLeakThroughUnknownFieldMaps() throws Exception {
    // Sensitive keys must never end up sitting in the generic "unknown"
    // bags either — confirms the parser-level guarantee survives all the
    // way through serialization, not just at the parser unit-test level.
    CanonicalLogEvent event = CanonicalLogEvent.builder()
        .message("m")
        .unknownTopLevelFields(Map.of("harmlessExtra", "kept"))
        .unknownMdcFields(Map.of("harmlessMdcExtra", "kept"))
        .sensitive(new RawSensitiveFields(RAW_CIF, RAW_USERNAME, RAW_CUSTOMER_ID, RAW_DEVICE_ID, RAW_DEVICE_IP))
        .build();

    EventDto dto = eventMapper.toDto(event);
    String json = objectMapper.writeValueAsString(dto);

    assertThat(json).doesNotContain(RAW_CIF, RAW_USERNAME, RAW_CUSTOMER_ID, RAW_DEVICE_ID, RAW_DEVICE_IP);
    assertThat(json).contains("harmlessExtra", "harmlessMdcExtra");
  }

  // -----------------------------------------------------------------
  // Legacy Remediation Slice 7 - free-text redaction, extended at the
  // exact same single boundary (EventMapper.toDto -> TextRedactor).
  // -----------------------------------------------------------------

  private static final String SENSITIVE_CIF_SENTINEL = "RAW-FREETEXT-CIF-SENTINEL-7b21";
  private static final String SENSITIVE_TOKEN_SENTINEL = "RAW-FREETEXT-TOKEN-SENTINEL-7b21";
  private static final String SENSITIVE_CARD_SENTINEL = "4111111111111111"; // a real value, not a label - Luhn-valid

  @Test
  void aContextualIdentifierEmbeddedInTheFreeTextMessageIsRedactedBeforeSerialization() throws Exception {
    CanonicalLogEvent event = CanonicalLogEvent.builder()
        .message("Login failed for customerId=" + SENSITIVE_CIF_SENTINEL)
        .build();

    String json = objectMapper.writeValueAsString(eventMapper.toDto(event));

    assertThat(json).doesNotContain(SENSITIVE_CIF_SENTINEL);
    assertThat(json).contains("customerId=[REDACTED]");
  }

  @Test
  void aBearerTokenEmbeddedInTheFreeTextExceptionIsRedactedBeforeSerialization() throws Exception {
    CanonicalLogEvent event = CanonicalLogEvent.builder()
        .message("m")
        .exception("java.lang.RuntimeException: auth failed, Authorization: Bearer " + SENSITIVE_TOKEN_SENTINEL + "0000000")
        .build();

    String json = objectMapper.writeValueAsString(eventMapper.toDto(event));

    assertThat(json).doesNotContain(SENSITIVE_TOKEN_SENTINEL);
    assertThat(json).contains("Authorization: Bearer [REDACTED]");
  }

  @Test
  void aValidLuhnCardNumberEmbeddedInTheFreeTextMessageIsRedactedBeforeSerialization() throws Exception {
    CanonicalLogEvent event = CanonicalLogEvent.builder()
        .message("card " + SENSITIVE_CARD_SENTINEL + " declined")
        .build();

    String json = objectMapper.writeValueAsString(eventMapper.toDto(event));

    assertThat(json).doesNotContain(SENSITIVE_CARD_SENTINEL);
    assertThat(json).contains("[REDACTED_CARD]");
  }

  @Test
  void aSecretEmbeddedInAMalformedRawLineIsRedactedBeforeSerialization() throws Exception {
    CanonicalLogEvent event = CanonicalLogEvent.builder()
        .malformed(true)
        .rawLine("NOT-JSON password=" + SENSITIVE_TOKEN_SENTINEL)
        .build();

    String json = objectMapper.writeValueAsString(eventMapper.toDto(event));

    assertThat(json).doesNotContain(SENSITIVE_TOKEN_SENTINEL);
    assertThat(json).contains("password=[REDACTED]");
  }

  @Test
  void aSecretEmbeddedInAnUnknownFieldStringValueIsRedactedBeforeSerialization() throws Exception {
    CanonicalLogEvent event = CanonicalLogEvent.builder()
        .message("m")
        .unknownTopLevelFields(Map.of("weirdField", "api_key=" + SENSITIVE_TOKEN_SENTINEL))
        .unknownMdcFields(Map.of("weirdMdc", "customerId=" + SENSITIVE_CIF_SENTINEL))
        .build();

    String json = objectMapper.writeValueAsString(eventMapper.toDto(event));

    assertThat(json).doesNotContain(SENSITIVE_TOKEN_SENTINEL, SENSITIVE_CIF_SENTINEL);
    assertThat(json).contains("api_key=[REDACTED]").contains("customerId=[REDACTED]");
  }

  @Test
  void anUnknownFieldNonStringValueIsNeverTouchedByRedactionAndNeverThrows() throws Exception {
    CanonicalLogEvent event = CanonicalLogEvent.builder()
        .message("m")
        .unknownTopLevelFields(Map.of("aNumber", 42, "aNestedMap", Map.of("customerId", "778899")))
        .build();

    String json = objectMapper.writeValueAsString(eventMapper.toDto(event));

    assertThat(json).contains("42");
    // The nested map's own "customerId" is never scanned (depth-0 only, section 9).
    assertThat(json).contains("778899");
  }

  private CanonicalLogEvent fullyPopulatedEvent() {
    return CanonicalLogEvent.builder()
        .timestamp(Instant.parse("2026-01-01T00:00:00Z"))
        .timestampRaw("2026-01-01T00:00:00+00:00")
        .schemaVersion("1")
        .service("accounts-api")
        .serviceSourceHint("accounts-api-compose")
        .severity("ERROR")
        .severityNumber(40000)
        .message("payment failed")
        .logger("com.example.Foo")
        .thread("http-nio-1")
        .exception("java.lang.RuntimeException: boom\n\tat com.example.Foo.bar(Foo.java:1)")
        .traceId("trace-1")
        .spanId("span-1")
        .journeyId("journey-1")
        .eventId("event-1")
        .businessStep("debit-account")
        .uiIdentifier("screen.transfer")
        .errorCode("ERR_1")
        .correlationId("corr-1")
        .sensitive(new RawSensitiveFields(RAW_CIF, RAW_USERNAME, RAW_CUSTOMER_ID, RAW_DEVICE_ID, RAW_DEVICE_IP))
        .devicePlatformType("ANDROID")
        .language("en")
        .serverIp("10.0.0.1")
        .serverHost("host-1")
        .build();
  }
}
