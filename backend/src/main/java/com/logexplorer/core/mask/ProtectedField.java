package com.logexplorer.core.mask;

/**
 * The five protected fields (pre-closure functional recovery §12): the
 * exact set CLAUDE.md §2 rule 1 names, now individually, explicitly
 * configurable via {@link MaskingPolicyService} rather than permanently
 * masked. {@link #key()} is the stable, API-facing identifier used by the
 * masking-settings endpoint and the frontend — never the Java enum name
 * itself, so a future rename of the constant cannot silently change the
 * wire contract.
 */
public enum ProtectedField {
  CIF("cif"),
  USER_NAME("userName"),
  CUSTOMER_ID("customerId"),
  DEVICE_ID("deviceId"),
  DEVICE_IP("deviceIp");

  private final String key;

  ProtectedField(String key) {
    this.key = key;
  }

  public String key() {
    return key;
  }

  public static ProtectedField fromKey(String key) {
    for (ProtectedField field : values()) {
      if (field.key.equals(key)) {
        return field;
      }
    }
    throw new IllegalArgumentException("Unknown protected field: " + key);
  }
}
