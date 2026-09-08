/**
 * The one literal placeholder for a missing table value, used everywhere
 * a cell has nothing to show (IMPLEMENTATION_PLAN.md "Phase G" scope item
 * 3: "Missing values render — . Never omit a cell.") - centralized so
 * every column renderer uses the exact same character, not a
 * near-identical lookalike.
 */
export const EMPTY_VALUE = '—';
