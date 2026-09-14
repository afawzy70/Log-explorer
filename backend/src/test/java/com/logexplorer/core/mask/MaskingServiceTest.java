package com.logexplorer.core.mask;

import static org.assertj.core.api.Assertions.assertThat;

import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.RawSensitiveFields;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Mission "Field Mapping Schema Scan + Masking Policy Extension" §B —
 * the owner's fresh/default masking state is now OFF (unmasked), superseding
 * the prior masked-by-default policy — see {@link MaskingPolicyService}'s
 * own javadoc for the full, preserved history of this decision.
 *
 * <p>Most tests in this file exist to verify the MASKING TRANSFORMATION
 * shape itself (strong/partial/IP masking) — those explicitly force the
 * field under test to {@code masked=true} in {@link #forceAllMasked()} so
 * their assertions are completely unaffected by which way the default
 * points. The tests specifically about DEFAULT policy behavior (the final
 * section of this file) are rewritten for the new default direction —
 * never silently left asserting the old, now-false premise.
 */
class MaskingServiceTest {

  private final MaskingPolicyService policy = new MaskingPolicyService();
  private final MaskingService service = new MaskingService(policy);

  /** Forces every protected field to masked=true — used by every test that verifies transformation shape, not default policy. */
  private void forceAllMasked() {
    for (ProtectedField field : ProtectedField.values()) {
      policy.setMasked(field, true);
    }
  }

  @BeforeEach
  void maskEverythingByDefaultForShapeTests() {
    forceAllMasked();
  }

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

  // --- configurable masking policy — transformation still shape-correct regardless of toggling ---

  @Test
  void disablingMaskingForOneFieldReturnsItsRawValueButLeavesTheOtherFourMasked() {
    // Starts from forceAllMasked() (this file's @BeforeEach) - proves the
    // toggle-OFF direction still works correctly regardless of the new
    // default (a user may always choose to mask something the fresh
    // default leaves unmasked, and later choose to unmask it again).
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
  void everyProtectedFieldCanBeIndividuallyMaskedWithoutAffectingTheOthers() {
    for (ProtectedField field : ProtectedField.values()) {
      MaskingPolicyService freshPolicy = new MaskingPolicyService();
      freshPolicy.setMasked(field, true);
      MaskingService freshService = new MaskingService(freshPolicy);
      RawSensitiveFields raw = new RawSensitiveFields("cif-v", "user-v", "cust-v", "dev-v", "10.0.0.9");
      CanonicalLogEvent event = CanonicalLogEvent.builder().sensitive(raw).build();
      MaskedSensitiveFields masked = freshService.mask(event);
      // Exactly the one field toggled ON is masked; every other field stays raw (the fresh default).
      assertThat(masked.cif().equals("cif-v")).isEqualTo(field != ProtectedField.CIF);
      assertThat(masked.userName().equals("user-v")).isEqualTo(field != ProtectedField.USER_NAME);
      assertThat(masked.customerId().equals("cust-v")).isEqualTo(field != ProtectedField.CUSTOMER_ID);
      assertThat(masked.deviceId().equals("dev-v")).isEqualTo(field != ProtectedField.DEVICE_ID);
      assertThat(masked.deviceIp().equals("10.0.0.9")).isEqualTo(field != ProtectedField.DEVICE_IP);
    }
  }

  @Test
  void resetToDefaultsRestoresUnmaskedStateAfterFieldsWereEnabled() {
    policy.setMasked(ProtectedField.CIF, true);
    policy.setMasked(ProtectedField.DEVICE_IP, true);
    policy.resetToDefaults();
    RawSensitiveFields raw = new RawSensitiveFields("CIF-1", null, null, null, "10.0.0.1");
    MaskedSensitiveFields masked = mask(raw);
    assertThat(masked.cif()).isEqualTo("CIF-1");
    assertThat(masked.deviceIp()).isEqualTo("10.0.0.1");
  }

  // --- fresh/default state itself (mission §B — DEFAULT_MASKING_STATE=DISABLED) ---

  @Test
  void aFreshMaskingPolicyServiceStartsFullyUnmaskedTheCurrentOwnerApprovedDefault() {
    MaskingPolicyService freshPolicy = new MaskingPolicyService();
    for (ProtectedField field : ProtectedField.values()) {
      assertThat(freshPolicy.isMasked(field)).isFalse();
    }
  }

  @Test
  void freshStateCifMaskingIsOff() {
    assertThat(new MaskingPolicyService().isMasked(ProtectedField.CIF)).isFalse();
  }

  @Test
  void freshStateUsernameMaskingIsOff() {
    assertThat(new MaskingPolicyService().isMasked(ProtectedField.USER_NAME)).isFalse();
  }

  @Test
  void freshStateCustomerIdMaskingIsOff() {
    assertThat(new MaskingPolicyService().isMasked(ProtectedField.CUSTOMER_ID)).isFalse();
  }

  @Test
  void freshStateDeviceIdMaskingIsOff() {
    assertThat(new MaskingPolicyService().isMasked(ProtectedField.DEVICE_ID)).isFalse();
  }

  @Test
  void freshStateDeviceIpMaskingIsOff() {
    assertThat(new MaskingPolicyService().isMasked(ProtectedField.DEVICE_IP)).isFalse();
  }

  @Test
  void allFiveFieldsAreUnmaskedByDefaultOnAFreshServiceEvenBeforeAnyPolicyChange() {
    MaskingPolicyService freshPolicy = new MaskingPolicyService();
    MaskingService freshService = new MaskingService(freshPolicy);
    RawSensitiveFields raw = new RawSensitiveFields("CIF-1", "user-1", "cust-1", "dev-1", "10.0.0.1");
    CanonicalLogEvent event = CanonicalLogEvent.builder().sensitive(raw).build();
    MaskedSensitiveFields masked = freshService.mask(event);
    assertThat(masked.cif()).isEqualTo("CIF-1");
    assertThat(masked.userName()).isEqualTo("user-1");
    assertThat(masked.customerId()).isEqualTo("cust-1");
    assertThat(masked.deviceId()).isEqualTo("dev-1");
    assertThat(masked.deviceIp()).isEqualTo("10.0.0.1");
  }

  @Test
  void cifVisibleWhenMaskingOff_maskedWhenOn() {
    MaskingPolicyService freshPolicy = new MaskingPolicyService();
    MaskingService freshService = new MaskingService(freshPolicy);
    RawSensitiveFields raw = new RawSensitiveFields("CIF-2449", null, null, null, null);
    CanonicalLogEvent event = CanonicalLogEvent.builder().sensitive(raw).build();

    assertThat(freshService.mask(event).cif()).isEqualTo("CIF-2449");

    freshPolicy.setMasked(ProtectedField.CIF, true);
    assertThat(freshService.mask(event).cif()).isEqualTo("****");
  }

  @Test
  void usernameVisibleWhenMaskingOff_maskedWhenOn() {
    MaskingPolicyService freshPolicy = new MaskingPolicyService();
    MaskingService freshService = new MaskingService(freshPolicy);
    RawSensitiveFields raw = new RawSensitiveFields(null, "jane.doe", null, null, null);
    CanonicalLogEvent event = CanonicalLogEvent.builder().sensitive(raw).build();

    assertThat(freshService.mask(event).userName()).isEqualTo("jane.doe");

    freshPolicy.setMasked(ProtectedField.USER_NAME, true);
    assertThat(freshService.mask(event).userName()).isEqualTo("ja***oe");
  }

  @Test
  void customerIdVisibleWhenMaskingOff_maskedWhenOn() {
    MaskingPolicyService freshPolicy = new MaskingPolicyService();
    MaskingService freshService = new MaskingService(freshPolicy);
    RawSensitiveFields raw = new RawSensitiveFields(null, null, "CUST789012", null, null);
    CanonicalLogEvent event = CanonicalLogEvent.builder().sensitive(raw).build();

    assertThat(freshService.mask(event).customerId()).isEqualTo("CUST789012");

    freshPolicy.setMasked(ProtectedField.CUSTOMER_ID, true);
    assertThat(freshService.mask(event).customerId()).isEqualTo("CU***12");
  }

  @Test
  void deviceIdVisibleWhenMaskingOff_maskedWhenOn() {
    MaskingPolicyService freshPolicy = new MaskingPolicyService();
    MaskingService freshService = new MaskingService(freshPolicy);
    RawSensitiveFields raw = new RawSensitiveFields(null, null, null, "DEVICE-98765", null);
    CanonicalLogEvent event = CanonicalLogEvent.builder().sensitive(raw).build();

    assertThat(freshService.mask(event).deviceId()).isEqualTo("DEVICE-98765");

    freshPolicy.setMasked(ProtectedField.DEVICE_ID, true);
    assertThat(freshService.mask(event).deviceId()).isEqualTo("DE***65");
  }

  @Test
  void deviceIpVisibleWhenMaskingOff_maskedWhenOn() {
    MaskingPolicyService freshPolicy = new MaskingPolicyService();
    MaskingService freshService = new MaskingService(freshPolicy);
    RawSensitiveFields raw = new RawSensitiveFields(null, null, null, null, "10.20.30.40");
    CanonicalLogEvent event = CanonicalLogEvent.builder().sensitive(raw).build();

    assertThat(freshService.mask(event).deviceIp()).isEqualTo("10.20.30.40");

    freshPolicy.setMasked(ProtectedField.DEVICE_IP, true);
    assertThat(freshService.mask(event).deviceIp()).isEqualTo("10.20.30.***");
  }
}
