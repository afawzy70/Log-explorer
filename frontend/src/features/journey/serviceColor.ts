/**
 * "Visually distinguish services" (IMPLEMENTATION_PLAN.md "Phase I" scope
 * item 2) - a small fixed categorical palette (never color alone: each
 * entry also prints the service name as text - see `JourneyEntryRow`),
 * assigned deterministically by name so the same service always gets the
 * same color within one timeline render, and across re-renders.
 */
const PALETTE = [
  '#2359d1', // accent blue
  '#8a5a00', // amber
  '#1a5e9a', // info blue
  '#7a5ba6', // violet
  '#0f7b6c', // teal
  '#b3261e', // red
  '#5b6270', // neutral
  '#a13d8f', // magenta
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** Stable across the whole app - not just within one timeline - so the same service always reads the same color anywhere this is used. */
export function colorForService(service: string | null): string {
  if (!service) {
    return PALETTE[PALETTE.length - 1];
  }
  return PALETTE[hashString(service) % PALETTE.length];
}
