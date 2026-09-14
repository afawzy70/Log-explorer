import type { JourneyField, LogEvent } from '../../shared/api/types';

/** The five non-sensitive identifiers "View X"/"Find same X" can search by (IMPLEMENTATION_PLAN.md "Phase I", extended with spanId by owner mission "Mapping Verification and Investigation Workspace") - never a sensitive field. Used for the investigation view's own title ("Trace: t-1") and generic copy. */
export const JOURNEY_FIELD_LABELS: Record<JourneyField, string> = {
  journeyId: 'Journey',
  correlationId: 'Correlation',
  traceId: 'Trace',
  spanId: 'Span',
  eventId: 'Event',
};

/**
 * Owner mission "Mapping Verification and Investigation Workspace" —
 * "Investigation Entry Actions": the exact required action button label
 * per relationship type. Trace and Span use "View" (a single, well-known
 * identifier that resolves to one specific timeline); Correlation and
 * Journey use "Find same" (a shared identifier several unrelated events
 * might coincidentally carry); Event keeps the existing "Find same Event"
 * phrasing. Deliberately distinct from {@link JOURNEY_FIELD_LABELS},
 * which names the relationship itself, not the button that launches it.
 */
export const JOURNEY_ACTION_LABELS: Record<JourneyField, string> = {
  traceId: 'View Trace',
  spanId: 'View Span',
  correlationId: 'Find same Correlation',
  journeyId: 'Find same Journey',
  eventId: 'Find same Event',
};

/** "Supports multiple traces within one journey" (scope item 3) - counted so the timeline can say so explicitly, not just imply it. */
export function countDistinctTraces(entries: LogEvent[]): number {
  const traceIds = new Set(entries.map((e) => e.traceId).filter((id): id is string => id != null));
  return traceIds.size;
}

export function countDistinctServices(entries: LogEvent[]): number {
  const services = new Set(entries.map((e) => e.service).filter((s): s is string => s != null));
  return services.size;
}
