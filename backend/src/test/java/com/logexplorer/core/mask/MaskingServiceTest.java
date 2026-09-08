package com.logexplorer.core.mask;

import static org.assertj.core.api.Assertions.assertThat;

import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.RawSensitiveFields;
import org.junit.jupiter.api.Test;

class MaskingServiceTest {

  private final MaskingService service = new MaskingService();

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
}
