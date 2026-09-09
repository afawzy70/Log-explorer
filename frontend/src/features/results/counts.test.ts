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

  describe('cumulative (post-Load-More) wording — Legacy Remediation Slice 1', () => {
    it('shows the cumulative count plainly when not truncated and total is unknown', () => {
      const summary = buildCountsSummary({ estimatedTotal: null, returned: 9, visible: 9, limit: 200, truncated: false }, 209);
      expect(summary).toBe('Showing 209 events loaded');
    });

    it('never compares the cumulative count against the latest page-only "returned" value', () => {
      // returned=9 is just the last page's own size - a cumulative count of
      // 209 must never be rendered as "209 of 9 fetched" or similar.
      const summary = buildCountsSummary({ estimatedTotal: null, returned: 9, visible: 9, limit: 200, truncated: true }, 209);
      expect(summary).not.toContain('of 9');
    });

    it('explicitly states the total is unknown when truncated with no known total', () => {
      const summary = buildCountsSummary({ estimatedTotal: null, returned: 9, visible: 9, limit: 200, truncated: true }, 209);
      expect(summary).toBe('Showing 209 events loaded — total unknown for this source, more available');
    });

    it('uses the known total when available, never fabricating or reusing a stale one', () => {
      const summary = buildCountsSummary({ estimatedTotal: 209, returned: 9, visible: 9, limit: 200, truncated: false }, 209);
      expect(summary).toBe('Showing 209 of 209');
    });

    it('uses singular "event" for a cumulative count of exactly one', () => {
      const summary = buildCountsSummary({ estimatedTotal: null, returned: 1, visible: 1, limit: 200, truncated: false }, 1);
      expect(summary).toBe('Showing 1 event loaded');
    });
  });
});
