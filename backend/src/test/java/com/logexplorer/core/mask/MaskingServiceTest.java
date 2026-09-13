package com.logexplorer.core.mask;

import static org.assertj.core.api.Assertions.assertThat;

import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.RawSensitiveFields;
import org.junit.jupiter.api.Test;

class MaskingServiceTest {

  // Pre-closure functional recovery (§12): every test in this file
  // exercises the DEFAULT policy (masked=true for all five fields) unless
  // it explicitly says otherwise - a fresh MaskingPolicyService always
  // starts fully masked (its own safe default), so this preserves every
  // existing assertion's exact prior meaning unchanged.
  private final MaskingPolicyService policy = new MaskingPolicyService();
  private final MaskingService service = new MaskingService(policy);

  private MaskedSensitiveFields mask(RawSensitiveFields raw) {
    CanonicalLogEvent event = CanonicalLogEvent.builder().sensitive(raw).build();
    return service.mask(event);
  }

  // --- cif: strongly masked, fixed-length, never reveals the original ----------

  @Test
  void cifIsStronglyMaskedToAFixedValueRegardlessOfLength() {
    RawSensitiveFields raw = new RawSensitiveFields("CIF-1234567890", null, null, null, null);
    assertThat(mask(raw).cif()).isEqualTo("****");
  }

  @Test
  void cifMaskingNeverLeaksTheOriginalValueEvenPartially() {
    RawSensitiveFields raw = new RawSensitiveFields("SUPER-SECRET-CIF-VALUE", null, null, null, null);
    String masked = mask(raw).cif();
    assertThat(masked).doesNotContain("SUPER", "SECRET", "CIF", "VALUE");
  }

  @Test
  void cifNullStaysNull() {
    RawSensitiveFields raw = new RawSensitiveFields(null, null, null, null, null);
    assertThat(mask(raw).cif()).isNull();
  }

  @Test
  void cifEmptyStaysEmpty() {
    RawSensitiveFields raw = new RawSensitiveFields("", null, null, null, null);
    assertThat(mask(raw).cif()).isEqualTo("");
  }

  // --- customerId / userName / deviceId: partial masking ------------------------

  @Test
  void customerIdIsPartiallyMaskedShowingFirstTwoAndLastTwoCharacters() {
    RawSensitiveFields raw = new RawSensitiveFields(null, null, "CUST789012", null, null);
    assertThat(mask(raw).customerId()).isEqualTo("CU***12");
  }

  @Test
  void userNameIsPartiallyMasked() {
    RawSensitiveFields raw = new RawSensitiveFields(null, "jane.doe", null, null, null);
    assertThat(mask(raw).userName()).isEqualTo("ja***oe");
  }

  @Test
  void deviceIdIsPartiallyMasked() {
    RawSensitiveFields raw = new RawSensitiveFields(null, null, null, "DEVICE-98765", null);
    assertThat(mask(raw).deviceId()).isEqualTo("DE***65");
  }

  @Test
  void shortValueBelowPartialThresholdIsFullyMaskedNotPartially() {
    // Anything short enough that "first two + last two" would reveal most
    // or all of the value must fall back to full masking.
    RawSensitiveFields raw = new RawSensitiveFields(null, null, "abcd", null, null);
    assertThat(mask(raw).customerId()).isEqualTo("****");
  }

  @Test
  void singleCharacterValueIsFullyMasked() {
    RawSensitiveFields raw = new RawSensitiveFields(null, "a", null, null, null);
    assertThat(mask(raw).userName()).isEqualTo("****");
  }

  @Test
  void partialMaskFieldsNullStayNull() {
    RawSensitiveFields raw = RawSensitiveFields.empty();
    MaskedSensitiveFields masked = mask(raw);
    assertThat(masked.userName()).isNull();
    assertThat(masked.customerId()).isNull();
    assertThat(masked.deviceId()).isNull();
  }

  @Test
  void partialMaskFieldsEmptyStayEmpty() {
    RawSensitiveFields raw = new RawSensitiveFields(null, "", "", "", null);
    MaskedSensitiveFields masked = mask(raw);
    assertThat(masked.userName()).isEqualTo("");
    assertThat(masked.customerId()).isEqualTo("");
    assertThat(masked.deviceId()).isEqualTo("");
  }

  // --- deviceIp: final portion masked, IPv4 and IPv6 -----------------------------

  @Test
  void ipv4FinalOctetIsMasked() {
    RawSensitiveFields raw = new RawSensitiveFields(null, null, null, null, "10.20.30.40");
    assertThat(mask(raw).deviceIp()).isEqualTo("10.20.30.***");
  }

  @Test
  void ipv6FinalGroupIsMasked() {
    RawSensitiveFields raw = new RawSensitiveFields(null, null, null, null, "2001:db8:0:0:0:0:0:1");
    assertThat(mask(raw).deviceIp()).isEqualTo("2001:db8:0:0:0:0:0:****");
  }

  @Test
  void ipv6CompressedFormFinalGroupIsMasked() {
    RawSensitiveFields raw = new RawSensitiveFields(null, null, null, null, "2001:db8::1");
    String masked = mask(raw).deviceIp();
    assertThat(masked).isEqualTo("2001:db8::****");
  }

  @Test
  void ipv6TrailingDoubleColonMasksTheLastVisibleSegmentNotAFabricatedOne() {
    // "2001:db8::" has no non-empty segment after "db8" (the trailing "::"
    // is compression, not data) — the last *visible* segment ("db8") is
    // what gets masked, and the "::" compression is left exactly as-is
    // rather than inventing a new trailing group that was never present.
    RawSensitiveFields raw = new RawSensitiveFields(null, null, null, null, "2001:db8::");
    String masked = mask(raw).deviceIp();
    assertThat(masked).isNotEqualTo("2001:db8::");
    assertThat(masked).isEqualTo("2001:****::");
  }

