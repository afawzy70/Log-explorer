package com.logexplorer.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.Instant;
import java.util.List;

/**
 * Inbound {@code POST /api/v1/logs/search} body.
 *
 * <p>{@code text}, {@code cif}, {@code userName}, {@code customerId}, {@code
 * deviceId}, {@code deviceIp} arrive as plain strings off the HTTP request
 * body — that carrier is unavoidable — but {@link #toString()} redacts all
 * six, so an accidental {@code log.info("{}", dto)} in a controller or
 * filter still cannot leak them. See {@link com.logexplorer.api.RequestMapper}
 * for how these become a properly wrapped {@code core.model.SearchRequest}.
 */
public record SearchRequestDto(
    @NotBlank String sourceId,
    @NotNull Instant start,
    @NotNull Instant end,
    String direction,
    Integer limit,
    List<String> services,
    /**
     * Owner mission "Service Filter, Docker Performance, and Verified
     * Default Mapping" §A — {@code "INCLUDE"} or {@code "EXCLUDE"}; {@code
     * null}/blank means {@code INCLUDE} (matches every existing caller's
     * current behavior unchanged). See {@link com.logexplorer.api.RequestMapper}
     * for how this parses into {@code core.model.SearchRequest.ServiceFilterMode}.
     */
    String serviceFilterMode,
    List<String> levels,
    String text,
    String traceId,
    String spanId,
    String correlationId,
    String journeyId,
    String journeyName,
    String eventId,
    String errorCode,
    String businessStep,
    String uiIdentifier,
    String loggerContains,
    String devicePlatform,
    String language,
    String cif,
    String userName,
    String customerId,
    String deviceId,
    String deviceIp,
    String query,
    String rawLogQl,
    String cursor,
    /** UX-R3 §7/§8/§9 — request-scoped Docker Compose project selection, never sensitive. */
    String composeProject,
    /** Classification tags (ANY). Evaluated server-side after classification. */
    List<String> tags
) {

  /** Pre-classification arity, kept so existing callers keep compiling. */
  public SearchRequestDto(String sourceId, Instant start, Instant end, String direction, Integer limit,
      List<String> services, String serviceFilterMode, List<String> levels, String text, String traceId,
      String spanId, String correlationId, String journeyId, String journeyName, String eventId, String errorCode,
      String businessStep, String uiIdentifier, String loggerContains, String devicePlatform, String language,
      String cif, String userName, String customerId, String deviceId, String deviceIp, String query,
      String rawLogQl, String cursor, String composeProject) {
    this(sourceId, start, end, direction, limit, services, serviceFilterMode, levels, text, traceId, spanId,
        correlationId, journeyId, journeyName, eventId, errorCode, businessStep, uiIdentifier, loggerContains,
        devicePlatform, language, cif, userName, customerId, deviceId, deviceIp, query, rawLogQl, cursor,
        composeProject, null);
  }

  @Override
  public String toString() {
    return "SearchRequestDto[sourceId=" + sourceId
        + ", start=" + start
        + ", end=" + end
        + ", direction=" + direction
        + ", limit=" + limit
        + ", services=" + services
        + ", serviceFilterMode=" + serviceFilterMode
        + ", levels=" + levels
        + ", text=" + redacted(text)
        + ", traceId=" + traceId
        + ", spanId=" + spanId
        + ", correlationId=" + correlationId
        + ", journeyId=" + journeyId
        + ", journeyName=" + journeyName
        + ", eventId=" + eventId
        + ", errorCode=" + errorCode
        + ", businessStep=" + businessStep
        + ", uiIdentifier=" + uiIdentifier
        + ", loggerContains=" + loggerContains
        + ", devicePlatform=" + devicePlatform
        + ", language=" + language
        + ", cif=" + redacted(cif)
        + ", userName=" + redacted(userName)
        + ", customerId=" + redacted(customerId)
        + ", deviceId=" + redacted(deviceId)
        + ", deviceIp=" + redacted(deviceIp)
        + ", query=" + redacted(query)
        + ", rawLogQl=" + redacted(rawLogQl)
        + ", cursor=" + cursor
        + ", composeProject=" + composeProject
        + ", tags=" + tags
        + "]";
  }

  private static String redacted(String value) {
    return value == null ? "null" : "[REDACTED]";
  }
}
