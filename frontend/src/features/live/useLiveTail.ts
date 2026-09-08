import { useCallback, useEffect, useRef, useState } from 'react';
import type { LogEvent } from '../../shared/api/types';
import type { LiveConnectionState, LiveStatusPayload } from './liveTailTypes';
import { VISIBLE_CAP } from './liveTailTypes';

/**
 * Live tail lifecycle (IMPLEMENTATION_PLAN.md "Phase J", HANDOVER.md §18.4):
 * Start/Pause/Resume/Stop, a bounded 1,000-event visible buffer (newest
 * first, matching the historical table's own convention), and distinct,
 * honest counts - `serverDroppedCount` (the backend's own bounded-buffer
 * overflow, reported via the periodic "status" event) is never conflated
 * with `clientDroppedCount` (this client's own 1,000-cap eviction) or
 * `bufferedCount` (events received while paused, not yet shown - a
 * SEPARATE bounded buffer, so a long pause can't grow memory unboundedly
 * either).
 *
 * Pause keeps the real `EventSource` connection open (so Resume never
 * needs to reconnect and re-request a fresh stream) - only Stop actually
 * closes it. Unmounting always closes it too (HANDOVER.md §18.4 "source
 * navigation/unmount closes stream").
 */
export function useLiveTail() {
  const [connectionState, setConnectionState] = useState<LiveConnectionState>('idle');
  const [visibleEvents, setVisibleEvents] = useState<LogEvent[]>([]);
  const [totalReceived, setTotalReceived] = useState(0);
  const [bufferedCount, setBufferedCount] = useState(0);
  const [clientDroppedCount, setClientDroppedCount] = useState(0);
  const [serverDroppedCount, setServerDroppedCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const pausedBufferRef = useRef<LogEvent[]>([]);
  // Mirrors `connectionState` but readable synchronously inside the SSE
  // event listeners' closures, which close over state from whenever
  // `start()` was called, not the latest render.
  const isPausedRef = useRef(false);

  const closeEventSource = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
  }, []);

  useEffect(() => closeEventSource, [closeEventSource]);

  const appendVisible = useCallback((event: LogEvent) => {
    setVisibleEvents((prev) => {
      const next = [event, ...prev];
      if (next.length > VISIBLE_CAP) {
        next.length = VISIBLE_CAP; // evict the oldest - it's at the tail, since newest is always prepended
        setClientDroppedCount((d) => d + 1);
      }
      return next;
    });
  }, []);

  const start = useCallback(
    (sourceId: string, services: string[]) => {
      closeEventSource();
      setVisibleEvents([]);
      setTotalReceived(0);
      setBufferedCount(0);
      setClientDroppedCount(0);
      setServerDroppedCount(0);
      setErrorMessage(null);
      pausedBufferRef.current = [];
      isPausedRef.current = false;
      setConnectionState('connecting');

      const params = new URLSearchParams({ sourceId });
      if (services.length > 0) {
        params.set('services', services.join(','));
      }
      // Search values never appear in the URL (CLAUDE.md §2 rule 4) -
      // live tail's own scope never accepts one to begin with; only the
      // non-sensitive sourceId/services ever reach this query string.
      const source = new EventSource(`/api/v1/logs/live?${params.toString()}`);
      eventSourceRef.current = source;

      source.onopen = () => setConnectionState('live');

      source.addEventListener('log', (e: MessageEvent) => {
        let event: LogEvent;
        try {
          event = JSON.parse(e.data) as LogEvent;
        } catch {
          return; // one malformed frame must never crash the whole stream
        }
        setTotalReceived((n) => n + 1);
        if (isPausedRef.current) {
          const next = [event, ...pausedBufferRef.current];
          if (next.length > VISIBLE_CAP) {
            next.length = VISIBLE_CAP;
            setClientDroppedCount((d) => d + 1);
          }
          pausedBufferRef.current = next;
          setBufferedCount(next.length);
        } else {
          appendVisible(event);
        }
      });

      source.addEventListener('status', (e: MessageEvent) => {
        try {
          const status = JSON.parse(e.data) as LiveStatusPayload;
          setServerDroppedCount(status.droppedCount);
        } catch {
          // a malformed heartbeat/status tick is never fatal - just skip it
        }
      });

      source.onerror = () => {
        // A real, explicit failure state - never a silent, invisible
        // auto-reconnect loop the investigator can't see or control.
        closeEventSource();
        isPausedRef.current = false;
        setConnectionState('error');
        setErrorMessage('Live connection lost.');
      };
    },
    [appendVisible, closeEventSource],
  );

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
    closeEventSource();
    isPausedRef.current = false;
    setConnectionState('stopped');
  }, [closeEventSource]);

  /** Leaves live mode entirely (the app's own "back to search results" action) - always safe to call, active or not. */
  const exit = useCallback(() => {
    closeEventSource();
    isPausedRef.current = false;
    pausedBufferRef.current = [];
    setConnectionState('idle');
    setVisibleEvents([]);
    setTotalReceived(0);
    setBufferedCount(0);
    setClientDroppedCount(0);
    setServerDroppedCount(0);
    setErrorMessage(null);
  }, [closeEventSource]);

  return {
    connectionState,
    visibleEvents,
    totalReceived,
    bufferedCount,
    clientDroppedCount,
    serverDroppedCount,
    errorMessage,
    start,
    pause,
    resume,
    exit,
    stop,
  };
}

export type LiveTailHandle = ReturnType<typeof useLiveTail>;