  @Test
  void deviceIpNullStaysNull() {
    RawSensitiveFields raw = RawSensitiveFields.empty();
    assertThat(mask(raw).deviceIp()).isNull();
  }

  @Test
  void deviceIpEmptyStaysEmpty() {
    RawSensitiveFields raw = new RawSensitiveFields(null, null, null, null, "");
    assertThat(mask(raw).deviceIp()).isEqualTo("");
  }

  @Test
  void malformedIpShapeFallsBackToPartialMaskingRatherThanLeakingRawValue() {
    RawSensitiveFields raw = new RawSensitiveFields(null, null, null, null, "not-an-ip-address");
    String masked = mask(raw).deviceIp();
    assertThat(masked).doesNotContain("not-an-ip-address");
  }

  // --- RawSensitiveFields itself is redacted at the type level -------------------

  @Test
  void rawSensitiveFieldsToStringNeverExposesRealValues() {
    RawSensitiveFields raw = new RawSensitiveFields("CIF-X", "user-x", "cust-x", "dev-x", "1.2.3.4");
    String str = raw.toString();
    assertThat(str).doesNotContain("CIF-X", "user-x", "cust-x", "dev-x", "1.2.3.4");
    assertThat(str).isEqualTo("RawSensitiveFields[REDACTED]");
  }

  // --- pre-closure functional recovery (§12/§13/§16) - configurable masking policy ---

  @Test
  void allFiveFieldsAreMaskedByDefaultEvenBeforeAnyPolicyChange() {
    RawSensitiveFields raw = new RawSensitiveFields("CIF-1", "user-1", "cust-1", "dev-1", "10.0.0.1");
    MaskedSensitiveFields masked = mask(raw);
    assertThat(masked.cif()).isEqualTo("****");
    assertThat(masked.userName()).isNotEqualTo("user-1");
    assertThat(masked.customerId()).isNotEqualTo("cust-1");
    assertThat(masked.deviceId()).isNotEqualTo("dev-1");
    assertThat(masked.deviceIp()).isNotEqualTo("10.0.0.1");
  }

  @Test
  void disablingMaskingForOneFieldReturnsItsRawValueButLeavesTheOtherFourMasked() {
    policy.setMasked(ProtectedField.CIF, false);
    RawSensitiveFields raw = new RawSensitiveFields("CIF-RAW-VALUE", "user-1", "cust-1", "dev-1", "10.0.0.1");
    MaskedSensitiveFields masked = mask(raw);
    assertThat(masked.cif()).isEqualTo("CIF-RAW-VALUE");
    assertThat(masked.userName()).isNotEqualTo("user-1");
    assertThat(masked.customerId()).isNotEqualTo("cust-1");
    assertThat(masked.deviceId()).isNotEqualTo("dev-1");
    assertThat(masked.deviceIp()).isNotEqualTo("10.0.0.1");
  }

  @Test
  void reEnablingMaskingAfterDisablingItMasksAgain() {
    policy.setMasked(ProtectedField.USER_NAME, false);
    assertThat(mask(new RawSensitiveFields(null, "jane.doe", null, null, null)).userName()).isEqualTo("jane.doe");
    policy.setMasked(ProtectedField.USER_NAME, true);
    assertThat(mask(new RawSensitiveFields(null, "jane.doe", null, null, null)).userName()).isEqualTo("ja***oe");
  }

  @Test
  void everyProtectedFieldCanBeIndividuallyUnmaskedWithoutAffectingTheOthers() {
    for (ProtectedField field : ProtectedField.values()) {
      MaskingPolicyService freshPolicy = new MaskingPolicyService();
      freshPolicy.setMasked(field, false);
      MaskingService freshService = new MaskingService(freshPolicy);
      RawSensitiveFields raw = new RawSensitiveFields("cif-v", "user-v", "cust-v", "dev-v", "10.0.0.9");
      CanonicalLogEvent event = CanonicalLogEvent.builder().sensitive(raw).build();
      MaskedSensitiveFields masked = freshService.mask(event);
      // Exactly the one field toggled off is raw; every other field stays masked.
      assertThat(masked.cif().equals("cif-v")).isEqualTo(field == ProtectedField.CIF);
      assertThat(masked.userName().equals("user-v")).isEqualTo(field == ProtectedField.USER_NAME);
      assertThat(masked.customerId().equals("cust-v")).isEqualTo(field == ProtectedField.CUSTOMER_ID);
      assertThat(masked.deviceId().equals("dev-v")).isEqualTo(field == ProtectedField.DEVICE_ID);
      assertThat(masked.deviceIp().equals("10.0.0.9")).isEqualTo(field == ProtectedField.DEVICE_IP);
    }
  }

  @Test
  void resetToDefaultsRestoresFullMaskingAfterFieldsWereDisabled() {
    policy.setMasked(ProtectedField.CIF, false);
    policy.setMasked(ProtectedField.DEVICE_IP, false);
    policy.resetToDefaults();
    RawSensitiveFields raw = new RawSensitiveFields("CIF-1", null, null, null, "10.0.0.1");
    MaskedSensitiveFields masked = mask(raw);
    assertThat(masked.cif()).isEqualTo("****");
    assertThat(masked.deviceIp()).isNotEqualTo("10.0.0.1");
  }

  @Test
  void aFreshMaskingPolicyServiceAlwaysStartsFullyMaskedTheSafeDefault() {
    MaskingPolicyService freshPolicy = new MaskingPolicyService();
    for (ProtectedField field : ProtectedField.values()) {
      assertThat(freshPolicy.isMasked(field)).isTrue();
    }
  }
}
