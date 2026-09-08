import { formatInterval } from '../../shared/time/interval';
import { TIME_RANGE_PRESETS } from '../../shared/time/presets';
import type { CommittedTimeRange } from './types';

/** The single label-computation used by both the control itself and the active-filters mirror. */
export function getTimeRangeDisplayLabel(range: CommittedTimeRange): string {
  const preset = TIME_RANGE_PRESETS.find((p) => p.id === range.presetId);
  return preset ? preset.label : formatInterval(range.start, range.end);
}
