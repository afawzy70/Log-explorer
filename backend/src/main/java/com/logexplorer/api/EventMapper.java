package com.logexplorer.api;

import com.logexplorer.api.dto.ClassificationDto;
import com.logexplorer.api.dto.EventDto;
import com.logexplorer.api.dto.ExtractedFieldDto;
import com.logexplorer.core.classify.ClassificationLimits;
import com.logexplorer.core.mask.ExtractedValueRedactor;
import com.logexplorer.core.mask.MaskedSensitiveFields;
import com.logexplorer.core.mask.MaskingService;
import com.logexplorer.core.mask.TextRedactor;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.ExtractedField;
import com.logexplorer.core.model.RuleMatch;
import java.util.List;
import org.springframework.stereotype.Component;

/**
 * Builds the outbound {@link EventDto} from a {@link CanonicalLogEvent}.
 * The only place in {@code api} allowed to hold a {@code CanonicalLogEvent}
 * reference — deliberately never touches {@code core.model.RawSensitiveFields}
 * itself; {@link MaskingService#mask(CanonicalLogEvent)} extracts it
 * internally, so that type name never has to appear in this file (or
 * anywhere else in {@code api}) at all. See the {@code arch} test package.
 *
 * <p><b>Legacy Remediation Slice 7</b> — this is also the single, sole
 * boundary at which {@link TextRedactor} is applied to every free-text
 * field a browser could ever see: {@code message}, {@code exception},
 * {@code rawLine} (only ever populated for a malformed event), and the
 * {@code String}-typed values of {@code unknownTopLevelFields}/{@code
 * unknownMdcFields}. Never a second redaction pass anywhere else — every
 * one of {@code /search}, {@code /context}, {@code /journey}, and the Live
 * SSE stream already funnels through this exact method (see {@code
 * SearchController}/{@code LiveTailService}), so extending this one
 * boundary protects all four automatically. This runs strictly *after*
 * {@code EventFilters#matches} has already decided whether the event
 * passed the search (that predicate always sees the true, unredacted
 * {@code CanonicalLogEvent} — redacting first would silently break
 * free-text search matching).
 *
 * <p><b>Event classification</b> — tags and per-rule extracted values
 * leave through this same boundary; every extracted value passes {@link
 * ExtractedValueRedactor} (credential headers, sensitive extraction
 * definitions, policy-masked protected identifiers, {@link TextRedactor})
 * and is bounded in length.
 */
@Component
public class EventMapper {

  private final MaskingService maskingService;
  private final TextRedactor textRedactor;
  private final ExtractedValueRedactor extractedValueRedactor;

  public EventMapper(MaskingService maskingService, TextRedactor textRedactor) {
    this.maskingService = maskingService;
    this.textRedactor = textRedactor;
    this.extractedValueRedactor = new ExtractedValueRedactor(maskingService, textRedactor);
  }

  public EventDto toDto(CanonicalLogEvent event) {
    MaskedSensitiveFields protectedFields = maskingService.mask(event);
    return new EventDto(
        event.timestamp(),
        event.timestampRaw(),
        event.schemaVersion(),
        event.service(),
        event.serviceSourceHint(),
        event.severity(),
        event.severityNumber(),
        textRedactor.redact(event.message()),
        event.logger(),
        event.thread(),
        textRedactor.redact(event.exception()),
        event.traceId(),
        event.spanId(),
        event.journeyId(),
        event.journeyName(),
        event.eventId(),
        event.businessStep(),
        event.uiIdentifier(),
        event.errorCode(),
        event.correlationId(),
        protectedFields,
        event.devicePlatformType(),
        event.language(),
        event.serverIp(),
        event.serverHost(),
        textRedactor.redactStringValues(event.unknownTopLevelFields()),
        textRedactor.redactStringValues(event.unknownMdcFields()),
        event.malformed(),
        textRedactor.redact(event.rawLine()),
        event.sourceId(),
        event.composeProject(),
        event.composeService(),
        event.containerId(),
        event.containerName(),
        event.stream(),
        event.namespace(),
        event.pod(),
        event.contextTargetProof(),
        event.tags(),
        classifications(event));
  }

  private List<ClassificationDto> classifications(CanonicalLogEvent event) {
    if (event.classifications().isEmpty()) {
      return List.of();
    }
    return event.classifications().stream()
        .map(match -> toDto(event, match))
        .toList();
  }

  private ClassificationDto toDto(CanonicalLogEvent event, RuleMatch match) {
    List<ExtractedFieldDto> extracted = match.extracted().stream()
        .map(field -> toDto(event, field))
        .toList();
    return new ClassificationDto(match.ruleId(), match.ruleName(), match.tags(), match.displayColor(),
        extracted);
  }

  private ExtractedFieldDto toDto(CanonicalLogEvent event, ExtractedField field) {
    ExtractedValueRedactor.Presented presented = extractedValueRedactor.present(
        event, field, ClassificationLimits.MAX_RETURNED_EXTRACTED_VALUE_LENGTH);
    return new ExtractedFieldDto(field.name(), field.label(), presented.value(), field.status().name(),
        presented.redacted(), presented.truncated());
  }
}
