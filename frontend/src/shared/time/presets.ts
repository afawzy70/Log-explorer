export interface TimeRangePreset {
  id: string;
  label: string;
  durationMs: number;
}

/**
 * IMPLEMENTATION_PLAN.md "Phase F" scope item 7 requires "Last 1 day"
 * specifically and bounds every preset within the backend's default
 * 7-day max range (`logexplorer.search.max-time-range`) so no preset can
 * ever itself trigger a guardrail rejection.
 */
export const TIME_RANGE_PRESETS: TimeRangePreset[] = [
  { id: '15m', label: 'Last 15 minutes', durationMs: 15 * 60 * 1000 },
  // UX-R3 §2 Decision A / §15 - same moving-relative recompute mechanism as
  // every other preset here (`recomputeRelativeRange` in useSearchState.ts
  // is generic over this table by id/durationMs; this entry needs no other
  // code change). Placed between 15m and 1h to keep the list monotonically
  // increasing by duration.
  { id: '30m', label: 'Last 30 minutes', durationMs: 30 * 60 * 1000 },
  { id: '1h', label: 'Last 1 hour', durationMs: 60 * 60 * 1000 },
  { id: '4h', label: 'Last 4 hours', durationMs: 4 * 60 * 60 * 1000 },
  { id: '1d', label: 'Last 1 day', durationMs: 24 * 60 * 60 * 1000 },
  { id: '7d', label: 'Last 7 days', durationMs: 7 * 24 * 60 * 60 * 1000 },
];

export const DEFAULT_PRESET_ID = '1d';
export const CUSTOM_RANGE_ID = 'custom';

/** "30-minute fallback" (scope item 7) when there is no previous preset duration to prefill from. */
export const CUSTOM_FALLBACK_DURATION_MS = 30 * 60 * 1000;
