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
  // OS-1E review recovery (mission §11/§14) - the SSE transport can be
  // perfectly healthy (connectionState === 'live') while the SOURCE's own
  // targets are all down; this override is what stops that case from
  // ever reading as a plain, healthy "LIVE".
  const sourceOverride = sourceStatusBadge(connectionState, live.sourceStatus);

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
        {/*
         * UX-R3 §16 - one authoritative, state-driven indicator, not two
         * that can disagree. Before this change, the pill always read
         * "LIVE" in the same red regardless of state, and only a small
         * secondary gray caption actually said "Paused" - easy to miss at
         * a glance (`docs/verification/UX_R3_EVIDENCE/BEFORE-K-live-paused.png`).
         * Now the badge itself carries both the text (never color-only)
         * and the tone for every state the real runtime state machine can
         * be in - CONNECTING/LIVE/PAUSED/RECONNECTING/STOPPED at minimum,
         * plus this app's own FAILED terminal state.
         */}
        <span
          className={[styles.liveBadge, sourceOverride ? sourceOverride.tone : liveBadgeToneClass(connectionState)].join(' ')}
          role="status"
        >
          <span
            className={[
              styles.liveDot,
              connectionState === 'live' && !sourceOverride ? styles.liveDotActive : '',
            ].join(' ')}
            aria-hidden="true"
          />
          {sourceOverride ? sourceOverride.text : liveBadgeText(connectionState)}
          {connectionState === 'reconnecting' ? ` (attempt ${live.reconnectAttempt})` : ''}
          {!sourceOverride && live.sourceStatus.state === 'DEGRADED'
            ? ` (${live.sourceStatus.activeTargets}/${live.sourceStatus.resolvedTargets} active)`
            : ''}
        </span>
        <h1 className={styles.title}>{sourceDisplayName}</h1>
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

      {live.sourceStatus.warnings.length > 0 ? (
        <ul className={styles.sourceWarnings} role="status">
          {live.sourceStatus.warnings.map((warning, index) => (
            // eslint-disable-next-line react/no-array-index-key
            <li key={index} className={styles.sourceWarningsItem}>
              {warning}
            </li>
          ))}
        </ul>
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

/** UX-R3 §16 - the exact text every state renders in the badge; always present alongside the tone, never color-only. */
function liveBadgeText(state: LiveTailHandle['connectionState']): string {
  switch (state) {
    case 'idle':
      return 'NOT STARTED';
    case 'connecting':
      return 'CONNECTING';
    case 'live':
      return 'LIVE';
    case 'paused':
      return 'PAUSED';
    case 'reconnecting':
      return 'RECONNECTING';
    case 'stopped':
      return 'STOPPED';
    case 'failed':
      return 'CONNECTION FAILED';
  }
}

/**
 * OS-1E final implementation (mission §11/§14/§15/§18/§20) — overrides
 * the plain transport-level badge while the transport itself reads as
 * healthy (`'live'`/`'paused'`) but the SOURCE's own per-target truth
 * says otherwise, AND while `'stopped'` if that stop was caused by a
 * terminal source state rather than an ordinary user Stop (`useLiveTail.ts`'s
 * own `onerror` handler transitions to `'stopped'` for a terminal source
 * state — this keeps that terminal reason visible afterward, rather than
 * silently reverting to a generic "STOPPED" once the transport closes).
 * A `'stopped'` caused by a normal, healthy Stop is unaffected: {@code
 * sourceStatus.state} in that case is whatever it last legitimately was
 * (RUNNING/DEGRADED/CONNECTING/RECONNECTING), none of which this switch
 * matches, so the plain "STOPPED" label renders exactly as before.
 *
 * <p>Returns `null` for `RUNNING`/`DEGRADED` (DEGRADED still shows
 * "LIVE", with the active/resolved count appended separately - the
 * session genuinely IS still live, just not complete) and for every
 * `connectionState` the transport itself already renders distinctly
 * (`connecting`/`reconnecting`/`failed`/`idle`).
 */
function sourceStatusBadge(
  connectionState: LiveTailHandle['connectionState'],
  sourceStatus: LiveTailHandle['sourceStatus'],
): { text: string; tone: string } | null {
  if (connectionState !== 'live' && connectionState !== 'paused' && connectionState !== 'stopped') {
    return null;
  }
  switch (sourceStatus.state) {
    case 'CONNECTING':
      return { text: 'CONNECTING', tone: styles.toneConnecting };
    case 'NO_ACTIVE_TARGETS':
      return { text: 'NO ACTIVE STREAMS', tone: styles.toneFailed };
    case 'EXPIRED':
      return { text: 'SESSION EXPIRED', tone: styles.toneFailed };
    case 'STALE':
      return { text: 'SCOPE CHANGED — RESTART LIVE', tone: styles.toneFailed };
    case 'RECONNECTING':
      return { text: 'RECONNECTING', tone: styles.toneConnecting };
    default:
      return null;
  }
}

/** UX-R3 §16 - a distinct visual tone per state family, always paired with `liveBadgeText`'s own distinct text. */
function liveBadgeToneClass(state: LiveTailHandle['connectionState']): string {
  switch (state) {
    case 'live':
      return styles.toneLive;
    case 'paused':
      return styles.tonePaused;
    case 'connecting':
    case 'reconnecting':
      return styles.toneConnecting;
    case 'failed':
      return styles.toneFailed;
    case 'stopped':
    case 'idle':
      return styles.toneStopped;
  }
}
