package com.logexplorer.api;

import com.logexplorer.api.dto.SearchRequestDto;
import com.logexplorer.core.model.SearchRequest;
import java.util.Locale;
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
        .build();
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
