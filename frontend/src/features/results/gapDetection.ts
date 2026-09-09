import type { LogEvent } from '../../shared/api/types';

/**
 * Legacy Remediation Slice 6 — bounded, deterministic investigation-gap
 * detection for context/journey views
 * (`docs/verification/LEGACY_REMEDIATION_SLICE_6_REPORT.md`). A "gap" is an
 * observable discontinuity in the *available* events, never proof that
 * something failed - the wording throughout this file and everywhere it is
 * rendered deliberately says "observed"/"gap detected", never "missing" or
 * "broken". Chronological order is NOT causality (this mission's own
 * non-negotiable principle) - a gap says nothing about what happened
 * during it, only that no event was observed there.
 *
 * <p><b>Threshold model — Option A ("configurable bounded threshold with a
 * sensible default")</b>, chosen over an adaptive/window-relative rule for
 * simplicity and exact-boundary testability: a fixed default of 5 seconds.
 * Reasoning: within a bounded "Show ±30 seconds" context window (60s
 * total), a 5+ second silence between two *adjacent observed* events is
 * unusual enough to be worth flagging without drowning the view in noise
 * from ordinary sub-second log cadences; for a journey/correlation view
 * (which can span much longer real-world durations), the same fixed
 * threshold still gives a meaningful signal, since a multi-second quiet
 * stretch between two events already known to be part of the same
 * correlated request flow is itself notable regardless of the journey's
 * own overall span. The threshold is a parameter (never hardcoded inside
 * the function), so a future caller can pass a different one without
 * touching this file.
 *
 * <p><b>Precondition</b>: {@code events} must already be in ascending
 * chronological order (true for both call sites this is used from - the
 * context view after `sortByTimestampAscending`, and the journey view,
 * which the backend itself returns pre-sorted ascending). This function
 * never re-sorts - doing so would duplicate the ordering decision that
 * already lives in exactly one place per view.
 *
 * <p><b>Filtering semantics (mission §8)</b>: context/journey views have no
 * local post-fetch filtering of their own (the toolbar's severity/service
 * filters are baked into the original request that produced these events,
 * never applied again afterward - see `useSearchState.ts#showContext`/
 * `#openJourney`, neither of which carries the toolbar's filters through).
 * The full fetched event set IS the visible set for both views, so "gaps
 * computed against the underlying bounded investigation sequence" and
 * "visible sequence gaps" are the same thing here - there is no separate
 * filtering-related hidden-event distinction to make.
 */
export const DEFAULT_GAP_THRESHOLD_MS = 5_000;

export type GapReason = 'large_interval';
export type GapConfidence = 'observed';

export interface GapMarker {
  /** Index (within the same array this was computed from) of the event immediately BEFORE this gap - render the marker immediately after that event. */
  afterIndex: number;
  fromTimestamp: string;
  toTimestamp: string;
  durationMs: number;
  reason: GapReason;
  /** "observed" - purely derived from two real adjacent event timestamps, never inferred/guessed. */
  confidence: GapConfidence;
}

/**
 * O(n) single pass over already-sorted `events` - never a repeated/nested
 * scan. Events with a missing or unparseable timestamp are skipped (a gap
 * can never be computed without knowing both endpoints - never guessed).
 */
export function detectGaps(events: LogEvent[], thresholdMs: number = DEFAULT_GAP_THRESHOLD_MS): GapMarker[] {
  const gaps: GapMarker[] = [];
  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1];
    const curr = events[i];
    if (!prev.timestamp || !curr.timestamp) {
      continue;
    }
    const prevMs = Date.parse(prev.timestamp);
    const currMs = Date.parse(curr.timestamp);
    if (Number.isNaN(prevMs) || Number.isNaN(currMs)) {
      continue;
    }
    const delta = currMs - prevMs;
    if (delta > thresholdMs) {
      gaps.push({
        afterIndex: i - 1,
        fromTimestamp: prev.timestamp,
        toTimestamp: curr.timestamp,
        durationMs: delta,
        reason: 'large_interval',
        confidence: 'observed',
      });
    }
  }
  return gaps;
}

/** "12.4s" / "1m 05s" - compact, consistent with how the rest of this app already formats bounded durations (e.g. ContextSummary's "60 seconds (±30s)"). */
export function formatGapDuration(durationMs: number): string {
  const totalSeconds = durationMs / 1000;
  if (totalSeconds < 60) {
    return `${totalSeconds % 1 === 0 ? totalSeconds : totalSeconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}
