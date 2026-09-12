import { useCallback, useEffect, useRef, useState } from 'react';
import type { LogEvent } from '../../shared/api/types';
import type { LiveConnectionState, LiveSourceStatusView, LiveStatusPayload } from './liveTailTypes';
import {
  BATCH_FLUSH_MS,
  NOMINAL_SOURCE_STATUS,
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_JITTER_RATIO,
  RECONNECT_MAX_ATTEMPTS,
  RECONNECT_MAX_DELAY_MS,
  VISIBLE_CAP,
} from './liveTailTypes';

interface StartArgs {
  sourceId: string;
  services: string[];
  /** UX-R3 §19 — request-scoped Docker Compose project selection; a project switch always calls `exit()` before Live could ever be (re)started under the new scope (see `App.tsx`), so this is never silently reused across projects. */
  composeProject?: string;
}

function reconnectDelayMs(attempt: number): number {
  const base = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** (attempt - 1), RECONNECT_MAX_DELAY_MS);
  const jitter = base * RECONNECT_JITTER_RATIO * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(base + jitter));
}

/**
 * Live tail lifecycle (Legacy Remediation Slice 5 -
 * `docs/verification/LEGACY_REMEDIATION_SLICE_5_REPORT.md`, superseding
 * Phase J's original design). An explicit finite state model
 * (`LiveConnectionState`) rather than loosely-related booleans - every
 * transition below is one of exactly the seven named states, never an
 * impossible combination.
 *
 * <p><b>Session/generation identity</b> (race safety - the mission's own
 * explicit checklist: double-Start, Stop-while-Connecting/Reconnecting,
 * stale events from a superseded session, a reconnect timer firing after
 * Stop): `sessionRef` is a monotonically increasing counter. `start()`,
 * `stop()`, and `exit()` each bump it; every async callback (SSE
 * handlers, the batch-flush interval, reconnect timers) captures the
 * session id it belongs to and is a no-op if `sessionRef.current` has
 * since moved on. This is the *only* mechanism guarding every race in
 * this hook - deliberately local to Live, not a generic fix for the
 * pre-existing, unrelated Issue #19 request-supersession concern
 * elsewhere in the app.
 *
 * <p><b>Batching</b> (performance - "do not append to React state per
 * incoming event"): incoming events are queued in `queueRef` (a plain
 * array, no state write) and committed to `visibleEvents` in one batched
 * `setState` every `BATCH_FLUSH_MS` via a single `setInterval` that lives
 * for the whole session (`start()` to `stop()`/`exit()`), not restarted
 * per reconnect attempt.
 *
 * <p><b>Retention</b>: `visibleEvents` is capped at `VISIBLE_CAP`
 * (oldest evicted first, deterministically, counted in
 * `clientDroppedCount`) - this is both the *retained* and *rendered*
 * bound (rendering the unfiltered retained set 1:1 - severity/text
 * filtering in `LiveTailPanel.tsx` only ever narrows what's displayed
 * from this already-bounded set, never the retention policy itself).
 *
 * <p><b>Pause</b> (policy B - "maintain a strictly bounded paused buffer
 * and clearly indicate dropped events", chosen over policy A because it
 * preserves what arrived while paused, which the pre-Slice-5 UX already
 * relied on): the real `EventSource` connection stays open; incoming
 * events go into `pausedBufferRef` instead of `queueRef`, bounded at the
 * exact same `VISIBLE_CAP`, evicting oldest-of-the-paused-window first.
 * Resume flushes the whole paused buffer into `visibleEvents` in one
 * batch immediately (not waiting for the next flush tick).
 *
 * <p><b>Reconnect</b>: bounded exponential backoff with ±20% jitter,
 * capped delay, capped attempt count (see `liveTailTypes.ts`'s own
 * constants and their rationale). Never retries after an intentional
 * `stop()`/`exit()` (the session-id guard). After
 * `RECONNECT_MAX_ATTEMPTS` failed attempts, the session moves to the
 * terminal `'failed'` state - `retry()` is the only way out, and it
 * starts a genuinely fresh session (fresh attempt counter, fresh
 * `EventSource`), never a continuation. <b>Continuity is never claimed
 * as exact-once</b>: each successful reconnect opens a brand-new stream
 * from "now" (the backend has no resume-from-cursor concept for live
 * tail), so a real gap is possible during the disconnected window -
 * `reconnectCount` is surfaced so the UI can say so honestly instead of
 * silently pretending nothing was missed.
 */
