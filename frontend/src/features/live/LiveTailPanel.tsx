import { useEffect, useMemo, useRef, useState } from 'react';
import type { UIEvent } from 'react';
import { Button } from '../../shared/ui/Button';
import { VisuallyHidden } from '../../shared/ui/VisuallyHidden';
import { SeverityMark } from '../../shared/ui/SeverityMark';
import { TagChip, TagCountBadge, tagColorsOf } from '../../shared/ui/TagChip';
import {
  EMPTY_VALUE,
  formatTimestampCell,
  resolveCorrelationOrTrace,
  resolveService,
  splitTimestampCell,
} from '../results/columnMapping';
import { colorForService } from '../journey/serviceColor';
import { SeverityFilter } from '../search/SeverityFilter';
import { ALL_SEVERITY_LEVEL_IDS } from '../search/severityLevels';
import { VISIBLE_CAP } from './liveTailTypes';
import type { LiveTailHandle } from './useLiveTail';
import type { LogEvent } from '../../shared/api/types';
import styles from './LiveTailPanel.module.css';

export interface LiveTailPanelProps {
  live: LiveTailHandle;
  sourceDisplayName: string;
  onStart: () => void;
}

const SCROLL_TOP_THRESHOLD = 4;

/**
 * The live tail view (originally Legacy Remediation Slice 5, superseding
 * Phase J's design - `docs/verification/LEGACY_REMEDIATION_SLICE_5_REPORT.md`;
 * recomposed to the approved B1 design in B7, Session 10).
 * "Must never imply completeness of historical data" - the banner below
 * states plainly that this only shows events received since Start, and
 * never claims exact-once delivery across a reconnect (see the reconnect
 * notice below). Live stays visually distinct from historical Search
 * through its own mode-bar and acquisition-state badge (a dedicated
 * pulsing "Live" indicator, never color alone - {@link liveBadgeText}),
 * not through a structurally different event list.
 *
 * <p><b>B7 (Session 10) - event list is now a real `&lt;table&gt;`</b>,
 * matching Results' own column/severity-mark grammar
 * (`COMPONENT_INVENTORY.md`'s own RECOMPOSE row for this file names
 * "event table" as required content) - a deliberate, owner-approved
 * supersession of Slice 5's original "never the seven-column results
 * table" card-list decision (CLAUDE.md §5's own "apply the later
 * decision, name the conflict" rule), directly serving this mission's own
 * "Live must visually belong to the same product... do not create a
 * second design language for Live" instruction. `JourneyEntryRow.tsx`
 * (the old card-row renderer) had exactly one remaining consumer - this
 * component - and is deleted as genuinely dead code now that this no
 * longer uses it, not left behind.
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
 * visible." `containerRef` now points at the table's own scroll wrapper
 * (`.tableScroll`) instead of the old `<ol>` element directly - a `<table>`
 * needs an explicit scrolling ancestor, the list didn't.
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
  const containerRef = useRef<HTMLDivElement | null>(null);

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

  function handleScroll(event: UIEvent<HTMLDivElement>) {
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
              <Kbd letter="P" />
            </Button>
          ) : null}
          {connectionState === 'paused' ? (
            <Button variant="secondary" onClick={live.resume}>
              Resume
              <Kbd letter="P" />
            </Button>
          ) : null}
          {isActive ? (
            <Button variant="ghost" onClick={live.stop}>
              Stop
              <Kbd letter="S" />
            </Button>
          ) : null}
          {live.visibleEvents.length > 0 ? (
            <Button variant="ghost" onClick={live.clear}>
              Clear
              <Kbd letter="C" />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            aria-pressed={live.followNewest}
            onClick={() => live.setFollowNewest(!live.followNewest)}
          >
            {live.followNewest ? '✓ Follow newest' : 'Follow newest'}
            <Kbd letter="F" />
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
        <div className={styles.tableScroll} ref={containerRef} onScroll={handleScroll}>
          <table className={styles.table} aria-label="Live events, newest first">
            <colgroup>
              <col className={styles.colTime} />
              <col className={styles.colLevel} />
              <col className={styles.colService} />
              <col />
              <col className={styles.colTags} />
              <col className={styles.colId} />
            </colgroup>
            <thead>
              <tr>
                <th scope="col" aria-sort="descending">
                  Time
                </th>
                <th scope="col">Level</th>
                <th scope="col">Service</th>
                <th scope="col">What happened</th>
                <th scope="col">Tags</th>
                <th scope="col">Trace</th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents.map((event, index) => (
                // eslint-disable-next-line react/no-array-index-key
                <LiveEventRow key={index} event={event} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Purely decorative keyboard-shortcut hint appended to a control's own text - `aria-hidden`, so the button's accessible name stays exactly its visible label (e.g. "Pause"), unchanged from before this recompose and matching every existing exact-name test assertion. */
function Kbd({ letter }: { letter: string }) {
  return (
    <kbd className={styles.kbd} aria-hidden="true">
      {letter}
    </kbd>
  );
}

