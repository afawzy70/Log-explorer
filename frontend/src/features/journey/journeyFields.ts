import type { JourneyField, LogEvent } from '../../shared/api/types';

/** The exact four non-sensitive identifiers "Find this X" can search by (IMPLEMENTATION_PLAN.md "Phase I" scope item 1) - never a sensitive field. */
export const JOURNEY_FIELD_LABELS: Record<JourneyField, string> = {
  journeyId: 'Journey',
  correlationId: 'Correlation',
  traceId: 'Trace',
  eventId: 'Event',
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
