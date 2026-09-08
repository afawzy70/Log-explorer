import { CUSTOM_RANGE_ID } from '../../shared/time/presets';

export interface CommittedTimeRange {
  /** A `TIME_RANGE_PRESETS` id, or `CUSTOM_RANGE_ID`. */
  presetId: string;
  /** UTC ISO instant. */
  start: string;
  /** UTC ISO instant. */
  end: string;
}

export function isCustomRange(range: CommittedTimeRange): boolean {
  return range.presetId === CUSTOM_RANGE_ID;
}
