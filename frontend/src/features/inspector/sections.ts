import type { LogEvent, SourceInfo } from '../../shared/api/types';
import { EMPTY_VALUE } from '../../shared/ui/table/emptyValue';
import type { FieldItem } from '../../shared/ui/FieldList';
import { resolveService } from '../results/columnMapping';
import { formatLocalTimestamp, formatUtcTimestamp, localZoneLabel } from './timestampFormat';

export type { FieldItem };

/** Always rendered, `—` when missing - fields the investigator expects every event to structurally have. */
function always(label: string, value: string | null, monospace = false): FieldItem {
  return { label, value: value && value.length > 0 ? value : EMPTY_VALUE, monospace };
}

/** Omitted entirely when missing - HANDOVER.md §16.3 "When present". */
function whenPresent(label: string, value: string | null | undefined, monospace = false): FieldItem | null {
  return value != null && value !== '' ? { label, value, monospace } : null;
}

function present<T>(items: (T | null)[]): T[] {
  return items.filter((item): item is T => item != null);
}

/**
 * "Overview (what/when/where)" (HANDOVER.md §16.2). `sources` resolves
 * `event.sourceId` to its display name when the source is still in the
 * currently-loaded list; falls back to the raw id otherwise (a source can
 * legitimately not be in the current list - e.g. context/find-related
 * results always come from the currently-selected source, but nothing
 * guarantees that invariant will always hold for every future caller of
 * this function).
 */
export function buildOverviewFields(event: LogEvent, sources: SourceInfo[]): FieldItem[] {
  const sourceName = sources.find((s) => s.id === event.sourceId)?.displayName ?? event.sourceId;
  return [
    always('Message', event.message ?? (event.malformed ? event.rawLine : null)),
    always('Local time', formatLocalTimestamp(event.timestamp)),
    always('Zone', localZoneLabel(event.timestamp)),
    always('UTC', formatUtcTimestamp(event.timestamp), true),
    always('Source', sourceName),
    always('Service', resolveService(event)),
    ...present([
      whenPresent('Compose project', event.composeProject),
      whenPresent('Container', event.containerName ?? event.containerId, true),
      whenPresent('Namespace', event.namespace),
      whenPresent('Pod', event.pod, true),
      whenPresent('Stream', event.stream),
    ]),
    always('Level', event.severity),
    always('Logger', event.logger, true),
    always('Thread', event.thread, true),
    always('Schema version', event.schemaVersion),
  ];
}

/**
 * "Actor & client" (HANDOVER.md §16.3): masked values only, shown "when
 * present" - an event with no actor/client data at all renders no rows,
 * never fabricated `—` placeholders for a whole category that doesn't
 * apply (unlike Overview's structurally-always-present fields).
 */
export function buildActorClientFields(event: LogEvent): FieldItem[] {
  return present([
    whenPresent('Username', event.protectedFields.userName),
    whenPresent('Customer ID', event.protectedFields.customerId),
    whenPresent('CIF', event.protectedFields.cif),
    whenPresent('Device ID', event.protectedFields.deviceId, true),
    whenPresent('Device IP', event.protectedFields.deviceIp, true),
    whenPresent('Device platform', event.devicePlatformType),
    whenPresent('Language', event.language),
  ]);
}

export interface RequestFlowIdentifier {
  field: 'journeyId' | 'correlationId' | 'traceId' | 'spanId' | 'eventId';
  label: string;
  value: string;
}

/** "Request flow" (HANDOVER.md §16.4), in the stated order - present only. */
export function buildRequestFlowIdentifiers(event: LogEvent): RequestFlowIdentifier[] {
  const candidates: RequestFlowIdentifier[] = [
    { field: 'journeyId', label: 'Journey ID', value: event.journeyId ?? '' },
    { field: 'correlationId', label: 'Correlation ID', value: event.correlationId ?? '' },
    { field: 'traceId', label: 'Trace ID', value: event.traceId ?? '' },
    { field: 'spanId', label: 'Span ID', value: event.spanId ?? '' },
    { field: 'eventId', label: 'Event ID', value: event.eventId ?? '' },
  ];
  return candidates.filter((c) => c.value !== '');
}

/** "Business/error" (HANDOVER.md §16.5) - present only; the formatted exception is handled separately (needs `<pre>`, not a single-line field). */
export function buildBusinessErrorFields(event: LogEvent): FieldItem[] {
  return present([
    whenPresent('Business step', event.businessStep),
    whenPresent('UI identifier', event.uiIdentifier),
    whenPresent('Error code', event.errorCode, true),
  ]);
}
