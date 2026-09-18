import { SEVERITY_LEVELS } from '../search/severityLevels';
import styles from './LiveSeverityFilter.module.css';

export interface LiveSeverityFilterProps {
  selected: string[];
  onChange: (next: string[]) => void;
}

/**
 * DRIFT-005 remediation: the approved Live design (prototype/scripts/app.js's `live()`) renders the
 * severity display filter as four always-visible segmented toggle buttons (Debug/Info/Warn/Error - TRACE
 * is not offered here, matching the design's own markup exactly), not a collapsed Search-style popover
 * trigger. This is a *display* filter only - it never changes which events the subscription receives
 * (LiveTailPanel.tsx's own filteredEvents derivation already only ever filters the already-received
 * `live.visibleEvents` array client-side; this component does not touch the subscription).
 */
const LIVE_LEVEL_IDS = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
const LIVE_LEVELS = SEVERITY_LEVELS.filter((l) => LIVE_LEVEL_IDS.includes(l.id));

export function LiveSeverityFilter({ selected, onChange }: LiveSeverityFilterProps) {
  function toggleLevel(id: string) {
    if (selected.includes(id)) {
      onChange(selected.filter((l) => l !== id));
    } else {
      onChange([...selected, id]);
    }
  }

  return (
    <div className={styles.group} role="group" aria-label="Displayed severity">
      {LIVE_LEVELS.map((level) => {
        const isActive = selected.includes(level.id);
        return (
          <button
            key={level.id}
            type="button"
            className={styles.segment}
            aria-pressed={isActive}
            style={{
              color: isActive ? level.colorVar : undefined,
              background: isActive ? level.bgVar : undefined,
            }}
            onClick={() => toggleLevel(level.id)}
          >
            <span className={styles.dot} style={{ background: level.colorVar }} aria-hidden="true" />
            {level.label}
          </button>
        );
      })}
    </div>
  );
}
