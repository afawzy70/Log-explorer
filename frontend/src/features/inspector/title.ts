import type { LogEvent } from '../../shared/api/types';

/**
 * "Title derived from message/error code. No invented diagnosis or root
 * cause." (IMPLEMENTATION_PLAN.md "Phase H" scope item "Header") - a
 * literal projection of fields the event already has, never a summary or
 * classification this code invents.
 */
export function deriveInspectorTitle(event: LogEvent): string {
  if (event.malformed) {
    return 'Malformed log line';
  }
  const message = event.message?.trim();
  if (message) {
    const collapsed = message.replace(/\s+/g, ' ');
    return collapsed.length > 140 ? `${collapsed.slice(0, 140)}…` : collapsed;
  }
  if (event.errorCode) {
    return `Error ${event.errorCode}`;
  }
  return '(empty message)';
}
