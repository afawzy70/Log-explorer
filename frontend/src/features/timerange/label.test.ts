import { describe, expect, it } from 'vitest';
import { getTimeRangeDisplayLabel } from './label';
import { CUSTOM_RANGE_ID, DEFAULT_PRESET_ID } from '../../shared/time/presets';

describe('getTimeRangeDisplayLabel', () => {
  it('shows the preset label, not a computed interval, for a known preset', () => {
    const label = getTimeRangeDisplayLabel({
      presetId: DEFAULT_PRESET_ID,
      start: '2026-08-12T00:00:00Z',
      end: '2026-08-13T00:00:00Z',
    });
    expect(label).toBe('Last 1 day');
  });

  it('shows the formatted interval for a custom range', () => {
    const label = getTimeRangeDisplayLabel({
      presetId: CUSTOM_RANGE_ID,
      start: '2026-08-13T10:39:00Z',
      end: '2026-08-13T11:09:00Z',
    });
    expect(label.toLowerCase()).not.toContain('custom range');
    expect(label).toContain('–');
  });
});
