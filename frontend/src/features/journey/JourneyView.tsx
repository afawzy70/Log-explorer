import { useEffect, useMemo } from 'react';
import type { SearchState } from '../../app/useSearchState';
import { eventIdentity } from '../../app/useSearchState';
import { EMPTY_VALUE } from '../results/columnMapping';
import { InvestigationModeBar } from './InvestigationModeBar';
import { InvestigationStatRow } from './InvestigationStatRow';
import type { StatEntry } from './InvestigationStatRow';
import { TimelinePlot } from './TimelinePlot';
import type { TimelinePlotTrace } from './TimelinePlot';
import { SequenceTable } from './SequenceTable';
import { JOURNEY_FIELD_LABELS, countDistinctServices, countDistinctTraces } from './journeyFields';
import { detectGaps } from '../results/gapDetection';
import { formatDuration } from './timelineTicks';
import { formatUtcTimestamp } from '../inspector/timestampFormat';
import styles from './JourneyView.module.css';

/**
 * The journey/trace/correlation/event timeline (IMPLEMENTATION_PLAN.md
 * "Phase I", HANDOVER.md §17) - "the core value proposition: follow a
 * request or journey across services." Renders in place of `ResultsPanel`
 * (see `App.tsx`) whenever `state.journeyQuery` is set; "preserves and
 * restores the original search state" holds by construction here, since
 * opening/closing this view never touches `searchResult` or any toolbar
 * filter at all (see `useSearchState.ts#openJourney`'s own comment).
 *
 * <p><b>B5 Investigation RECOMPOSE</b> (`COMPONENT_INVENTORY.md`: "Card
 * list becomes a capture: mode bar, stat row, timeline plot ... and a
 * sequence table"). Reuses the same `TimelinePlot`/`InvestigationStatRow`/
 * `InvestigationModeBar` primitives the Surroundings context view uses
 * (`ResultsPanel.tsx`) - the design's own `capture()`/`contextView()`
 * prototype functions share one visual grammar, differing only in bounds
 * and (here) the per-trace bracket row. Deliberately does NOT reuse
 * `ResultsTable` for the sequence table itself: the design's own `capture()`
 * draws a genuinely different table shape (Offset + Business step columns,
 * a Trace/Span identifier column, no row selection) from `contextView()`'s
 * own `resultsTable()` call, which is the exact same primitive the main
 * search results use - see `SequenceTable.tsx`'s own comment.
 */
