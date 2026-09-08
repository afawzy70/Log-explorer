import type { ResultCounts } from '../../shared/api/types';

/**
 * The single place that turns `ResultCounts` into copy (IMPLEMENTATION_PLAN.md
 * "Phase G" scope item 10: "Counts kept distinct ... using the shared type
 * and fixed copy. No contradictory text."). `estimatedTotal`, `returned`,
 * `visible`, and `truncated` are never conflated - each is only ever
 * mentioned when it adds real information beyond the others.
 */
export function buildCountsSummary(counts: ResultCounts): string {
  const { estimatedTotal, returned, visible, truncated } = counts;
  const visiblePart = visible === returned ? `${visible}` : `${visible} of ${returned} fetched`;

  if (estimatedTotal != null) {
    return `Showing ${visiblePart} of ${estimatedTotal}${truncated ? ' (truncated)' : ''}`;
  }
  return `Showing ${visiblePart} event${visible === 1 ? '' : 's'}${truncated ? ' (truncated — more may be available)' : ''}`;
}
