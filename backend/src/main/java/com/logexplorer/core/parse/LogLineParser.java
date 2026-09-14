package com.logexplorer.core.parse;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.logexplorer.core.mapping.CanonicalField;
import com.logexplorer.core.mapping.FieldMappingProfile;
import com.logexplorer.core.mapping.FieldMappingProfileService;
import com.logexplorer.core.mapping.FieldMappingResolver;
import com.logexplorer.core.mapping.JsonPath;
import com.logexplorer.core.mapping.MappingScopeKey;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.RawSensitiveFields;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

/**
 * Parses one raw log line into a {@link CanonicalLogEvent} (HANDOVER.md §5).
 *
 * <p>Never throws for malformed input — a line that isn't valid JSON, or
 * isn't a JSON object, becomes a raw fallback event ({@code
 * CanonicalLogEvent.malformed() == true}, with {@code rawLine} set) rather
 * than being dropped. A single bad
 * <em>field</em> inside an otherwise-valid JSON object (an unparseable
 * timestamp, a non-numeric {@code level_value}) does not discard the rest
 * of the event either — each risky field is parsed defensively on its own.
 *
 * <p><b>Configurable field mapping</b> (owner mission "Configurable Log
 * Field Mapping + Original JSON Sampling"): every canonical field except
 * {@code schemaVersion} and {@code severityNumber} is now resolved through
 * {@link FieldMappingResolver} against the currently active {@link
 * FieldMappingProfile} ({@link FieldMappingProfileService#activeProfile()})
 * rather than a fixed set of hard-coded {@code mdc.<key>} paths. The
 * built-in default profile ({@code core.mapping.DefaultFieldMappingProfile})
 * reproduces this class's own previous hard-coded extraction exactly,
 * field for field — so parsing behavior is byte-for-byte unchanged until an
 * owner explicitly edits and saves a different mapping (mission §23
 * "Existing supported log formats must continue working using the built-in
 * default mapping"). What actually changes is that a source whose sensitive/
 * business fields live somewhere other than {@code mdc.<key>} (the owner's
 * observed defect — a top-level {@code cif} that today lands only in
 * {@code unknownTopLevelFields}) can now be mapped correctly without a code
 * change, by adding an alternate candidate path in the mapping settings.
 *
 * <p>{@code root} is still needed by {@link #unknownEntries} after mapping
 * resolution — "known" top-level/MDC keys are now derived from the active
 * profile's own single-segment and {@code mdc.<single-segment>} candidate
 * paths (the same flat two-level shape the original hard-coded key sets
 * always assumed) rather than a fixed constant set, so unknown-field
 * display never drifts out of sync with whatever mapping is actually
 * active. A candidate path with a different shape (three-plus segments, or
 * nested outside {@code mdc}) does not remove its leaf key from "unknown" —
 * the flat top-level/MDC unknown-field model predates this mission and is
 * deliberately left as-is rather than generalized further here.
 */
@Component
public class LogLineParser {

  private final ObjectMapper objectMapper;
  private final FieldMappingProfileService mappingProfileService;

  public LogLineParser(ObjectMapper objectMapper, FieldMappingProfileService mappingProfileService) {
    this.objectMapper = objectMapper;
    this.mappingProfileService = mappingProfileService;
  }

  public CanonicalLogEvent parse(String line) {
    return parse(line, null);
  }

  /**
   * @param serviceSourceHint adapter-provided service metadata (e.g. Compose
   *     service, OpenShift metadata) — retained alongside the top-level
   *     {@code application} field per the service-precedence rule
   *     (HANDOVER.md §5.2), even when the two agree. {@code null} when the
   *     adapter has nothing to add (true for every caller until Phase C/D).
   */
  public CanonicalLogEvent parse(String line, String serviceSourceHint) {
    return parse(line, serviceSourceHint, MappingScopeKey.UNSPECIFIED);
  }

  /**
   * Owner mission "Project-Scoped Schema Scan" §7/§8 — resolves the
   * active {@link FieldMappingProfile} for the exact scope ({@code
   * sourceId} + Compose project/OpenShift namespace/logical workload)
   * this line was actually read from, rather than one global profile.
   * Every real adapter (Docker, OpenShift, Loki, Fixture) resolves and
   * passes its own real {@link MappingScopeKey} here; the two shorter
   * overloads above exist only for scope-agnostic callers (mapping-
   * mechanics unit tests) and use {@link MappingScopeKey#UNSPECIFIED}.
   */
  public CanonicalLogEvent parse(String line, String serviceSourceHint, MappingScopeKey scope) {
    if (line == null) {
      return malformed(null, serviceSourceHint);
    }
    Map<String, Object> root;
    try {
      root = objectMapper.readValue(line, new TypeReference<LinkedHashMap<String, Object>>() { });
    } catch (Exception e) {
      // Any parse failure (invalid JSON, or JSON that isn't an object, e.g.
      // a bare array or scalar) -> raw fallback event. Never dropped.
      return malformed(line, serviceSourceHint);
    }
    if (root == null) {
      return malformed(line, serviceSourceHint);
    }
    return parseObject(root, line, serviceSourceHint, scope);
  }

