package com.logexplorer.api.dto;

import java.time.Instant;
import java.util.List;

/**
 * The committed search scope a bounded classification sample is read from.
 *
 * <p>Owner mission "Classification real search scope, assisted extraction,
 * and visual tagging" §"Search-scope correctness principle": detection and
 * rule testing must sample the <b>same logical population the selected
 * event came from</b>, not a new unrelated broad source query. Before that
 * mission this record carried only source, project, time range, services
 * and levels, so a search narrowed by free text (or by any advanced filter)
 * sampled mostly unrelated events — the reported defect where a visible
 * screen full of {@code API_LOGS:} events produced "matched 1 of 200".
 *
 * <p>It therefore mirrors {@link SearchRequestDto} field for field, apart
 * from the fields a sample must own itself:
 * <ul>
 *   <li>{@code direction}, {@code limit}, {@code cursor} — sampling is
 *       always one bounded newest-first page of its own size;</li>
 *   <li>{@code tags} — deliberately NOT carried. See
 *       {@link com.logexplorer.api.ClassificationSampleCollector} for the
 *       documented tag-filter policy.</li>
 * </ul>
 *
 * <p>{@code anchorTimestamp} is the selected event's timestamp, used to
 * guarantee the anchor participates even when the bounded page would have
 * stopped short of it.
 *
 * <p>Sampling runs through the normal search pipeline (guardrails, mapping
 * gate, concurrency limits); sampled events are never retained. The five
 * sensitive filter values and the free-text/query fields are redacted by
 * {@link #toString()}, exactly like {@link SearchRequestDto}.
 */
public record ClassificationSampleScopeDto(
    String sourceId,
    String composeProject,
    Instant start,
    Instant end,
    List<String> services,
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
    Instant anchorTimestamp
) {

  /** Pre-mission arity (source, project, window, services, levels only), kept for existing callers and tests. */
  public ClassificationSampleScopeDto(String sourceId, String composeProject, Instant start, Instant end,
      List<String> services, String serviceFilterMode, List<String> levels) {
    this(sourceId, composeProject, start, end, services, serviceFilterMode, levels, null, null, null, null, null,
        null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null);
  }

  /** The scope as a search body, so the sample is built by the one real {@code RequestMapper}. */
  public SearchRequestDto toSearchRequest(String direction, Integer limit, List<String> tags) {
    return new SearchRequestDto(sourceId, start, end, direction, limit, services, serviceFilterMode, levels, text,
        traceId, spanId, correlationId, journeyId, journeyName, eventId, errorCode, businessStep, uiIdentifier,
        loggerContains, devicePlatform, language, cif, userName, customerId, deviceId, deviceIp, query, rawLogQl,
        null, composeProject, tags);
  }

  @Override
  public String toString() {
    return "ClassificationSampleScopeDto[sourceId=" + sourceId
        + ", composeProject=" + composeProject
        + ", start=" + start
        + ", end=" + end
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
        + ", anchorTimestamp=" + anchorTimestamp
        + "]";
  }

  private static String redacted(String value) {
    return value == null ? "null" : "[REDACTED]";
  }
}
