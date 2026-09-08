import { describe, expect, it } from 'vitest';
import { formatLocalTimestamp, formatUtcTimestamp, localZoneLabel } from './timestampFormat';

describe('timestampFormat', () => {
  it('formats a real timestamp with milliseconds for both local and UTC', () => {
    const iso = '2026-01-01T12:00:00.123Z';
    expect(formatLocalTimestamp(iso)).toMatch(/\d{3}/); // contains milliseconds
    expect(formatUtcTimestamp(iso)).toContain('UTC');
    expect(formatUtcTimestamp(iso)).toMatch(/\d{3}/);
  });

  it('renders the empty-value placeholder for a null/invalid timestamp, never a crash', () => {
    expect(formatLocalTimestamp(null)).toBe('—');
    expect(formatUtcTimestamp(null)).toBe('—');
    expect(formatLocalTimestamp('not-a-date')).toBe('—');
  });

  it('the zone label always includes a UTC offset', () => {
    expect(localZoneLabel('2026-01-01T12:00:00Z')).toMatch(/UTC[+-]\d{2}:\d{2}/);
  });
});
