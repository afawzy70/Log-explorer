import { describe, expect, it } from 'vitest';
import { formatUtcOffsetLabel, formatZoneLabel, getDisplayTimeZone } from './timezone';

describe('getDisplayTimeZone', () => {
  it('returns the runtime-resolved IANA zone name', () => {
    expect(getDisplayTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});

describe('formatUtcOffsetLabel', () => {
  it('formats the offset as UTC+HH:MM / UTC-HH:MM matching the runtime offset', () => {
    const date = new Date('2026-08-13T12:00:00Z');
    const offsetMinutes = -date.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const abs = Math.abs(offsetMinutes);
    const expected = `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
    expect(formatUtcOffsetLabel(date)).toBe(expected);
  });

  it('always has the exact shape UTC±HH:MM', () => {
    expect(formatUtcOffsetLabel(new Date())).toMatch(/^UTC[+-]\d{2}:\d{2}$/);
  });
});

describe('formatZoneLabel', () => {
  it('combines the zone name and offset as "<zone> (UTC±HH:MM)"', () => {
    const label = formatZoneLabel(new Date('2026-08-13T12:00:00Z'));
    expect(label).toBe(`${getDisplayTimeZone()} (${formatUtcOffsetLabel(new Date('2026-08-13T12:00:00Z'))})`);
    expect(label).toMatch(/^.+ \(UTC[+-]\d{2}:\d{2}\)$/);
  });
});
