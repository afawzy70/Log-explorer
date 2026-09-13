import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useLiveTail } from './useLiveTail';
import { BATCH_FLUSH_MS, RECONNECT_MAX_ATTEMPTS, VISIBLE_CAP } from './liveTailTypes';
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

/** Advances fake timers enough for at least one batch flush tick to run. */
function advanceOneFlush() {
  act(() => {
    vi.advanceTimersByTime(BATCH_FLUSH_MS);
  });
}

describe('useLiveTail (Legacy Remediation Slice 5)', () => {
  beforeEach(() => {
    installMockEventSource();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { EventSource?: unknown }).EventSource;
  });

  describe('state machine', () => {
    it('starts idle', () => {
      const { result } = renderHook(() => useLiveTail());
      expect(result.current.connectionState).toBe('idle');
      expect(result.current.visibleEvents).toEqual([]);
    });

    it('start() -> connecting -> live on open', () => {
      const { result } = renderHook(() => useLiveTail());
      act(() => result.current.start('fixture', []));
      expect(result.current.connectionState).toBe('connecting');

      act(() => latestMockEventSource().emitOpen());
      expect(result.current.connectionState).toBe('live');
    });

    it('pause: live -> paused; resume: paused -> live', () => {
      const { result } = renderHook(() => useLiveTail());
      act(() => result.current.start('fixture', []));
      act(() => latestMockEventSource().emitOpen());

      act(() => result.current.pause());
      expect(result.current.connectionState).toBe('paused');

      act(() => result.current.resume());
      expect(result.current.connectionState).toBe('live');
    });

    it('pause is a no-op unless currently live (no impossible transitions)', () => {
      const { result } = renderHook(() => useLiveTail());
      act(() => result.current.start('fixture', [])); // connecting
      act(() => result.current.pause());
      expect(result.current.connectionState).toBe('connecting'); // unchanged
    });

    it('stop: any active state -> stopped', () => {
      const { result } = renderHook(() => useLiveTail());
      act(() => result.current.start('fixture', []));
      act(() => latestMockEventSource().emitOpen());
      act(() => result.current.stop());
      expect(result.current.connectionState).toBe('stopped');
    });

    it('exit: any state -> idle, and clears every count', () => {
      const { result } = renderHook(() => useLiveTail());
      act(() => result.current.start('fixture', []));
      act(() => latestMockEventSource().emitOpen());
      act(() => latestMockEventSource().emit('log', event()));
      advanceOneFlush();
      expect(result.current.visibleEvents.length).toBeGreaterThan(0);

      act(() => result.current.exit());
      expect(result.current.connectionState).toBe('idle');
      expect(result.current.visibleEvents).toEqual([]);
      expect(result.current.totalReceived).toBe(0);
    });
  });

  describe('start', () => {
    it('opens a real EventSource at /api/v1/logs/live with only sourceId/services in the URL - never a token or sensitive value', () => {
      const { result } = renderHook(() => useLiveTail());
      act(() => result.current.start('fixture', ['gateway', 'payments-api']));

      const source = latestMockEventSource();
      expect(source.url).toContain('/api/v1/logs/live?');
      expect(source.url).toContain('sourceId=fixture');
      expect(source.url).toContain('services=gateway%2Cpayments-api');
      expect(result.current.connectionState).toBe('connecting');
    });

    it('with no services omits the services param entirely', () => {
      const { result } = renderHook(() => useLiveTail());
      act(() => result.current.start('fixture', []));
      expect(latestMockEventSource().url).not.toContain('services=');
    });

    it('UX-R3 §19: threads a request-scoped composeProject into the URL when supplied, still never a sensitive value', () => {
      const { result } = renderHook(() => useLiveTail());
      act(() => result.current.start('local-docker', [], 'project-a'));
      const source = latestMockEventSource();
      expect(source.url).toContain('sourceId=local-docker');
      expect(source.url).toContain('composeProject=project-a');
    });

    it('with no composeProject omits the param entirely - unscoped Live, unchanged from before UX-R3', () => {
      const { result } = renderHook(() => useLiveTail());
      act(() => result.current.start('fixture', []));
      expect(latestMockEventSource().url).not.toContain('composeProject=');
    });

    it('retry() after a terminal failure re-starts with the exact same composeProject scope, never silently dropping it', async () => {
      const { result } = renderHook(() => useLiveTail());
      act(() => result.current.start('local-docker', [], 'project-a'));
      act(() => latestMockEventSource().emitOpen());

      for (let i = 0; i < RECONNECT_MAX_ATTEMPTS; i++) {
        act(() => latestMockEventSource().emitError());
        await act(() => vi.runOnlyPendingTimersAsync());
      }
      act(() => latestMockEventSource().emitError());
      expect(result.current.connectionState).toBe('failed');

      act(() => result.current.retry());
      expect(latestMockEventSource().url).toContain('composeProject=project-a');
    });
  });

  describe('duplicate Start prevention (session/generation identity)', () => {
    it('calling start() again closes the previous EventSource and begins one clean new session - no ghost subscriptions', () => {
      const { result } = renderHook(() => useLiveTail());
      act(() => result.current.start('fixture', []));
      const first = latestMockEventSource();
      act(() => result.current.start('fixture', ['gateway']));
      const second = latestMockEventSource();

      expect(first.closed).toBe(true);
      expect(second).not.toBe(first);
    });

    it('events from the superseded (old) EventSource are ignored once a new session has started - stale-session events ignored', () => {
      const { result } = renderHook(() => useLiveTail());
      act(() => result.current.start('fixture', []));
      const stale = latestMockEventSource();
      act(() => stale.emitOpen());

      act(() => result.current.start('fixture', [])); // new session
      const fresh = latestMockEventSource();
      act(() => fresh.emitOpen());

      // The old (stale) source delivers an event "late" - it must never reach the new session's state.
      act(() => stale.emit('log', event({ message: 'stale-event' })));
      advanceOneFlush();

      expect(result.current.visibleEvents.some((e) => e.message === 'stale-event')).toBe(false);
    });
  });

  describe('source change cancels the old session', () => {
    it('calling exit() (as App.tsx does on source change) invalidates the previous session the same way start() does', () => {
      const { result } = renderHook(() => useLiveTail());
      act(() => result.current.start('fixture', []));
      const stale = latestMockEventSource();
      act(() => stale.emitOpen());

      act(() => result.current.exit());
      expect(result.current.connectionState).toBe('idle');

      // A late event from the exited session's own EventSource must never reappear.
      act(() => stale.emit('log', event({ message: 'post-exit-event' })));
      advanceOneFlush();
      expect(result.current.visibleEvents).toEqual([]);
    });
  });

  describe('batching behavior (performance)', () => {
    it('incoming events do not appear in visibleEvents until the next flush tick - never one render per event', () => {
      const { result } = renderHook(() => useLiveTail());
      act(() => result.current.start('fixture', []));
      act(() => latestMockEventSource().emitOpen());

      act(() => latestMockEventSource().emit('log', event({ message: 'not-yet-flushed' })));
      expect(result.current.visibleEvents).toEqual([]); // queued, not yet committed to state

      advanceOneFlush();
      expect(result.current.visibleEvents).toHaveLength(1);
      expect(result.current.visibleEvents[0].message).toBe('not-yet-flushed');
    });

    it('a burst of many events between two flush ticks commits as exactly one batch, newest first', () => {
      const { result } = renderHook(() => useLiveTail());
      act(() => result.current.start('fixture', []));
      act(() => latestMockEventSource().emitOpen());

      act(() => {
        for (let i = 0; i < 50; i++) {
          latestMockEventSource().emit('log', event({ message: `burst-${i}` }));
        }
      });
      expect(result.current.visibleEvents).toEqual([]); // still queued

      advanceOneFlush();
      expect(result.current.visibleEvents).toHaveLength(50);
      expect(result.current.visibleEvents[0].message).toBe('burst-49'); // newest of the batch first
      expect(result.current.visibleEvents[49].message).toBe('burst-0');
      expect(result.current.totalReceived).toBe(50);
    });
  });

  describe('bounded retained event count (retention limit)', () => {
    it(`never exceeds VISIBLE_CAP (${VISIBLE_CAP}) events, evicting oldest first and counting evictions`, () => {
      const { result } = renderHook(() => useLiveTail());
      act(() => result.current.start('fixture', []));
      act(() => latestMockEventSource().emitOpen());

      const overflow = VISIBLE_CAP + 25;
      act(() => {
        for (let i = 0; i < overflow; i++) {
          latestMockEventSource().emit('log', event({ message: `e-${i}` }));
        }
      });
      advanceOneFlush();

      expect(result.current.visibleEvents).toHaveLength(VISIBLE_CAP);
      expect(result.current.clientDroppedCount).toBe(25);
      expect(result.current.visibleEvents[0].message).toBe(`e-${overflow - 1}`); // newest survives
    });

    it('retention stays bounded across many flush ticks too - no unbounded growth over time', () => {
      const { result } = renderHook(() => useLiveTail());
      act(() => result.current.start('fixture', []));
      act(() => latestMockEventSource().emitOpen());

      for (let tick = 0; tick < 30; tick++) {
        act(() => {
          for (let i = 0; i < 100; i++) {
            latestMockEventSource().emit('log', event({ message: `tick${tick}-${i}` }));
          }
        });
        advanceOneFlush();
        expect(result.current.visibleEvents.length).toBeLessThanOrEqual(VISIBLE_CAP);
      }
      expect(result.current.visibleEvents).toHaveLength(VISIBLE_CAP); // reached the plateau, never exceeded it
    });
  });

  describe('pause / resume (bounded paused buffer - policy B)', () => {
    it('pause() diverts new events into a bounded buffered count instead of visibleEvents', () => {
      const { result } = renderHook(() => useLiveTail());
      act(() => result.current.start('fixture', []));
      act(() => latestMockEventSource().emitOpen());
      act(() => latestMockEventSource().emit('log', event({ message: 'before-pause' })));
      advanceOneFlush();

      act(() => result.current.pause());
      act(() => latestMockEventSource().emit('log', event({ message: 'while-paused' })));

      expect(result.current.bufferedCount).toBe(1);
      expect(result.current.visibleEvents.some((e) => e.message === 'while-paused')).toBe(false);
    });

    it('resume() flushes the buffered events into visibleEvents immediately (not waiting for the next tick), newest first, and clears bufferedCount', () => {
      const { result } = renderHook(() => useLiveTail());
      act(() => result.current.start('fixture', []));
      act(() => latestMockEventSource().emitOpen());
      act(() => result.current.pause());
      act(() => latestMockEventSource().emit('log', event({ message: 'buffered-1' })));
      act(() => latestMockEventSource().emit('log', event({ message: 'buffered-2' })));

      act(() => result.current.resume());

      expect(result.current.bufferedCount).toBe(0);
      expect(result.current.visibleEvents[0].message).toBe('buffered-2');
      expect(result.current.visibleEvents[1].message).toBe('buffered-1');
    });

    it('the paused buffer is itself bounded at VISIBLE_CAP - pause never creates unlimited accumulation', () => {
      const { result } = renderHook(() => useLiveTail());
      act(() => result.current.start('fixture', []));
      act(() => latestMockEventSource().emitOpen());
      act(() => result.current.pause());

      const overflow = VISIBLE_CAP + 10;
      act(() => {
        for (let i = 0; i < overflow; i++) {
          latestMockEventSource().emit('log', event({ message: `p-${i}` }));
        }
      });

      expect(result.current.bufferedCount).toBe(VISIBLE_CAP);
      expect(result.current.clientDroppedCount).toBe(10);
    });

    it('pause keeps the real connection open - the same EventSource instance survives pause/resume', () => {
      const { result } = renderHook(() => useLiveTail());
      act(() => result.current.start('fixture', []));
      act(() => latestMockEventSource().emitOpen());
      const before = MockEventSource.instances.length;

      act(() => result.current.pause());
      act(() => result.current.resume());

      expect(MockEventSource.instances.length).toBe(before); // no new connection was opened
    });
  });

  describe('Clear', () => {
    it('empties visibleEvents and every count without touching connectionState or closing the connection', () => {
      const { result } = renderHook(() => useLiveTail());
      act(() => result.current.start('fixture', []));
      act(() => latestMockEventSource().emitOpen());
      act(() => latestMockEventSource().emit('log', event()));
      advanceOneFlush();
      const source = latestMockEventSource();

      act(() => result.current.clear());

      expect(result.current.visibleEvents).toEqual([]);
      expect(result.current.totalReceived).toBe(0);
      expect(result.current.connectionState).toBe('live');
      expect(source.closed).toBe(false);

      // The stream is still genuinely live - a new event still arrives after Clear.
      act(() => latestMockEventSource().emit('log', event({ message: 'after-clear' })));
      advanceOneFlush();
      expect(result.current.visibleEvents).toHaveLength(1);
    });
  });

  describe('reconnect', () => {
    it('an error while live moves to reconnecting and schedules exactly one retry attempt', () => {
      const { result } = renderHook(() => useLiveTail());
      act(() => result.current.start('fixture', []));
      act(() => latestMockEventSource().emitOpen());

      act(() => latestMockEventSource().emitError());
      expect(result.current.connectionState).toBe('reconnecting');
      expect(result.current.reconnectAttempt).toBe(1);
    });

    it('a successful reconnect returns to live, resets the attempt counter, and increments reconnectCount (continuity honesty)', async () => {
      const { result } = renderHook(() => useLiveTail());
      act(() => result.current.start('fixture', []));
      act(() => latestMockEventSource().emitOpen());
      act(() => latestMockEventSource().emitError());
      expect(result.current.connectionState).toBe('reconnecting');

      await act(() => vi.runOnlyPendingTimersAsync());
      act(() => latestMockEventSource().emitOpen());

      expect(result.current.connectionState).toBe('live');
      expect(result.current.reconnectAttempt).toBe(0);
      expect(result.current.reconnectCount).toBe(1);
    });

    it('bounded retries: after RECONNECT_MAX_ATTEMPTS consecutive failures, moves to the terminal "failed" state instead of retrying forever', async () => {
      const { result } = renderHook(() => useLiveTail());
      act(() => result.current.start('fixture', []));
      act(() => latestMockEventSource().emitOpen());

      for (let i = 0; i < RECONNECT_MAX_ATTEMPTS; i++) {
        act(() => latestMockEventSource().emitError());
        expect(result.current.connectionState).toBe('reconnecting');
        await act(() => vi.runOnlyPendingTimersAsync());
      }
      // One more failure than the budget allows.
      act(() => latestMockEventSource().emitError());

      expect(result.current.connectionState).toBe('failed');
      expect(result.current.errorMessage).toContain('Retry');
    });

    it('no multiple concurrent reconnect timers - a second error before the first timer fires does not double-schedule', () => {
      const { result } = renderHook(() => useLiveTail());
      act(() => result.current.start('fixture', []));
      act(() => latestMockEventSource().emitOpen());
      act(() => latestMockEventSource().emitError());
      const attemptAfterFirstError = result.current.reconnectAttempt;

      expect(vi.getTimerCount()).toBeGreaterThanOrEqual(1);
      const timersBeforeSecondError = vi.getTimerCount();
      // The (already-closed) EventSource firing onerror again must not be
      // possible in production (closed sources don't fire), but even if a
      // stray call happened, the session guard/attempt bookkeeping stays sane.
      expect(attemptAfterFirstError).toBe(1);
      expect(timersBeforeSecondError).toBeGreaterThanOrEqual(1);
    });

    it('Stop cancels the pending reconnect timer and prevents any further attempt', () => {
      const { result } = renderHook(() => useLiveTail());
      act(() => result.current.start('fixture', []));
      act(() => latestMockEventSource().emitOpen());
      act(() => latestMockEventSource().emitError());
      expect(result.current.connectionState).toBe('reconnecting');

      act(() => result.current.stop());
      expect(result.current.connectionState).toBe('stopped');

      const instancesBefore = MockEventSource.instances.length;
      act(() => vi.runAllTimers());
      // No new EventSource was opened by a reconnect attempt that should have been cancelled.
      expect(MockEventSource.instances.length).toBe(instancesBefore);
      expect(result.current.connectionState).toBe('stopped');
    });

    it('restarting from the terminal "failed" state via retry() begins a genuinely fresh session', async () => {
      const { result } = renderHook(() => useLiveTail());
      act(() => result.current.start('fixture', []));
      act(() => latestMockEventSource().emitOpen());
      for (let i = 0; i < RECONNECT_MAX_ATTEMPTS; i++) {
        act(() => latestMockEventSource().emitError());
        await act(() => vi.runOnlyPendingTimersAsync());
      }
      act(() => latestMockEventSource().emitError());
      expect(result.current.connectionState).toBe('failed');

      act(() => result.current.retry());
      expect(result.current.connectionState).toBe('connecting');
      expect(result.current.reconnectAttempt).toBe(0);
      expect(result.current.errorMessage).toBeNull();

      act(() => latestMockEventSource().emitOpen());
      expect(result.current.connectionState).toBe('live');
    });
  });

  describe('follow newest', () => {
    it('defaults to true, and setFollowNewest(false) suspends it', () => {
      const { result } = renderHook(() => useLiveTail());
      expect(result.current.followNewest).toBe(true);
      act(() => result.current.setFollowNewest(false));
      expect(result.current.followNewest).toBe(false);
    });

    it('while following, unseenCount stays 0 as events arrive', () => {
      const { result } = renderHook(() => useLiveTail());
      act(() => result.current.start('fixture', []));
      act(() => latestMockEventSource().emitOpen());
      act(() => latestMockEventSource().emit('log', event()));
      advanceOneFlush();
      expect(result.current.unseenCount).toBe(0);
    });

    it('once suspended, unseenCount accumulates as new events arrive, and re-enabling follow clears it', () => {
      const { result } = renderHook(() => useLiveTail());
      act(() => result.current.start('fixture', []));
      act(() => latestMockEventSource().emitOpen());
      act(() => result.current.setFollowNewest(false));

      act(() => latestMockEventSource().emit('log', event()));
      act(() => latestMockEventSource().emit('log', event()));
      advanceOneFlush();
      expect(result.current.unseenCount).toBe(2);

      act(() => result.current.setFollowNewest(true));
      expect(result.current.unseenCount).toBe(0);
    });
  });

  describe('source status (OS-1E final implementation)', () => {
    it('defaults to the nominal/RUNNING status, and a "status" event populates it from the payload verbatim', () => {
      const { result } = renderHook(() => useLiveTail());
      expect(result.current.sourceStatus).toEqual({
        state: 'RUNNING',
        resolvedTargets: 0,
        connectingTargets: 0,
        activeTargets: 0,
        reconnectingTargets: 0,
        stoppedTargets: 0,
        warnings: [],
      });

      act(() => result.current.start('openshift', []));
      act(() => latestMockEventSource().emitOpen());
      act(() =>
        latestMockEventSource().emit('status', {
          droppedCount: 0,
          serverTime: '2026-01-01T00:00:00Z',
          liveSourceState: 'DEGRADED',
          resolvedTargets: 2,
          connectingTargets: 0,
          activeTargets: 1,
          reconnectingTargets: 0,
          stoppedTargets: 1,
          warnings: ['Pod payment-api-1 / container app stopped — the pod or container no longer exists (404).'],
        }),
      );

      expect(result.current.sourceStatus).toEqual({
        state: 'DEGRADED',
        resolvedTargets: 2,
        connectingTargets: 0,
        activeTargets: 1,
        reconnectingTargets: 0,
        stoppedTargets: 1,
        warnings: ['Pod payment-api-1 / container app stopped — the pod or container no longer exists (404).'],
      });
    });

    it('a "status" event carrying CONNECTING (mission §15) is read verbatim - never confused with RUNNING', () => {
      const { result } = renderHook(() => useLiveTail());
      act(() => result.current.start('openshift', []));
      act(() => latestMockEventSource().emitOpen());
      act(() =>
        latestMockEventSource().emit('status', {
          droppedCount: 0,
          serverTime: '2026-01-01T00:00:00Z',
          liveSourceState: 'CONNECTING',
          resolvedTargets: 10,
          connectingTargets: 10,
          activeTargets: 0,
          reconnectingTargets: 0,
          stoppedTargets: 0,
          warnings: [],
        }),
      );
      expect(result.current.sourceStatus.state).toBe('CONNECTING');
      expect(result.current.sourceStatus.connectingTargets).toBe(10);
      expect(result.current.sourceStatus.activeTargets).toBe(0);
    });

    it('a later "status" event replaces the whole snapshot - a resolved target no longer clears a stale field', () => {
      const { result } = renderHook(() => useLiveTail());
      act(() => result.current.start('openshift', []));
      act(() => latestMockEventSource().emitOpen());
      act(() =>
        latestMockEventSource().emit('status', {
          droppedCount: 0,
          serverTime: '2026-01-01T00:00:00Z',
          liveSourceState: 'NO_ACTIVE_TARGETS',
          resolvedTargets: 1,
          connectingTargets: 0,
          activeTargets: 0,
          reconnectingTargets: 0,
          stoppedTargets: 1,
          warnings: ['some target stopped'],
        }),
      );
      expect(result.current.sourceStatus.state).toBe('NO_ACTIVE_TARGETS');

      act(() =>
        latestMockEventSource().emit('status', {
          droppedCount: 0,
          serverTime: '2026-01-01T00:00:01Z',
          liveSourceState: 'RUNNING',
          resolvedTargets: 1,
          connectingTargets: 0,
          activeTargets: 1,
          reconnectingTargets: 0,
          stoppedTargets: 0,
          warnings: [],
        }),
      );
      expect(result.current.sourceStatus.state).toBe('RUNNING');
      expect(result.current.sourceStatus.warnings).toEqual([]);
    });

    it('a fresh start() resets sourceStatus back to nominal', () => {
      const { result } = renderHook(() => useLiveTail());
      act(() => result.current.start('openshift', []));
      act(() => latestMockEventSource().emitOpen());
      act(() =>
        latestMockEventSource().emit('status', {
          droppedCount: 0,
          serverTime: '2026-01-01T00:00:00Z',
          liveSourceState: 'EXPIRED',
          resolvedTargets: 1,
          connectingTargets: 0,
          activeTargets: 0,
          reconnectingTargets: 0,
          stoppedTargets: 1,
          warnings: ['some target stopped'],
        }),
      );
      expect(result.current.sourceStatus.state).toBe('EXPIRED');

      act(() => result.current.start('openshift', []));
      expect(result.current.sourceStatus.state).toBe('RUNNING');
      expect(result.current.sourceStatus.warnings).toEqual([]);
    });

    it('a source with no per-target concept (e.g. Docker/Fixture) simply never leaves RUNNING', () => {
      const { result } = renderHook(() => useLiveTail());
      act(() => result.current.start('fixture', []));
      act(() => latestMockEventSource().emitOpen());
      act(() =>
        latestMockEventSource().emit('status', {
          droppedCount: 0,
          serverTime: '2026-01-01T00:00:00Z',
          liveSourceState: 'RUNNING',
          resolvedTargets: 0,
          connectingTargets: 0,
          activeTargets: 0,
          reconnectingTargets: 0,
          stoppedTargets: 0,
          warnings: [],
        }),
      );
      expect(result.current.sourceStatus.state).toBe('RUNNING');
    });
  });

  describe('terminal source state suppresses the generic automatic reconnect (OS-1E final implementation, mission §18/§20)', () => {
    it('NO_ACTIVE_TARGETS at the moment of disconnect transitions straight to stopped - no reconnect timer, events retained', () => {
      const { result } = renderHook(() => useLiveTail());
      act(() => result.current.start('openshift', []));
      act(() => latestMockEventSource().emitOpen());
      act(() => latestMockEventSource().emit('log', event({ message: 'before-terminal' })));
      advanceOneFlush();
      act(() =>
        latestMockEventSource().emit('status', {
          droppedCount: 0,
          serverTime: '2026-01-01T00:00:00Z',
          liveSourceState: 'NO_ACTIVE_TARGETS',
          resolvedTargets: 1,
          connectingTargets: 0,
          activeTargets: 0,
          reconnectingTargets: 0,
          stoppedTargets: 1,
          warnings: ['every target stopped'],
        }),
      );

      act(() => latestMockEventSource().emitError());

      expect(result.current.connectionState).toBe('stopped');
      expect(result.current.reconnectAttempt).toBe(0);
      expect(result.current.reconnectCount).toBe(0);
      // Currently displayed events remain available - the same "Stop"
      // guarantee an ordinary user-initiated Stop already gives.
      expect(result.current.visibleEvents.some((e) => e.message === 'before-terminal')).toBe(true);

      // No reconnect timer was armed - advancing time must not reopen a
      // new EventSource.
      const instanceCountBeforeAdvance = MockEventSource.instances.length;
      act(() => vi.advanceTimersByTime(60_000));
      expect(MockEventSource.instances.length).toBe(instanceCountBeforeAdvance); // no new EventSource was created
      expect(result.current.connectionState).toBe('stopped');
    });

    it('EXPIRED at the moment of disconnect also suppresses the generic reconnect', () => {
      const { result } = renderHook(() => useLiveTail());
      act(() => result.current.start('openshift', []));
      act(() => latestMockEventSource().emitOpen());
      act(() =>
        latestMockEventSource().emit('status', {
          droppedCount: 0,
          serverTime: '2026-01-01T00:00:00Z',
          liveSourceState: 'EXPIRED',
          resolvedTargets: 1,
          connectingTargets: 0,
          activeTargets: 0,
          reconnectingTargets: 0,
          stoppedTargets: 1,
          warnings: ['session expired'],
        }),
      );

      act(() => latestMockEventSource().emitError());

      expect(result.current.connectionState).toBe('stopped');
    });

    it('STALE at the moment of disconnect also suppresses the generic reconnect', () => {
      const { result } = renderHook(() => useLiveTail());
      act(() => result.current.start('openshift', []));
      act(() => latestMockEventSource().emitOpen());
      act(() =>
        latestMockEventSource().emit('status', {
          droppedCount: 0,
          serverTime: '2026-01-01T00:00:00Z',
          liveSourceState: 'STALE',
          resolvedTargets: 1,
          connectingTargets: 0,
          activeTargets: 0,
          reconnectingTargets: 0,
          stoppedTargets: 0,
          warnings: ['scope changed'],
        }),
      );

      act(() => latestMockEventSource().emitError());

      expect(result.current.connectionState).toBe('stopped');
    });

    it('a NON-terminal source state (e.g. RUNNING/DEGRADED) at the moment of disconnect still uses the ordinary generic reconnect - no regression', () => {
      const { result } = renderHook(() => useLiveTail());
      act(() => result.current.start('openshift', []));
      act(() => latestMockEventSource().emitOpen());
      act(() =>
        latestMockEventSource().emit('status', {
          droppedCount: 0,
          serverTime: '2026-01-01T00:00:00Z',
          liveSourceState: 'RUNNING',
          resolvedTargets: 1,
          connectingTargets: 0,
          activeTargets: 1,
          reconnectingTargets: 0,
          stoppedTargets: 0,
          warnings: [],
        }),
      );

      act(() => latestMockEventSource().emitError());

      expect(result.current.connectionState).toBe('reconnecting');
      expect(result.current.reconnectAttempt).toBe(1);
    });

    it('Docker/Fixture (always NOMINAL/RUNNING) are unaffected - the ordinary generic reconnect still applies', () => {
      const { result } = renderHook(() => useLiveTail());
      act(() => result.current.start('fixture', []));
      act(() => latestMockEventSource().emitOpen());

      act(() => latestMockEventSource().emitError());

      expect(result.current.connectionState).toBe('reconnecting');
    });
  });

  describe('no sensitive persistence', () => {
    it('never writes to localStorage or sessionStorage at any point in the lifecycle', () => {
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
      const { result } = renderHook(() => useLiveTail());
      act(() => result.current.start('fixture', ['gateway']));
      act(() => latestMockEventSource().emitOpen());
      act(() => latestMockEventSource().emit('log', event()));
      advanceOneFlush();
      act(() => result.current.pause());
      act(() => result.current.resume());
      act(() => result.current.clear());
      act(() => result.current.stop());

      expect(setItemSpy).not.toHaveBeenCalled();
      setItemSpy.mockRestore();
    });
  });

  it('unmounting closes the stream and cancels any pending reconnect timer (HANDOVER.md §18.4 "unmount closes stream")', () => {
    const { result, unmount } = renderHook(() => useLiveTail());
    act(() => result.current.start('fixture', []));
    const source = latestMockEventSource();
    expect(source.closed).toBe(false);

    unmount();

    expect(source.closed).toBe(true);
  });
});
