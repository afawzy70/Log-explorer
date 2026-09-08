import { describe, expect, it } from 'vitest';
import { colorForService } from './serviceColor';

describe('colorForService', () => {
  it('is deterministic - the same service always gets the same color', () => {
    expect(colorForService('payments-api')).toBe(colorForService('payments-api'));
  });

  it('different services usually get different colors (not the point of a hash to guarantee, but true for these names)', () => {
    const colors = new Set(['payments-api', 'notification-worker', 'gateway', 'accounts-api'].map(colorForService));
    expect(colors.size).toBeGreaterThan(1);
  });

  it('returns a color for a null service rather than throwing', () => {
    expect(colorForService(null)).toEqual(expect.any(String));
  });

  it('returns a real CSS color value', () => {
    expect(colorForService('gateway')).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
