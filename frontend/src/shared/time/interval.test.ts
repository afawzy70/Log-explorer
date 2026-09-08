import { describe, expect, it } from 'vitest';
import {
  formatInterval,
  localDateTimeInputValue,
  MAX_RANGE_MS,
  utcIsoFromLocalDateTimeInput,
  validateRange,
} from './interval';

describe('validateRange', () => {
  const now = new Date('2026-08-13T14:09:00Z');

  it('rejects a missing start', () => {
    expect(validateRange(null, '2026-08-13T14:00:00Z', now)).toEqual({
      ok: false,
      reason: 'missing-start',
      message: 'Start is required.',
    });
  });

  it('rejects a missing end', () => {
    expect(validateRange('2026-08-13T13:00:00Z', null, now)).toEqual({
      ok: false,
      reason: 'missing-end',
      message: 'End is required.',
    });
  });

  it('rejects start equal to end', () => {
    const result = validateRange('2026-08-13T13:00:00Z', '2026-08-13T13:00:00Z', now);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('start-not-before-end');
  });

  it('rejects start after end', () => {
    const result = validateRange('2026-08-13T14:00:00Z', '2026-08-13T13:00:00Z', now);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('start-not-before-end');
  });

  it('rejects an end in the future', () => {
    const result = validateRange('2026-08-13T13:00:00Z', '2026-08-13T15:00:00Z', now);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('future-end');
  });

  it('rejects a range wider than the max', () => {
    const start = new Date(now.getTime() - MAX_RANGE_MS - 60_000).toISOString();
    const result = validateRange(start, now.toISOString(), now);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('max-range-exceeded');
  });

  it('accepts a range exactly at the max', () => {
    const start = new Date(now.getTime() - MAX_RANGE_MS).toISOString();
    const result = validateRange(start, now.toISOString(), now);
    expect(result.ok).toBe(true);
  });

  it('accepts a valid, ordinary range', () => {
    const result = validateRange('2026-08-13T13:00:00Z', '2026-08-13T14:00:00Z', now);
    expect(result).toEqual({ ok: true });
  });
});

describe('localDateTimeInputValue / utcIsoFromLocalDateTimeInput round-trip', () => {
  it('round-trips a UTC instant through the local datetime-local representation without drift', () => {
    const original = '2026-08-13T10:39:00.000Z';
    const local = localDateTimeInputValue(original);
    const roundTripped = utcIsoFromLocalDateTimeInput(local);
    expect(roundTripped).toBe(original);
  });

  it('produces a value shaped like a datetime-local input expects (YYYY-MM-DDTHH:mm)', () => {
    const local = localDateTimeInputValue('2026-08-13T10:39:00.000Z');
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it('returns null for an empty or invalid input value rather than throwing', () => {
    expect(utcIsoFromLocalDateTimeInput('')).toBeNull();
    expect(utcIsoFromLocalDateTimeInput('not-a-date')).toBeNull();
  });
});

describe('formatInterval', () => {
  it('shows a single date with two times when start and end are on the same local day', () => {
    const label = formatInterval('2026-08-13T10:39:00Z', '2026-08-13T11:09:00Z');
    const dashCount = (label.match(/–/g) ?? []).length;
    expect(dashCount).toBe(1);
    // Exactly one date token (a single comma separating date from the first time).
    expect(label.split(',')).toHaveLength(2);
  });

  it('shows both dates when start and end fall on different local days', () => {
    const start = new Date('2026-08-13T10:00:00Z');
    const end = new Date(start.getTime() + 3 * 24 * 60 * 60 * 1000);
    const label = formatInterval(start.toISOString(), end.toISOString());
    // Two date tokens -> two commas (each "<date>, <time>" segment).
    expect(label.split(',')).toHaveLength(3);
  });

  it('never renders the generic literal "Custom range"', () => {
    const label = formatInterval('2026-08-13T10:39:00Z', '2026-08-13T11:09:00Z');
    expect(label.toLowerCase()).not.toContain('custom range');
  });
});