  private CanonicalLogEvent malformed(String rawLine, String serviceSourceHint) {
    return CanonicalLogEvent.builder()
        .malformed(true)
        .rawLine(rawLine)
        .originalRawJson(rawLine)
        .serviceSourceHint(serviceSourceHint)
        .build();
  }

  @SuppressWarnings("unchecked")
  private CanonicalLogEvent parseObject(Map<String, Object> root, String rawLine, String serviceSourceHint, MappingScopeKey scope) {
    CanonicalLogEvent.Builder builder = CanonicalLogEvent.builder();
    FieldMappingProfile profile = mappingProfileService.activeProfile(scope);
    Map<CanonicalField, String> resolved = FieldMappingResolver.resolveAll(root, profile);

    String timestampRaw = resolved.get(CanonicalField.TIMESTAMP);
    builder.timestampRaw(timestampRaw);
    builder.timestamp(parseTimestamp(timestampRaw));

    // Not user-mappable (mission §8 does not list either as a canonical
    // field): schema version is internal Logstash-format metadata, and
    // severityNumber needs the raw Object (to distinguish a numeric
    // level_value from a numeric-looking string) rather than the
    // string-only resolution every other field uses.
    builder.schemaVersion(asString(root.get("@version")));
    builder.severityNumber(parseSeverityNumber(root.get("level_value")));

    builder.service(resolved.get(CanonicalField.SERVICE));
    builder.serviceSourceHint(serviceSourceHint);
    builder.severity(resolved.get(CanonicalField.SEVERITY));
    builder.message(resolved.get(CanonicalField.MESSAGE));
    builder.logger(resolved.get(CanonicalField.LOGGER));
    builder.thread(resolved.get(CanonicalField.THREAD));
    builder.exception(formatException(resolveRawException(root, profile)));

    builder.traceId(resolved.get(CanonicalField.TRACE_ID));
    builder.spanId(resolved.get(CanonicalField.SPAN_ID));
    builder.journeyId(resolved.get(CanonicalField.JOURNEY_ID));
    builder.journeyName(resolved.get(CanonicalField.JOURNEY_NAME));
    builder.eventId(resolved.get(CanonicalField.EVENT_ID));
    builder.businessStep(resolved.get(CanonicalField.BUSINESS_STEP));
    builder.uiIdentifier(resolved.get(CanonicalField.UI_IDENTIFIER));
    builder.errorCode(resolved.get(CanonicalField.ERROR_CODE));
    builder.correlationId(resolved.get(CanonicalField.CORRELATION_ID));
    builder.devicePlatformType(resolved.get(CanonicalField.DEVICE_PLATFORM_TYPE));
    builder.language(resolved.get(CanonicalField.LANGUAGE));
    builder.serverIp(resolved.get(CanonicalField.SERVER_IP));
    builder.serverHost(resolved.get(CanonicalField.SERVER_HOST));

    builder.sensitive(new RawSensitiveFields(
        resolved.get(CanonicalField.CIF),
        resolved.get(CanonicalField.USERNAME),
        resolved.get(CanonicalField.CUSTOMER_ID),
        resolved.get(CanonicalField.DEVICE_ID),
        resolved.get(CanonicalField.DEVICE_IP)));

    Object mdcRaw = root.get("mdc");
    Map<String, Object> mdc = (mdcRaw instanceof Map) ? (Map<String, Object>) mdcRaw : Map.of();
    builder.unknownTopLevelFields(unknownEntries(root, knownTopLevelKeys(profile)));
    builder.unknownMdcFields(unknownEntries(mdc, knownMdcKeys(profile)));

    builder.originalRawJson(rawLine);

    return builder.build();
  }

