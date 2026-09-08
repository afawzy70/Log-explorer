/**
 * Committed range state is always stored as UTC ISO instant strings
 * (`start`/`end`). The custom-range popover edits values in the display
 * zone (native `datetime-local` inputs, which already operate in the
 * browser's own local zone - see timezone.ts) and converts to UTC exactly
 * once, at Apply (CLAUDE.md §4: "Convert display-zone values to UTC
 * exactly once").
 */

export type TimeValidationReason =
  | 'missing-start'
  | 'missing-end'
  | 'start-not-before-end'
  | 'future-end'
  | 'max-range-exceeded';

export interface TimeValidationResult {
  ok: boolean;
  reason?: TimeValidationReason;
  message?: string;
}

/** Mirrors the backend default (`logexplorer.search.max-time-range: 7d`) for immediate client-side feedback; the backend remains the authoritative bound. */
export const MAX_RANGE_MS = 7 * 24 * 60 * 60 * 1000;

export function validateRange(
  startIso: string | null,
  endIso: string | null,
  now: Date = new Date(),
): TimeValidationResult {
  if (!startIso) {
    return { ok: false, reason: 'missing-start', message: 'Start is required.' };
  }
  if (!endIso) {
    return { ok: false, reason: 'missing-end', message: 'End is required.' };
  }
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime())) {
    return { ok: false, reason: 'missing-start', message: 'Start is required.' };
  }
  if (Number.isNaN(end.getTime())) {
    return { ok: false, reason: 'missing-end', message: 'End is required.' };
  }
  if (!(start.getTime() < end.getTime())) {
    return { ok: false, reason: 'start-not-before-end', message: 'Start must be before End.' };
  }
  if (end.getTime() > now.getTime()) {
    return { ok: false, reason: 'future-end', message: 'End cannot be in the future.' };
  }
  if (end.getTime() - start.getTime() > MAX_RANGE_MS) {
    return { ok: false, reason: 'max-range-exceeded', message: 'Range cannot exceed 7 days.' };
  }
  return { ok: true };
}

/** UTC ISO -> the local wall-clock string a `datetime-local` input expects. */
export function localDateTimeInputValue(utcIso: string): string {
  const d = new Date(utcIso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A `datetime-local` input's value (local wall-clock, no zone suffix) -> UTC ISO instant. The single UTC conversion point. */
export function utcIsoFromLocalDateTimeInput(value: string): string | null {
  if (!value) {
    return null;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return d.toISOString();
}

/**
 * The "actual interval" label (scope item 7): both dates shown only when
 * they differ, e.g. same-day "13 Aug, 1:39 PM – 2:09 PM" vs. cross-day
 * "13 Aug, 11:50 PM – 14 Aug, 12:10 AM". Never a generic "Custom range".
 */
export function formatInterval(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const sameDay = start.toDateString() === end.toDateString();
  const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay) {
    return `${dateFmt.format(start)}, ${timeFmt.format(start)} – ${timeFmt.format(end)}`;
  }
  return `${dateFmt.format(start)}, ${timeFmt.format(start)} – ${dateFmt.format(end)}, ${timeFmt.format(end)}`;
}
