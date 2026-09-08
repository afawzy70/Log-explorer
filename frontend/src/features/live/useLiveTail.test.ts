import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useLiveTail } from './useLiveTail';
import { VISIBLE_CAP } from './liveTailTypes';
import { installMockEventSource, latestMockEventSource, MockEventSource } from './mockEventSource';
import type { LogEvent } from '../../shared/api/types';

function event(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    timestamp: '2026-01-01T00:00:00Z',
    timestampRaw: null,
    schemaVersion: null,
    service: 'gateway',
    serviceSourceHint: null,
    severity: 'INFO',
    severityNumber: null,
    message: 'live event',
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
    containerId: null,
    containerName: null,
    stream: null,
    namespace: null,
    pod: null,
    ...overrides,
  };
}

describe('useLiveTail', () => {
  beforeEach(() => {
    installMockEventSource();
  });

  afterEach(() => {
    delete (globalThis as { EventSource?: unknown }).EventSource;
  });

  it('starts idle', () => {
    const { result } = renderHook(() => useLiveTail());
    expect(result.current.connectionState).toBe('idle');
    expect(result.current.visibleEvents).toEqual([]);
  });

  it('start() opens a real EventSource at /api/v1/logs/live with only sourceId/services in the URL - never a token or sensitive value', () => {
    const { result } = renderHook(() => useLiveTail());
    act(() => result.current.start('fixture', ['gateway', 'payments-api']));

    const source = latestMockEventSource();
    expect(source.url).toContain('/api/v1/logs/live?');
    expect(source.url).toContain('sourceId=fixture');
    expect(source.url).toContain('services=gateway%2Cpayments-api');
    expect(result.current.connectionState).toBe('connecting');
  });

  it('start() with no services omits the services param entirely', () => {
    const { result } = renderHook(() => useLiveTail());
    act(() => result.current.start('fixture', []));
    expect(latestMockEventSource().url).not.toContain('services=');
  });

  it('onopen transitions connecting -> live', () => {
    const { result } = renderHook(() => useLiveTail());
    act(() => result.current.start('fixture', []));
    act(() => latestMockEventSource().emitOpen());
    expect(result.current.connectionState).toBe('live');
  });

  it('a real "log" event is parsed and prepended (newest first), incrementing totalReceived', () => {
    const { result } = renderHook(() => useLiveTail());
    act(() => result.current.start('fixture', []));
    act(() => latestMockEventSource().emitOpen());

    act(() => latestMockEventSource().emit('log', event({ message: 'first' })));
    act(() => latestMockEventSource().emit('log', event({ message: 'second' })));

    expect(result.current.totalReceived).toBe(2);
    expect(result.current.visibleEvents.map((e) => e.message)).toEqual(['second', 'first']);
  });

  it('a malformed "log" payload is skipped rather than crashing the stream', () => {
    const { result } = renderHook(() => useLiveTail());
    act(() => result.current.start('fixture', []));
    act(() => latestMockEventSource().emitRaw('log', 'not json'));
    expect(result.current.visibleEvents).toEqual([]);
    expect(result.current.totalReceived).toBe(0);
  });

  it('a real "status" event updates serverDroppedCount - a distinct, never-conflated count', () => {
    const { result } = renderHook(() => useLiveTail());
    act(() => result.current.start('fixture', []));
    act(() => latestMockEventSource().emit('status', { droppedCount: 7, serverTime: '2026-01-01T00:00:05Z' }));
    expect(result.current.serverDroppedCount).toBe(7);
    expect(result.current.clientDroppedCount).toBe(0); // never conflated with the server's own count
  });

  it('exceeding the 1,000-event visible cap evicts the oldest and counts it as a client drop', () => {
    const { result } = renderHook(() => useLiveTail());
    act(() => result.current.start('fixture', []));
    act(() => {
      for (let i = 0; i < VISIBLE_CAP + 5; i++) {
        latestMockEventSource().emit('log', event({ message: `event-${i}` }));
      }
    });
    expect(result.current.visibleEvents).toHaveLength(VISIBLE_CAP);
    expect(result.current.clientDroppedCount).toBe(5);
    expect(result.current.totalReceived).toBe(VISIBLE_CAP + 5);
    // Newest-first: the most recent event is still at the front, the
    // oldest 5 (event-0..event-4) are the ones that got evicted.
    expect(result.current.visibleEvents[0].message).toBe(`event-${VISIBLE_CAP + 4}`);
  });

  it('pause() diverts new events into the buffered count instead of the visible list', () => {
    const { result } = renderHook(() => useLiveTail());
    act(() => result.current.start('fixture', []));
    act(() => latestMockEventSource().emitOpen());
    act(() => latestMockEventSource().emit('log', event({ message: 'before-pause' })));

    act(() => result.current.pause());
    expect(result.current.connectionState).toBe('paused');
    act(() => latestMockEventSource().emit('log', event({ message: 'while-paused' })));

    expect(result.current.visibleEvents.map((e) => e.message)).toEqual(['before-pause']);
    expect(result.current.bufferedCount).toBe(1);
    expect(result.current.totalReceived).toBe(2); // still counted as received, just not yet shown
  });

  it('resume() flushes buffered events into the visible list, newest first, and clears the buffered count', () => {
    const { result } = renderHook(() => useLiveTail());
    act(() => result.current.start('fixture', []));
    act(() => latestMockEventSource().emitOpen());
    act(() => latestMockEventSource().emit('log', event({ message: 'before-pause' })));
    act(() => result.current.pause());
    act(() => latestMockEventSource().emit('log', event({ message: 'buffered-1' })));
    act(() => latestMockEventSource().emit('log', event({ message: 'buffered-2' })));

    act(() => result.current.resume());

    expect(result.current.connectionState).toBe('live');
    expect(result.current.bufferedCount).toBe(0);
    expect(result.current.visibleEvents.map((e) => e.message)).toEqual(['buffered-2', 'buffered-1', 'before-pause']);
  });

  it('the EventSource connection stays open across pause/resume - never reconnects', () => {
    const { result } = renderHook(() => useLiveTail());
    act(() => result.current.start('fixture', []));
    const source = latestMockEventSource();
    act(() => result.current.pause());
    act(() => result.current.resume());
    expect(source.closed).toBe(false);
    expect(MockEventSource.instances).toHaveLength(1); // no second connection was ever opened
  });

  it('stop() closes the real connection and sets a real, visible "stopped" state', () => {
    const { result } = renderHook(() => useLiveTail());
    act(() => result.current.start('fixture', []));
    const source = latestMockEventSource();
    act(() => result.current.stop());
    expect(source.closed).toBe(true);
    expect(result.current.connectionState).toBe('stopped');
  });

  it('a real connection error closes the stream and surfaces an explicit error state - never a silent retry loop', () => {
    const { result } = renderHook(() => useLiveTail());
    act(() => result.current.start('fixture', []));
    const source = latestMockEventSource();
    act(() => source.emitError());
    expect(source.closed).toBe(true);
    expect(result.current.connectionState).toBe('error');
    expect(result.current.errorMessage).not.toBeNull();
  });

  it('exit() fully resets to idle, clearing every count', () => {
    const { result } = renderHook(() => useLiveTail());
    act(() => result.current.start('fixture', []));
    act(() => latestMockEventSource().emit('log', event()));
    act(() => result.current.stop());

    act(() => result.current.exit());

    expect(result.current.connectionState).toBe('idle');
    expect(result.current.visibleEvents).toEqual([]);
    expect(result.current.totalReceived).toBe(0);
  });

  it('unmounting closes the stream (HANDOVER.md §18.4 "unmount closes stream")', () => {
    const { result, unmount } = renderHook(() => useLiveTail());
    act(() => result.current.start('fixture', []));
    const source = latestMockEventSource();
    expect(source.closed).toBe(false);

    unmount();

    expect(source.closed).toBe(true);
  });

  it('calling start() again closes the previous connection before opening a new one', () => {
    const { result } = renderHook(() => useLiveTail());
    act(() => result.current.start('fixture', []));
    const first = latestMockEventSource();
    act(() => result.current.start('fixture', ['gateway']));
    const second = latestMockEventSource();

    expect(first.closed).toBe(true);
    expect(second).not.toBe(first);
  });
});
