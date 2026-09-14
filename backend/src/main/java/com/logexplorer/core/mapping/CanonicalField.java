package com.logexplorer.core.mapping;

/**
 * Every canonical Log Explorer field a {@link FieldMappingProfile} can map
 * from source JSON (owner mission: "Configurable Log Field Mapping +
 * Original JSON Sampling"). This is the single authoritative list — the
 * mapping UI, the mapping validation preview, and {@code
 * core.parse.LogLineParser} all iterate this enum rather than each keeping
 * their own field list, so it can never drift.
 *
 * <p>{@link #sensitive()} mirrors {@code core.mask.ProtectedField} exactly
 * (same five fields) — kept as a separate boolean here, rather than a
 * dependency on that enum, so this package has no reason to ever import
 * {@code core.mask} (mapping happens strictly before masking; masking must
 * never need to know about mapping).
 *
 * <p>{@link #JOURNEY_NAME} is new (mission §9) — audited against the
 * existing model and found genuinely absent: {@code CanonicalLogEvent} only
 * ever had {@code journeyId}, never a human-readable journey name (e.g.
 * {@code "SIGN_IN"}). The two are deliberately kept distinct, never equated
 * — see {@code CanonicalLogEvent#journeyName()}'s own javadoc.
 */
public enum CanonicalField {
  TIMESTAMP("timestamp", "Timestamp", false),
  SERVICE("service", "Service", false),
  SEVERITY("severity", "Severity", false),
  MESSAGE("message", "Message", false),
  LOGGER("logger", "Logger", false),
  THREAD("thread", "Thread", false),
  EXCEPTION("exception", "Exception", false),

  CIF("cif", "CIF", true),
  USERNAME("userName", "Username", true),
  CUSTOMER_ID("customerId", "Customer ID", true),
  DEVICE_ID("deviceId", "Device ID", true),
  DEVICE_IP("deviceIp", "Device IP", true),

  CORRELATION_ID("correlationId", "Correlation ID", false),
  TRACE_ID("traceId", "Trace ID", false),
  SPAN_ID("spanId", "Span ID", false),
  JOURNEY_ID("journeyId", "Journey ID", false),
  /** New canonical field — mission §9. Distinct from {@link #JOURNEY_ID}. */
  JOURNEY_NAME("journeyName", "Journey Name", false),
  EVENT_ID("eventId", "Event ID", false),

  BUSINESS_STEP("businessStep", "Business Step", false),
  UI_IDENTIFIER("uiIdentifier", "UI Identifier", false),
  ERROR_CODE("errorCode", "Error Code", false),

  DEVICE_PLATFORM_TYPE("devicePlatformType", "Device Platform Type", false),
  LANGUAGE("language", "Language", false),
  SERVER_IP("serverIp", "Server IP", false),
  SERVER_HOST("serverHost", "Server Host", false);

  private final String key;
  private final String displayName;
  private final boolean sensitive;

  CanonicalField(String key, String displayName, boolean sensitive) {
    this.key = key;
    this.displayName = displayName;
    this.sensitive = sensitive;
  }

  /** Stable wire identifier — used in the mapping profile API/JSON, never renamed. */
  public String key() {
    return key;
  }

  public String displayName() {
    return displayName;
  }

  /** Whether this field is one of the five protected/masked fields (mirrors {@code core.mask.ProtectedField}). */
  public boolean sensitive() {
    return sensitive;
  }

  public static CanonicalField byKey(String key) {
    for (CanonicalField f : values()) {
      if (f.key.equals(key)) {
        return f;
      }
    }
    throw new IllegalArgumentException("Unknown canonical field key: " + key);
  }
}
