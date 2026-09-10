import type { LogEvent } from '../../shared/api/types';
import { EMPTY_VALUE } from '../../shared/ui/table/emptyValue';

export { EMPTY_VALUE };

/**
 * "Service = application with Compose-service fallback" (scope item 2).
 * `event.service` is the parsed `application` field; `serviceSourceHint`
 * is the adapter-provided fallback (Compose service name, etc.) - present
 * even for a malformed event, since it comes from the adapter, not the
 * parse.
 */
export function resolveService(event: LogEvent): string {
  return event.service ?? event.serviceSourceHint ?? EMPTY_VALUE;
}

export interface WhatHappenedCell {
  text: string;
  malformed: boolean;
}

/**
 * "What happened = message only" (scope item 2) - never falls back to
 * service. A malformed event has no `message` by definition; its raw line
 * is shown instead, distinguishably marked (scope item 11: "malformed raw
 * line rendering").
 *
 * A genuinely empty message (`message: ""` - the field was present, just
 * blank) is distinct from an absent one (`message: null`): CLAUDE.md §4
 * "Parsing" - "Empty message is preserved; the UI shows a display
 * fallback like `(empty message)`. The backend never invents a message."
 * A real bug found via Phase M's real-browser UX acceptance testing:
 * this previously rendered a truly empty string for that case - an
 * invisible, effectively omitted cell, not a fallback at all, and
 * indistinguishable from a rendering glitch. `null` (the field was never
 * present) still falls back to the ordinary `EMPTY_VALUE` ("—") shared by
 * every other missing-value cell in this table.
 */
export function resolveWhatHappened(event: LogEvent): WhatHappenedCell {
  if (event.malformed) {
    return { text: event.rawLine ?? EMPTY_VALUE, malformed: true };
  }
  if (event.message === '') {
    return { text: '(empty message)', malformed: false };
  }
  return { text: event.message ?? EMPTY_VALUE, malformed: false };
}

export interface LabeledValue {
  label: string;
  value: string;
}

/** User/Customer column - already-masked values only, never raw (CLAUDE.md §2 rule 1). */
export function resolveUserOrCustomer(event: LogEvent): LabeledValue | null {
  if (event.protectedFields.userName) {
    return { label: 'User', value: event.protectedFields.userName };
  }
  if (event.protectedFields.customerId) {
    return { label: 'Customer', value: event.protectedFields.customerId };
  }
  return null;
}

export interface CorrelationOrTraceCell extends LabeledValue {
  /** Which journey-lookup field this cell's value is - IMPLEMENTATION_PLAN.md "Phase I" click actions key off this. */
  field: 'traceId' | 'correlationId';
}

/** Correlation/Trace column - traceId preferred, correlationId as fallback (both non-sensitive, copyable, and clickable per HANDOVER.md §17 "supported click actions on non-sensitive IDs"). */
export function resolveCorrelationOrTrace(event: LogEvent): CorrelationOrTraceCell | null {
  if (event.traceId) {
    return { label: 'Trace ID', value: event.traceId, field: 'traceId' };
  }
  if (event.correlationId) {
    return { label: 'Correlation ID', value: event.correlationId, field: 'correlationId' };
  }
  return null;
}

/**
 * "Time shows date + time + milliseconds" (scope item 6) - always the
 * full date, never just a time-of-day, since "Last 1 day" can cross a
 * date boundary and an ambiguous time-only cell would misrepresent that.
 */
export function formatTimestampCell(iso: string | null): string {
  if (!iso) {
    return EMPTY_VALUE;
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return EMPTY_VALUE;
  }
  // Built from `formatToParts`, not `format`, so this canonical string and
  // the two-span rendering in `splitTimestampCell` are identical *by
  // construction*. They are not otherwise guaranteed to agree: on this
  // project's own Node/ICU build `format()` emits a plain space before the
  // day period while `formatToParts()` emits U+202F (narrow no-break
  // space), so deriving one from each would make the rendered table cell
  // silently differ from the string every test and the journey view use.
  // Caught by `splitTimestampCell`'s own round-trip test, not by eye.
  return TIMESTAMP_CELL_FORMATTER.formatToParts(date)
    .map((p) => p.value)
    .join('');
}

const TIMESTAMP_CELL_FORMATTER = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3,
});

/**
 * UX-R4 §13 - the same timestamp {@link formatTimestampCell} produces,
 * split into its calendar-date prefix and its clock-time remainder so the
 * results table can weight the two differently.
 *
 * <p><b>Why.</b> In a log investigation nearly every row in a result set
 * shares the same calendar date, so repeating "Sep 10, 2026," at full
 * weight on all 200 rows spends the widest fixed column in the table on
 * the least discriminating part of the value, and pushes the part the
 * investigator actually scans - the seconds and milliseconds - to the
 * right-hand edge of the cell. CLAUDE.md §4 requires the table to show
 * "date + time + milliseconds", and it still does: nothing is dropped or
 * abbreviated, the date is simply rendered at secondary emphasis behind
 * the time.
 *
 * <p>The split is done on {@link Intl.DateTimeFormat#formatToParts} from
 * the *same formatter instance*, and the two pieces concatenate back to
 * exactly what {@link formatTimestampCell} returns - asserted directly in
 * `columnMapping.test.ts`, so no locale can silently make the rendered
 * cell disagree with the canonical string.
 */
export function splitTimestampCell(iso: string | null): { date: string; time: string } | null {
  if (!iso) {
    return null;
  }
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  const parts = TIMESTAMP_CELL_FORMATTER.formatToParts(parsed);
  const firstTimeIndex = parts.findIndex((p) => p.type === 'hour');
  if (firstTimeIndex <= 0) {
    // No hour part, or the value leads with the time (a locale that puts
    // time first): there is no meaningful date prefix to de-emphasise, so
    // render the whole thing as the primary value rather than guessing.
    return { date: '', time: parts.map((p) => p.value).join('') };
  }
  return {
    date: parts
      .slice(0, firstTimeIndex)
      .map((p) => p.value)
      .join(''),
    time: parts
      .slice(firstTimeIndex)
      .map((p) => p.value)
      .join(''),
  };
}

/**
 * "Container" optional column (Legacy Remediation Slice 4) - the
 * human-readable container name when the adapter has one (Docker),
 * falling back to the raw container ID (also non-sensitive - an
 * infrastructure identifier, not a customer/user identifier).
 */
export function resolveContainer(event: LogEvent): string {
  return event.containerName ?? event.containerId ?? EMPTY_VALUE;
}

/** Every non-empty, copyable, non-sensitive identifier on an event - the Actions menu's content. */
export interface CopyableIdentifier {
  label: string;
  value: string;
}

export function listCopyableIdentifiers(event: LogEvent): CopyableIdentifier[] {
  const candidates: CopyableIdentifier[] = [
    { label: 'Trace ID', value: event.traceId ?? '' },
    { label: 'Span ID', value: event.spanId ?? '' },
    { label: 'Correlation ID', value: event.correlationId ?? '' },
    { label: 'Journey ID', value: event.journeyId ?? '' },
    { label: 'Event ID', value: event.eventId ?? '' },
  ];
  return candidates.filter((c) => c.value !== '');
}
