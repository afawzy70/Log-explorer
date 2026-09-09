import { useEffect, useMemo, useRef, useState } from 'react';
import type { UIEvent } from 'react';
import { Button } from '../../shared/ui/Button';
import { VisuallyHidden } from '../../shared/ui/VisuallyHidden';
import { JourneyEntryRow } from '../journey/JourneyEntryRow';
import { SeverityFilter } from '../search/SeverityFilter';
import { ALL_SEVERITY_LEVEL_IDS } from '../search/severityLevels';
import { VISIBLE_CAP } from './liveTailTypes';
import type { LiveTailHandle } from './useLiveTail';
import styles from './LiveTailPanel.module.css';

export interface LiveTailPanelProps {
  live: LiveTailHandle;
  sourceDisplayName: string;
  onStart: () => void;
}

const SCROLL_TOP_THRESHOLD = 4;

/**
 * The live tail view (Legacy Remediation Slice 5, superseding Phase J's
 * design - `docs/verification/LEGACY_REMEDIATION_SLICE_5_REPORT.md`).
 * "Visually distinct from historical search" - a dedicated pulsing "LIVE"
 * indicator and its own accent color, never the seven-column results
 * table. "Must never imply completeness of historical data" - the banner
 * below states plainly that this only shows events received since Start,
 * and never claims exact-once delivery across a reconnect (see the
 * reconnect notice below).
 *
 * <p>Severity/text filtering here is purely local/client-side over
 * `live.visibleEvents` (the already-bounded, already-masked retained
 * set) - it never changes what is requested from the server and never
 * reconnects. `SeverityFilter` is the exact same component the
 * historical toolbar uses, reused as-is (never a duplicated severity
 * expression language).
 *
 * <p><b>Follow newest</b>: `containerRef`'s own scroll position drives
 * it, not a separate simulated "virtual scroll" - scrolling away from
 * the top (newest-first list) suspends follow (never fights the user's
 * own scroll), and re-enabling it (the toggle or "Jump to newest")
 * scrolls back to the top in the same effect that keeps following while
 * enabled, so there is exactly one code path for "make the newest event
 * visible."
 */
