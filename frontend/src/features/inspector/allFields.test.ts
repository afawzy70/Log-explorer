import { describe, expect, it } from 'vitest';
import { buildCanonicalFieldEntries, buildUnknownFieldEntries, filterFieldEntries } from './allFields';
import { fullEvent, sparseEvent } from './testEventFixture';

const NO_SOURCES = [] as never[];

describe('buildCanonicalFieldEntries', () => {
  it('a full event produces a non-empty, comprehensive canonical field list, including masked actor/client fields', () => {
    const entries = buildCanonicalFieldEntries(fullEvent(), NO_SOURCES);
    const labels = entries.map((e) => e.label);
    expect(labels).toContain('message');
    expect(labels).toContain('protectedFields.userName');
    expect(labels).toContain('sourceId');
    expect(labels).toContain('containerId');
  });

  it('a sparse event omits every field with no value - never a wall of empty rows', () => {
    const entries = buildCanonicalFieldEntries(sparseEvent(), NO_SOURCES);
    // "malformed" is a boolean, always present regardless of sparseness.
    expect(entries).toEqual([{ label: 'malformed', value: 'false' }]);
  });

  it('never leaks a raw sensitive value - every protectedFields.* entry is already masked', () => {
    const event = fullEvent();
    const entries = buildCanonicalFieldEntries(event, NO_SOURCES);
    const cif = entries.find((e) => e.label === 'protectedFields.cif');
    expect(cif?.value).toBe(event.protectedFields.cif);
    expect(cif?.value).toMatch(/\*/);
  });
});

describe('buildUnknownFieldEntries', () => {
  it('never discards unknown top-level or MDC fields', () => {
    const entries = buildUnknownFieldEntries(fullEvent());
    expect(entries).toContainEqual({ label: 'extraField', value: 'extra-value' });
    expect(entries).toContainEqual({ label: 'mdc.custom.mdc.key', value: 'mdc-value' });
  });

  it('an event with no unknown fields produces an empty list', () => {
    expect(buildUnknownFieldEntries(sparseEvent())).toEqual([]);
  });

  it('stringifies a non-string unknown value safely rather than throwing', () => {
    const entries = buildUnknownFieldEntries(sparseEvent({ unknownTopLevelFields: { count: 3, nested: { a: 1 } } }));
    expect(entries).toContainEqual({ label: 'count', value: '3' });
    expect(entries.find((e) => e.label === 'nested')?.value).toContain('"a":1');
  });
});

describe('filterFieldEntries', () => {
  const entries = [
    { label: 'traceId', value: 'trace-000100' },
    { label: 'service', value: 'payments-api' },
  ];

  it('an empty query returns everything unchanged', () => {
    expect(filterFieldEntries(entries, '')).toEqual(entries);
  });

  it('matches case-insensitively against the label', () => {
    expect(filterFieldEntries(entries, 'TRACE')).toEqual([entries[0]]);
  });

  it('matches case-insensitively against the value', () => {
    expect(filterFieldEntries(entries, 'PAYMENTS')).toEqual([entries[1]]);
  });

  it('a query matching nothing returns an empty list', () => {
    expect(filterFieldEntries(entries, 'nope')).toEqual([]);
  });
});

/*
 * UX-R5 §8/§9 - the fields Overview stopped showing must still be
 * reachable. "Do NOT remove any useful field/capability. Every existing
 * useful field must remain reachable." This is the proof for the two
 * Overview demoted (thread, schema version).
 */
describe('UX-R5 - fields demoted out of Overview remain reachable in All fields', () => {
  it('still lists thread and schema version', () => {
    const labels = buildCanonicalFieldEntries(fullEvent(), []).map((f) => f.label);
    expect(labels).toContain('thread');
    expect(labels).toContain('schemaVersion');
  });
});