  /**
   * Exception formatting still needs the raw {@code Object} (a String, a
   * structured {@code {class, message, stacktrace}} map, or a list of
   * lines) — {@link FieldMappingResolver} only ever returns a resolved
   * {@code String}, so this re-resolves the same candidate path(s) as raw
   * values via {@code core.mapping.JsonPathResolver} directly rather than
   * going through the string-only path.
   */
  private Object resolveRawException(Map<String, Object> root, FieldMappingProfile profile) {
    List<JsonPath> candidates = profile.candidates(CanonicalField.EXCEPTION);
    for (int i = 0; i < candidates.size(); i++) {
      Object value = com.logexplorer.core.mapping.JsonPathResolver.resolveRaw(root, candidates.get(i));
      boolean isLast = i == candidates.size() - 1;
      if (isLast) {
        return value;
      }
      if (value != null && !(value instanceof String s && s.isEmpty())) {
        return value;
      }
    }
    return null;
  }

  /**
   * Every active-profile candidate path shaped as a single top-level
   * segment (e.g. {@code application}, {@code message}) — the "known"
   * top-level keys for {@link #unknownEntries}. See class javadoc for why
   * only this flat shape is recognized.
   */
  private java.util.Set<String> knownTopLevelKeys(FieldMappingProfile profile) {
    java.util.Set<String> known = new java.util.HashSet<>(java.util.Set.of("mdc"));
    for (CanonicalField field : CanonicalField.values()) {
      for (JsonPath path : profile.candidates(field)) {
        if (path.segments().size() == 1) {
          known.add(path.segments().get(0));
        }
      }
    }
    return known;
  }

  /** Every active-profile candidate path shaped as {@code mdc.<key>} (exactly two segments, first "mdc") — the "known" MDC keys. */
  private java.util.Set<String> knownMdcKeys(FieldMappingProfile profile) {
    java.util.Set<String> known = new java.util.HashSet<>();
    for (CanonicalField field : CanonicalField.values()) {
      for (JsonPath path : profile.candidates(field)) {
        if (path.segments().size() == 2 && "mdc".equals(path.segments().get(0))) {
          known.add(path.segments().get(1));
        }
      }
    }
    return known;
  }

  private Map<String, Object> unknownEntries(Map<String, Object> source, java.util.Set<String> knownKeys) {
    Map<String, Object> unknown = new HashMap<>();
    for (Map.Entry<String, Object> entry : source.entrySet()) {
      if (!knownKeys.contains(entry.getKey())) {
        unknown.put(entry.getKey(), entry.getValue());
      }
    }
    return unknown;
  }

  private Instant parseTimestamp(String raw) {
    if (raw == null || raw.isEmpty()) {
      return null;
    }
    try {
      return OffsetDateTime.parse(raw).toInstant();
    } catch (DateTimeParseException e1) {
      try {
        return Instant.parse(raw);
      } catch (DateTimeParseException e2) {
        // Single bad field: keep timestampRaw, leave the normalized
        // timestamp null rather than discarding the whole event.
        return null;
      }
    }
  }

  private Integer parseSeverityNumber(Object raw) {
    if (raw == null) {
      return null;
    }
    if (raw instanceof Number number) {
      return number.intValue();
    }
    if (raw instanceof String s) {
      try {
        return Integer.parseInt(s.trim());
      } catch (NumberFormatException e) {
        return null;
      }
    }
    return null;
  }

  @SuppressWarnings("unchecked")
  private String formatException(Object raw) {
    if (raw == null) {
      return null;
    }
    if (raw instanceof String s) {
      return s;
    }
    if (raw instanceof Map<?, ?> map) {
      Map<String, Object> m = (Map<String, Object>) map;
      StringBuilder sb = new StringBuilder();
      Object clazz = m.get("class");
      Object message = m.get("message");
      if (clazz != null || message != null) {
        sb.append(clazz != null ? clazz : "").append(message != null ? ": " + message : "");
      }
      Object stacktrace = m.get("stacktrace");
      if (stacktrace instanceof List<?> lines) {
        for (Object l : lines) {
          if (sb.length() > 0) {
            sb.append('\n');
          }
          sb.append(asString(l));
        }
      }
      return sb.length() > 0 ? sb.toString() : String.valueOf(m);
    }
    if (raw instanceof List<?> lines) {
      StringBuilder sb = new StringBuilder();
      for (Object l : lines) {
        if (sb.length() > 0) {
          sb.append('\n');
        }
        sb.append(asString(l));
      }
      return sb.toString();
    }
    return String.valueOf(raw);
  }

  private String asString(Object value) {
    if (value == null) {
      return null;
    }
    if (value instanceof String s) {
      return s;
    }
    return String.valueOf(value);
  }
}
