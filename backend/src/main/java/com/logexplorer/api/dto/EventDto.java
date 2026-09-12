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
    String rawLine,
    String sourceId,
    String composeProject,
    String composeService,
    String containerId,
    String containerName,
    String stream,
    String namespace,
    String pod,
    /**
     * OS-1D review recovery — an opaque, server-issued, HMAC-signed proof
     * that this event's own (source, connection generation, namespace,
     * pod, container) tuple was a real, legitimately-resolved search
     * target. {@code null} for every source except OpenShift. The
     * frontend treats this as an opaque string: never displayed, never
     * persisted, never logged — echoed back verbatim only on a later
     * "Show surrounding logs" call. See {@code core.search.ContextTargetProofCodec}.
     */
    String contextTargetProof
) {
}
