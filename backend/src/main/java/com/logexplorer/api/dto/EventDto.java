package com.logexplorer.api.dto;

import com.logexplorer.core.mask.MaskedSensitiveFields;
import java.time.Instant;
import java.util.Map;

/**
 * The only shape of an event that ever leaves the backend. Deliberately has
 * no field of type {@code core.model.CanonicalLogEvent} or {@code
 * core.model.RawSensitiveFields} — enforced by an ArchUnit rule (see the
 * {@code arch} test package) so this can never regress silently. {@link
 * #protectedFields} carries only already-masked values. Fields are never
 * omitted from the JSON, even when {@code null} — explicit absence beats
 * silent omission.
 */
public record EventDto(
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
    MaskedSensitiveFields protectedFields,
    String devicePlatformType,
    String language,
    String serverIp,
    String serverHost,
    Map<String, Object> unknownTopLevelFields,
    Map<String, Object> unknownMdcFields,
    boolean malformed,
    String rawLine
) {
}
