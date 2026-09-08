import { CUSTOM_FALLBACK_DURATION_MS, CUSTOM_RANGE_ID, TIME_RANGE_PRESETS } from '../../shared/time/presets';
import type { CommittedTimeRange } from './types';

/**
 * CLAUDE.md §4: "Reopen restores committed values" when already on
 * Custom; otherwise "Prefill: End = now, Start = end − previous preset,
 * 30-minute fallback" when transitioning in from a preset.
 */
export function getPopoverInitialValues(
  committed: CommittedTimeRange,
  now: Date = new Date(),
): { startIso: string; endIso: string } {
  if (committed.presetId === CUSTOM_RANGE_ID) {
    return { startIso: committed.start, endIso: committed.end };
  }
  const preset = TIME_RANGE_PRESETS.find((p) => p.id === committed.presetId);
  const durationMs = preset ? preset.durationMs : CUSTOM_FALLBACK_DURATION_MS;
  const endIso = now.toISOString();
  const startIso = new Date(now.getTime() - durationMs).toISOString();
  return { startIso, endIso };
}
