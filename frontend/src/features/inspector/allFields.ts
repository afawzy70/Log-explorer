import type { LogEvent, SourceInfo } from '../../shared/api/types';
import type { FieldItem } from '../../shared/ui/FieldList';
import { resolveService } from '../results/columnMapping';
import { formatLocalTimestamp, formatUtcTimestamp } from './timestampFormat';

/**
 * "All fields: searchable key/value view - canonical fields first, unknown
 * fields after" (HANDOVER.md §16.6). Every canonical `LogEvent` field the
 * other sections already show, plus the handful (`sourceId`, `serverIp`,
 * `serverHost`, `timestampRaw`, `malformed`) none of them do - this is the
 * one place that is genuinely comprehensive. Masked fields stay masked
 * (`event.protectedFields` is already-masked strings, the only sensitive
 * carrier `LogEvent` has - see its own type comment).
 */
export function buildCanonicalFieldEntries(event: LogEvent, sources: SourceInfo[]): FieldItem[] {
  const sourceName = sources.find((s) => s.id === event.sourceId)?.displayName;
  // `presence` (the raw underlying field) decides whether a row appears at
  // all; `display` (which may substitute `EMPTY_VALUE`/a resolved name) is
  // what's actually shown once it does. Using the display string for both
  // would mean a field with no data still "counts" as present just
  // because its formatter never returns null - `resolveService`/
  // `formatUtcTimestamp` both always return a string, so a sparse event
  // would otherwise show `—` rows here instead of omitting them.
  const entries: [string, string | null | undefined, string | null | undefined, boolean?][] = [
    ['timestamp', event.timestamp, formatUtcTimestamp(event.timestamp), true],
    ['timestampLocal', event.timestamp, formatLocalTimestamp(event.timestamp), true],
    ['timestampRaw', event.timestampRaw, event.timestampRaw, true],
    ['schemaVersion', event.schemaVersion, event.schemaVersion],
    ['service', event.service ?? event.serviceSourceHint, resolveService(event)],
    ['severity', event.severity, event.severity],
    ['message', event.message, event.message],
    ['logger', event.logger, event.logger, true],
    ['thread', event.thread, event.thread, true],
    ['exception', event.exception, event.exception, true],
    ['traceId', event.traceId, event.traceId, true],
    ['spanId', event.spanId, event.spanId, true],
    ['journeyId', event.journeyId, event.journeyId, true],
    ['eventId', event.eventId, event.eventId, true],
    ['businessStep', event.businessStep, event.businessStep],
    ['uiIdentifier', event.uiIdentifier, event.uiIdentifier],
    ['errorCode', event.errorCode, event.errorCode, true],
    ['correlationId', event.correlationId, event.correlationId, true],
    ['protectedFields.userName', event.protectedFields.userName, event.protectedFields.userName],
    ['protectedFields.customerId', event.protectedFields.customerId, event.protectedFields.customerId],
    ['protectedFields.cif', event.protectedFields.cif, event.protectedFields.cif],
    ['protectedFields.deviceId', event.protectedFields.deviceId, event.protectedFields.deviceId, true],
    ['protectedFields.deviceIp', event.protectedFields.deviceIp, event.protectedFields.deviceIp, true],
    ['devicePlatformType', event.devicePlatformType, event.devicePlatformType],
    ['language', event.language, event.language],
    ['serverIp', event.serverIp, event.serverIp, true],
    ['serverHost', event.serverHost, event.serverHost],
    ['malformed', String(event.malformed), String(event.malformed)],
    ['rawLine', event.rawLine, event.rawLine, true],
    ['sourceId', event.sourceId, sourceName ? `${event.sourceId} (${sourceName})` : event.sourceId, true],
    ['composeProject', event.composeProject, event.composeProject],
    ['containerId', event.containerId, event.containerId, true],
    ['containerName', event.containerName, event.containerName],
    ['stream', event.stream, event.stream],
    ['namespace', event.namespace, event.namespace],
    ['pod', event.pod, event.pod, true],
  ];
  return entries
    .filter(([, presence]) => presence != null && presence !== '')
    .map(([label, , display, monospace]) => ({ label, value: display as string, monospace }));
}

/** "Unknown fields after" (HANDOVER.md §16.6) - never discarded (CLAUDE.md §4 "Never discard unknown JSON or MDC fields"). */
export function buildUnknownFieldEntries(event: LogEvent): FieldItem[] {
  const topLevel = Object.entries(event.unknownTopLevelFields ?? {}).map(
    ([key, value]): FieldItem => ({ label: key, value: stringifyUnknown(value) }),
  );
  const mdc = Object.entries(event.unknownMdcFields ?? {}).map(
    ([key, value]): FieldItem => ({ label: `mdc.${key}`, value: stringifyUnknown(value) }),
  );
  return [...topLevel, ...mdc];
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Case-insensitive substring match against label or value - the "searchable" part of the key/value view. */
export function filterFieldEntries(entries: FieldItem[], query: string): FieldItem[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    return entries;
  }
  return entries.filter(
    (entry) => entry.label.toLowerCase().includes(trimmed) || entry.value.toLowerCase().includes(trimmed),
  );
}