export function useLiveTail() {
  const [connectionState, setConnectionState] = useState<LiveConnectionState>('idle');
  const [visibleEvents, setVisibleEvents] = useState<LogEvent[]>([]);
  const [totalReceived, setTotalReceived] = useState(0);
  const [bufferedCount, setBufferedCount] = useState(0);
  const [clientDroppedCount, setClientDroppedCount] = useState(0);
  const [serverDroppedCount, setServerDroppedCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [reconnectCount, setReconnectCount] = useState(0);
  const [followNewest, setFollowNewestState] = useState(true);
  const [unseenCount, setUnseenCount] = useState(0);
  /**
   * OS-1E review recovery — the source's own CURRENT per-target runtime
   * truth (which/how many targets are active/reconnecting/stopped, and
   * why), taken verbatim from the most recent "status" heartbeat - a
   * full snapshot every tick, never a delta (see `LiveSourceStatus`'s own
   * backend javadoc). `NOMINAL_SOURCE_STATUS` for every source with no
   * per-target concept (Docker/Fixture/Loki) - never a source-specific UI
   * branch; `LiveTailPanel.tsx` decides how to render based on the
   * VALUES here, not on which source is selected.
   */
  const [sourceStatus, setSourceStatus] = useState<LiveSourceStatusView>(NOMINAL_SOURCE_STATUS);

  const sessionRef = useRef(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  const queueRef = useRef<LogEvent[]>([]);
  const pausedBufferRef = useRef<LogEvent[]>([]);
  const isPausedRef = useRef(false);
  const flushIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastStartRef = useRef<StartArgs | null>(null);
  const followNewestRef = useRef(true);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current != null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const clearFlushInterval = useCallback(() => {
    if (flushIntervalRef.current != null) {
      clearInterval(flushIntervalRef.current);
      flushIntervalRef.current = null;
    }
  }, []);

  const closeEventSource = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      closeEventSource();
      clearReconnectTimer();
      clearFlushInterval();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flush = useCallback((mySession: number) => {
    if (sessionRef.current !== mySession) {
      return;
    }
    const batch = queueRef.current;
    if (batch.length === 0) {
      return;
    }
    queueRef.current = [];
    setTotalReceived((n) => n + batch.length);
    if (followNewestRef.current) {
      setUnseenCount(0);
    } else {
      setUnseenCount((n) => n + batch.length);
    }
    setVisibleEvents((prev) => {
      // Batch arrived oldest-to-newest (push order); reversed so the
      // newest-of-batch ends up first, matching "newest first" overall.
      const next = [...batch.slice().reverse(), ...prev];
      if (next.length > VISIBLE_CAP) {
        const evicted = next.length - VISIBLE_CAP;
        next.length = VISIBLE_CAP;
        setClientDroppedCount((d) => d + evicted);
      }
      return next;
    });
  }, []);

  const connect = useCallback(
    (mySession: number, args: StartArgs) => {
      const params = new URLSearchParams({ sourceId: args.sourceId });
      if (args.services.length > 0) {
        params.set('services', args.services.join(','));
      }
      if (args.composeProject) {
        params.set('composeProject', args.composeProject);
      }
      // Search values never appear in the URL (CLAUDE.md §2 rule 4) -
      // live tail's own scope never accepts one to begin with; only the
      // non-sensitive sourceId/services/composeProject ever reach this
      // query string.
      const source = new EventSource(`/api/v1/logs/live?${params.toString()}`);
      eventSourceRef.current = source;

      source.onopen = () => {
        if (sessionRef.current !== mySession) {
          return;
        }
        setConnectionState((prev) => {
          if (prev === 'reconnecting') {
            setReconnectCount((n) => n + 1);
          }
          return 'live';
        });
        setReconnectAttempt(0);
        setErrorMessage(null);
      };

      source.addEventListener('log', (e: MessageEvent) => {
        if (sessionRef.current !== mySession) {
          return;
        }
        let event: LogEvent;
        try {
          event = JSON.parse(e.data) as LogEvent;
        } catch {
          return; // one malformed frame must never crash the whole stream
        }
        if (isPausedRef.current) {
          const next = [event, ...pausedBufferRef.current];
          if (next.length > VISIBLE_CAP) {
            next.length = VISIBLE_CAP;
            setClientDroppedCount((d) => d + 1);
          }
          pausedBufferRef.current = next;
          setBufferedCount(next.length);
        } else {
          queueRef.current.push(event);
        }
      });

      source.addEventListener('status', (e: MessageEvent) => {
        if (sessionRef.current !== mySession) {
          return;
        }
        try {
          const status = JSON.parse(e.data) as LiveStatusPayload;
          setServerDroppedCount(status.droppedCount);
          setSourceStatus({
            state: status.liveSourceState ?? 'RUNNING',
            resolvedTargets: status.resolvedTargets ?? 0,
            activeTargets: status.activeTargets ?? 0,
            reconnectingTargets: status.reconnectingTargets ?? 0,
            stoppedTargets: status.stoppedTargets ?? 0,
            warnings: status.warnings ?? [],
          });
        } catch {
          // a malformed heartbeat/status tick is never fatal - just skip it
        }
      });

      source.onerror = () => {
        if (sessionRef.current !== mySession) {
          return;
        }
        closeEventSource();
        setReconnectAttempt((prevAttempt) => {
          const nextAttempt = prevAttempt + 1;
          if (nextAttempt > RECONNECT_MAX_ATTEMPTS) {
            setConnectionState('failed');
            setErrorMessage(
              `Live connection lost after ${RECONNECT_MAX_ATTEMPTS} reconnect attempts. Click Retry to try again.`,
            );
            return prevAttempt;
          }
          setConnectionState('reconnecting');
          setErrorMessage(null);
          const delay = reconnectDelayMs(nextAttempt);
          clearReconnectTimer();
          reconnectTimerRef.current = setTimeout(() => {
            if (sessionRef.current !== mySession) {
              return;
            }
            connect(mySession, args);
          }, delay);
          return nextAttempt;
        });
      };
    },
    [closeEventSource, clearReconnectTimer],
  );

  const start = useCallback(
    (sourceId: string, services: string[], composeProject?: string) => {
      // A fresh session invalidates every callback/timer from whatever
      // came before (double-Start included - the previous session's own
      // EventSource/timers become no-ops via the session guard, and are
      // also explicitly closed/cleared here rather than left to leak).
      sessionRef.current += 1;
      const mySession = sessionRef.current;
      closeEventSource();
      clearReconnectTimer();
      clearFlushInterval();

      queueRef.current = [];
      pausedBufferRef.current = [];
      isPausedRef.current = false;
      followNewestRef.current = true;

      setVisibleEvents([]);
      setTotalReceived(0);
      setBufferedCount(0);
      setClientDroppedCount(0);
      setServerDroppedCount(0);
      setErrorMessage(null);
      setReconnectAttempt(0);
      setReconnectCount(0);
      setFollowNewestState(true);
      setUnseenCount(0);
      setSourceStatus(NOMINAL_SOURCE_STATUS);
      setConnectionState('connecting');

      const args: StartArgs = { sourceId, services, composeProject };
      lastStartRef.current = args;
      flushIntervalRef.current = setInterval(() => flush(mySession), BATCH_FLUSH_MS);
      connect(mySession, args);
    },
    [closeEventSource, clearReconnectTimer, clearFlushInterval, flush, connect],
  );

  /** Manual recovery from the terminal `'failed'` state (mission: "Terminal failure should offer Retry without requiring page refresh") - a genuinely fresh session, not a continuation. */
  const retry = useCallback(() => {
    if (lastStartRef.current) {
      start(lastStartRef.current.sourceId, lastStartRef.current.services, lastStartRef.current.composeProject);
    }
  }, [start]);

  const pause = useCallback(() => {
    isPausedRef.current = true;
    setConnectionState((prev) => (prev === 'live' ? 'paused' : prev));
  }, []);

  const resume = useCallback(() => {
    isPausedRef.current = false;
    setConnectionState((prev) => (prev === 'paused' ? 'live' : prev));
    const buffered = pausedBufferRef.current;
    pausedBufferRef.current = [];
    setBufferedCount(0);
    if (buffered.length === 0) {
      return;
    }
    setTotalReceived((n) => n + buffered.length);
    if (followNewestRef.current) {
      setUnseenCount(0);
    } else {
      setUnseenCount((n) => n + buffered.length);
    }
    setVisibleEvents((prev) => {
      const next = [...buffered, ...prev];
      if (next.length > VISIBLE_CAP) {
        const evicted = next.length - VISIBLE_CAP;
        next.length = VISIBLE_CAP;
        setClientDroppedCount((d) => d + evicted);
      }
      return next;
    });
  }, []);

  const stop = useCallback(() => {
    sessionRef.current += 1; // invalidates any in-flight reconnect timer/callback - "no reconnect after intentional Stop"
    closeEventSource();
    clearReconnectTimer();
    clearFlushInterval();
    queueRef.current = [];
    isPausedRef.current = false;
    setReconnectAttempt(0);
    setConnectionState('stopped');
    // Currently displayed events remain available (mission: "leave
    // currently displayed events available unless Clear is explicitly
    // used") - visibleEvents/totalReceived/etc. are deliberately untouched.
  }, [closeEventSource, clearReconnectTimer, clearFlushInterval]);

  /** Leaves live mode entirely (the app's own "back to search results" action) - always safe to call, active or not. */
  const exit = useCallback(() => {
    sessionRef.current += 1;
    closeEventSource();
    clearReconnectTimer();
    clearFlushInterval();
    queueRef.current = [];
    pausedBufferRef.current = [];
    isPausedRef.current = false;
    followNewestRef.current = true;
    setConnectionState('idle');
    setVisibleEvents([]);
    setTotalReceived(0);
    setBufferedCount(0);
    setClientDroppedCount(0);
    setServerDroppedCount(0);
    setErrorMessage(null);
    setReconnectAttempt(0);
    setReconnectCount(0);
    setFollowNewestState(true);
    setUnseenCount(0);
    setSourceStatus(NOMINAL_SOURCE_STATUS);
  }, [closeEventSource, clearReconnectTimer, clearFlushInterval]);

  /**
   * "Clear" (Legacy Remediation Slice 4/UI Parity Pass, unchanged
   * semantics this slice): empties the displayed/buffered view and
   * resets every count without touching the connection, reconnect
   * state, or Live-local filter configuration (filters live in
   * `LiveTailPanel.tsx`, entirely untouched by this).
   */
  const clear = useCallback(() => {
    pausedBufferRef.current = [];
    queueRef.current = [];
    setVisibleEvents([]);
    setTotalReceived(0);
    setBufferedCount(0);
    setClientDroppedCount(0);
    setServerDroppedCount(0);
    setUnseenCount(0);
  }, []);

  const setFollowNewest = useCallback((next: boolean) => {
    followNewestRef.current = next;
    setFollowNewestState(next);
    if (next) {
      setUnseenCount(0);
    }
  }, []);

  return {
    connectionState,
    visibleEvents,
    totalReceived,
    bufferedCount,
    clientDroppedCount,
    serverDroppedCount,
    errorMessage,
    reconnectAttempt,
    reconnectCount,
    followNewest,
    unseenCount,
    sourceStatus,
    start,
    pause,
    resume,
    exit,
    stop,
    clear,
    retry,
    setFollowNewest,
  };
}

export type LiveTailHandle = ReturnType<typeof useLiveTail>;
