export type DetectableIdField = 'traceId' | 'correlationId' | 'journeyId' | 'eventId';

export interface DetectedId {
  field: DetectableIdField;
  fieldLabel: string;
}

const PREFIX_RULES: Array<{ pattern: RegExp; field: DetectableIdField; fieldLabel: string }> = [
  { pattern: /^trace-/i, field: 'traceId', fieldLabel: 'Trace ID' },
  { pattern: /^(corr|correlation)-/i, field: 'correlationId', fieldLabel: 'Correlation ID' },
  { pattern: /^journey-/i, field: 'journeyId', fieldLabel: 'Journey ID' },
  { pattern: /^event-/i, field: 'eventId', fieldLabel: 'Event ID' },
];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_TRACE_PATTERN = /^[0-9a-f]{16,32}$/i;

/**
 * Universal search "detects possible trace/correlation/journey/event IDs
 * and offers a confirmable suggestion (never silent classification)"
 * (IMPLEMENTATION_PLAN.md "Phase F" scope item 5). This never itself
 * changes what gets searched - it only proposes; the caller decides
 * whether to confirm.
 */
export function detectIdCandidate(value: string): DetectedId | null {
  const trimmed = value.trim();
  if (trimmed.length < 6) {
    return null;
  }
  for (const rule of PREFIX_RULES) {
    if (rule.pattern.test(trimmed)) {
      return { field: rule.field, fieldLabel: rule.fieldLabel };
    }
  }
  if (UUID_PATTERN.test(trimmed) || HEX_TRACE_PATTERN.test(trimmed)) {
    return { field: 'traceId', fieldLabel: 'Trace ID' };
  }
  return null;
}
