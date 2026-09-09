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
    RawSensitiveFields sensitiveFilters,
    QueryExpr query,
    String rawLogQl,
    String cursor
) {

  public SearchRequest {
    services = services == null ? List.of() : List.copyOf(services);
    levels = levels == null ? List.of() : List.copyOf(levels);
    sensitiveFilters = sensitiveFilters == null ? RawSensitiveFields.empty() : sensitiveFilters;
    direction = direction == null ? Direction.BACKWARD : direction;
  }

  public enum Direction { FORWARD, BACKWARD }

  /**
   * A copy of this request with only {@code end} replaced - used by {@code
   * api.SearchService} (Legacy Remediation Slice 1) to narrow the window
   * sent to a {@code LogSource} for a continuation page, while every filter
   * field (and therefore what the search "means") stays byte-for-byte
   * identical to the original request. {@code cursor} is intentionally
   * carried through unchanged; the caller only ever calls this once, before
   * dispatch, and never re-reads {@code cursor()} off the scoped copy.
   */
  public SearchRequest withEnd(Instant newEnd) {
    return new SearchRequest(
        sourceId, start, newEnd, direction, limit, services, levels, text,
        traceId, spanId, correlationId, journeyId, eventId, errorCode,
        businessStep, uiIdentifier, loggerContains, devicePlatform, language,
        containerId, pod, sensitiveFilters, query, rawLogQl, cursor);
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
        + ", sensitiveFilters=" + sensitiveFilters
        + ", query=" + (query == null ? "null" : "[REDACTED]")
        + ", rawLogQl=" + (rawLogQl == null ? "null" : "[REDACTED]")
        + ", cursor=" + cursor
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
    private RawSensitiveFields sensitiveFilters = RawSensitiveFields.empty();
    private QueryExpr query;
    private String rawLogQl;
    private String cursor;

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
    public Builder cursor(String v) { this.cursor = v; return this; }

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
          containerId, pod, sensitiveFilters, query, rawLogQl, cursor);
    }
  }
}
