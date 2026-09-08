import { EMPTY_VALUE } from '../../shared/ui/table/emptyValue';
import { formatZoneLabel } from '../../shared/time/timezone';

/**
 * "Local timestamp with ms and named zone; UTC" (HANDOVER.md §16.2) - two
 * separate, explicitly-labeled lines, never one ambiguous timestamp. Both
 * built from the exact same `Date`, formatted for different zones.
 */
export function formatLocalTimestamp(iso: string | null): string {
  return formatWithZone(iso, undefined);
}

export function formatUtcTimestamp(iso: string | null): string {
  return formatWithZone(iso, 'UTC');
}

/** e.g. "Asia/Kuwait (UTC+03:00)" for whatever timestamp is being shown - `undefined` iso still gets today's zone label. */
export function localZoneLabel(iso: string | null): string {
  return formatZoneLabel(iso ? new Date(iso) : new Date());
}

function formatWithZone(iso: string | null, timeZone: string | undefined): string {
  if (!iso) {
    return EMPTY_VALUE;
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return EMPTY_VALUE;
  }
  const formatter = new Intl.DateTimeFormat(undefined, {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  });
  const formatted = formatter.format(date);
  return timeZone === 'UTC' ? `${formatted} UTC` : formatted;
}