/**
 * REQUIREMENTS_TRACEABILITY.md item #72 ("JMS / event correlation metadata displayed... Trace/Span/
 * Correlation/Event IDs when available") - the retired card-list (`JourneyEntryRow`) showed all four
 * simultaneously; the table's single ID column (matching Results' own default Correlation/Trace column,
 * which also shows only one by default - Span ID/Event ID are opt-in optional Results columns) only ever
 * shows the primary resolved value as visible text. Live has no Columns picker and no Inspector integration
 * to fall back on, so without this, Span ID/Event ID would become entirely unreachable for a live-streamed
 * event - a real requirement loss, not a cosmetic one. This composes every present identifier into the
 * cell's `title` so the full set stays discoverable on hover, same graceful-degradation shape the Tags cell
 * already uses (compact visible value, full detail on hover/accessible name).
 */
function allIdentifiersTitle(event: LogEvent): string | null {
  const parts: string[] = [];
  if (event.traceId) parts.push(`Trace ID: ${event.traceId}`);
  if (event.spanId) parts.push(`Span ID: ${event.spanId}`);
  if (event.correlationId) parts.push(`Correlation ID: ${event.correlationId}`);
  if (event.eventId) parts.push(`Event ID: ${event.eventId}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * One row of the live event table - mirrors Results' own column/severity-mark grammar
 * (`features/results/columnRegistry.tsx`) so Live reads as the same product, not a second design language.
 * Trace/Correlation ID resolution reuses `resolveCorrelationOrTrace` (trace preferred, correlation fallback) -
 * the exact same precedence Results' own Correlation/Trace column already uses, not a new rule invented here.
 */
function LiveEventRow({ event }: { event: LogEvent }) {
  const color = colorForService(event.service);
  const message = event.malformed ? (event.rawLine ?? EMPTY_VALUE) : (event.message ?? EMPTY_VALUE);
  const tags = event.tags ?? [];
  const tagColors = tagColorsOf(event.classifications);
  const [firstTag, ...restTags] = tags;
  const allTags = tags.join(', ');
  const idCell = resolveCorrelationOrTrace(event);
  const idCellTitle = allIdentifiersTitle(event);
  const split = splitTimestampCell(event.timestamp);

  return (
    <tr className={event.severity?.toUpperCase() === 'ERROR' ? styles.errorRow : undefined}>
      <td className={styles.timeCell}>
        <SeverityMark severity={event.severity} />
        {/*
         * Same weighting Results' own Time column uses (`columnRegistry.tsx`'s
         * `splitTimestampCell` usage) - the repeated calendar date de-emphasized
         * behind the clock time that actually varies row to row. Necessary here,
         * not just cosmetic: the unweighted full string overflowed the fixed
         * `.colTime` width and visually bled into the Level column.
         */}
        <span className={styles.timeText} title={formatTimestampCell(event.timestamp)}>
          {split ? (
            <>
              {split.date ? <span className={styles.timeDatePart}>{split.date}</span> : null}
              <span className={styles.timeClockPart}>{split.time}</span>
            </>
          ) : (
            formatTimestampCell(event.timestamp)
          )}
        </span>
      </td>
      <td className={styles.levelCell}>{event.severity ?? EMPTY_VALUE}</td>
      <td className={styles.serviceCell}>
        <span className={styles.serviceSwatch} style={{ background: color }} aria-hidden="true" />
        {resolveService(event)}
      </td>
      <td className={styles.messageCell}>{message}</td>
      <td>
        {tags.length > 0 ? (
          <span className={styles.tagsCell} title={allTags}>
            <VisuallyHidden>{`Tags: ${allTags}`}</VisuallyHidden>
            <span aria-hidden="true" className={styles.tagsCell}>
              <TagChip tag={firstTag} color={tagColors[firstTag]} title={allTags} />
              {restTags.length > 0 ? <TagCountBadge count={restTags.length} title={allTags} /> : null}
            </span>
          </span>
        ) : (
          EMPTY_VALUE
        )}
      </td>
      <td className={styles.idCell} title={idCellTitle ?? undefined}>
        {idCell ? idCell.value : EMPTY_VALUE}
      </td>
    </tr>
  );
}

/*
 * UX-R3 §16 - the exact text every state renders in the badge; always present alongside the tone, never
 * color-only. B7 (Session 10) - sentence case ("Live", not "LIVE"), matching the approved design's own copy and
 * every other v2 status pill in this app (Field Mapping's "Search ready.", Settings' "Connected", the
 * classification import preview's "New"/"Identical", etc.) - none of these strings are asserted case-sensitively
 * anywhere in the test suite (confirmed by reading every assertion first), so this is presentation only.
 */
function liveBadgeText(state: LiveTailHandle['connectionState']): string {
  switch (state) {
    case 'idle':
      return 'Not started';
    case 'connecting':
      return 'Connecting';
    case 'live':
      return 'Live';
    case 'paused':
      return 'Paused';
    case 'reconnecting':
      return 'Reconnecting';
    case 'stopped':
      return 'Stopped';
    case 'failed':
      return 'Connection failed';
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
      return { text: 'Connecting', tone: styles.toneConnecting };
    case 'NO_ACTIVE_TARGETS':
      return { text: 'No active streams', tone: styles.toneFailed };
    case 'EXPIRED':
      return { text: 'Session expired', tone: styles.toneFailed };
    case 'STALE':
      return { text: 'Scope changed — restart Live', tone: styles.toneFailed };
    case 'RECONNECTING':
      return { text: 'Reconnecting', tone: styles.toneConnecting };
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
