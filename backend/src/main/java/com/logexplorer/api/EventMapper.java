package com.logexplorer.api;

import com.logexplorer.api.dto.EventDto;
import com.logexplorer.core.mask.MaskedSensitiveFields;
import com.logexplorer.core.mask.MaskingService;
import com.logexplorer.core.model.CanonicalLogEvent;
import org.springframework.stereotype.Component;

/**
 * Builds the outbound {@link EventDto} from a {@link CanonicalLogEvent}.
 * The only place in {@code api} allowed to hold a {@code CanonicalLogEvent}
 * reference — deliberately never touches {@code core.model.RawSensitiveFields}
 * itself; {@link MaskingService#mask(CanonicalLogEvent)} extracts it
 * internally, so that type name never has to appear in this file (or
 * anywhere else in {@code api}) at all. See the {@code arch} test package.
 */
@Component
public class EventMapper {

  private final MaskingService maskingService;

  public EventMapper(MaskingService maskingService) {
    this.maskingService = maskingService;
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
        event.message(),
        event.logger(),
        event.thread(),
        event.exception(),
        event.traceId(),
        event.spanId(),
        event.journeyId(),
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
        event.unknownTopLevelFields(),
        event.unknownMdcFields(),
        event.malformed(),
        event.rawLine(),
        event.sourceId(),
        event.composeProject(),
        event.containerId(),
        event.containerName(),
        event.stream(),
        event.namespace(),
        event.pod());
  }
}
