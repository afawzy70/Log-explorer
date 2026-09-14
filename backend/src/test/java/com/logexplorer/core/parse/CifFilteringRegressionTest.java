package com.logexplorer.core.parse;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.logexplorer.core.mapping.CanonicalField;
import com.logexplorer.core.mapping.FieldMappingProfileService;
import com.logexplorer.core.mapping.JsonPath;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.SearchRequest;
import com.logexplorer.core.search.EventFilters;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * End-to-end regression test for the owner-reported defect (mission
 * "Configurable Log Field Mapping + Original JSON Sampling"): "Filtering by
 * CIF returned no results even though the original log event contained
 * CIF" — because the source event's {@code cif} lived at the JSON top
 * level, not under {@code mdc.cif} where the parser exclusively looked.
 *
 * <p>Exercises the REAL pipeline this owner actually hits: {@link
 * LogLineParser} (parse) → {@link EventFilters} (filter) — proving the fix
 * end to end, not just at the resolver-unit level ({@code
 * FieldMappingResolverTest} already covers the resolver itself in
 * isolation).
 */
class CifFilteringRegressionTest {

  private final ObjectMapper objectMapper = new ObjectMapper();

  @Test
  void topLevelCifFilterFindsTheEvent_onceMappedByTheOwner() {
    // The owner's exact reported source shape: cif at the top level.
    String rawLine = "{\"@timestamp\":\"2026-01-01T12:00:00Z\",\"application\":\"payments-api\","
        + "\"level\":\"INFO\",\"message\":\"Payment authorization failed\",\"cif\":\"2449\"}";

    FieldMappingProfileService mappingService = new FieldMappingProfileService();
    // The owner's fix: map canonical CIF to the source's real top-level path.
    mappingService.updateCandidates(CanonicalField.CIF, List.of(JsonPath.parse("cif")));

    LogLineParser parser = new LogLineParser(objectMapper, mappingService);
    CanonicalLogEvent event = parser.parse(rawLine);

    assertThat(event.sensitive().cif()).isEqualTo("2449");

    SearchRequest request = SearchRequest.builder()
        .sourceId("x")
        .start(Instant.parse("2026-01-01T00:00:00Z"))
        .end(Instant.parse("2026-01-02T00:00:00Z"))
        .sensitiveFilters("2449", null, null, null, null)
        .build();

    assertThat(EventFilters.matches(event, request))
        .as("mission §17: CIF filter = 2449 must find an event whose mapped source path resolves to 2449")
        .isTrue();
  }

  @Test
  void topLevelCifFilterFindsNothing_beforeTheOwnerConfiguresTheMapping_reproducesTheOriginalDefect() {
    // Same raw event, but the DEFAULT (unedited) profile - the exact
    // pre-fix state that produced the owner's bug report.
    String rawLine = "{\"@timestamp\":\"2026-01-01T12:00:00Z\",\"application\":\"payments-api\","
        + "\"level\":\"INFO\",\"message\":\"Payment authorization failed\",\"cif\":\"2449\"}";

    LogLineParser parser = new LogLineParser(objectMapper, new FieldMappingProfileService());
    CanonicalLogEvent event = parser.parse(rawLine);

    // The value is real, present, and fully inspectable - it lands in
    // unknownTopLevelFields, never discarded - but not yet the canonical
    // sensitive.cif(), because no mapping candidate points at "cif" yet.
    assertThat(event.sensitive().cif()).isNull();
    assertThat(event.unknownTopLevelFields()).containsEntry("cif", "2449");

    SearchRequest request = SearchRequest.builder()
        .sourceId("x")
        .start(Instant.parse("2026-01-01T00:00:00Z"))
        .end(Instant.parse("2026-01-02T00:00:00Z"))
        .sensitiveFilters("2449", null, null, null, null)
        .build();

    assertThat(EventFilters.matches(event, request)).isFalse();
  }

