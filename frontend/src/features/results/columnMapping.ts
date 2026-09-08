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
 */
export function resolveWhatHappened(event: LogEvent): WhatHappenedCell {
  if (event.malformed) {
    return { text: event.rawLine ?? EMPTY_VALUE, malformed: true };
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

/** Correlation/Trace column - traceId preferred, correlationId as fallback (both non-sensitive, copyable). */
export function resolveCorrelationOrTrace(event: LogEvent): LabeledValue | null {
  if (event.traceId) {
    return { label: 'Trace ID', value: event.traceId };
  }
  if (event.correlationId) {
    return { label: 'Correlation ID', value: event.correlationId };
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
  const formatter = new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  });
  return formatter.format(date);
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
