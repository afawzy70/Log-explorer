package com.logexplorer.core.mapping;

import java.util.EnumMap;
import java.util.List;
import java.util.Map;

/**
 * The built-in default {@link FieldMappingProfile} — reproduces {@code
 * core.parse.LogLineParser}'s previous hard-coded {@code mdc.<key>}
 * extraction EXACTLY, field for field, path for path (mission §11: "Do NOT
 * invent final owner defaults beyond current known verified mappings.
 * Preserve current mappings as the initial built-in compatibility
 * profile.").
 *
 * <p>Every candidate list here has exactly the single path the old
 * hard-coded parser used, with one exception: {@link
 * CanonicalField#CORRELATION_ID}, which already had two candidates in the
 * old parser ({@code resolveCorrelationId}) and keeps both, in the same
 * order. {@link CanonicalField#JOURNEY_NAME} is new (mission §9) and
 * deliberately ships with <b>zero</b> candidates — no verified default
 * mapping exists yet; the owner will confirm one after reviewing real
 * source JSON (mission §11, §31). A profile still using this default,
 * unmodified, is always {@code SEARCH_READY} (mission §23: "Existing
 * supported log formats must continue working using the built-in default
 * mapping without requiring immediate manual setup") — see {@code
 * FieldMappingProfileService}.
 */
public final class DefaultFieldMappingProfile {

  public static final String ID = "default";
  public static final String NAME = "Default (built-in compatibility)";

  private DefaultFieldMappingProfile() {
  }

  public static FieldMappingProfile build() {
    Map<CanonicalField, List<JsonPath>> candidates = new EnumMap<>(CanonicalField.class);

    candidates.put(CanonicalField.TIMESTAMP, one("@timestamp"));
    candidates.put(CanonicalField.SERVICE, one("application"));
    candidates.put(CanonicalField.SEVERITY, one("level"));
    candidates.put(CanonicalField.MESSAGE, one("message"));
    candidates.put(CanonicalField.LOGGER, one("logger_name"));
    candidates.put(CanonicalField.THREAD, one("thread_name"));
    candidates.put(CanonicalField.EXCEPTION, one("exception"));

    candidates.put(CanonicalField.CIF, one("mdc.cif"));
    candidates.put(CanonicalField.USERNAME, one("mdc.UserName"));
    candidates.put(CanonicalField.CUSTOMER_ID, one("mdc.CustomerId"));
    candidates.put(CanonicalField.DEVICE_ID, one("mdc.deviceId"));
    candidates.put(CanonicalField.DEVICE_IP, one("mdc.deviceIp"));

    // Preserves core.parse.LogLineParser#resolveCorrelationId's exact
    // precedence: the header-shaped MDC key first, then the literal
    // (bracket-quoted, NOT nested) "event.correlationId" flat key.
    candidates.put(CanonicalField.CORRELATION_ID, List.of(
        JsonPath.parse("mdc.X-Correlation-id"),
        JsonPath.parse("mdc[\"event.correlationId\"]")));
    candidates.put(CanonicalField.TRACE_ID, one("mdc.traceId"));
    candidates.put(CanonicalField.SPAN_ID, one("mdc.spanId"));
    candidates.put(CanonicalField.JOURNEY_ID, one("mdc.x-journey-trace-id"));
    candidates.put(CanonicalField.JOURNEY_NAME, List.of()); // intentionally unmapped — see class javadoc
    candidates.put(CanonicalField.EVENT_ID, one("mdc.eventId"));

    candidates.put(CanonicalField.BUSINESS_STEP, one("mdc.stepName"));
    candidates.put(CanonicalField.UI_IDENTIFIER, one("mdc.UIIdentifier"));
    candidates.put(CanonicalField.ERROR_CODE, one("mdc.ERROR_CODE"));

    candidates.put(CanonicalField.DEVICE_PLATFORM_TYPE, one("mdc.devicePlatformType"));
    candidates.put(CanonicalField.LANGUAGE, one("mdc.language"));
    candidates.put(CanonicalField.SERVER_IP, one("mdc.serverIp"));
    candidates.put(CanonicalField.SERVER_HOST, one("mdc.serverHost"));

    return FieldMappingProfile.of(ID, NAME, candidates);
  }

  private static List<JsonPath> one(String path) {
    return List.of(JsonPath.parse(path));
  }
}
