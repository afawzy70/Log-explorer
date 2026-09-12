import { describe, expect, it } from 'vitest';
import { DEFAULT_GAP_THRESHOLD_MS, detectGaps, formatGapDuration } from './gapDetection';
import type { LogEvent } from '../../shared/api/types';

function event(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    timestamp: '2026-01-01T12:00:00.000Z',
    timestampRaw: null,
    schemaVersion: null,
    service: 'gateway',
    serviceSourceHint: null,
    severity: 'INFO',
    severityNumber: null,
    message: 'm',
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
    ...overrides,
  };
}

function at(iso: string): LogEvent {
  return event({ timestamp: iso });
}

describe('detectGaps (Legacy Remediation Slice 6)', () => {
  it('zero gaps for an empty or single-event sequence', () => {
    expect(detectGaps([])).toEqual([]);
    expect(detectGaps([at('2026-01-01T12:00:00Z')])).toEqual([]);
  });

  it('zero gaps when every adjacent interval is within the threshold', () => {
    const events = [
      at('2026-01-01T12:00:00.000Z'),
      at('2026-01-01T12:00:01.000Z'),
      at('2026-01-01T12:00:03.000Z'),
    ];
    expect(detectGaps(events)).toEqual([]);
  });

  it('exact boundary: a delta exactly equal to the threshold is NOT a gap', () => {
    const events = [at('2026-01-01T12:00:00.000Z'), at('2026-01-01T12:00:05.000Z')]; // exactly 5000ms = DEFAULT_GAP_THRESHOLD_MS
    expect(detectGaps(events, DEFAULT_GAP_THRESHOLD_MS)).toEqual([]);
  });

  it('exact boundary: one millisecond over the threshold IS a gap', () => {
    const events = [at('2026-01-01T12:00:00.000Z'), at('2026-01-01T12:00:05.001Z')]; // 5001ms
    const gaps = detectGaps(events, DEFAULT_GAP_THRESHOLD_MS);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].durationMs).toBe(5001);
  });

  it('a single gap carries from/to/duration/reason/confidence and the correct afterIndex', () => {
    const events = [at('2026-01-01T12:00:00Z'), at('2026-01-01T12:00:10Z')];
    const gaps = detectGaps(events, 5_000);
    expect(gaps).toEqual([
      {
        afterIndex: 0,
        fromTimestamp: '2026-01-01T12:00:00Z',
        toTimestamp: '2026-01-01T12:00:10Z',
        durationMs: 10_000,
        reason: 'large_interval',
        confidence: 'observed',
      },
    ]);
  });

  it('multiple gaps in one sequence are all detected, each with its own afterIndex', () => {
    const events = [
      at('2026-01-01T12:00:00Z'), // 0
      at('2026-01-01T12:00:01Z'), // 1 - no gap (0->1)
      at('2026-01-01T12:00:20Z'), // 2 - gap (1->2, 19s)
      at('2026-01-01T12:00:21Z'), // 3 - no gap (2->3)
      at('2026-01-01T12:00:45Z'), // 4 - gap (3->4, 24s)
    ];
    const gaps = detectGaps(events, 5_000);
    expect(gaps).toHaveLength(2);
    expect(gaps[0].afterIndex).toBe(1);
    expect(gaps[1].afterIndex).toBe(3);
  });

  it('a custom threshold is honored instead of the default', () => {
    const events = [at('2026-01-01T12:00:00Z'), at('2026-01-01T12:00:02Z')]; // 2s apart
    expect(detectGaps(events, 5_000)).toEqual([]); // below default threshold
    expect(detectGaps(events, 1_000)).toHaveLength(1); // above a tighter custom threshold
  });

  it('never computes a gap across an event with a missing timestamp - skips it rather than guessing', () => {
    const events = [
      at('2026-01-01T12:00:00Z'),
      event({ timestamp: null }),
      at('2026-01-01T12:00:30Z'),
    ];
    expect(detectGaps(events, 5_000)).toEqual([]);
  });

  it('never computes a gap across an event with an unparseable timestamp', () => {
    const events = [at('2026-01-01T12:00:00Z'), event({ timestamp: 'not-a-real-timestamp' }), at('2026-01-01T12:00:30Z')];
    expect(detectGaps(events, 5_000)).toEqual([]);
  });

  it('is purely a function of timestamps - severity/service mix never affects gap computation', () => {
    const events = [
      event({ timestamp: '2026-01-01T12:00:00Z', severity: 'ERROR', service: 'a' }),
      event({ timestamp: '2026-01-01T12:00:20Z', severity: 'DEBUG', service: 'z' }),
    ];
    const gaps = detectGaps(events, 5_000);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].durationMs).toBe(20_000);
  });
});

describe('formatGapDuration', () => {
  it('formats sub-minute durations as seconds', () => {
    expect(formatGapDuration(5_000)).toBe('5s');
    expect(formatGapDuration(12_400)).toBe('12.4s');
  });

  it('formats minute-plus durations as "Xm SSs"', () => {
    expect(formatGapDuration(65_000)).toBe('1m 05s');
    expect(formatGapDuration(125_000)).toBe('2m 05s');
  });
});
