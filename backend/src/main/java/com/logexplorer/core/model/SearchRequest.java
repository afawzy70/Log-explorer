package com.logexplorer.core.model;

import com.logexplorer.core.query.QueryParser;
import com.logexplorer.core.query.ast.QueryExpr;
import java.time.Instant;
import java.util.List;

/**
 * A bounded historical search request (HANDOVER.md §8).
 *
 * <p>{@code text} is free text the investigator typed or pasted — it may
 * contain anything, including something that looks like a sensitive
 * identifier — so it is treated the same as the five named sensitive
 * fields for logging purposes: {@link #toString()} redacts both {@code
 * text} and {@code sensitiveFilters}, never the structural fields (source,
 * time range, limit, services, levels, non-sensitive IDs), which are safe
 * and useful to see in diagnostics.
 *
 * <p>{@code query} is the parsed DSL AST (HANDOVER.md §9) — parsed exactly
 * once, eagerly, inside {@link Builder#query(String)}, never re-parsed per
 * event; ANDed with every other structured filter by {@code
 * core.search.EventFilters}. {@code rawLogQl} is Loki-only raw LogQL text
 * (IMPLEMENTATION_PLAN.md "Phase E" scope item 8), gated by {@code
 * api.SearchService} against the target source's {@code
 * capabilities().rawLogQL()} before ever reaching a {@code LogSource}.
 * Both are exactly the class of "search value" CLAUDE.md's "never log
 * search values" rule covers, so {@link #toString()} redacts both — {@code
 * query}'s own AST node types already self-redact their literal values
 * too (defense in depth), and {@code rawLogQl} is arbitrary free text.
 */
