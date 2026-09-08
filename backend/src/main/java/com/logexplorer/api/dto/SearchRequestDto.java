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
    String cif,
    String userName,
    String customerId,
    String deviceId,
    String deviceIp,
    String query,
    String rawLogQl,
    String cursor
) {

  @Override
  public String toString() {
    return "SearchRequestDto[sourceId=" + sourceId
        + ", start=" + start
        + ", end=" + end
        + ", direction=" + direction
        + ", limit=" + limit
        + ", services=" + services
        + ", levels=" + levels
        + ", text=" + redacted(text)
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
        + ", cif=" + redacted(cif)
        + ", userName=" + redacted(userName)
        + ", customerId=" + redacted(customerId)
        + ", deviceId=" + redacted(deviceId)
        + ", deviceIp=" + redacted(deviceIp)
        + ", query=" + redacted(query)
        + ", rawLogQl=" + redacted(rawLogQl)
        + ", cursor=" + cursor
        + "]";
  }

  private static String redacted(String value) {
    return value == null ? "null" : "[REDACTED]";
  }
}
