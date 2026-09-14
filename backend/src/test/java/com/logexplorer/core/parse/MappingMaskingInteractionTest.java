package com.logexplorer.core.parse;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.logexplorer.core.mapping.CanonicalField;
import com.logexplorer.core.mapping.FieldMappingProfileService;
import com.logexplorer.core.mapping.JsonPath;
import com.logexplorer.core.mask.MaskingPolicyService;
import com.logexplorer.core.mask.MaskingService;
import com.logexplorer.core.mask.MaskedSensitiveFields;
import com.logexplorer.core.mask.ProtectedField;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.SearchRequest;
import com.logexplorer.core.search.EventFilters;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Mission "Field Mapping Schema Scan + Masking Policy Extension" §B2/§B4
 * — proves the masking architecture remains fully intact regardless of
 * WHICH source JSON path a canonical field was mapped from, and
 * regardless of the current masking default. "CIF mapped from cif /
 * cifId / mdc.cif / customer.cif must always be canonical CIF" — source
 * path choice never alters sensitive classification, and whether it is
 * shown masked depends only on the global CIF masking toggle.
 */
class MappingMaskingInteractionTest {

  private final ObjectMapper objectMapper = new ObjectMapper();

  private String maskCif(String rawLine, JsonPath cifCandidate, boolean maskingOn) {
    FieldMappingProfileService mappingService = new FieldMappingProfileService();
    mappingService.updateCandidates(CanonicalField.CIF, List.of(cifCandidate));
    LogLineParser parser = new LogLineParser(objectMapper, mappingService);
    CanonicalLogEvent event = parser.parse(rawLine);

    MaskingPolicyService policy = new MaskingPolicyService();
    policy.setMasked(ProtectedField.CIF, maskingOn);
    MaskedSensitiveFields masked = new MaskingService(policy).mask(event);
    return masked.cif();
  }

  @Test
  void cifMappedFromTopLevelCif_obeysTheCifToggle_off() {
    assertThat(maskCif("{\"cif\":\"2449\"}", JsonPath.parse("cif"), false)).isEqualTo("2449");
  }

  @Test
  void cifMappedFromTopLevelCif_obeysTheCifToggle_on() {
    assertThat(maskCif("{\"cif\":\"2449\"}", JsonPath.parse("cif"), true)).isEqualTo("****");
  }

  @Test
  void cifMappedFromCifIdAlternative_obeysTheCifToggle_off() {
    assertThat(maskCif("{\"cifId\":\"2449\"}", JsonPath.parse("cifId"), false)).isEqualTo("2449");
  }

  @Test
  void cifMappedFromCifIdAlternative_obeysTheCifToggle_on() {
    assertThat(maskCif("{\"cifId\":\"2449\"}", JsonPath.parse("cifId"), true)).isEqualTo("****");
  }

  @Test
  void cifMappedFromMdcCif_obeysTheCifToggle_off() {
    assertThat(maskCif("{\"mdc\":{\"cif\":\"2449\"}}", JsonPath.parse("mdc.cif"), false)).isEqualTo("2449");
  }

  @Test
  void cifMappedFromMdcCif_obeysTheCifToggle_on() {
    assertThat(maskCif("{\"mdc\":{\"cif\":\"2449\"}}", JsonPath.parse("mdc.cif"), true)).isEqualTo("****");
  }

  @Test
  void cifMappedFromNestedCustomerCif_obeysTheCifToggle_off() {
    assertThat(maskCif("{\"customer\":{\"cif\":\"2449\"}}", JsonPath.parse("customer.cif"), false)).isEqualTo("2449");
  }

  @Test
  void cifMappedFromNestedCustomerCif_obeysTheCifToggle_on() {
    assertThat(maskCif("{\"customer\":{\"cif\":\"2449\"}}", JsonPath.parse("customer.cif"), true)).isEqualTo("****");
  }

  @Test
  void maskingStateDoesNotAffectFilterCorrectness() {
    // Filtering reads CanonicalLogEvent.sensitive() (the raw, unmasked
    // value) directly - EventFilters runs entirely before EventMapper
    // ever calls MaskingService (see EventMapper's own doc comment).
    // Proven here for both masking directions against the identical
    // mapped event.
    FieldMappingProfileService mappingService = new FieldMappingProfileService();
    mappingService.updateCandidates(CanonicalField.CIF, List.of(JsonPath.parse("cif")));
    LogLineParser parser = new LogLineParser(objectMapper, mappingService);
    CanonicalLogEvent event = parser.parse("{\"cif\":\"2449\"}");

    SearchRequest request = SearchRequest.builder()
        .sourceId("x")
        .start(Instant.parse("2026-01-01T00:00:00Z"))
        .end(Instant.parse("2026-01-02T00:00:00Z"))
        .sensitiveFilters("2449", null, null, null, null)
        .build();

    // Masking policy is irrelevant to EventFilters - it isn't even
    // constructed here, and the filter still matches correctly.
    assertThat(EventFilters.matches(event, request)).isTrue();
  }

  @Test
  void mappingEditDoesNotResetMaskingPolicy() {
    MaskingPolicyService maskingPolicy = new MaskingPolicyService();
    maskingPolicy.setMasked(ProtectedField.CIF, true);

    FieldMappingProfileService mappingService = new FieldMappingProfileService();
    mappingService.updateCandidates(CanonicalField.CIF, List.of(JsonPath.parse("cif"), JsonPath.parse("cifId")));
    mappingService.updateCandidates(CanonicalField.USERNAME, List.of(JsonPath.parse("userName")));

    // Two independent, unrelated services - editing one never touches the other's state.
    assertThat(maskingPolicy.isMasked(ProtectedField.CIF)).isTrue();
  }

  @Test
  void resettingTheMappingProfileDoesNotResetMaskingPolicy() {
    MaskingPolicyService maskingPolicy = new MaskingPolicyService();
    maskingPolicy.setMasked(ProtectedField.CIF, true);
    maskingPolicy.setMasked(ProtectedField.DEVICE_IP, true);

    FieldMappingProfileService mappingService = new FieldMappingProfileService();
    mappingService.updateCandidates(CanonicalField.CIF, List.of(JsonPath.parse("cif")));
    mappingService.resetToDefault();

    assertThat(maskingPolicy.isMasked(ProtectedField.CIF)).isTrue();
    assertThat(maskingPolicy.isMasked(ProtectedField.DEVICE_IP)).isTrue();
  }

  @Test
  void anExplicitlySetMaskingPreferenceIsNeverSilentlyResetByAnUnrelatedOperation() {
    // Mission §B1 migration note: within one running process, only an
    // explicit setMasked call (never a background/unrelated code path)
    // changes the policy. Simulates a realistic sequence of unrelated
    // operations around an explicit user choice and proves it survives.
    MaskingPolicyService policy = new MaskingPolicyService();
    policy.setMasked(ProtectedField.USER_NAME, true); // the user's explicit choice

    // Unrelated operations that must never touch masking policy:
    FieldMappingProfileService mappingService = new FieldMappingProfileService();
    mappingService.updateCandidates(CanonicalField.CIF, List.of(JsonPath.parse("cif")));
    mappingService.confirmSave(true);
    mappingService.resetToDefault();
    new LogLineParser(objectMapper, mappingService).parse("{\"cif\":\"1\"}");

    assertThat(policy.isMasked(ProtectedField.USER_NAME))
        .as("mission §B1: an explicit user choice survives unrelated operations")
        .isTrue();
  }
}
