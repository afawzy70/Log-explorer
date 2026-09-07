package com.logexplorer.core.parse;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.RawSensitiveFields;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
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
 */
@Component
public class LogLineParser {

  private static final Set<String> CANONICAL_TOP_KEYS = Set.of(
      "@timestamp", "@version", "message", "logger_name", "thread_name",
      "level", "level_value", "application", "mdc", "exception");

  private static final Set<String> CANONICAL_MDC_KEYS = Set.of(
      "cif", "UserName", "CustomerId", "X-Correlation-id", "deviceId", "deviceIp",
      "devicePlatformType", "language", "x-journey-trace-id", "serverIp", "serverHost",
      "stepName", "UIIdentifier", "traceId", "spanId", "event.correlationId", "eventId",
      "ERROR_CODE");

  private final ObjectMapper objectMapper;

  public LogLineParser(ObjectMapper objectMapper) {
    this.objectMapper = objectMapper;
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
    return parseObject(root, line, serviceSourceHint);
  }

  private CanonicalLogEvent malformed(String rawLine, String serviceSourceHint) {
    return CanonicalLogEvent.builder()
        .malformed(true)
        .rawLine(rawLine)
        .serviceSourceHint(serviceSourceHint)
        .build();
  }

  @SuppressWarnings("unchecked")
  private CanonicalLogEvent parseObject(Map<String, Object> root, String rawLine, String serviceSourceHint) {
    CanonicalLogEvent.Builder builder = CanonicalLogEvent.builder();

    String timestampRaw = asString(root.get("@timestamp"));
    builder.timestampRaw(timestampRaw);
    builder.timestamp(parseTimestamp(timestampRaw));

    builder.schemaVersion(asString(root.get("@version")));
    builder.service(asString(root.get("application")));
    builder.serviceSourceHint(serviceSourceHint);
    builder.severity(asString(root.get("level")));
    builder.severityNumber(parseSeverityNumber(root.get("level_value")));
    builder.message(asString(root.get("message")));
    builder.logger(asString(root.get("logger_name")));
    builder.thread(asString(root.get("thread_name")));
    builder.exception(formatException(root.get("exception")));

    Object mdcRaw = root.get("mdc");
    Map<String, Object> mdc = (mdcRaw instanceof Map) ? (Map<String, Object>) mdcRaw : Map.of();

    builder.traceId(asString(mdc.get("traceId")));
    builder.spanId(asString(mdc.get("spanId")));
    builder.journeyId(asString(mdc.get("x-journey-trace-id")));
    builder.eventId(asString(mdc.get("eventId")));
    builder.businessStep(asString(mdc.get("stepName")));
    builder.uiIdentifier(asString(mdc.get("UIIdentifier")));
    builder.errorCode(asString(mdc.get("ERROR_CODE")));
    builder.correlationId(resolveCorrelationId(mdc));
    builder.devicePlatformType(asString(mdc.get("devicePlatformType")));
    builder.language(asString(mdc.get("language")));
    builder.serverIp(asString(mdc.get("serverIp")));
    builder.serverHost(asString(mdc.get("serverHost")));

    builder.sensitive(new RawSensitiveFields(
        asString(mdc.get("cif")),
        asString(mdc.get("UserName")),
        asString(mdc.get("CustomerId")),
        asString(mdc.get("deviceId")),
        asString(mdc.get("deviceIp"))));

    builder.unknownTopLevelFields(unknownEntries(root, CANONICAL_TOP_KEYS));
    builder.unknownMdcFields(unknownEntries(mdc, CANONICAL_MDC_KEYS));

    return builder.build();
  }

  /**
   * Correlation precedence (HANDOVER.md §5.1): {@code mdc["X-Correlation-id"]}
   * first, then the <b>literal</b> key {@code mdc["event.correlationId"]} —
   * a flat key containing a period, not a nested {@code event.correlationId}
   * path. {@code Map.get("event.correlationId")} on the already-parsed mdc
   * map is exactly the safe literal-key access the plan calls for; a
   * JsonPointer/nested-path lookup would incorrectly treat this as {@code
   * event -> correlationId} and find nothing.
   */
  private String resolveCorrelationId(Map<String, Object> mdc) {
    String header = asString(mdc.get("X-Correlation-id"));
    if (header != null && !header.isEmpty()) {
      return header;
    }
    return asString(mdc.get("event.correlationId"));
  }

  private Map<String, Object> unknownEntries(Map<String, Object> source, Set<String> canonicalKeys) {
    Map<String, Object> unknown = new HashMap<>();
    for (Map.Entry<String, Object> entry : source.entrySet()) {
      if (!canonicalKeys.contains(entry.getKey())) {
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