  @Test
  void mdcCifStillWorksUnchanged_backwardCompatibility() {
    String rawLine = "{\"@timestamp\":\"2026-01-01T12:00:00Z\",\"mdc\":{\"cif\":\"2449\"}}";
    LogLineParser parser = new LogLineParser(objectMapper, new FieldMappingProfileService());
    CanonicalLogEvent event = parser.parse(rawLine);
    assertThat(event.sensitive().cif()).isEqualTo("2449");

    SearchRequest request = SearchRequest.builder()
        .sourceId("x")
        .start(Instant.parse("2026-01-01T00:00:00Z"))
        .end(Instant.parse("2026-01-02T00:00:00Z"))
        .sensitiveFilters("2449", null, null, null, null)
        .build();
    assertThat(EventFilters.matches(event, request)).isTrue();
  }

  @Test
  void mappedUsernameFilterWorks() {
    String rawLine = "{\"userName\":\"jsmith\"}";
    FieldMappingProfileService mappingService = new FieldMappingProfileService();
    mappingService.updateCandidates(CanonicalField.USERNAME, List.of(JsonPath.parse("mdc.UserName"), JsonPath.parse("userName")));
    LogLineParser parser = new LogLineParser(objectMapper, mappingService);
    CanonicalLogEvent event = parser.parse(rawLine);
    assertThat(event.sensitive().userName()).isEqualTo("jsmith");

    SearchRequest request = SearchRequest.builder()
        .sourceId("x").start(Instant.EPOCH).end(Instant.now())
        .sensitiveFilters(null, "jsmith", null, null, null)
        .build();
    assertThat(EventFilters.matches(event, request)).isTrue();
  }

  @Test
  void mappedCustomerIdFilterWorks() {
    String rawLine = "{\"customerId\":\"6978\"}";
    FieldMappingProfileService mappingService = new FieldMappingProfileService();
    mappingService.updateCandidates(CanonicalField.CUSTOMER_ID, List.of(JsonPath.parse("mdc.CustomerId"), JsonPath.parse("customerId")));
    LogLineParser parser = new LogLineParser(objectMapper, mappingService);
    CanonicalLogEvent event = parser.parse(rawLine);

    SearchRequest request = SearchRequest.builder()
        .sourceId("x").start(Instant.EPOCH).end(Instant.now())
        .sensitiveFilters(null, null, "6978", null, null)
        .build();
    assertThat(EventFilters.matches(event, request)).isTrue();
  }

  @Test
  void mappedDeviceIdAndDeviceIpFilterWork() {
    String rawLine = "{\"deviceId\":\"dev-9\",\"deviceIp\":\"10.0.0.1\"}";
    FieldMappingProfileService mappingService = new FieldMappingProfileService();
    mappingService.updateCandidates(CanonicalField.DEVICE_ID, List.of(JsonPath.parse("deviceId")));
    mappingService.updateCandidates(CanonicalField.DEVICE_IP, List.of(JsonPath.parse("deviceIp")));
    LogLineParser parser = new LogLineParser(objectMapper, mappingService);
    CanonicalLogEvent event = parser.parse(rawLine);

    SearchRequest request = SearchRequest.builder()
        .sourceId("x").start(Instant.EPOCH).end(Instant.now())
        .sensitiveFilters(null, null, null, "dev-9", "10.0.0.1")
        .build();
    assertThat(EventFilters.matches(event, request)).isTrue();
  }

  @Test
  void maskingStillAppliesRegardlessOfWhichPathSuppliedTheValue_mappingCannotBypassMasking() {
    // core.mask.MaskingService reads event.sensitive() - entirely
    // downstream of, and blind to, which JsonPath candidate supplied the
    // value. This is a structural guarantee, asserted here at the
    // sensitive-field-population level (the masking behavior itself is
    // covered exhaustively by MaskingServiceTest).
    String rawLine = "{\"cif\":\"2449\"}";
    FieldMappingProfileService mappingService = new FieldMappingProfileService();
    mappingService.updateCandidates(CanonicalField.CIF, List.of(JsonPath.parse("cif")));
    LogLineParser parser = new LogLineParser(objectMapper, mappingService);
    CanonicalLogEvent event = parser.parse(rawLine);

    com.logexplorer.core.mask.MaskingService maskingService =
        new com.logexplorer.core.mask.MaskingService(new com.logexplorer.core.mask.MaskingPolicyService());
    com.logexplorer.core.mask.MaskedSensitiveFields masked = maskingService.mask(event);

    assertThat(masked.cif())
        .as("mission §18: MAPPING_CANNOT_BYPASS_MASKING")
        .isNotEqualTo("2449")
        .isEqualTo("****");
  }
}
