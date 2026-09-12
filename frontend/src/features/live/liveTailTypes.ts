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

/**
 * OS-1E review recovery — the source's own CURRENT per-target runtime
 * truth, mirrored from backend `LiveSourceStatus`. `'RUNNING'` is the
 * value every source without a per-target concept (Docker/Fixture/Loki)
 * always reports - never any other value - so a component can safely
 * treat any other state as "this source has something specific to say."
 * See `LiveSourceStatus`'s own backend javadoc for the exact derivation
 * rule and what each state means.
 */
export type LiveSourceState = 'RUNNING' | 'DEGRADED' | 'RECONNECTING' | 'NO_ACTIVE_TARGETS' | 'EXPIRED' | 'STALE';

/**
 * The "status" SSE event's payload - mirrors backend
 * `LiveTailService.StatusPayload` (IMPLEMENTATION_PLAN.md "Phase J").
 *
 * OS-1E review recovery — `liveSourceState`/`resolvedTargets`/
 * `activeTargets`/`reconnectingTargets`/`stoppedTargets`/`warnings`
 * replace the original single-warning-string design, which could only
 * ever report the single most recently changed target's own warning
 * (target A stopped, then target B also stopped - the old channel
 * reported only B). Every one of these fields is a full CURRENT snapshot
 * on every "status" tick, never a delta - always present (never
 * undefined) for every source, so a component never needs a null-check
 * to render them; `liveSourceState: 'RUNNING'`/all counts `0`/
 * `warnings: []` for every source with no per-target concept.
 */
export interface LiveStatusPayload {
  droppedCount: number;
  serverTime: string;
  liveSourceState: LiveSourceState;
  resolvedTargets: number;
  activeTargets: number;
  reconnectingTargets: number;
  stoppedTargets: number;
  warnings: string[];
}

/** The subset of {@link LiveStatusPayload} `useLiveTail.ts` tracks as its own `sourceStatus` state - the same fields, without the per-tick `droppedCount`/`serverTime` (already tracked separately). */
export interface LiveSourceStatusView {
  state: LiveSourceState;
  resolvedTargets: number;
  activeTargets: number;
  reconnectingTargets: number;
  stoppedTargets: number;
  warnings: string[];
}

/** Mirrors backend `LiveSourceStatus.NOMINAL` - the default for every source with no per-target concept. */
export const NOMINAL_SOURCE_STATUS: LiveSourceStatusView = {
  state: 'RUNNING',
  resolvedTargets: 0,
  activeTargets: 0,
  reconnectingTargets: 0,
  stoppedTargets: 0,
  warnings: [],
};

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
