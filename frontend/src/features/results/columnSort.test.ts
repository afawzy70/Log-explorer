import { describe, expect, it } from 'vitest';
import { compareSortValues, nextColumnSort, sortIndexedEventsByColumn } from './columnSort';
import type { IndexedEvent } from './columnSort';
import type { LogEvent } from '../../shared/api/types';

function event(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    timestamp: null,
    timestampRaw: null,
    schemaVersion: null,
    service: null,
    serviceSourceHint: null,
    severity: null,
    severityNumber: null,
    message: null,
    logger: null,
    thread: null,
    exception: null,
    traceId: null,
    spanId: null,
    journeyId: null,
    eventId: null,
    businessStep: null,
    uiIdentifier: null,
    errorCode: null,
    correlationId: null,
    protectedFields: { cif: null, userName: null, customerId: null, deviceId: null, deviceIp: null },
    devicePlatformType: null,
    language: null,
    serverIp: null,
    serverHost: null,
    unknownTopLevelFields: {},
    unknownMdcFields: {},
    malformed: false,
    rawLine: null,
    sourceId: null,
    composeProject: null,
    composeService: null,
    containerId: null,
    containerName: null,
    stream: null,
    namespace: null,
    pod: null,
    contextTargetProof: null,
    tags: [],
    classifications: [],
    ...overrides,
  };
}

describe('compareSortValues', () => {
  it('missing (null/undefined/empty) always sorts after a present value', () => {
    expect(compareSortValues(null, 'a')).toBeGreaterThan(0);
    expect(compareSortValues('a', null)).toBeLessThan(0);
    expect(compareSortValues('', 'a')).toBeGreaterThan(0);
    expect(compareSortValues(undefined, 'a')).toBeGreaterThan(0);
  });

  it('two missing values are equal', () => {
    expect(compareSortValues(null, null)).toBe(0);
    expect(compareSortValues(null, undefined)).toBe(0);
  });

  it('numbers compare numerically, not lexicographically', () => {
    expect(compareSortValues(2, 10)).toBeLessThan(0);
  });

  it('strings compare with natural/numeric-aware ordering', () => {
    expect(compareSortValues('event-2', 'event-10')).toBeLessThan(0);
  });
});

describe('nextColumnSort', () => {
  it('a previously-inactive column starts ascending', () => {
    expect(nextColumnSort(null, 'service')).toEqual({ columnId: 'service', direction: 'asc' });
  });

  it('clicking the currently-ascending column flips to descending', () => {
    expect(nextColumnSort({ columnId: 'service', direction: 'asc' }, 'service')).toEqual({
      columnId: 'service',
      direction: 'desc',
    });
  });

  it('clicking a DIFFERENT column resets to ascending, never continuing the previous column\'s direction', () => {
    expect(nextColumnSort({ columnId: 'service', direction: 'desc' }, 'level')).toEqual({
      columnId: 'level',
      direction: 'asc',
    });
  });
});

describe('sortIndexedEventsByColumn', () => {
  function indexed(events: LogEvent[]): IndexedEvent[] {
    return events.map((e, originalIndex) => ({ event: e, originalIndex }));
  }

  it('null sort state returns the list unchanged (fetch order)', () => {
    const list = indexed([event({ service: 'b' }), event({ service: 'a' })]);
    expect(sortIndexedEventsByColumn(list, null)).toEqual(list);
  });

  it('a column with no sortAccessor (e.g. whatHappened) is never reordered even if requested', () => {
    const list = indexed([event({ message: 'b' }), event({ message: 'a' })]);
    const result = sortIndexedEventsByColumn(list, { columnId: 'whatHappened', direction: 'asc' });
    expect(result.map((r) => r.event.message)).toEqual(['b', 'a']);
  });

  it('sorts a real scalar column ascending and descending', () => {
    const list = indexed([event({ logger: 'c' }), event({ logger: 'a' }), event({ logger: 'b' })]);
    expect(sortIndexedEventsByColumn(list, { columnId: 'logger', direction: 'asc' }).map((r) => r.event.logger)).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(sortIndexedEventsByColumn(list, { columnId: 'logger', direction: 'desc' }).map((r) => r.event.logger)).toEqual([
      'c',
      'b',
      'a',
    ]);
  });

  it('missing values sort last in BOTH directions, not just ascending', () => {
    const list = indexed([event({ logger: 'b' }), event({ logger: null }), event({ logger: 'a' })]);
    expect(sortIndexedEventsByColumn(list, { columnId: 'logger', direction: 'asc' }).map((r) => r.event.logger)).toEqual([
      'a',
      'b',
      null,
    ]);
    expect(sortIndexedEventsByColumn(list, { columnId: 'logger', direction: 'desc' }).map((r) => r.event.logger)).toEqual([
      'b',
      'a',
      null,
    ]);
  });

  it('equal values keep their original relative (fetch) order - a stable sort', () => {
    const list = indexed([
      event({ logger: 'x', message: 'first' }),
      event({ logger: 'x', message: 'second' }),
      event({ logger: 'x', message: 'third' }),
    ]);
    const result = sortIndexedEventsByColumn(list, { columnId: 'logger', direction: 'asc' });
    expect(result.map((r) => r.event.message)).toEqual(['first', 'second', 'third']);
  });

  it('preserves the true original index through a reorder, even for events that are otherwise identical on every other field', () => {
    // Two events differing ONLY in `level` (severityNumber) - a real,
    // unremarkable case (e.g. background heartbeats at the same
    // synthetic timestamp) that a content-based identity lookup could
    // conflate; index-pairing must not.
    const list = indexed([event({ severityNumber: 40000 }), event({ severityNumber: 20000 })]);
    const result = sortIndexedEventsByColumn(list, { columnId: 'level', direction: 'asc' });
    expect(result.map((r) => r.originalIndex)).toEqual([1, 0]);
  });

  it('sorts Level by severity priority (severityNumber), not alphabetically', () => {
    const list = indexed([
      event({ severity: 'WARN', severityNumber: 30000 }),
      event({ severity: 'INFO', severityNumber: 20000 }),
      event({ severity: 'ERROR', severityNumber: 40000 }),
    ]);
    const result = sortIndexedEventsByColumn(list, { columnId: 'level', direction: 'asc' });
    expect(result.map((r) => r.event.severity)).toEqual(['INFO', 'WARN', 'ERROR']);
  });
});
