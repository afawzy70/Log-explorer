/**
 * There is no timezone picker anywhere in scope (IMPLEMENTATION_PLAN.md
 * "Phase F") - "display zone" always means the browser/OS's own resolved
 * IANA zone, which is also exactly what a native `datetime-local` input
 * already edits in. No timezone-conversion library needed.
 */
export function getDisplayTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** e.g. "UTC+03:00" - `date` matters because some zones observe DST. */
export function formatUtcOffsetLabel(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, '0');
  const minutes = String(abs % 60).padStart(2, '0');
  return `UTC${sign}${hours}:${minutes}`;
}

/** e.g. "Asia/Kuwait (UTC+03:00)" - the exact label shape CLAUDE.md §4 requires. */
export function formatZoneLabel(date: Date = new Date()): string {
  return `${getDisplayTimeZone()} (${formatUtcOffsetLabel(date)})`;
}
