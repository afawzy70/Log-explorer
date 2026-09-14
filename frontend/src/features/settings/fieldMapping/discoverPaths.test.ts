import { describe, expect, it } from 'vitest';
import { discoverPaths } from './discoverPaths';

describe('discoverPaths', () => {
  it('discovers a top-level scalar field', () => {
    const result = discoverPaths(['{"cif":"2449"}']);
    const cif = result.find((p) => p.path === 'cif');
    expect(cif).toBeDefined();
    expect(cif?.valueKind).toBe('string');
    expect(cif?.valuePreview).toBe('2449');
  });

  it('discovers a nested field with dot-joined path segments', () => {
    const result = discoverPaths(['{"customer":{"cif":"2449"}}']);
    expect(result.map((p) => p.path)).toContain('customer.cif');
  });

  it('discovers a deeply nested field', () => {
    const result = discoverPaths(['{"context":{"customer":{"cif":"2449"}}}']);
    expect(result.map((p) => p.path)).toContain('context.customer.cif');
  });

  it('also records the intermediate object path itself, truthfully typed as object', () => {
    const result = discoverPaths(['{"customer":{"cif":"2449"}}']);
    const customer = result.find((p) => p.path === 'customer');
    expect(customer).toBeDefined();
    expect(customer?.valueKind).toBe('object');
  });

  it('renders a literal dotted key one level under a parent using bracket-quoted syntax, matching the backend JsonPath grammar', () => {
    const result = discoverPaths(['{"mdc":{"event.correlationId":"corr-1"}}']);
    expect(result.map((p) => p.path)).toContain('mdc["event.correlationId"]');
    // Must NOT be rendered as the nested-path form, which would mean something else entirely.
    expect(result.map((p) => p.path)).not.toContain('mdc.event.correlationId');
  });

  it('renders a literal dotted key at the top level using bracket-quoted syntax', () => {
    const result = discoverPaths(['{"event.correlationId":"corr-1"}']);
    expect(result.map((p) => p.path)).toContain('["event.correlationId"]');
  });

  it('represents arrays truthfully - discoverable as a path, never flattened into a scalar or indexed', () => {
    const result = discoverPaths(['{"tags":["a","b","c"]}']);
    const tags = result.find((p) => p.path === 'tags');
    expect(tags).toBeDefined();
    expect(tags?.valueKind).toBe('array');
    expect(tags?.valuePreview).toContain('3 item');
    // No indexed sub-paths like tags.0, tags[0], etc.
    expect(result.map((p) => p.path)).not.toContain('tags.0');
    expect(result.map((p) => p.path)).not.toContain('tags[0]');
  });

  it('does not recurse into array elements even when they are objects', () => {
    const result = discoverPaths(['{"items":[{"id":"x"}]}']);
    expect(result.map((p) => p.path)).not.toContain('items.id');
  });

  it('represents null values truthfully', () => {
    const result = discoverPaths(['{"exception":null}']);
    const exception = result.find((p) => p.path === 'exception');
    expect(exception?.valueKind).toBe('null');
    expect(exception?.valuePreview).toBe('null');
  });

  it('produces the union of paths across multiple samples with different shapes', () => {
    const result = discoverPaths(['{"cif":"2449"}', '{"userName":"jsmith"}']);
    const paths = result.map((p) => p.path);
    expect(paths).toContain('cif');
    expect(paths).toContain('userName');
  });

  it('deduplicates the same path seen across multiple samples', () => {
    const result = discoverPaths(['{"cif":"2449"}', '{"cif":"3300"}']);
    expect(result.filter((p) => p.path === 'cif')).toHaveLength(1);
  });

  it('skips a malformed (non-JSON) sample without throwing, and still returns paths from the valid ones', () => {
    expect(() => discoverPaths(['not-json-at-all', '{"cif":"2449"}'])).not.toThrow();
    const result = discoverPaths(['not-json-at-all', '{"cif":"2449"}']);
    expect(result.map((p) => p.path)).toContain('cif');
  });

  it('skips a sample whose top level is a JSON array or scalar, not an object', () => {
    expect(discoverPaths(['[1,2,3]'])).toEqual([]);
    expect(discoverPaths(['"just a string"'])).toEqual([]);
    expect(discoverPaths(['42'])).toEqual([]);
  });

  it('returns an empty list for empty input', () => {
    expect(discoverPaths([])).toEqual([]);
  });

  it('returns an empty list for an empty object sample', () => {
    expect(discoverPaths(['{}'])).toEqual([]);
  });

  it('truncates a very long value preview rather than embedding the full value', () => {
    const longValue = 'x'.repeat(500);
    const result = discoverPaths([JSON.stringify({ message: longValue })]);
    const message = result.find((p) => p.path === 'message');
    expect(message?.valuePreview.length).toBeLessThan(longValue.length);
    expect(message?.valuePreview.endsWith('…')).toBe(true);
  });

  it('results are sorted alphabetically by path for stable, predictable display', () => {
    const result = discoverPaths(['{"z":"1","a":"2","m":"3"}']);
    expect(result.map((p) => p.path)).toEqual(['a', 'm', 'z']);
  });
});
