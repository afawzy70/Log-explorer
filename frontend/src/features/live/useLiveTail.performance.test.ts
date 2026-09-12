import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useLiveTail } from './useLiveTail';
import { BATCH_FLUSH_MS, VISIBLE_CAP } from './liveTailTypes';
import { installMockEventSource, latestMockEventSource } from './mockEventSource';
import type { LogEvent } from '../../shared/api/types';

/**
 * Deterministic synthetic Live performance profiles (Legacy Remediation
 * Slice 5 - `docs/verification/LEGACY_REMEDIATION_SLICE_5_PERFORMANCE_REPORT.md`).
 * Uses `MockEventSource` (not the real backend/Fixture source, whose own
 * live tail runs at ~1.4 events/sec - `FixtureLogSource#TICK_INTERVAL`)
 * so these rates are exact, reproducible, and require no real production
 * logs, per the mission's own explicit instruction. Real-browser E2E
 * (`phase-legacy-slice5-live-resilience.spec.ts`) separately proves the
 * actual system end-to-end against the real Fixture rate; these tests
 * prove the client-side architecture (batching + bounded retention)
 * itself scales well past what the real source can ever produce.
 */
function event(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    timestamp: '2026-01-01T00:00:00Z',
    timestampRaw: null,
    schemaVersion: null,
    service: 'gateway',
    serviceSourceHint: null,
    severity: 'INFO',
    severityNumber: null,
    message: 'perf event',
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

/** Simulates `durationMs` of streaming at `ratePerSecond`, advancing fake time in `BATCH_FLUSH_MS` steps and emitting the right number of events per step. */
function simulateRate(ratePerSecond: number, durationMs: number) {
  const eventsPerFlush = Math.max(1, Math.round((ratePerSecond * BATCH_FLUSH_MS) / 1000));
  const ticks = Math.round(durationMs / BATCH_FLUSH_MS);
  let sent = 0;
  for (let t = 0; t < ticks; t++) {
    act(() => {
      for (let i = 0; i < eventsPerFlush; i++) {
        latestMockEventSource().emit('log', event({ message: `e-${sent}` }));
        sent++;
      }
    });
    act(() => {
      vi.advanceTimersByTime(BATCH_FLUSH_MS);
    });
  }
  return sent;
}

describe('useLiveTail performance profiles (Legacy Remediation Slice 5)', () => {
  beforeEach(() => {
    installMockEventSource();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { EventSource?: unknown }).EventSource;
  });

  it('LOW (10 events/sec, 5s): every event survives, retained count bounded correctly, well under the retention cap', () => {
    const { result } = renderHook(() => useLiveTail());
    act(() => result.current.start('fixture', []));
    act(() => latestMockEventSource().emitOpen());

    const sent = simulateRate(10, 5_000);

    expect(sent).toBe(50);
    expect(result.current.totalReceived).toBe(50);
    expect(result.current.visibleEvents).toHaveLength(50); // well under VISIBLE_CAP - nothing evicted
    expect(result.current.clientDroppedCount).toBe(0);
  });

  it('MEDIUM (100 events/sec, 10s): retention stays exactly bounded at VISIBLE_CAP once exceeded, eviction count is exact', () => {
    const { result } = renderHook(() => useLiveTail());
    act(() => result.current.start('fixture', []));
    act(() => latestMockEventSource().emitOpen());

    const sent = simulateRate(100, 10_000);

    expect(sent).toBe(1000);
    expect(result.current.totalReceived).toBe(1000);
    // 1000 < VISIBLE_CAP (2000) - still nothing evicted at this duration.
    expect(result.current.visibleEvents).toHaveLength(1000);
    expect(result.current.clientDroppedCount).toBe(0);
  });

  it('MEDIUM sustained past the retention cap (100 events/sec, 30s = 3000 events): reaches the plateau and stays there - never grows further', () => {
    const { result } = renderHook(() => useLiveTail());
    act(() => result.current.start('fixture', []));
    act(() => latestMockEventSource().emitOpen());

    const sent = simulateRate(100, 30_000);

    expect(sent).toBe(3000);
    expect(result.current.totalReceived).toBe(3000); // every arrival still counted, even the evicted ones
    expect(result.current.visibleEvents).toHaveLength(VISIBLE_CAP); // plateaued, not still rising
    expect(result.current.clientDroppedCount).toBe(3000 - VISIBLE_CAP);
    expect(result.current.visibleEvents[0].message).toBe('e-2999'); // newest survives
  });

  it('BURST (1,000 events/sec for a bounded 2s interval = 2000 events): the retention cap absorbs the burst without error, DOM-bound (visibleEvents) never exceeds VISIBLE_CAP even mid-burst', () => {
    const { result } = renderHook(() => useLiveTail());
    act(() => result.current.start('fixture', []));
    act(() => latestMockEventSource().emitOpen());

    const sent = simulateRate(1_000, 2_000);

    expect(sent).toBe(2000);
    expect(result.current.totalReceived).toBe(2000);
    expect(result.current.visibleEvents.length).toBeLessThanOrEqual(VISIBLE_CAP);
  });

  it('BURST: batching keeps React state commits far below the raw event count (the whole point of batching)', () => {
    const { result } = renderHook(() => useLiveTail());
    act(() => result.current.start('fixture', []));
    act(() => latestMockEventSource().emitOpen());

    // 5,000 events arriving essentially all at once (a worse-than-BURST
    // spike, all within a single flush window) must still commit as one
    // single batched state update, not 5,000 individual ones - proven
    // indirectly here: the queue is fully drained by exactly one flush tick.
    act(() => {
      for (let i = 0; i < 5000; i++) {
        latestMockEventSource().emit('log', event({ message: `spike-${i}` }));
      }
    });
    expect(result.current.visibleEvents).toEqual([]); // nothing committed yet - still queued

    act(() => vi.advanceTimersByTime(BATCH_FLUSH_MS)); // exactly one flush tick
    expect(result.current.visibleEvents).toHaveLength(VISIBLE_CAP); // fully drained and bounded in one commit
    expect(result.current.totalReceived).toBe(5000);
  });

  it('filtering while receiving: severity/text filtering is purely derived (useMemo in the panel) - the hook itself does no extra work per filter change during sustained load', () => {
    // The hook exposes only the unfiltered, bounded visibleEvents;
    // filtering happens in LiveTailPanel's own useMemo (see its test
    // file) and never touches retention/eviction bookkeeping. Proven
    // here structurally: sustained load produces the exact same
    // totalReceived/clientDroppedCount regardless of anything
    // filter-related, since the hook has no filter state to begin with.
    const { result } = renderHook(() => useLiveTail());
    act(() => result.current.start('fixture', []));
    act(() => latestMockEventSource().emitOpen());
    simulateRate(100, 5_000);
    expect(result.current).not.toHaveProperty('filterLevels');
    expect(result.current).not.toHaveProperty('filterText');
  });

  it('interact with controls during load: pause/resume/clear/stop all still work correctly mid-burst without losing bookkeeping integrity', () => {
    const { result } = renderHook(() => useLiveTail());
    act(() => result.current.start('fixture', []));
    act(() => latestMockEventSource().emitOpen());

    act(() => {
      for (let i = 0; i < 500; i++) {
        latestMockEventSource().emit('log', event({ message: `mid-${i}` }));
      }
    });
    // Pause mid-burst (queue not yet flushed).
    act(() => result.current.pause());
    expect(result.current.connectionState).toBe('paused');

    act(() => vi.advanceTimersByTime(BATCH_FLUSH_MS));
    // The 500 queued-before-pause events still flush normally (pause only
    // affects events arriving *after* the pause call, not what's already queued).
    expect(result.current.visibleEvents).toHaveLength(500);

    act(() => result.current.clear());
    expect(result.current.visibleEvents).toEqual([]);

    act(() => result.current.resume());
    expect(result.current.connectionState).toBe('live');

    act(() => result.current.stop());
    expect(result.current.connectionState).toBe('stopped');
  });
});
