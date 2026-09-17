import { describe, expect, it } from 'vitest';
import { computeTicks, formatDuration, formatOffsetLabel, pickTickStep } from './timelineTicks';

describe('pickTickStep', () => {
  it('picks 1s/2s for a sub-10s span', () => {
    expect(pickTickStep(8_000)).toEqual({ minorMs: 1_000, majorMs: 2_000 });
  });

  it('picks 5s/10s for a 60s window, matching the design context-view default', () => {
    expect(pickTickStep(60_000)).toEqual({ minorMs: 5_000, majorMs: 10_000 });
  });

  it('picks progressively coarser steps for longer spans', () => {
    expect(pickTickStep(4 * 60_000)).toEqual({ minorMs: 15_000, majorMs: 60_000 });
    expect(pickTickStep(20 * 60_000)).toEqual({ minorMs: 60_000, majorMs: 5 * 60_000 });
    expect(pickTickStep(90 * 60_000)).toEqual({ minorMs: 5 * 60_000, majorMs: 15 * 60_000 });
  });

  it('falls back to a coarse step for a multi-hour span, never throwing or picking a sub-second step', () => {
    expect(pickTickStep(6 * 60 * 60_000)).toEqual({ minorMs: 15 * 60_000, majorMs: 60 * 60_000 });
  });
});

describe('formatOffsetLabel', () => {
  it('formats zero as "0s", never "+0s" or "-0s"', () => {
    expect(formatOffsetLabel(0)).toBe('0s');
  });

  it('signs positive and negative offsets distinctly', () => {
    expect(formatOffsetLabel(12_000)).toBe('+12s');
    expect(formatOffsetLabel(-3_000)).toBe('−3s');
  });

  it('formats minutes and seconds together, omitting a zero seconds remainder', () => {
    expect(formatOffsetLabel(90_000)).toBe('+1m 30s');
    expect(formatOffsetLabel(120_000)).toBe('+2m');
  });

  it('formats hours and minutes together, omitting a zero minutes remainder', () => {
    expect(formatOffsetLabel(3 * 60 * 60_000 + 5 * 60_000)).toBe('+3h 05m');
    expect(formatOffsetLabel(2 * 60 * 60_000)).toBe('+2h');
  });
});

describe('formatDuration', () => {
  it('formats sub-minute durations as seconds', () => {
    expect(formatDuration(12_400)).toBe('12.4s');
  });

  it('formats minute-scale durations as "Xm YYs"', () => {
    expect(formatDuration(65_000)).toBe('1m 05s');
  });

  it('formats hour-scale durations as "Xh YYm"', () => {
    expect(formatDuration(2 * 60 * 60_000 + 5 * 60_000)).toBe('2h 05m');
  });
});

describe('computeTicks', () => {
  it('places a tick exactly at the origin (offset 0) when the origin is inside the range', () => {
    const ticks = computeTicks(-10_000, 10_000, 5_000, { minorMs: 5_000, majorMs: 10_000 });
    const zero = ticks.find((t) => t.label === '0s');
    expect(zero).toBeDefined();
    expect(zero!.percent).toBeCloseTo(75, 1); // (5000 - -10000) / 20000 * 100
  });

  it('never emits a tick outside the 0-100 percent range', () => {
    const ticks = computeTicks(0, 27_300, 0, { minorMs: 5_000, majorMs: 10_000 });
    for (const t of ticks) {
      expect(t.percent).toBeGreaterThanOrEqual(0);
      expect(t.percent).toBeLessThanOrEqual(100);
    }
  });

  it('labels only major ticks, never a minor one', () => {
    const ticks = computeTicks(0, 30_000, 0, { minorMs: 5_000, majorMs: 10_000 });
    for (const t of ticks) {
      if (!t.major) {
        expect(t.label).toBeUndefined();
      }
    }
    expect(ticks.some((t) => t.major)).toBe(true);
  });

  it('returns an empty list for a degenerate zero-width range, never throwing', () => {
    expect(computeTicks(5_000, 5_000, 5_000, { minorMs: 1_000, majorMs: 2_000 })).toEqual([]);
  });
});
