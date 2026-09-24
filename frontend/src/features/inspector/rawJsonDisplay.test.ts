import { describe, expect, it } from 'vitest';
import { formatMaskedRawJson } from './rawJsonDisplay';

describe('formatMaskedRawJson', () => {
  it('pretty-prints valid JSON, matching the Canonical Event JSON disclosure\'s own formatting', () => {
    expect(formatMaskedRawJson('{"a":1,"b":"two"}')).toBe(JSON.stringify({ a: 1, b: 'two' }, null, 2));
  });

  it('falls back to the raw string verbatim for non-JSON (malformed-line) text', () => {
    expect(formatMaskedRawJson('NOT VALID JSON cif=[REDACTED]')).toBe('NOT VALID JSON cif=[REDACTED]');
  });

  it('preserves already-masked markers exactly, never re-processing them', () => {
    const masked = '{"cif":"****","message":"card [REDACTED_CARD] declined"}';
    const formatted = formatMaskedRawJson(masked);
    expect(formatted).toContain('****');
    expect(formatted).toContain('[REDACTED_CARD]');
  });
});
