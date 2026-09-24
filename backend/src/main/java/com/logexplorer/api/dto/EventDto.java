package com.logexplorer.api.dto;

import com.logexplorer.core.mask.MaskedSensitiveFields;
import java.time.Instant;
import java.util.List;
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
    /** New canonical field (mission "Configurable Log Field Mapping" §9) — see {@code core.model.CanonicalLogEvent#journeyName}'s own javadoc for why it is distinct from {@link #journeyId}. */
    String journeyName,
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
    /**
     * Owner report — a masked rendering of the untouched source line/JSON
     * this event was parsed from ({@code core.model.CanonicalLogEvent
     * #originalRawJson}), for every event, not just malformed ones. Built
     * exclusively by {@code core.mask.MaskingService#maskRawJson} (see its
     * own javadoc) — the same single masking boundary {@link
     * #protectedFields} already goes through, just applied to the whole
     * source text rather than to individual resolved fields. Deliberately
     * distinct from both the frontend's "Canonical Event JSON" (this app's
     * own re-serialized, already-masked DTO) and the Field Mapping
     * settings workflow's genuinely unmasked "Original Source JSON"
     * sample — see {@code AllFieldsSection.tsx}'s own comment for that
     * three-way distinction. {@code null} when the source never supplied
     * this content at all.
     */
    String rawJson,
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
    String contextTargetProof,
    List<String> tags,
    List<ClassificationDto> classifications
) {
}
