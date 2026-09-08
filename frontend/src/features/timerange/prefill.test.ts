import { describe, expect, it } from 'vitest';
import { CUSTOM_FALLBACK_DURATION_MS, CUSTOM_RANGE_ID, TIME_RANGE_PRESETS } from '../../shared/time/presets';
import { getPopoverInitialValues } from './prefill';

describe('getPopoverInitialValues', () => {
  const now = new Date('2026-08-13T14:09:00Z');

  it('reopening an already-custom range restores the committed values verbatim', () => {
    const committed = { presetId: CUSTOM_RANGE_ID, start: '2026-08-01T00:00:00Z', end: '2026-08-02T00:00:00Z' };
    expect(getPopoverInitialValues(committed, now)).toEqual({
      startIso: '2026-08-01T00:00:00Z',
      endIso: '2026-08-02T00:00:00Z',
    });
  });

  it('transitioning in from a preset prefills End=now, Start=end-previousPresetDuration', () => {
    const oneHourPreset = TIME_RANGE_PRESETS.find((p) => p.id === '1h')!;
    const committed = { presetId: '1h', start: 'irrelevant', end: 'irrelevant' };
    const result = getPopoverInitialValues(committed, now);
    expect(result.endIso).toBe(now.toISOString());
    expect(result.startIso).toBe(new Date(now.getTime() - oneHourPreset.durationMs).toISOString());
  });

  it('falls back to a 30-minute duration when the presetId is not recognized', () => {
    const committed = { presetId: 'not-a-real-preset', start: 'irrelevant', end: 'irrelevant' };
    const result = getPopoverInitialValues(committed, now);
    expect(result.endIso).toBe(now.toISOString());
    expect(result.startIso).toBe(new Date(now.getTime() - CUSTOM_FALLBACK_DURATION_MS).toISOString());
  });
});
