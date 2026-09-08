package com.logexplorer.core.model;

import java.time.Instant;
import java.util.Map;

/**
 * The canonical, source-independent log event shape (HANDOVER.md §5).
 *
 * <p>Immutable. Never serialized directly to the browser — {@code api.dto}
 * types are built from this via {@code core.mask.MaskingService}, and an
 * ArchUnit rule (see the {@code arch} test package) forbids any DTO from
 * depending on this type at all.
 */
public record CanonicalLogEvent(
    Instant timestamp,
    String timestampRaw,
    String schemaVersion,
    String service,
    String serviceSourceHint,
    String severity,
    Integer severityNumber,
    String message,
    String logger,
    String thread,
    String exception,
    String traceId,
    String spanId,
    String journeyId,
    String eventId,
    String businessStep,
    String uiIdentifier,
    String errorCode,
    String correlationId,
    RawSensitiveFields sensitive,
    String devicePlatformType,
    String language,
    String serverIp,
    String serverHost,
    Map<String, Object> unknownTopLevelFields,
    Map<String, Object> unknownMdcFields,
    boolean malformed,
    String rawLine
) {

  public CanonicalLogEvent {
    unknownTopLevelFields = unknownTopLevelFields == null ? Map.of() : Map.copyOf(unknownTopLevelFields);
    unknownMdcFields = unknownMdcFields == null ? Map.of() : Map.copyOf(unknownMdcFields);
    sensitive = sensitive == null ? RawSensitiveFields.empty() : sensitive;
  }

  public static Builder builder() {
    return new Builder();
  }

  /** Builder for a large immutable record — plain positional construction would be error-prone. */
  public static final class Builder {
    private Instant timestamp;
    private String timestampRaw;
    private String schemaVersion;
    private String service;
    private String serviceSourceHint;
    private String severity;
    private Integer severityNumber;
    private String message;
    private String logger;
    private String thread;
    private String exception;
    private String traceId;
    private String spanId;
    private String journeyId;
    private String eventId;
    private String businessStep;
    private String uiIdentifier;
    private String errorCode;
    private String correlationId;
    private RawSensitiveFields sensitive = RawSensitiveFields.empty();
    private String devicePlatformType;
    private String language;
    private String serverIp;
    private String serverHost;
    private Map<String, Object> unknownTopLevelFields = Map.of();
    private Map<String, Object> unknownMdcFields = Map.of();
    private boolean malformed;
    private String rawLine;

    public Builder timestamp(Instant v) { this.timestamp = v; return this; }
    public Builder timestampRaw(String v) { this.timestampRaw = v; return this; }
    public Builder schemaVersion(String v) { this.schemaVersion = v; return this; }
    public Builder service(String v) { this.service = v; return this; }
    public Builder serviceSourceHint(String v) { this.serviceSourceHint = v; return this; }
    public Builder severity(String v) { this.severity = v; return this; }
    public Builder severityNumber(Integer v) { this.severityNumber = v; return this; }
    public Builder message(String v) { this.message = v; return this; }
    public Builder logger(String v) { this.logger = v; return this; }
    public Builder thread(String v) { this.thread = v; return this; }
    public Builder exception(String v) { this.exception = v; return this; }
    public Builder traceId(String v) { this.traceId = v; return this; }
    public Builder spanId(String v) { this.spanId = v; return this; }
    public Builder journeyId(String v) { this.journeyId = v; return this; }
    public Builder eventId(String v) { this.eventId = v; return this; }
    public Builder businessStep(String v) { this.businessStep = v; return this; }
    public Builder uiIdentifier(String v) { this.uiIdentifier = v; return this; }
    public Builder errorCode(String v) { this.errorCode = v; return this; }
    public Builder correlationId(String v) { this.correlationId = v; return this; }
    public Builder sensitive(RawSensitiveFields v) { this.sensitive = v; return this; }
    public Builder devicePlatformType(String v) { this.devicePlatformType = v; return this; }
    public Builder language(String v) { this.language = v; return this; }
    public Builder serverIp(String v) { this.serverIp = v; return this; }
    public Builder serverHost(String v) { this.serverHost = v; return this; }
    public Builder unknownTopLevelFields(Map<String, Object> v) { this.unknownTopLevelFields = v; return this; }
    public Builder unknownMdcFields(Map<String, Object> v) { this.unknownMdcFields = v; return this; }
    public Builder malformed(boolean v) { this.malformed = v; return this; }
    public Builder rawLine(String v) { this.rawLine = v; return this; }

    public CanonicalLogEvent build() {
      return new CanonicalLogEvent(
          timestamp, timestampRaw, schemaVersion, service, serviceSourceHint,
          severity, severityNumber, message, logger, thread, exception,
          traceId, spanId, journeyId, eventId, businessStep, uiIdentifier,
          errorCode, correlationId, sensitive, devicePlatformType, language,
          serverIp, serverHost, unknownTopLevelFields, unknownMdcFields,
          malformed, rawLine);
    }
  }
}
