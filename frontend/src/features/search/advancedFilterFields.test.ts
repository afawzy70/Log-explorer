import { describe, expect, it } from 'vitest';
import { countActiveAdvancedFilters, emptyAdvancedFilterValues } from './advancedFilterFields';

describe('countActiveAdvancedFilters', () => {
  it('is zero for empty values', () => {
    expect(countActiveAdvancedFilters(emptyAdvancedFilterValues())).toBe(0);
  });

  it('counts each non-blank field except text (which has its own toolbar control)', () => {
    const values = { ...emptyAdvancedFilterValues(), text: 'ignored for the count', traceId: 'trace-1', cif: 'x' };
    expect(countActiveAdvancedFilters(values)).toBe(2);
  });

  it('treats a whitespace-only value as inactive', () => {
    const values = { ...emptyAdvancedFilterValues(), traceId: '   ' };
    expect(countActiveAdvancedFilters(values)).toBe(0);
  });
});
