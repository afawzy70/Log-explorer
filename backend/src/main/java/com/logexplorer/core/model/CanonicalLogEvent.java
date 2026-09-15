package com.logexplorer.core.model;

import java.time.Instant;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

/**
 * The canonical, source-independent log event shape (HANDOVER.md §5).
 *
 * <p>Immutable. Never serialized directly to the browser — {@code api.dto}
 * types are built from this via {@code core.mask.MaskingService}, and an
 * ArchUnit rule (see the {@code arch} test package) forbids any DTO from
 * depending on this type at all.
 *
 * <p>{@code sourceId}, {@code composeProject}, {@code containerId}, {@code
 * containerName}, {@code stream} are Docker adapter enrichment fields
 * (added Phase C, IMPLEMENTATION_PLAN.md "Phase C" scope item 5); {@code
 * namespace}, {@code pod} are Loki adapter enrichment fields (added Phase
 * D, IMPLEMENTATION_PLAN.md "Phase D" scope item 4 — {@code containerName}
 * is reused for Loki's own container label, since pods have containers
 * too). None of these are sensitive; each is left {@code null} by
 * anything that doesn't have it (the fixture source has none of them).
 *
 * <p>{@code composeService} (Legacy Remediation Slice 3, {@code
 * docs/LEGACY_TO_NEW_REMEDIATION_PLAN.md} §"Slice 3") is the raw {@code
 * com.docker.compose.service} label value — deliberately distinct from the
 * already-existing {@link #service()} (the canonical, cross-source field
 * derived from the log line's own {@code application}/source-metadata,
 * used for search/filter/display everywhere). The two usually agree but
 * are not guaranteed to: {@code composeService} is Compose's own view of
 * "which service container this container is," independent of whatever
 * the application itself claims in its log payload, and exists purely as
 * transparent Docker-adapter provenance metadata, the same class of field
 * {@code composeProject}/{@code containerId} already are.
 *
 * <p>{@code sourceTimestamp} (Legacy Remediation Slice 1 recovery,
 * mandatory blocker #1 — "use source-native pagination position") is the
 * adapter's own native clock for this event — Docker's log-frame receive
 * time, Loki's stream-entry nanosecond timestamp, or fixture's own
 * deterministic per-index instant — as distinct from {@link #timestamp},
 * the *parsed application* timestamp from the log's own content, which can
 * differ from the source-native one and, for a malformed/non-JSON line, is
 * {@code null} while {@code sourceTimestamp} is always still known. Used
 * exclusively for pagination continuation (see {@code api.SearchService}
 * and {@code core.search.PageCursorCodec}) and never returned to the
 * browser — {@code api.dto.EventDto} has no equivalent field, and the
 * displayed/canonical timestamp everywhere in the UI remains {@link
 * #timestamp}, unchanged.
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
    /**
     * Owner mission "Configurable Log Field Mapping" §9 — a human-readable
     * journey name (e.g. {@code "SIGN_IN"}), deliberately distinct from
     * {@link #journeyId}: a journey ID is an opaque correlation identifier
     * for one journey *instance*, while a journey name identifies which
     * journey *kind* it is. Audited against the pre-existing model and
     * found genuinely absent — never silently equated with {@code
     * journeyId}. Null for every event until a {@code
     * core.mapping.FieldMappingProfile} maps it to a real source path (the
     * built-in default profile ships with no candidate for this field —
     * see {@code core.mapping.DefaultFieldMappingProfile}'s own javadoc).
     */
    String journeyName,
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
    String rawLine,
    /**
     * Owner mission "Configurable Log Field Mapping + Original JSON
     * Sampling" §3/§4 — the exact, untouched raw source line/JSON text this
     * event was parsed from, for EVERY event ({@code malformed} or not) —
     * unlike {@link #rawLine} (populated only when {@code malformed}, and
     * already wired into the normal {@code /search} response via {@code
     * api.dto.EventDto#rawLine}). This field is set by {@code
     * core.parse.LogLineParser} for source-neutral, real original-JSON
     * sampling.
     *
     * <p><b>Security boundary (mission §4/§18 —
     * {@code MAPPING_CANNOT_BYPASS_MASKING}): this field must NEVER be
     * added to {@code api.dto.EventDto} or read anywhere in the {@code api}
     * package's normal search/context/journey/live response construction
     * (see {@code api.EventMapper}, the sole {@code CanonicalLogEvent}→DTO
     * boundary). It exists solely for {@code
     * core.mapping.sample.FieldMappingSampleService}'s dedicated, separate,
     * bounded, never-persisted sample-fetch endpoint — a privileged
     * mapping-setup surface, never the normal masked search path
     * ({@code ORIGINAL_MAPPING_SAMPLE != NORMAL_SEARCH_RESPONSE}). An
     * ArchUnit-style test enforces {@code EventDto} never gains a field
     * populated from this one.
     */
    String originalRawJson,
    String sourceId,
    String composeProject,
    String composeService,
    String containerId,
    String containerName,
    String stream,
    String namespace,
    String pod,
    Instant sourceTimestamp,
    /**
     * OS-1D review recovery — an opaque, server-issued, HMAC-signed proof
     * ({@code core.search.ContextTargetProofCodec}) that this event's own
     * ({@code sourceId}, connection generation, {@code namespace}, {@code
     * pod}, {@code containerName}) tuple was a real, legitimately-resolved
     * search target — set only by {@code DirectPodLogProvider} for
     * OpenShift events. Carried through to {@code api.dto.EventDto}
     * unchanged (unlike {@code sourceTimestamp}) so the frontend can echo
     * it back on a later "Show surrounding logs" call; every other source
     * leaves this {@code null}. Not sensitive (a signed opaque token, the
     * same class of value {@code SearchRequest#cursor} already is), but
     * kept out of {@code toString}-style logging anyway per this recovery's
     * own "do not log it" instruction — see {@code SearchRequest#toString}
     * for the matching request-side redaction.
     */
    String contextTargetProof,
    /**
     * Owner mission "Event Classification, Extraction, and Portable Rules" —
     * the classification rules that matched this event, each with its own
     * extracted values, computed at runtime by {@code
     * core.classify.ClassificationEngine} right after parsing and field
     * mapping. Never persisted. Extracted values are raw here and are
     * redacted only at the {@code api.EventMapper} boundary, exactly like
     * {@link #message}.
     */
    List<RuleMatch> classifications
) {

  public CanonicalLogEvent {
    // A real bug, found only against real-world container logs (never
    // reproduced by the fixture/mock corpora, which never happened to
    // include one): Map.copyOf rejects any null *value*, but a genuine
    // unknown top-level or MDC field in a real Spring Boot JSON log line
    // can legitimately be JSON `null` (e.g. "exception": null when
    // absent) - a perfectly valid value, not a malformed one.
    // Collections.unmodifiableMap tolerates null values (only Map.copyOf
    // and Map.of() reject them), preserving the field's real value
    // faithfully - "never discard unknown JSON or MDC fields" (CLAUDE.md
    // §4 "Parsing") applies just as much to a null-valued field as any
    // other.
    unknownTopLevelFields = unknownTopLevelFields == null
        ? Map.of()
        : Collections.unmodifiableMap(new LinkedHashMap<>(unknownTopLevelFields));
    unknownMdcFields = unknownMdcFields == null
        ? Map.of()
        : Collections.unmodifiableMap(new LinkedHashMap<>(unknownMdcFields));
    sensitive = sensitive == null ? RawSensitiveFields.empty() : sensitive;
    classifications = classifications == null ? List.of() : List.copyOf(classifications);
  }

  /** De-duplicated tags of every matching classification rule, in deterministic rule order. */
  public List<String> tags() {
    if (classifications.isEmpty()) {
      return List.of();
    }
    LinkedHashSet<String> tags = new LinkedHashSet<>();
    for (RuleMatch match : classifications) {
      tags.addAll(match.tags());
    }
    return List.copyOf(tags);
  }

  public static Builder builder() {
    return new Builder();
  }

  /**
   * A {@link Builder} pre-populated from this event — for adapters (Docker,
   * Loki) that parse via {@code core.parse.LogLineParser} and then need to
   * stamp on their own enrichment fields ({@code composeProject}, {@code
   * containerId}, ...) without hand-copying every existing field.
   */
  public Builder toBuilder() {
    return new Builder()
        .timestamp(timestamp)
        .timestampRaw(timestampRaw)
        .schemaVersion(schemaVersion)
        .service(service)
        .serviceSourceHint(serviceSourceHint)
        .severity(severity)
        .severityNumber(severityNumber)
        .message(message)
        .logger(logger)
        .thread(thread)
        .exception(exception)
        .traceId(traceId)
        .spanId(spanId)
        .journeyId(journeyId)
        .journeyName(journeyName)
        .eventId(eventId)
        .businessStep(businessStep)
        .uiIdentifier(uiIdentifier)
        .errorCode(errorCode)
        .correlationId(correlationId)
        .sensitive(sensitive)
        .devicePlatformType(devicePlatformType)
        .language(language)
        .serverIp(serverIp)
        .serverHost(serverHost)
        .unknownTopLevelFields(unknownTopLevelFields)
        .unknownMdcFields(unknownMdcFields)
        .malformed(malformed)
        .rawLine(rawLine)
        .originalRawJson(originalRawJson)
        .sourceId(sourceId)
        .composeProject(composeProject)
        .composeService(composeService)
        .containerId(containerId)
        .containerName(containerName)
        .stream(stream)
        .namespace(namespace)
        .pod(pod)
        .sourceTimestamp(sourceTimestamp)
        .contextTargetProof(contextTargetProof)
        .classifications(classifications);
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
    private String journeyName;
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
    private String originalRawJson;
    private String sourceId;
    private String composeProject;
    private String composeService;
    private String containerId;
    private String containerName;
    private String stream;
    private String namespace;
    private String pod;
    private Instant sourceTimestamp;
    private String contextTargetProof;
    private List<RuleMatch> classifications = List.of();

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
    public Builder journeyName(String v) { this.journeyName = v; return this; }
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
    public Builder originalRawJson(String v) { this.originalRawJson = v; return this; }
    public Builder sourceId(String v) { this.sourceId = v; return this; }
    public Builder composeProject(String v) { this.composeProject = v; return this; }
    public Builder composeService(String v) { this.composeService = v; return this; }
    public Builder containerId(String v) { this.containerId = v; return this; }
    public Builder containerName(String v) { this.containerName = v; return this; }
    public Builder stream(String v) { this.stream = v; return this; }
    public Builder namespace(String v) { this.namespace = v; return this; }
    public Builder pod(String v) { this.pod = v; return this; }
    public Builder sourceTimestamp(Instant v) { this.sourceTimestamp = v; return this; }
    /** OS-1D review recovery — see the field's own javadoc. */
    public Builder contextTargetProof(String v) { this.contextTargetProof = v; return this; }
    /** Runtime classification results — see the field's own javadoc. */
    public Builder classifications(List<RuleMatch> v) { this.classifications = v; return this; }

    public CanonicalLogEvent build() {
      return new CanonicalLogEvent(
          timestamp, timestampRaw, schemaVersion, service, serviceSourceHint,
          severity, severityNumber, message, logger, thread, exception,
          traceId, spanId, journeyId, journeyName, eventId, businessStep, uiIdentifier,
          errorCode, correlationId, sensitive, devicePlatformType, language,
          serverIp, serverHost, unknownTopLevelFields, unknownMdcFields,
          malformed, rawLine, originalRawJson, sourceId, composeProject, composeService, containerId, containerName, stream,
          namespace, pod, sourceTimestamp, contextTargetProof, classifications);
    }
  }
}
