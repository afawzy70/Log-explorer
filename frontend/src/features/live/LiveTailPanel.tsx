import { Button } from '../../shared/ui/Button';
import { JourneyEntryRow } from '../journey/JourneyEntryRow';
import { VISIBLE_CAP } from './liveTailTypes';
import type { LiveTailHandle } from './useLiveTail';
import styles from './LiveTailPanel.module.css';

export interface LiveTailPanelProps {
  live: LiveTailHandle;
  sourceDisplayName: string;
  onStart: () => void;
}

/**
 * The live tail view (IMPLEMENTATION_PLAN.md "Phase J", HANDOVER.md §18.4).
 * "Visually distinct from historical search" - a dedicated pulsing "LIVE"
 * indicator and its own accent color, never the seven-column results
 * table. "Must never imply completeness of historical data" - the banner
 * below states plainly that this only shows events received since Start.
 */
export function LiveTailPanel({ live, sourceDisplayName, onStart }: LiveTailPanelProps) {
  const { connectionState } = live;
  const isActive = connectionState === 'live' || connectionState === 'paused' || connectionState === 'connecting';

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
        </span>
        <div className={styles.controls}>
          {connectionState === 'idle' || connectionState === 'stopped' || connectionState === 'error' ? (
            <Button variant="primary" onClick={onStart}>
              Start
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
        </div>
      </div>

      <p className={styles.disclaimer}>
        Showing events received since Start — this is not a complete historical record. Use search for that.
      </p>

      {live.errorMessage ? (
        <div className={styles.error} role="alert">
          {live.errorMessage}
        </div>
      ) : null}

      <p className={styles.counts}>
        Received: {live.totalReceived} · Visible: {live.visibleEvents.length} (cap {VISIBLE_CAP.toLocaleString()})
        {live.bufferedCount > 0 ? ` · Buffered while paused: ${live.bufferedCount}` : ''}
        {live.clientDroppedCount > 0 ? ` · Dropped (display cap): ${live.clientDroppedCount}` : ''}
        {live.serverDroppedCount > 0 ? ` · Dropped (server buffer full): ${live.serverDroppedCount}` : ''}
      </p>

      {live.visibleEvents.length === 0 ? (
        <p className={styles.empty}>
          {connectionState === 'connecting'
            ? 'Connecting…'
            : isActive
              ? 'Waiting for new events…'
              : 'Click Start to begin streaming new events as they happen.'}
        </p>
      ) : (
        <ol className={styles.list}>
          {live.visibleEvents.map((event, index) => (
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
    case 'stopped':
      return 'Stopped';
    case 'error':
      return 'Connection lost';
  }
}
