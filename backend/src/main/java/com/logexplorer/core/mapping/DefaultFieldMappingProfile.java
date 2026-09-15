package com.logexplorer.core.mapping;

import java.util.EnumMap;
import java.util.List;
import java.util.Map;

/**
 * The built-in default {@link FieldMappingProfile}.
 *
 * <p><b>Superseded by owner mission "Service Filter, Docker Performance,
 * and Verified Default Mapping" §C (CLAUDE.md §5 named conflict, applied):
 * </b> this class's original mapping (see git history / the register's
 * "Configurable Log Field Mapping" section for the superseded table)
 * reproduced {@code core.parse.LogLineParser}'s OLD hard-coded {@code
 * mdc.&lt;key&gt;} extraction verbatim, as a conservative migration
 * compatibility profile — deliberately NOT a claim that those paths were
 * owner-verified against real source JSON. The owner has since reviewed
 * real source JSON and explicitly approved the table below as the
 * authoritative built-in default — most fields move from an
 * {@code mdc.<key>} nested path to a bare top-level key; {@link
 * CanonicalField#EVENT_ID} and {@link CanonicalField#ERROR_CODE} stay
 * {@code mdc}-nested; {@link CanonicalField#EXCEPTION} changes from
 * {@code exception} to {@code stack_trace}; {@link
 * CanonicalField#CORRELATION_ID} drops its second (literal-dotted-key)
 * fallback candidate down to the single owner-approved {@code
 * X-Correlation-id} path; {@link CanonicalField#JOURNEY_NAME} gets a real
 * default for the first time. {@link CanonicalField#JOURNEY_ID} and {@link
 * CanonicalField#UI_IDENTIFIER} remain deliberately, permanently
 * unmapped — the owner explicitly declined to guess a default for either
 * (mission §C: "do not infer paths from historical mappings... do not
 * silently assign them from schema scan results").
 *
 * <p>Every non-empty candidate list here has exactly the ONE owner-approved
 * path — {@code core.mapping.FieldMappingProfileService} treats "this
 * field's default candidates are non-empty" as "this field starts {@code
 * VERIFIED}" (see that class's own javadoc): these are no longer merely
 * historical migration candidates but the authoritative, owner-approved
 * built-in default (mission §C: "these mappings are no longer merely
 * historical candidates... must start VERIFIED"). A profile still using
 * this default, unmodified, is always {@code SEARCH_READY} (unchanged from
 * the superseded mission's own §23 requirement: "Existing supported log
 * formats must continue working using the built-in default mapping
 * without requiring immediate manual setup").
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
    candidates.put(CanonicalField.EXCEPTION, one("stack_trace"));

    candidates.put(CanonicalField.CIF, one("cif"));
    candidates.put(CanonicalField.USERNAME, one("userName"));
    candidates.put(CanonicalField.CUSTOMER_ID, one("customerId"));
    candidates.put(CanonicalField.DEVICE_ID, one("deviceId"));
    candidates.put(CanonicalField.DEVICE_IP, one("deviceIp"));

    // Owner-approved single candidate (mission §C) - no second/literal-key
    // fallback anymore; the owner's real source JSON carries this at the
    // top level under this exact bare key.
    candidates.put(CanonicalField.CORRELATION_ID, one("X-Correlation-id"));
    candidates.put(CanonicalField.TRACE_ID, one("traceId"));
    candidates.put(CanonicalField.SPAN_ID, one("spanId"));
    // Deliberately unmapped, permanently - see class javadoc.
    candidates.put(CanonicalField.JOURNEY_ID, List.of());
    candidates.put(CanonicalField.JOURNEY_NAME, one("journeyName"));
    candidates.put(CanonicalField.EVENT_ID, one("mdc.eventId"));

    candidates.put(CanonicalField.BUSINESS_STEP, one("stepName"));
    // Deliberately unmapped, permanently - see class javadoc.
    candidates.put(CanonicalField.UI_IDENTIFIER, List.of());
    candidates.put(CanonicalField.ERROR_CODE, one("mdc.ERROR_CODE"));

    candidates.put(CanonicalField.DEVICE_PLATFORM_TYPE, one("devicePlatformType"));
    candidates.put(CanonicalField.LANGUAGE, one("language"));
    candidates.put(CanonicalField.SERVER_IP, one("serverIp"));
    candidates.put(CanonicalField.SERVER_HOST, one("serverHost"));

    return FieldMappingProfile.of(ID, NAME, candidates);
  }

  private static List<JsonPath> one(String path) {
    return List.of(JsonPath.parse(path));
  }
}
