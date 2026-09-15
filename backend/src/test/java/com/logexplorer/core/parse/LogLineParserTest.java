package com.logexplorer.core.parse;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.logexplorer.core.mapping.CanonicalField;
import com.logexplorer.core.mapping.FieldMappingProfileService;
import com.logexplorer.core.mapping.JsonPath;
import com.logexplorer.core.model.CanonicalLogEvent;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class LogLineParserTest {

  private final LogLineParser parser = new LogLineParser(new ObjectMapper(), new FieldMappingProfileService());

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

  /**
   * Superseded by owner mission "Service Filter, Docker Performance, and
   * Verified Default Mapping" §C (CLAUDE.md §5 named conflict, applied):
   * the built-in default profile no longer reads most of these fields
   * from {@code mdc} — the owner reviewed real source JSON and approved a
   * mapping where most canonical fields live at the JSON top level; {@link
   * com.logexplorer.core.mapping.CanonicalField#EVENT_ID}/{@link
   * com.logexplorer.core.mapping.CanonicalField#ERROR_CODE} are the only
   * two that remain {@code mdc}-nested by default. {@link
   * com.logexplorer.core.mapping.CanonicalField#JOURNEY_ID}/{@link
   * com.logexplorer.core.mapping.CanonicalField#UI_IDENTIFIER} are
   * deliberately, permanently unmapped by default — see {@link
   * com.logexplorer.core.mapping.DefaultFieldMappingProfile}'s own
   * javadoc.
   */
  @Test
  void mapsAllCanonicalFieldsViaTheOwnerApprovedDefaultProfile() {
    String line = """
        {"@timestamp":"2026-01-01T00:00:00Z","message":"m","application":"gateway",
         "traceId":"t1","spanId":"s1","journeyId":"j1","journeyName":"SIGN_IN",
         "stepName":"debit-account","uiIdentifier":"screen.x",
         "X-Correlation-id":"c1","devicePlatformType":"IOS","language":"en",
         "serverIp":"10.0.0.1","serverHost":"host-1",
         "cif":"CIF123456","userName":"jdoe","customerId":"CUST7890","deviceId":"DEV12345","deviceIp":"10.1.2.3",
         "mdc":{"eventId":"e1","ERROR_CODE":"ERR_1"}}
        """;
    CanonicalLogEvent event = parser.parse(line);

    assertThat(event.traceId()).isEqualTo("t1");
    assertThat(event.spanId()).isEqualTo("s1");
    assertThat(event.journeyName()).isEqualTo("SIGN_IN");
    assertThat(event.eventId()).isEqualTo("e1");
    assertThat(event.businessStep()).isEqualTo("debit-account");
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

    // Journey ID and UI Identifier are deliberately unmapped by default -
    // present in the real source JSON above but never resolved without
    // the owner explicitly configuring a candidate.
    assertThat(event.journeyId()).isNull();
    assertThat(event.uiIdentifier()).isNull();

    // Every field mapped from a top-level key above is promoted to a
    // typed field, never left sitting in the generic unknown-fields bag -
    // the same invariant unknownMdcFieldsNeverContainAnyOfTheFiveSensitiveKeysWhenMdcMapped
    // proves for the mdc-nested case.
    assertThat(event.unknownTopLevelFields()).doesNotContainKeys(
        "traceId", "spanId", "journeyName", "stepName", "X-Correlation-id",
        "devicePlatformType", "language", "serverIp", "serverHost",
        "cif", "userName", "customerId", "deviceId", "deviceIp");
    // journeyId/uiIdentifier are unmapped, so they remain visible as
    // unknown top-level fields - never silently discarded either.
    assertThat(event.unknownTopLevelFields()).containsEntry("journeyId", "j1");
    assertThat(event.unknownTopLevelFields()).containsEntry("uiIdentifier", "screen.x");
  }

  // --- correlation precedence (HANDOVER.md §5.1, superseded default path by owner mission §C) ---

  @Test
  void correlationUsesTheOwnerApprovedTopLevelHeaderKeyByDefault() {
    String line = """
        {"message":"m","X-Correlation-id":"header-value"}
        """;
    assertThat(parser.parse(line).correlationId()).isEqualTo("header-value");
  }

  @Test
  void correlationIsNullWhenTheDefaultKeyIsAbsent() {
    String line = """
        {"message":"m"}
        """;
    assertThat(parser.parse(line).correlationId()).isNull();
  }

  /**
   * Superseded by owner mission "Service Filter, Docker Performance, and
   * Verified Default Mapping" §C: the built-in default no longer carries
   * a second, literal-dotted-key fallback candidate for Correlation ID
   * (the owner-approved default is the single top-level {@code
   * X-Correlation-id} path) — but the literal-bracket JSON-path syntax
   * itself (a flat key containing a dot, never a nested path) remains
   * fully supported and configurable, proven here via an explicit mapping
   * rather than the default profile.
   */
  @Test
  void literalDottedKeyFallbackRemainsAvailableAsAnExplicitlyConfiguredCandidate() {
    String line = """
        {"message":"m","mdc":{"event.correlationId":"literal-value"}}
        """;
    FieldMappingProfileService mappingService = new FieldMappingProfileService();
    mappingService.updateCandidates(
        CanonicalField.CORRELATION_ID,
        List.of(
            JsonPath.parse("mdc.X-Correlation-id"),
            JsonPath.parse("mdc[\"event.correlationId\"]")));
    LogLineParser configuredParser = new LogLineParser(new ObjectMapper(), mappingService);
    assertThat(configuredParser.parse(line).correlationId()).isEqualTo("literal-value");
  }

  @Test
  void correlationLiteralKeyIsNotMistakenForANestedPath() {
    // A genuinely nested "event": {"correlationId": ...} structure must NOT
    // be picked up by the literal-key lookup, explicitly configured the
    // same way the fallback candidate above is.
    String line = """
        {"message":"m","mdc":{"event":{"correlationId":"should-not-be-used"}}}
        """;
    FieldMappingProfileService mappingService = new FieldMappingProfileService();
    mappingService.updateCandidates(
        CanonicalField.CORRELATION_ID,
        List.of(JsonPath.parse("mdc[\"event.correlationId\"]")));
    LogLineParser configuredParser = new LogLineParser(new ObjectMapper(), mappingService);
    assertThat(configuredParser.parse(line).correlationId()).isNull();
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
    // eventId (owner mission §C - one of only two fields still mdc-nested by default).
    String line = """
        {"message":"m","mdc":{"eventId":"e1","weirdCustomField":"kept-too"}}
        """;
    CanonicalLogEvent event = parser.parse(line);
    assertThat(event.unknownMdcFields()).containsEntry("weirdCustomField", "kept-too");
    assertThat(event.unknownMdcFields()).doesNotContainKey("eventId");
  }

  /**
   * Superseded by owner mission "Service Filter, Docker Performance, and
   * Verified Default Mapping" §C: the five sensitive fields are no longer
   * mdc-nested in the built-in DEFAULT profile (they're top-level now —
   * see {@code mapsAllCanonicalFieldsViaTheOwnerApprovedDefaultProfile}'s
   * own top-level-unknown-field assertions for that case). This test
   * keeps proving the underlying invariant that still matters whenever a
   * sensitive field genuinely IS mapped from {@code mdc} (a source that
   * still nests it there, explicitly configured) — it must never be left
   * sitting in the generic unknown-fields bag.
   */
  @Test
  void unknownMdcFieldsNeverContainAnyOfTheFiveSensitiveKeysWhenMdcMapped() {
    String line = """
        {"message":"m","mdc":{"cif":"C1","UserName":"u","CustomerId":"c","deviceId":"d","deviceIp":"1.2.3.4"}}
        """;
    FieldMappingProfileService mappingService = new FieldMappingProfileService();
    mappingService.updateCandidates(CanonicalField.CIF, List.of(JsonPath.parse("mdc.cif")));
    mappingService.updateCandidates(CanonicalField.USERNAME, List.of(JsonPath.parse("mdc.UserName")));
    mappingService.updateCandidates(CanonicalField.CUSTOMER_ID, List.of(JsonPath.parse("mdc.CustomerId")));
    mappingService.updateCandidates(CanonicalField.DEVICE_ID, List.of(JsonPath.parse("mdc.deviceId")));
    mappingService.updateCandidates(CanonicalField.DEVICE_IP, List.of(JsonPath.parse("mdc.deviceIp")));
    LogLineParser configuredParser = new LogLineParser(new ObjectMapper(), mappingService);
    CanonicalLogEvent event = configuredParser.parse(line);
    assertThat(event.unknownMdcFields()).isEmpty();
  }

  @Test
  void aNullValuedUnknownFieldIsPreservedRatherThanCrashingTheWholeEvent() {
    // Regression test for a real NullPointerException reported against a
    // real Docker container's real log output (not reproducible from the
    // fixture/mock corpora, which never happened to include a null-valued
    // field): CanonicalLogEvent's canonical constructor used to call
    // Map.copyOf on unknownTopLevelFields/unknownMdcFields, which rejects
    // any null *value* - but a JSON `null` (e.g. "exception":null when
    // absent) is a perfectly ordinary, valid value for an unknown field,
    // not a malformed one.
    String line = """
        {"message":"m","application":"gateway","mdc":{"weirdCustomField":null},"someFutureField":null}
        """;
    CanonicalLogEvent event = parser.parse(line);
    assertThat(event.unknownTopLevelFields()).containsEntry("someFutureField", null);
    assertThat(event.unknownMdcFields()).containsEntry("weirdCustomField", null);
    assertThat(event.malformed()).isFalse();
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
    // stack_trace - owner mission §C's default candidate for Exception (was "exception").
    String line = """
        {"message":"boom","application":"payments-api","mdc":{},"stack_trace":"java.lang.RuntimeException: boom\\n\\tat com.example.Foo.bar(Foo.java:10)\\n\\t... 5 more"}
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
