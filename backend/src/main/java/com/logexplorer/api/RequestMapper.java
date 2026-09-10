package com.logexplorer.api;

import com.logexplorer.api.dto.ContextRequestDto;
import com.logexplorer.api.dto.JourneyRequestDto;
import com.logexplorer.api.dto.SearchRequestDto;
import com.logexplorer.core.guard.GuardrailViolationException;
import com.logexplorer.core.guard.GuardrailViolationException.Reason;
import com.logexplorer.core.model.SearchRequest;
import java.time.Duration;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.springframework.stereotype.Component;

/**
 * Builds the domain {@link SearchRequest} from the inbound {@link
 * SearchRequestDto}. The five raw sensitive-filter values arrive as plain
 * strings (unavoidable — they came off the HTTP body) and are wrapped into
 * {@code core.model.RawSensitiveFields} entirely inside {@link
 * SearchRequest.Builder#sensitiveFilters}, in {@code core.model} — this
 * class never names or imports {@code RawSensitiveFields} itself. See the
 * {@code arch} test package.
 */
@Component
public class RequestMapper {

  /** "Show ±30 seconds was explicitly specified" (HANDOVER.md §16.7) — fixed, never client-supplied. */
  static final Duration CONTEXT_WINDOW = Duration.ofSeconds(30);

  /**
   * "Click actions on non-sensitive IDs: Find this trace / correlation /
   * journey / event. Never create a raw customer-identifier click-search."
   * (IMPLEMENTATION_PLAN.md "Phase I") — a closed set, checked in {@link
   * #toJourneyDomain}, so a request naming anything else (in particular
   * any of the five sensitive fields) is structurally rejected before it
   * ever reaches a {@code LogSource}.
   */
  private static final Set<String> JOURNEY_FIELDS = Set.of("journeyId", "correlationId", "traceId", "eventId");

  public SearchRequest toDomain(SearchRequestDto dto) {
    return SearchRequest.builder()
        .sourceId(dto.sourceId())
        .start(dto.start())
        .end(dto.end())
        .direction(parseDirection(dto.direction()))
        .limit(dto.limit())
        .services(dto.services())
        .levels(dto.levels())
        .text(dto.text())
        .traceId(dto.traceId())
        .spanId(dto.spanId())
        .correlationId(dto.correlationId())
        .journeyId(dto.journeyId())
        .eventId(dto.eventId())
        .errorCode(dto.errorCode())
        .businessStep(dto.businessStep())
        .uiIdentifier(dto.uiIdentifier())
        .loggerContains(dto.loggerContains())
        .devicePlatform(dto.devicePlatform())
        .language(dto.language())
        .sensitiveFilters(dto.cif(), dto.userName(), dto.customerId(), dto.deviceId(), dto.deviceIp())
        .query(dto.query())
        .rawLogQl(dto.rawLogQl())
        .cursor(dto.cursor())
        .composeProject(dto.composeProject())
        .build();
  }

  /**
   * "Context" (HANDOVER.md §16.7): a bounded ±30s window around one
   * event's timestamp, scoped to whichever of service/container/pod the
   * event actually has. Direction is left at the default (newest-first —
   * {@link SearchRequest#SearchRequest} compact constructor's own
   * default), the same ordering the results table shows everywhere else
   * (CLAUDE.md §4 "Newest first"), since this reuses that exact table.
   * The window itself is always exactly {@link #CONTEXT_WINDOW} on each
   * side — the request never supplies its own start/end, so it can never
   * be widened past what the frontend's own preview showed before the
   * user confirmed.
   */
  public SearchRequest toContextDomain(ContextRequestDto dto) {
    return SearchRequest.builder()
        .sourceId(dto.sourceId())
        .start(dto.timestamp().minus(CONTEXT_WINDOW))
        .end(dto.timestamp().plus(CONTEXT_WINDOW))
        .services(dto.service() == null || dto.service().isBlank() ? List.of() : List.of(dto.service()))
        .containerId(dto.containerId())
        .pod(dto.pod())
        .composeProject(dto.composeProject())
        .build();
  }

  /**
   * "Timeline: same active source only; bounded time window" (HANDOVER.md
   * §17) — {@code sourceId}/{@code start}/{@code end} are carried straight
   * through, never widened or defaulted here; the caller's own
   * currently-committed search window is the bound. {@code field} must be
   * one of {@link #JOURNEY_FIELDS} — anything else (including any of the
   * five sensitive fields) is rejected outright.
   */
  public SearchRequest toJourneyDomain(JourneyRequestDto dto) {
    if (!JOURNEY_FIELDS.contains(dto.field())) {
      throw new GuardrailViolationException(Reason.INVALID_JOURNEY_FIELD,
          "field must be one of " + JOURNEY_FIELDS);
    }
    SearchRequest.Builder builder = SearchRequest.builder()
        .sourceId(dto.sourceId())
        .start(dto.start())
        .end(dto.end())
        .composeProject(dto.composeProject());
    switch (dto.field()) {
      case "journeyId" -> builder.journeyId(dto.value());
      case "correlationId" -> builder.correlationId(dto.value());
      case "traceId" -> builder.traceId(dto.value());
      case "eventId" -> builder.eventId(dto.value());
      default -> throw new IllegalStateException("unreachable - already validated above");
    }
    return builder.build();
  }

  private SearchRequest.Direction parseDirection(String raw) {
    if (raw == null || raw.isBlank()) {
      return null;
    }
    try {
      return SearchRequest.Direction.valueOf(raw.trim().toUpperCase(Locale.ROOT));
    } catch (IllegalArgumentException e) {
      return null;
    }
  }
}