public record SearchRequest(
    String sourceId,
    Instant start,
    Instant end,
    Direction direction,
    Integer limit,
    List<String> services,
    List<String> levels,
    String text,
    String traceId,
    String spanId,
    String correlationId,
    String journeyId,
    String eventId,
    String errorCode,
    String businessStep,
    String uiIdentifier,
    String loggerContains,
    String devicePlatform,
    String language,
    String containerId,
    String pod,
    /**
     * OS-1D — a generic (source-interpreted) container-name scope hint,
     * parallel to {@link #containerId} (Docker's own hash-based identity)
     * and {@link #pod} (already shared by Loki and OpenShift). Only ever
     * populated by {@code api.SearchController}'s {@code /context}
     * endpoint, exactly like {@code containerId}/{@code pod} already are —
     * never a general-search filter. {@code OpenShiftLogSource} has no
     * short container-id concept at all (a Kubernetes container's only
     * durable identity within a pod is its name), so this is what lets
     * "Show surrounding logs" narrow to the exact (pod, container) an
     * OpenShift event came from, the same way {@code containerId} already
     * narrows a Docker context call.
     */
    String containerName,
    /**
     * OS-1D review recovery — the opaque, server-issued, HMAC-signed proof
     * ({@code core.search.ContextTargetProofCodec}) that {@link #pod}/
     * {@link #containerName} were a real, legitimately-resolved target of
     * a search this backend itself produced. Only ever populated by the
     * {@code /context} endpoint, exactly like {@code pod}/{@code
     * containerName} — required by {@code DirectPodLogProvider} only when
     * the named target is no longer present in the currently cached OS-1B
     * scope (a pod that disappeared since the original search); a target
     * still in current scope is authorized by normal scope validation and
     * never needs this field at all. A client-supplied {@code pod}/{@code
     * containerName} pair is never, by itself, sufficient authorization —
     * see {@code DirectPodLogProvider#resolveTargetPlan}'s own javadoc.
     */
    String contextTargetProof,
    RawSensitiveFields sensitiveFilters,
    QueryExpr query,
    String rawLogQl,
    String cursor,
    Instant pageBoundary,
    /**
     * UX-R3 §7/§8/§9 — a request/session-scoped Docker Compose project
     * selection (never persisted server-side, never a global mutation of
     * {@code DockerProperties}). Only {@code DockerLogSource} interprets
     * it; every other source (Fixture, Loki) simply ignores it, the same
     * way {@code containerId}/{@code pod} already only mean something to
     * one source each.
     */
    String composeProject
) {

  public SearchRequest {
    services = services == null ? List.of() : List.copyOf(services);
    levels = levels == null ? List.of() : List.copyOf(levels);
    sensitiveFilters = sensitiveFilters == null ? RawSensitiveFields.empty() : sensitiveFilters;
    direction = direction == null ? Direction.BACKWARD : direction;
  }

  public enum Direction { FORWARD, BACKWARD }

  /**
   * A copy of this request with only {@code pageBoundary} replaced - used
   * exclusively by {@code api.SearchService} (Legacy Remediation Slice 1
   * recovery, mandatory blocker #1) to hand a {@code LogSource} the
   * decoded, plain (non-sensitive) source-native instant to continue
   * pagination from, while {@code start}/{@code end} (the canonical
   * committed search window - unchanged, still enforced by {@code
   * core.search.EventFilters} against {@link CanonicalLogEvent#timestamp()})
   * and every filter field stay byte-for-byte identical to the original
   * request. {@code null} means "page 1 - no continuation in progress."
   * Every {@code LogSource} implementation may use this as a hint to
   * narrow its own native query further (for pagination depth/efficiency)
   * but must never rely on it alone for correctness - {@code SearchService}
   * always re-applies an exact, direction-aware filter against {@link
   * CanonicalLogEvent#sourceTimestamp()} afterward.
   */
  public SearchRequest withPageBoundary(Instant boundary) {
    return new SearchRequest(
        sourceId, start, end, direction, limit, services, levels, text,
        traceId, spanId, correlationId, journeyId, eventId, errorCode,
        businessStep, uiIdentifier, loggerContains, devicePlatform, language,
        containerId, pod, containerName, contextTargetProof, sensitiveFilters, query, rawLogQl, cursor, boundary,
        composeProject);
  }

  @Override
  public String toString() {
    return "SearchRequest[sourceId=" + sourceId
        + ", start=" + start
        + ", end=" + end
        + ", direction=" + direction
        + ", limit=" + limit
        + ", services=" + services
        + ", levels=" + levels
        + ", text=" + (text == null ? "null" : "[REDACTED]")
        + ", traceId=" + traceId
        + ", spanId=" + spanId
        + ", correlationId=" + correlationId
        + ", journeyId=" + journeyId
        + ", eventId=" + eventId
        + ", errorCode=" + errorCode
        + ", businessStep=" + businessStep
        + ", uiIdentifier=" + uiIdentifier
        + ", loggerContains=" + loggerContains
        + ", devicePlatform=" + devicePlatform
        + ", language=" + language
        + ", containerId=" + containerId
        + ", pod=" + pod
        + ", containerName=" + containerName
        + ", contextTargetProof=" + (contextTargetProof == null ? "null" : "[REDACTED]")
        + ", sensitiveFilters=" + sensitiveFilters
        + ", query=" + (query == null ? "null" : "[REDACTED]")
        + ", rawLogQl=" + (rawLogQl == null ? "null" : "[REDACTED]")
        + ", cursor=" + cursor
        + ", pageBoundary=" + pageBoundary
        + ", composeProject=" + composeProject
        + "]";
  }

  public static Builder builder() {
    return new Builder();
  }

  public static final class Builder {
    private String sourceId;
    private Instant start;
    private Instant end;
    private Direction direction;
    private Integer limit;
    private List<String> services;
    private List<String> levels;
    private String text;
    private String traceId;
    private String spanId;
    private String correlationId;
    private String journeyId;
    private String eventId;
    private String errorCode;
    private String businessStep;
    private String uiIdentifier;
    private String loggerContains;
    private String devicePlatform;
    private String language;
    private String containerId;
    private String pod;
    private String containerName;
    private String contextTargetProof;
    private RawSensitiveFields sensitiveFilters = RawSensitiveFields.empty();
    private QueryExpr query;
    private String rawLogQl;
    private String cursor;
    private Instant pageBoundary;
    private String composeProject;

    public Builder sourceId(String v) { this.sourceId = v; return this; }
    public Builder start(Instant v) { this.start = v; return this; }
    public Builder end(Instant v) { this.end = v; return this; }
    public Builder direction(Direction v) { this.direction = v; return this; }
    public Builder limit(Integer v) { this.limit = v; return this; }
    public Builder services(List<String> v) { this.services = v; return this; }
    public Builder levels(List<String> v) { this.levels = v; return this; }
    public Builder text(String v) { this.text = v; return this; }
    public Builder traceId(String v) { this.traceId = v; return this; }
    public Builder spanId(String v) { this.spanId = v; return this; }
    public Builder correlationId(String v) { this.correlationId = v; return this; }
    public Builder journeyId(String v) { this.journeyId = v; return this; }
    public Builder eventId(String v) { this.eventId = v; return this; }
    public Builder errorCode(String v) { this.errorCode = v; return this; }
    public Builder businessStep(String v) { this.businessStep = v; return this; }
    public Builder uiIdentifier(String v) { this.uiIdentifier = v; return this; }
    public Builder loggerContains(String v) { this.loggerContains = v; return this; }
    public Builder devicePlatform(String v) { this.devicePlatform = v; return this; }
    public Builder language(String v) { this.language = v; return this; }
    public Builder containerId(String v) { this.containerId = v; return this; }
    public Builder pod(String v) { this.pod = v; return this; }
    /** OS-1D — generic container-name scope hint (see the field's own javadoc). */
    public Builder containerName(String v) { this.containerName = v; return this; }
    /** OS-1D review recovery — see the field's own javadoc. */
    public Builder contextTargetProof(String v) { this.contextTargetProof = v; return this; }
    public Builder cursor(String v) { this.cursor = v; return this; }
    /** Test-only convenience — production callers use {@link SearchRequest#withPageBoundary}. */
    public Builder pageBoundary(Instant v) { this.pageBoundary = v; return this; }
    /** UX-R3 §7/§8/§9 — request/session-scoped Compose project selection. */
    public Builder composeProject(String v) { this.composeProject = v; return this; }

    /**
     * Builds the raw sensitive-filter holder from plain strings, entirely
     * inside {@code core.model} — so API-layer code (which receives these
     * as plain strings off an HTTP request body) never has to name or
     * import {@link RawSensitiveFields} itself. See the {@code arch} test
     * package for the rule this supports.
     */
    public Builder sensitiveFilters(String cif, String userName, String customerId, String deviceId, String deviceIp) {
      this.sensitiveFilters = new RawSensitiveFields(cif, userName, customerId, deviceId, deviceIp);
      return this;
    }

    /**
     * Parses {@code text} into the DSL AST immediately (may throw {@link
     * com.logexplorer.core.query.QuerySyntaxException}) — exactly once,
     * eagerly, never per-event. {@code null}/blank means "no DSL filter",
     * not an error.
     */
    public Builder query(String text) {
      this.query = QueryParser.parse(text);
      return this;
    }

    /** Already-parsed AST, for callers (tests) that build one directly. */
    public Builder query(QueryExpr parsed) {
      this.query = parsed;
      return this;
    }

    public Builder rawLogQl(String v) {
      this.rawLogQl = v;
      return this;
    }

    public SearchRequest build() {
      return new SearchRequest(
          sourceId, start, end, direction, limit, services, levels, text,
          traceId, spanId, correlationId, journeyId, eventId, errorCode,
          businessStep, uiIdentifier, loggerContains, devicePlatform, language,
          containerId, pod, containerName, contextTargetProof, sensitiveFilters, query, rawLogQl, cursor,
          pageBoundary, composeProject);
    }
  }
}
