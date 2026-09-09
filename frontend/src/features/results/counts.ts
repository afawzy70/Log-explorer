import type { ResultCounts } from '../../shared/api/types';

/**
 * The single place that turns `ResultCounts` into copy (IMPLEMENTATION_PLAN.md
 * "Phase G" scope item 10: "Counts kept distinct ... using the shared type
 * and fixed copy. No contradictory text."). `estimatedTotal`, `returned`,
 * `visible`, and `truncated` are never conflated - each is only ever
 * mentioned when it adds real information beyond the others.
 *
 * <p>Legacy Remediation Slice 1: when `cumulativeVisible` is passed (the
 * real, current `events.length` after zero or more "Load more" appends),
 * it replaces `counts.visible` for display and is never compared against
 * `counts.returned` - `returned` only ever describes the *latest page's
 * own* response size, a meaningless number to compare a multi-page running
 * total against. Omitting it preserves the exact original single-response
 * wording (existing callers/tests untouched).
 */
export function buildCountsSummary(counts: ResultCounts, cumulativeVisible?: number): string {
  const { estimatedTotal, returned, visible, truncated } = counts;

  if (cumulativeVisible == null) {
    const visiblePart = visible === returned ? `${visible}` : `${visible} of ${returned} fetched`;
    if (estimatedTotal != null) {
      return `Showing ${visiblePart} of ${estimatedTotal}${truncated ? ' (truncated)' : ''}`;
    }
    return `Showing ${visiblePart} event${visible === 1 ? '' : 's'}${truncated ? ' (truncated — more may be available)' : ''}`;
  }

  const eventWord = cumulativeVisible === 1 ? 'event' : 'events';
  if (estimatedTotal != null) {
    return `Showing ${cumulativeVisible} of ${estimatedTotal}${truncated ? ' (truncated)' : ''}`;
  }
  // Mandatory architecture correction #4 ("truthful totals"): once paging
  // has started, a total is never fabricated or silently reused from an
  // earlier page - say so explicitly rather than merely omitting a number.
  return `Showing ${cumulativeVisible} ${eventWord} loaded${truncated ? ' — total unknown for this source, more available' : ''}`;
}
