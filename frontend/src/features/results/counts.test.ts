import { describe, expect, it } from 'vitest';
import { buildCountsSummary } from './counts';

describe('buildCountsSummary', () => {
  it('shows a plain count when visible equals returned and there is no estimated total', () => {
    const summary = buildCountsSummary({ estimatedTotal: null, returned: 45, visible: 45, limit: 200, truncated: false });
    expect(summary).toBe('Showing 45 events');
  });

  it('uses singular "event" for exactly one result', () => {
    const summary = buildCountsSummary({ estimatedTotal: null, returned: 1, visible: 1, limit: 200, truncated: false });
    expect(summary).toBe('Showing 1 event');
  });

  it('mentions the estimated total when known', () => {
    const summary = buildCountsSummary({ estimatedTotal: 120, returned: 45, visible: 45, limit: 200, truncated: false });
    expect(summary).toBe('Showing 45 of 120');
  });

  it('flags truncation honestly when a total is known', () => {
    const summary = buildCountsSummary({ estimatedTotal: 500, returned: 200, visible: 200, limit: 200, truncated: true });
    expect(summary).toBe('Showing 200 of 500 (truncated)');
  });

  it('flags truncation honestly without inventing a total when none is known', () => {
    const summary = buildCountsSummary({ estimatedTotal: null, returned: 200, visible: 200, limit: 200, truncated: true });
    expect(summary).toBe('Showing 200 events (truncated — more may be available)');
  });

  it('distinguishes visible from returned when they differ, never silently dropping the distinction', () => {
    const summary = buildCountsSummary({ estimatedTotal: null, returned: 200, visible: 150, limit: 200, truncated: false });
    expect(summary).toBe('Showing 150 of 200 fetched events');
  });
});
