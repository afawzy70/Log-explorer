import { Fragment } from 'react';
import type { LogEvent } from '../../shared/api/types';
import { eventIdentity } from '../../app/useSearchState';
import { Icon } from '../../shared/ui/Icon';
import { SeverityMark } from '../../shared/ui/SeverityMark';
import { resolveService } from '../results/columnMapping';
import type { GapMarker } from '../results/gapDetection';
import { colorForService } from './serviceColor';
import { computeTicks, formatDuration, pickTickStep } from './timelineTicks';
import styles from './TimelinePlot.module.css';

export interface TimelinePlotTrace {
  id: string;
  /** "T1", "T2"... - a short index label, never the raw ID itself (too long for the bracket). */
  label: string;
  startMs: number;
  endMs: number;
}

export interface TimelinePlotProps {
  events: LogEvent[];
  /**
   * {@link eventIdentity} of the root/selected event - drives the trigger line/flag and the point ring. `null`
   * when nothing is anchored (a real, honest state - a journey/trace investigation can genuinely be opened
   * without ever capturing an origin event, e.g. via a pasted ID rather than an inspector action) - the
   * trigger marker is simply omitted rather than fabricating a "selected" point that doesn't exist.
   */
  rootIdentity: string | null;
  gaps: GapMarker[];
  loMs: number;
  hiMs: number;
  /** The tick ruler's zero point - the root/selected event's own timestamp for a capture, the window's centre for context. */
  originMs: number;
  ariaLabel: string;
  /** Journey-only: one bracket per distinct trace, spanning that trace's own first-to-last event. */
  traces?: TimelinePlotTrace[];
  /** `window` (Surroundings) draws ticks/lanes shorter and the trigger flag at the bottom, matching the design's own `.window-plot` overrides. */
  variant?: 'capture' | 'window';
}

/**
 * B5 Investigation - the timeline visualization (`COMPONENT_INVENTORY.md`'s `JourneyView.tsx` REPLACE_VISUALLY
 * entry: "timeline plot (service lanes, trace brackets, gap bands, selected-event line)"), shared between the
 * Trace/Span/Correlation/Journey/Event capture view and the Surroundings (±30s) context view - the design's own
 * `capture()`/`contextView()` prototype functions draw the same `.scope-plot`/`.window-plot` structure from one
 * shared shape (ruler, lane labels, lanes, gap bands, trigger marker), differing only in bounds and (for
 * journey) the trace-bracket row.
 *
 * <p><b>Non-causality (B5's own explicit rule):</b> this is a chronological/contextual plot, never a causal
 * graph - no arrows, no inferred parent-child lines, no fabricated flow connections between points. Every event
 * is an independent mark at its own observed timestamp; the only relationship drawn between two points is a gap
 * band, and that band states only "no event was observed here", never why.
 *
 * <p>Tick intervals are computed from the real observed span (`timelineTicks.ts#pickTickStep`), not the
 * prototype's own hardcoded per-relation-type constants - a real trace/journey can span anywhere from
 * milliseconds to hours, unlike the prototype's synthetic sub-minute demo data.
 */
