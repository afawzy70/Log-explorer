/**
 * Explicit finite state model (Legacy Remediation Slice 5 - "Prefer an
 * explicit finite state model... Avoid many loosely-related booleans").
 * `'reconnecting'` is new this slice; `'error'` was renamed to `'failed'`
 * to match the mission's own vocabulary (a terminal state after the
 * bounded retry budget is exhausted - not just "an error happened").
 */
export type LiveConnectionState =
  | 'idle'
  | 'connecting'
  | 'live'
  | 'paused'
  | 'reconnecting'
  | 'stopped'
  | 'failed';

/** The "status" SSE event's payload - mirrors backend `LiveTailService.StatusPayload` (IMPLEMENTATION_PLAN.md "Phase J"). */
export interface LiveStatusPayload {
  droppedCount: number;
  serverTime: string;
}

/**
 * Event retention limit (Legacy Remediation Slice 5 - "Define and
 * document an explicit maximum retained Live event count"). Doubled from
 * Phase J's original 1,000: Slice 5 adds Live-local severity/text
 * filtering, which benefits from more retained history to filter over,
 * while staying well inside the range this codebase has already proven
 * safe to render directly with no virtualization -
 * `ResultsTable.performance.test.tsx` renders 5,000 rows of the far
 * heavier 7-column table with no special handling. Applies to both what
 * is *retained* (the buffer `useLiveTail` keeps) and what is *rendered*
 * (rendering the unfiltered retained set 1:1 keeps DOM rows trivially
 * bounded by the same number - see `docs/verification/LEGACY_REMEDIATION_SLICE_5_PERFORMANCE_REPORT.md`).
 */
export const VISIBLE_CAP = 2000;

/**
 * Batching flush interval, milliseconds (Legacy Remediation Slice 5 -
 * "Prefer a short flush interval... Example target: flush a batch every
 * ~50-200ms"). Incoming events are queued in a ref (no React state write)
 * and committed to state in one batch on this cadence, decoupling arrival
 * rate from render rate - "one React state update per incoming event"
 * would not scale (the mission's own explicit anti-pattern) and was the
 * pre-Slice-5 architecture. 100ms sits at the middle of the suggested
 * range: fast enough that new logs still feel live (a human cannot
 * perceive a 100ms display lag as "not live"), slow enough that a
 * 500-1,000 events/sec burst collapses into ~10 commits/sec instead of
 * hundreds-to-thousands.
 */
export const BATCH_FLUSH_MS = 100;

/**
 * Bounded exponential backoff with jitter (Legacy Remediation Slice 5 -
 * matches the exact policy the pre-Slice-5 capability matrix already
 * named as the target for LIVE-06: "±20% jitter, cap 15s, max 5
 * attempts"). `RECONNECT_BASE_DELAY_MS` doubles each attempt
 * (500ms, 1s, 2s, 4s, 8s, capped at `RECONNECT_MAX_DELAY_MS`) before
 * ±20% jitter is applied; after `RECONNECT_MAX_ATTEMPTS` failed attempts
 * the session moves to the terminal `'failed'` state instead of retrying
 * forever invisibly.
 */
export const RECONNECT_BASE_DELAY_MS = 500;
export const RECONNECT_MAX_DELAY_MS = 15_000;
export const RECONNECT_MAX_ATTEMPTS = 5;
export const RECONNECT_JITTER_RATIO = 0.2;