export function JourneyView({ state }: { state: SearchState }) {
  const query = state.journeyQuery;

  const events = state.journeyResult?.events ?? [];
  // Legacy Remediation Slice 6 - the backend already returns journey
  // events ascending by timestamp (SearchController#journey), so this is
  // safe to compute directly on `events` with no re-sort of its own.
  const gaps = useMemo(() => detectGaps(events), [events]);
  const errorCount = events.filter((e) => e.severity?.toUpperCase() === 'ERROR').length;
  const warnCount = events.filter((e) => e.severity?.toUpperCase() === 'WARN').length;
  const timestamped = events.filter((e): e is typeof e & { timestamp: string } => e.timestamp != null);
  const firstTimestamp = timestamped[0]?.timestamp ?? null;
  const lastTimestamp = timestamped[timestamped.length - 1]?.timestamp ?? null;
  const truncated = state.journeyResult?.counts.truncated ?? false;
  const isJourney = query?.field === 'journeyId';

  /**
   * Owner mission "Mapping Verification and Investigation Workspace" -
   * "Root event anchoring": the event that launched this view must never
   * silently disappear. `journeyRootEvent` is the exact event captured at
   * launch (`useSearchState.ts#openJourney`'s third argument); its index
   * in THIS result (by {@link eventIdentity}, not object reference - the
   * root event and its entry in `events` are two separately-fetched
   * copies of the same underlying event) gives both the highlight target
   * and "Selected event: N of M". `rootIndex === -1` (root event set but
   * genuinely absent from this bounded result) is reported honestly below
   * rather than silently highlighting a different event.
   */
  const rootEvent = state.journeyRootEvent;
  const rootIdentity = rootEvent ? eventIdentity(rootEvent) : null;
  const rootIndex = rootIdentity != null ? events.findIndex((e) => eventIdentity(e) === rootIdentity) : -1;

  // Trace grouping (journey kind only) - one bracket per distinct trace, in first-seen order, indexed T1/T2/...
  const traces = useMemo<TimelinePlotTrace[]>(() => {
    if (!isJourney) {
      return [];
    }
    const order: string[] = [];
    const bounds = new Map<string, { startMs: number; endMs: number }>();
    for (const event of events) {
      if (!event.traceId || !event.timestamp) {
        continue;
      }
      const ms = Date.parse(event.timestamp);
      if (Number.isNaN(ms)) {
        continue;
      }
      if (!bounds.has(event.traceId)) {
        order.push(event.traceId);
        bounds.set(event.traceId, { startMs: ms, endMs: ms });
      } else {
        const b = bounds.get(event.traceId)!;
        b.startMs = Math.min(b.startMs, ms);
        b.endMs = Math.max(b.endMs, ms);
      }
    }
    return order.map((id, i) => ({ id, label: `T${i + 1}`, startMs: bounds.get(id)!.startMs, endMs: bounds.get(id)!.endMs }));
  }, [events, isJourney]);
  const traceIndexOf = useMemo(() => new Map(traces.map((t, i) => [t.id, i + 1])), [traces]);

  const firstMs = firstTimestamp ? Date.parse(firstTimestamp) : null;
  const lastMs = lastTimestamp ? Date.parse(lastTimestamp) : null;
  const observedSpanMs = firstMs != null && lastMs != null ? lastMs - firstMs : null;
  // The plot's own zero point: the root/selected event when it's present in this bounded result, otherwise
  // the first event - never assumed to exist (an aged-out root is a real, honestly-handled state elsewhere
  // in this view, not something the plot silently pretends around).
  const originMs = rootIndex >= 0 && rootEvent?.timestamp ? Date.parse(rootEvent.timestamp) : (firstMs ?? 0);

  useEffect(() => {
    if (rootIndex >= 0) {
      document
        .querySelector(`[data-testid="journey-view"] tr[aria-current="location"]`)
        ?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    }
    // Re-fires whenever the root identity itself changes (a new
    // investigation was launched) - not on every render of an
    // already-open view, matching `ResultsTable`'s identical pattern.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootIdentity]);

  if (!query) {
    return null;
  }

  const title = JOURNEY_FIELD_LABELS[query.field];

  const stats: StatEntry[] = [
    { key: 'events', label: 'Events', value: events.length },
    { key: 'services', label: 'Services', value: countDistinctServices(events) },
  ];
  if (isJourney) {
    stats.push({ key: 'traces', label: 'Traces', value: countDistinctTraces(events) });
  }
  stats.push(
    { key: 'errors', label: 'Errors', value: errorCount, variant: 'danger' },
    { key: 'warnings', label: 'Warnings', value: warnCount, variant: 'warn' },
  );
  if (firstTimestamp && lastTimestamp) {
    stats.push({
      key: 'first-last',
      label: 'First → last',
      // `formatUtcTimestamp` already appends "UTC" to its own result - never repeat it.
      value: `${formatUtcTimestamp(firstTimestamp)} → ${formatUtcTimestamp(lastTimestamp)}`,
      mono: true,
    });
  }
  if (observedSpanMs != null) {
    stats.push({ key: 'span', label: 'Observed span', value: formatDuration(observedSpanMs), mono: true });
  }
  stats.push({ key: 'gaps', label: 'Gaps', value: gaps.length });
  // Root anchoring: the stat is only shown once the root event is genuinely present in this bounded result -
  // when it is missing (or was never captured at all), the separate honest notice below states that instead
  // of this stat silently claiming a position that isn't real.
  if (rootEvent && rootIndex >= 0) {
    stats.push({ key: 'selected', label: 'Selected event', value: `${rootIndex + 1} of ${events.length}` });
  }

  const summaryLine = isJourney
    ? `${events.length} event${events.length === 1 ? '' : 's'} across ${countDistinctServices(events)} service${countDistinctServices(events) === 1 ? '' : 's'} and ${countDistinctTraces(events)} trace${countDistinctTraces(events) === 1 ? '' : 's'}, same source, ascending by timestamp. Using journey correlation.`
    : `${events.length} event${events.length === 1 ? '' : 's'} across ${countDistinctServices(events)} service${countDistinctServices(events) === 1 ? '' : 's'}, same source, ascending by timestamp. Using ${title.toLowerCase()} correlation.`;

  return (
    <div className={styles.wrapper} data-testid="journey-view">
      <InvestigationModeBar
        backLabel="Back to search results"
        onBack={state.closeJourney}
        title={title}
        idValue={query.value}
        copyLabel={title.toLowerCase()}
      />

      {state.journeyError ? (
        <div className={styles.error} role="alert">
          {state.journeyError}
        </div>
      ) : state.journeyLoading ? (
        <p className={styles.status} role="status">
          Loading timeline…
        </p>
      ) : events.length === 0 ? (
        <p className={styles.empty}>
          No events found for this {title.toLowerCase()} ID in the current source and time range.
        </p>
      ) : (
        <>
          <InvestigationStatRow stats={stats} ariaLabel={`${title} investigation summary`}>
            <div className={styles.claim}>
              <span>{summaryLine}</span>
              <span className={styles.claimNote}>
                Ordered by timestamp — this does not indicate causality between events. A detected gap means no
                event was observed in that interval, not evidence that anything failed.
              </span>
            </div>
          </InvestigationStatRow>

          {rootIndex === -1 && rootEvent ? (
            <p className={styles.incompleteNotice} role="status">
              Selected event is not present in this result (outside the bounded window or guardrail limit).
            </p>
          ) : null}
          {truncated ? (
            <p className={styles.incompleteNotice} role="status">
              ⚠ Results may be incomplete — this source returned a bounded subset (limit reached).
            </p>
          ) : null}

          {firstMs != null && lastMs != null ? (
            <TimelinePlot
              events={events}
              rootIdentity={rootIndex >= 0 ? rootIdentity : null}
              gaps={gaps}
              loMs={firstMs - Math.max((lastMs - firstMs) * 0.02, 500)}
              hiMs={lastMs + Math.max((lastMs - firstMs) * 0.02, 500)}
              originMs={originMs}
              ariaLabel={`Timeline of ${events.length} events by service; the selected event is marked.`}
              traces={isJourney ? traces : undefined}
            />
          ) : null}

          <SequenceTable
            events={events}
            startMs={firstMs ?? 0}
            rootIdentity={rootIndex >= 0 ? rootIdentity : null}
            gaps={gaps}
            onShowContext={state.showContext}
            ariaLabel={`${title} events in timestamp order`}
            identifierColumn={
              isJourney
                ? {
                    header: 'Trace',
                    render: (event) =>
                      event.traceId ? (
                        <span className={styles.traceCell}>
                          <span className={styles.traceTag}>T{traceIndexOf.get(event.traceId) ?? '—'}</span>{' '}
                          <span className={styles.traceMono}>{event.traceId.slice(0, 8)}</span>
                        </span>
                      ) : (
                        EMPTY_VALUE
                      ),
                  }
                : {
                    header: 'Span ID',
                    render: (event) => <span className={styles.traceMono}>{event.spanId ?? EMPTY_VALUE}</span>,
                  }
            }
          />
        </>
      )}
    </div>
  );
}
