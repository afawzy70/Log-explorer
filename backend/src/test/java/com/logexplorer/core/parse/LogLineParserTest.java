package com.logexplorer.core.parse;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.logexplorer.core.model.CanonicalLogEvent;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class LogLineParserTest {

  private final LogLineParser parser = new LogLineParser(new ObjectMapper());

  // --- canonical top-level field mapping (HANDOVER.md §5.1) ------------------

  @Test
  void mapsAllCanonicalTopLevelFields() {
    String line = """
        {"@timestamp":"2026-01-01T00:00:00.123+00:00","@version":"1","message":"hello",
         "logger_name":"com.example.Foo","thread_name":"http-nio-1","level":"INFO","level_value":20000,
         "application":"accounts-api","mdc":{}}
        """;
    CanonicalLogEvent event = parser.parse(line);

    assertThat(event.timestamp()).isEqualTo(Instant.parse("2026-01-01T00:00:00.123Z"));
    assertThat(event.timestampRaw()).isEqualTo("2026-01-01T00:00:00.123+00:00");
    assertThat(event.schemaVersion()).isEqualTo("1");
    assertThat(event.message()).isEqualTo("hello");
    assertThat(event.logger()).isEqualTo("com.example.Foo");
    assertThat(event.thread()).isEqualTo("http-nio-1");
    assertThat(event.severity()).isEqualTo("INFO");
    assertThat(event.severityNumber()).isEqualTo(20000);
    assertThat(event.service()).isEqualTo("accounts-api");
    assertThat(event.malformed()).isFalse();
  }

  @Test
  void mapsAllCanonicalMdcFields() {
    String line = """
        {"@timestamp":"2026-01-01T00:00:00Z","message":"m","application":"gateway",
         "mdc":{
           "traceId":"t1","spanId":"s1","x-journey-trace-id":"j1","eventId":"e1",
           "stepName":"debit-account","UIIdentifier":"screen.x","ERROR_CODE":"ERR_1",
           "X-Correlation-id":"c1","devicePlatformType":"IOS","language":"en",
           "serverIp":"10.0.0.1","serverHost":"host-1",
           "cif":"CIF123456","UserName":"jdoe","CustomerId":"CUST7890","deviceId":"DEV12345","deviceIp":"10.1.2.3"
         }}
        """;
    CanonicalLogEvent event = parser.parse(line);

    assertThat(event.traceId()).isEqualTo("t1");
    assertThat(event.spanId()).isEqualTo("s1");
    assertThat(event.journeyId()).isEqualTo("j1");
    assertThat(event.eventId()).isEqualTo("e1");
    assertThat(event.businessStep()).isEqualTo("debit-account");
    assertThat(event.uiIdentifier()).isEqualTo("screen.x");
    assertThat(event.errorCode()).isEqualTo("ERR_1");
    assertThat(event.correlationId()).isEqualTo("c1");
    assertThat(event.devicePlatformType()).isEqualTo("IOS");
    assertThat(event.language()).isEqualTo("en");
    assertThat(event.serverIp()).isEqualTo("10.0.0.1");
    assertThat(event.serverHost()).isEqualTo("host-1");
    assertThat(event.sensitive().cif()).isEqualTo("CIF123456");
    assertThat(event.sensitive().userName()).isEqualTo("jdoe");
    assertThat(event.sensitive().customerId()).isEqualTo("CUST7890");
    assertThat(event.sensitive().deviceId()).isEqualTo("DEV12345");
    assertThat(event.sensitive().deviceIp()).isEqualTo("10.1.2.3");
  }

  // --- correlation precedence (HANDOVER.md §5.1) -----------------------------

  @Test
  void correlationPrefersHeaderKeyWhenBothPresent() {
    String line = """
        {"message":"m","mdc":{"X-Correlation-id":"header-value","event.correlationId":"literal-value"}}
        """;
    assertThat(parser.parse(line).correlationId()).isEqualTo("header-value");
  }

  @Test
  void correlationFallsBackToLiteralDottedKeyWhenHeaderAbsent() {
    // "event.correlationId" is a literal flat key containing a period, not
    // a nested "event" -> "correlationId" path.
    String line = """
        {"message":"m","mdc":{"event.correlationId":"literal-value"}}
        """;
    assertThat(parser.parse(line).correlationId()).isEqualTo("literal-value");
  }

  @Test
  void correlationLiteralKeyIsNotMistakenForANestedPath() {
    // A genuinely nested "event": {"correlationId": ...} structure must NOT
    // be picked up by the literal-key lookup.
    String line = """
        {"message":"m","mdc":{"event":{"correlationId":"should-not-be-used"}}}
        """;
    assertThat(parser.parse(line).correlationId()).isNull();
  }

  @Test
  void correlationIsNullWhenNeitherVariantPresent() {
    String line = """
        {"message":"m","mdc":{}}
        """;
    assertThat(parser.parse(line).correlationId()).isNull();
  }

  // --- service precedence (HANDOVER.md §5.2) ---------------------------------

  @Test
  void serviceUsesTopLevelApplicationAndRetainsSourceHintSeparately() {
    String line = """
        {"message":"m","application":"accounts-api","mdc":{}}
        """;
    CanonicalLogEvent event = parser.parse(line, "compose-service-name");
    assertThat(event.service()).isEqualTo("accounts-api");
    assertThat(event.serviceSourceHint()).isEqualTo("compose-service-name");
  }

  @Test
  void serviceHintIsRetainedEvenWhenItAgreesWithApplication() {
    String line = """
        {"message":"m","application":"accounts-api","mdc":{}}
        """;
    CanonicalLogEvent event = parser.parse(line, "accounts-api");
    assertThat(event.service()).isEqualTo("accounts-api");
    assertThat(event.serviceSourceHint()).isEqualTo("accounts-api");
  }

  // --- unknown field preservation (HANDOVER.md §5.3) -------------------------

  @Test
  void preservesUnknownTopLevelFields() {
    String line = """
        {"message":"m","application":"gateway","mdc":{},"someFutureField":"kept","another":42}
        """;
    CanonicalLogEvent event = parser.parse(line);
    assertThat(event.unknownTopLevelFields()).containsEntry("someFutureField", "kept");
    assertThat(event.unknownTopLevelFields()).containsEntry("another", 42);
    assertThat(event.unknownTopLevelFields()).doesNotContainKey("message");
    assertThat(event.unknownTopLevelFields()).doesNotContainKey("application");
  }

  @Test
  void preservesUnknownMdcFields() {
    String line = """
        {"message":"m","mdc":{"traceId":"t1","weirdCustomField":"kept-too"}}
        """;
    CanonicalLogEvent event = parser.parse(line);
    assertThat(event.unknownMdcFields()).containsEntry("weirdCustomField", "kept-too");
    assertThat(event.unknownMdcFields()).doesNotContainKey("traceId");
  }

  @Test
  void unknownMdcFieldsNeverContainAnyOfTheFiveSensitiveKeys() {
    // Sanity: the five sensitive keys are always promoted to typed fields,
    // never left sitting in the generic "unknown" bag.
    String line = """
        {"message":"m","mdc":{"cif":"C1","UserName":"u","CustomerId":"c","deviceId":"d","deviceIp":"1.2.3.4"}}
        """;
    CanonicalLogEvent event = parser.parse(line);
    assertThat(event.unknownMdcFields()).isEmpty();
  }

  // --- malformed lines (HANDOVER.md §5.4) -------------------------------------

  @Test
  void malformedNonJsonLineBecomesRawFallbackEvent() {
    String line = "this is not json at all";
    CanonicalLogEvent event = parser.parse(line);
    assertThat(event.malformed()).isTrue();
    assertThat(event.rawLine()).isEqualTo(line);
  }

  @Test
  void jsonArrayInsteadOfObjectBecomesRawFallbackEvent() {
    String line = "[1,2,3]";
    CanonicalLogEvent event = parser.parse(line);
    assertThat(event.malformed()).isTrue();
    assertThat(event.rawLine()).isEqualTo(line);
  }

  @Test
  void nullLineBecomesRawFallbackEventWithoutThrowing() {
    CanonicalLogEvent event = parser.parse(null);
    assertThat(event.malformed()).isTrue();
  }

  // --- single-bad-field tolerance ----------------------------------------------

  @Test
  void unparsableTimestampDoesNotDiscardTheRestOfTheEvent() {
    String line = """
        {"@timestamp":"not-a-real-timestamp","message":"still here","application":"gateway","mdc":{}}
        """;
    CanonicalLogEvent event = parser.parse(line);
    assertThat(event.malformed()).isFalse();
    assertThat(event.timestamp()).isNull();
    assertThat(event.timestampRaw()).isEqualTo("not-a-real-timestamp");
    assertThat(event.message()).isEqualTo("still here");
  }

  @Test
  void nonNumericLevelValueDoesNotDiscardTheRestOfTheEvent() {
    String line = """
        {"message":"still here","level_value":"not-a-number","application":"gateway","mdc":{}}
        """;
    CanonicalLogEvent event = parser.parse(line);
    assertThat(event.malformed()).isFalse();
    assertThat(event.severityNumber()).isNull();
    assertThat(event.message()).isEqualTo("still here");
  }

  // --- empty / missing message (HANDOVER.md §5.6) -----------------------------

  @Test
  void emptyMessageIsPreservedAsEmptyString() {
    String line = """
        {"message":"","application":"gateway","mdc":{}}
        """;
    assertThat(parser.parse(line).message()).isEqualTo("");
  }

  @Test
  void missingMessageKeyYieldsNullNotFabricatedText() {
    String line = """
        {"application":"gateway","mdc":{}}
        """;
    assertThat(parser.parse(line).message()).isNull();
  }

  // --- multiline exceptions (HANDOVER.md §5.7) ---------------------------------

  @Test
  void multilineExceptionStaysOneLogicalEventWithNewlinesIntact() {
    String line = """
        {"message":"boom","application":"payments-api","mdc":{},"exception":"java.lang.RuntimeException: boom\\n\\tat com.example.Foo.bar(Foo.java:10)\\n\\t... 5 more"}
        """;
    CanonicalLogEvent event = parser.parse(line);
    assertThat(event.exception()).contains("\n");
    assertThat(event.exception()).startsWith("java.lang.RuntimeException: boom");
    assertThat(event.exception()).contains("Foo.bar(Foo.java:10)");
  }

  // --- offset timestamps --------------------------------------------------------

  @ParameterizedTest
  @CsvSource({
      "2026-01-01T00:00:00Z,          2026-01-01T00:00:00Z",
      "2026-01-01T03:00:00+03:00,     2026-01-01T00:00:00Z",
      "2026-01-01T00:00:00.500Z,      2026-01-01T00:00:00.500Z",
      "2026-01-01T00:00:00-05:00,     2026-01-01T05:00:00Z",
  })
  void acceptsVariousTimestampOffsetsAndNormalizesToUtcInstant(String raw, String expectedUtc) {
    String line = "{\"@timestamp\":\"" + raw + "\",\"message\":\"m\",\"mdc\":{}}";
    CanonicalLogEvent event = parser.parse(line);
    assertThat(event.timestamp()).isEqualTo(Instant.parse(expectedUtc));
    assertThat(event.timestampRaw()).isEqualTo(raw.trim());
  }
}
