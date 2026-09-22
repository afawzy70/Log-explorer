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
    // UX-R5 §9 - one fact, one row. This was previously three peer rows
    // ("Local time", "Zone", "UTC") carrying equal visual weight, which
    // spent 30% of Overview restating the same instant. All three values
    // are still here and still complete: the local time leads (it is what
    // an investigator reasons in), with the zone and the UTC form on a
    // secondary line beneath it.
    {
      label: 'Time',
      value: formatLocalTimestamp(event.timestamp),
      secondary:
        event.timestamp != null
          ? `${localZoneLabel(event.timestamp)} · ${formatUtcTimestamp(event.timestamp)}`
          : undefined,
    },
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
    // UX-R5 §9 ("do not overwhelm Overview with raw-field noise"): thread
    // and schema version are diagnostic minutiae, not part of what/where.
    // They are NOT removed from the product - `buildCanonicalFieldEntries`
    // still lists both in "All fields", which is the canonical escape
    // hatch for exactly this class of field, and `allFields.test.ts`
    // covers them there.
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

/**
 * "Business" (HANDOVER.md §16.5, split from the former combined "Business / error" tab -
 * LIVE_TIME_INSPECTOR_AND_DOCUMENTATION_RECOVERY, owner decision: error/exception data must never mix
 * into the business tab). Business-domain fields only - present only.
 */
export function buildBusinessFields(event: LogEvent): FieldItem[] {
  return present([
    whenPresent('Business step', event.businessStep),
    whenPresent('UI identifier', event.uiIdentifier),
  ]);
}

/** Error tab fields (LIVE_TIME_INSPECTOR_AND_DOCUMENTATION_RECOVERY) - present only; the exception itself is handled separately (needs `<pre>`, not a single-line field). */
export function buildErrorFields(event: LogEvent): FieldItem[] {
  return present([
    whenPresent('Error code', event.errorCode, true),
  ]);
}

/**
 * An event "contains error information" (LIVE_TIME_INSPECTOR_AND_DOCUMENTATION_RECOVERY) when its
 * severity is ERROR/FATAL, or it carries a real exception or error code - never fabricated when none of
 * these is actually present.
 */
export function eventHasErrorInfo(event: LogEvent): boolean {
  const severity = event.severity?.toUpperCase();
  return severity === 'ERROR' || severity === 'FATAL' || Boolean(event.exception) || Boolean(event.errorCode);
}

/**
 * A short, non-fabricated preview of an exception string for Overview's Error Summary: the exception
 * type/class when the text deterministically looks like Java's own `pkg.Type: message` shape (the exact
 * shape `testEventFixture.ts`'s own fixture and every real Java stack trace this product parses uses -
 * `LogLineParser`/`EventMapper` never invent this shape, so detecting it here never invents one either),
 * and the first line as the message preview otherwise. Never derives a type that is not genuinely there.
 */
export function deriveExceptionSummary(exception: string): { exceptionType: string | null; preview: string } {
  const firstLine = exception.split('\n')[0]?.trim() ?? '';
  const match = /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+):\s*(.*)$/.exec(firstLine);
  if (match) {
    return { exceptionType: match[1], preview: match[2] || firstLine };
  }
  return { exceptionType: null, preview: firstLine };
}
