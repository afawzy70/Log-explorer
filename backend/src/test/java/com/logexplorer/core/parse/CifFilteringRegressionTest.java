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

  /**
   * Superseded by owner mission "Service Filter, Docker Performance, and
   * Verified Default Mapping" §C (CLAUDE.md §5 named conflict, applied):
   * this test originally proved the ORIGINAL defect — the built-in
   * default profile only ever looked under {@code mdc.cif}, so a
   * top-level {@code cif} silently found nothing until the owner
   * explicitly reconfigured it (the scenario {@code
   * topLevelCifFilterFindsTheEvent_onceMappedByTheOwner} above still
   * proves the general reconfiguration mechanism). The owner has since
   * reviewed real source JSON and approved a NEW built-in default that
   * maps CIF to the bare top-level {@code cif} path directly (see {@link
   * com.logexplorer.core.mapping.DefaultFieldMappingProfile}) — this
   * exact scenario is therefore no longer reproducible: the untouched
   * default now finds it with zero configuration, which is the point of
   * this replacement test.
   */
  @Test
  void topLevelCifFilterFindsTheEventByDefault_noConfigurationNeeded_ownerApprovedDefaultMapping() {
    String rawLine = "{\"@timestamp\":\"2026-01-01T12:00:00Z\",\"application\":\"payments-api\","
        + "\"level\":\"INFO\",\"message\":\"Payment authorization failed\",\"cif\":\"2449\"}";

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

  /**
   * Superseded by owner mission "Service Filter, Docker Performance, and
   * Verified Default Mapping" §C: {@code mdc.cif} is no longer part of
   * the built-in DEFAULT profile (top-level {@code cif} is), but remains
   * a fully legitimate, explicitly-configurable candidate path for a
   * source that genuinely still nests it there — "backward compatibility"
   * now means "still configurable," not "still the untouched default."
   */
  @Test
  void mdcCifStillWorksWhenExplicitlyConfigured_backwardCompatibleAsAConfigurableCandidate() {
    String rawLine = "{\"@timestamp\":\"2026-01-01T12:00:00Z\",\"mdc\":{\"cif\":\"2449\"}}";
    FieldMappingProfileService mappingService = new FieldMappingProfileService();
    mappingService.updateCandidates(CanonicalField.CIF, List.of(JsonPath.parse("mdc.cif")));
    LogLineParser parser = new LogLineParser(objectMapper, mappingService);
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

    // Explicitly enabled - the fresh/default masking state is now OFF
    // (mission "Field Mapping Schema Scan + Masking Policy Extension"
    // §B), so this test enables CIF masking itself to prove the real
    // guarantee: regardless of which JsonPath candidate supplied the
    // value, masking still applies correctly *whenever the policy says
    // masked*. See MaskingServiceTest for exhaustive default-state coverage.
    com.logexplorer.core.mask.MaskingPolicyService maskingPolicy = new com.logexplorer.core.mask.MaskingPolicyService();
    maskingPolicy.setMasked(com.logexplorer.core.mask.ProtectedField.CIF, true);
    com.logexplorer.core.mask.MaskingService maskingService = new com.logexplorer.core.mask.MaskingService(maskingPolicy);
    com.logexplorer.core.mask.MaskedSensitiveFields masked = maskingService.mask(event);

    assertThat(masked.cif())
        .as("mission §18: MAPPING_CANNOT_BYPASS_MASKING")
        .isNotEqualTo("2449")
        .isEqualTo("****");
  }

  @Test
  void whenMaskingIsOff_theMappedValueIsReturnedRawRegardlessOfWhichPathSuppliedIt() {
    // Mission §B2 - "source path choice does not alter sensitive
    // classification... whether it is shown masked depends only on the
    // global CIF masking toggle." Same mapped-from-top-level-cif setup as
    // above, but with the fresh/default (masking OFF) policy - the raw
    // value is expected, by owner-approved design, not a leak.
    String rawLine = "{\"cif\":\"2449\"}";
    FieldMappingProfileService mappingService = new FieldMappingProfileService();
    mappingService.updateCandidates(CanonicalField.CIF, List.of(JsonPath.parse("cif")));
    LogLineParser parser = new LogLineParser(objectMapper, mappingService);
    CanonicalLogEvent event = parser.parse(rawLine);

    com.logexplorer.core.mask.MaskingService maskingService =
        new com.logexplorer.core.mask.MaskingService(new com.logexplorer.core.mask.MaskingPolicyService());
    com.logexplorer.core.mask.MaskedSensitiveFields masked = maskingService.mask(event);

    assertThat(masked.cif()).isEqualTo("2449");
  }
}