export function LiveTailPanel({ live, sourceDisplayName, onStart }: LiveTailPanelProps) {
  const { connectionState } = live;
  const isActive = connectionState === 'live' || connectionState === 'paused' || connectionState === 'connecting' || connectionState === 'reconnecting';
  const canStart = connectionState === 'idle' || connectionState === 'stopped';

  const [filterLevels, setFilterLevels] = useState<string[]>(ALL_SEVERITY_LEVEL_IDS);
  const [filterText, setFilterText] = useState('');
  const containerRef = useRef<HTMLOListElement | null>(null);

  const filteredEvents = useMemo(() => {
    const text = filterText.trim().toLowerCase();
    return live.visibleEvents.filter((event) => {
      if (event.severity && !filterLevels.includes(event.severity.toUpperCase())) {
        return false;
      }
      if (text && !(event.message ?? '').toLowerCase().includes(text)) {
        return false;
      }
      return true;
    });
  }, [live.visibleEvents, filterLevels, filterText]);

  // Keeps the newest event visible while following - the same effect
  // handles "a new batch arrived" and "the user just re-enabled follow"
  // (e.g. via Jump to newest), since both change one of these deps.
  useEffect(() => {
    if (live.followNewest) {
      containerRef.current?.scrollTo({ top: 0 });
    }
  }, [live.visibleEvents, live.followNewest]);

  function handleScroll(event: UIEvent<HTMLOListElement>) {
    if (event.currentTarget.scrollTop > SCROLL_TOP_THRESHOLD) {
      live.setFollowNewest(false);
    }
  }

  function jumpToNewest() {
    live.setFollowNewest(true);
  }

  return (
    <div className={styles.wrapper} data-testid="live-tail-panel">
      <div className={styles.header}>
        <Button variant="ghost" onClick={live.exit}>
          ← Back to search results
        </Button>
        <span className={styles.liveBadge} aria-hidden="true">
          <span className={[styles.liveDot, connectionState === 'live' ? styles.liveDotActive : ''].join(' ')} />
          LIVE
        </span>
        <h1 className={styles.title}>{sourceDisplayName}</h1>
        <span className={styles.stateLabel} role="status">
          {stateLabel(connectionState)}
          {connectionState === 'reconnecting' ? ` (attempt ${live.reconnectAttempt})` : ''}
        </span>
        <div className={styles.controls}>
          {canStart ? (
            <Button variant="primary" onClick={onStart}>
              Start
            </Button>
          ) : null}
          {connectionState === 'failed' ? (
            <Button variant="primary" onClick={live.retry}>
              Retry
            </Button>
          ) : null}
          {connectionState === 'live' ? (
            <Button variant="secondary" onClick={live.pause}>
              Pause
            </Button>
          ) : null}
          {connectionState === 'paused' ? (
            <Button variant="secondary" onClick={live.resume}>
              Resume
            </Button>
          ) : null}
          {isActive ? (
            <Button variant="ghost" onClick={live.stop}>
              Stop
            </Button>
          ) : null}
          {live.visibleEvents.length > 0 ? (
            <Button variant="ghost" onClick={live.clear}>
              Clear
            </Button>
          ) : null}
          <Button
            variant="ghost"
            aria-pressed={live.followNewest}
            onClick={() => live.setFollowNewest(!live.followNewest)}
          >
            {live.followNewest ? '✓ Follow newest' : 'Follow newest'}
          </Button>
        </div>
      </div>

      <p className={styles.disclaimer}>
        Showing events received since Start — this is not a complete historical record. Use search for that. Retained
        events are capped at {VISIBLE_CAP.toLocaleString()}; oldest events are evicted first.
      </p>

      {live.reconnectCount > 0 ? (
        <p className={styles.reconnectNotice} role="status">
          Reconnected {live.reconnectCount} time{live.reconnectCount === 1 ? '' : 's'} this session — events during a
          disconnected period may have been missed.
        </p>
      ) : null}

      {live.errorMessage ? (
        <div className={styles.error} role="alert">
          {live.errorMessage}
        </div>
      ) : null}

      <div className={styles.filterRow}>
        <SeverityFilter selected={filterLevels} onChange={setFilterLevels} />
        <label className={styles.textFilterLabel}>
          <VisuallyHidden>Filter live events by text</VisuallyHidden>
          <input
            type="text"
            className={styles.textFilterInput}
            placeholder="Filter displayed events…"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
          />
        </label>
      </div>

      <p className={styles.counts}>
        Received: {live.totalReceived} · Visible: {filteredEvents.length}
        {filteredEvents.length !== live.visibleEvents.length ? ` (of ${live.visibleEvents.length} retained)` : ''}
        {live.bufferedCount > 0 ? ` · Buffered while paused: ${live.bufferedCount}` : ''}
        {live.clientDroppedCount > 0 ? ` · Evicted (retention cap): ${live.clientDroppedCount}` : ''}
        {live.serverDroppedCount > 0 ? ` · Dropped (server buffer full): ${live.serverDroppedCount}` : ''}
      </p>

      {!live.followNewest ? (
        <Button variant="secondary" onClick={jumpToNewest} className={styles.jumpButton}>
          ↑ Jump to newest{live.unseenCount > 0 ? ` (${live.unseenCount} new)` : ''}
        </Button>
      ) : null}

      {filteredEvents.length === 0 ? (
        <p className={styles.empty}>
          {connectionState === 'connecting'
            ? 'Connecting…'
            : connectionState === 'reconnecting'
              ? 'Reconnecting…'
              : live.visibleEvents.length > 0
                ? 'No events match the current filter.'
                : isActive
                  ? 'Waiting for new events…'
                  : 'Click Start to begin streaming new events as they happen.'}
        </p>
      ) : (
        <ol className={styles.list} ref={containerRef} onScroll={handleScroll}>
          {filteredEvents.map((event, index) => (
            // eslint-disable-next-line react/no-array-index-key
            <JourneyEntryRow key={index} event={event} />
          ))}
        </ol>
      )}
    </div>
  );
}

function stateLabel(state: LiveTailHandle['connectionState']): string {
  switch (state) {
    case 'idle':
      return 'Not started';
    case 'connecting':
      return 'Connecting…';
    case 'live':
      return 'Live';
    case 'paused':
      return 'Paused';
    case 'reconnecting':
      return 'Reconnecting…';
    case 'stopped':
      return 'Stopped';
    case 'failed':
      return 'Connection failed';
  }
}