export function TimelinePlot({
  events,
  rootIdentity,
  gaps,
  loMs,
  hiMs,
  originMs,
  ariaLabel,
  traces,
  variant = 'capture',
}: TimelinePlotProps) {
  const step = pickTickStep(hiMs - loMs);
  const ticks = computeTicks(loMs, hiMs, originMs, step);
  const percentOf = (ms: number) => Math.min(100, Math.max(0, ((ms - loMs) / (hiMs - loMs)) * 100));

  // Services in first-seen order (matches the prototype's own `svcs()`) - a stable, data-driven lane order,
  // never alphabetical (which would reshuffle lanes as different services happen to appear across events).
  const services: string[] = [];
  for (const event of events) {
    const label = resolveService(event);
    if (!services.includes(label)) {
      services.push(label);
    }
  }

  const rootMs = originMs;
  const rootPercent = percentOf(rootMs);
  const flagEdgeClass = rootPercent > 80 ? styles.flagEnd : rootPercent < 20 ? styles.flagStart : '';

  return (
    <div className={styles.wrapper} role="img" aria-label={ariaLabel}>
      <div className={`${styles.plot} ${variant === 'window' ? styles.plotWindow : ''}`}>
        <div className={styles.axisLabel}>{variant === 'window' ? 'Window' : 'Offset'}</div>
        <div className={styles.ruler}>
          {ticks.map((tick, i) => (
            <Fragment key={i}>
              <span
                className={`${styles.tick} ${tick.major ? styles.tickMajor : ''}`}
                style={{ left: `${tick.percent}%` }}
              />
              {tick.label != null ? (
                <span
                  className={`${styles.tickLabel} ${tick.percent < 2 ? styles.tickLabelStart : tick.percent > 97 ? styles.tickLabelEnd : ''}`}
                  style={{ left: `${tick.percent}%` }}
                >
                  {tick.label}
                </span>
              ) : null}
            </Fragment>
          ))}
        </div>
        {traces && traces.length > 0 ? (
          <>
            <div className={styles.axisLabel} aria-hidden="true" />
            <div className={styles.traceRow}>
              {traces.map((trace) => (
                <span
                  key={trace.id}
                  className={styles.bracket}
                  style={{
                    left: `${percentOf(trace.startMs)}%`,
                    width: `calc(${percentOf(trace.endMs) - percentOf(trace.startMs)}% + 1px)`,
                  }}
                >
                  <span>{trace.label}</span>
                </span>
              ))}
            </div>
          </>
        ) : null}
        <div className={styles.laneLabels}>
          {services.map((service) => (
            <div key={service} className={styles.laneLabel}>
              <span
                className={styles.swatch}
                style={{ background: colorForService(service === '—' ? null : service) }}
                aria-hidden="true"
              />
              {service}
            </div>
          ))}
        </div>
        <div className={`${styles.lanesArea} ${variant === 'window' ? styles.lanesAreaWindow : ''}`}>
          {gaps.map((gap) => {
            const fromMs = Date.parse(gap.fromTimestamp);
            const toMs = Date.parse(gap.toTimestamp);
            return (
              <div
                key={`${gap.fromTimestamp}-${gap.toTimestamp}`}
                className={styles.gapBand}
                style={{ left: `${percentOf(fromMs)}%`, width: `${percentOf(toMs) - percentOf(fromMs)}%` }}
              >
                <span>{formatDuration(gap.durationMs)}</span>
              </div>
            );
          })}
          {services.map((service) => (
            <div key={service} className={styles.lane}>
              {events
                .filter((e) => resolveService(e) === service)
                .map((event) => {
                  const identity = eventIdentity(event);
                  const ms = event.timestamp ? Date.parse(event.timestamp) : null;
                  if (ms == null || Number.isNaN(ms)) {
                    return null;
                  }
                  const isRoot = identity === rootIdentity;
                  return (
                    <span
                      key={identity}
                      className={`${styles.point} ${isRoot ? styles.pointRoot : ''}`}
                      style={{ left: `${percentOf(ms)}%` }}
                      title={`${event.timestamp} · ${event.severity ?? 'UNKNOWN'} · ${event.message ?? ''}`}
                    >
                      <SeverityMark severity={event.severity} />
                    </span>
                  );
                })}
            </div>
          ))}
          {rootIdentity != null ? (
            <>
              <span className={`${styles.triggerLine} ${variant === 'window' ? styles.triggerLineWindow : ''}`} style={{ left: `${rootPercent}%` }} />
              <span
                className={`${styles.triggerFlag} ${variant === 'window' ? styles.triggerFlagWindow : ''} ${flagEdgeClass}`}
                style={{ left: `${rootPercent}%` }}
              >
                <Icon name="crosshair" size="sm" />
                Selected event
              </span>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
