import { describe, expect, it } from 'vitest';
import { deriveInspectorTitle } from './title';
import { fullEvent, sparseEvent } from './testEventFixture';

describe('deriveInspectorTitle', () => {
  it('uses the message when present', () => {
    expect(deriveInspectorTitle(fullEvent())).toBe('Payment authorization failed');
  });

  it('collapses internal whitespace/newlines', () => {
    expect(deriveInspectorTitle(fullEvent({ message: 'line one\n  line two' }))).toBe('line one line two');
  });

  it('truncates a very long message rather than overflowing the header', () => {
    const long = 'x'.repeat(200);
    const title = deriveInspectorTitle(fullEvent({ message: long }));
    expect(title.length).toBeLessThan(200);
    expect(title.endsWith('…')).toBe(true);
  });

  it('falls back to the error code when there is no message', () => {
    expect(deriveInspectorTitle(sparseEvent({ errorCode: 'ERR_42' }))).toBe('Error ERR_42');
  });

  it('falls back to a malformed-line label, never inventing a diagnosis', () => {
    expect(deriveInspectorTitle(sparseEvent({ malformed: true, rawLine: '{not json' }))).toBe('Malformed log line');
  });

  it('falls back to an honest empty-message label when nothing else is available', () => {
    expect(deriveInspectorTitle(sparseEvent())).toBe('(empty message)');
  });
});
