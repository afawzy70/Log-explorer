/**
 * B5 Investigation - tick-interval selection for `TimelinePlot`'s ruler.
 *
 * <p>The design's own prototype (`prototype/scripts/app.js#capture`) hardcodes minor/major intervals per
 * relation type (journey: 1s/2s, trace: 0.5s/1s) and a fixed ±30s window for context - safe in a static demo
 * with synthetic sub-minute data, but a real production trace/journey can span anywhere from milliseconds to
 * hours. This picks a "nice" step from the timeline's own real observed span instead of a hardcoded constant,
 * so the ruler stays readable (never too dense, never too sparse) regardless of how long the real investigation
 * actually is - the one legitimate adaptation from the prototype's own demo-data assumptions.
 */
export interface TickStep {
  minorMs: number;
  majorMs: number;
}

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/** Ladder of (minor, major) steps, ascending by total span this step suits. */
const LADDER: Array<{ maxSpanMs: number; minorMs: number; majorMs: number }> = [
  { maxSpanMs: 10 * SECOND, minorMs: SECOND, majorMs: 2 * SECOND },
  { maxSpanMs: 60 * SECOND, minorMs: 5 * SECOND, majorMs: 10 * SECOND },
  { maxSpanMs: 5 * MINUTE, minorMs: 15 * SECOND, majorMs: MINUTE },
  { maxSpanMs: 30 * MINUTE, minorMs: MINUTE, majorMs: 5 * MINUTE },
  { maxSpanMs: 2 * HOUR, minorMs: 5 * MINUTE, majorMs: 15 * MINUTE },
];
const FALLBACK: TickStep = { minorMs: 15 * MINUTE, majorMs: HOUR };

export function pickTickStep(spanMs: number): TickStep {
  const rung = LADDER.find((r) => spanMs <= r.maxSpanMs);
  return rung ? { minorMs: rung.minorMs, majorMs: rung.majorMs } : FALLBACK;
}

/** "+12s" / "−3s" / "0s" / "+1m 30s" / "+2h 05m" - a signed offset from the timeline's origin (the root/selected event, or the window start). */
export function formatOffsetLabel(offsetMs: number): string {
  if (offsetMs === 0) {
    return '0s';
  }
  const sign = offsetMs < 0 ? '−' : '+';
  const abs = Math.abs(offsetMs);
  if (abs < MINUTE) {
    const seconds = abs / 1000;
    return `${sign}${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`;
  }
  if (abs < HOUR) {
    const minutes = Math.floor(abs / MINUTE);
    const seconds = Math.round((abs % MINUTE) / 1000);
    return seconds === 0 ? `${sign}${minutes}m` : `${sign}${minutes}m ${String(seconds).padStart(2, '0')}s`;
  }
  const hours = Math.floor(abs / HOUR);
  const minutes = Math.round((abs % HOUR) / MINUTE);
  return minutes === 0 ? `${sign}${hours}h` : `${sign}${hours}h ${String(minutes).padStart(2, '0')}m`;
}

/** "12.4s" / "1m 05s" / "2h 05m" - an unsigned duration, for the gap-band label and "Observed span" stat. */
export function formatDuration(durationMs: number): string {
  if (durationMs < MINUTE) {
    const seconds = durationMs / 1000;
    return `${seconds % 1 === 0 ? seconds : seconds.toFixed(1)}s`;
  }
  if (durationMs < HOUR) {
    const minutes = Math.floor(durationMs / MINUTE);
    const seconds = Math.round((durationMs % MINUTE) / 1000);
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  }
  const hours = Math.floor(durationMs / HOUR);
  const minutes = Math.round((durationMs % HOUR) / MINUTE);
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

export interface Tick {
  /** 0-100, position along the ruler. */
  percent: number;
  major: boolean;
  /** Only present on a major tick - the minor ticks are unlabeled marks. */
  label?: string;
}

/**
 * Every tick between `lo` and `hi`, aligned to `originMs` (so "0" always lands exactly on a tick when the
 * origin itself is inside the visible range) - mirrors the prototype's own `ticks()` alignment behaviour.
 */
export function computeTicks(loMs: number, hiMs: number, originMs: number, step: TickStep): Tick[] {
  const ticks: Tick[] = [];
  if (hiMs <= loMs) {
    return ticks;
  }
  const first = Math.ceil((loMs - originMs) / step.minorMs) * step.minorMs;
  for (let offset = first; originMs + offset <= hiMs + 1; offset += step.minorMs) {
    const rounded = Math.round(offset / 10) * 10; // sub-10ms float drift guard
    const isMajor = Math.abs(rounded % step.majorMs) < 1;
    const percent = ((originMs + rounded - loMs) / (hiMs - loMs)) * 100;
    if (percent < -0.01 || percent > 100.01) {
      continue;
    }
    ticks.push({ percent, major: isMajor, label: isMajor ? formatOffsetLabel(rounded) : undefined });
  }
  return ticks;
}
