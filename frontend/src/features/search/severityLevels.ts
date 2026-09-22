export interface SeverityLevelDef {
  id: string;
  label: string;
  colorVar: string;
  bgVar: string;
}

/*
 * B7 (Session 10) - `colorVar` moved from v1 `--color-severity-*` (no dark-theme override anywhere in
 * `tokens.css`, confirmed by grep) to the already dark-theme-correct `--v2-sev-*` ink tokens: both of its
 * consumers (`columnRegistry.tsx`'s Level column, `InspectorHeader.tsx`) are already-recomposed v2 surfaces,
 * confirmed via a repo-wide grep before this change - `colorVar` was their one remaining v1 leak.
 *
 * `bgVar` has exactly one consumer (`SeverityFilter.tsx`'s active/pressed chip background, converted to v2 in
 * this same pass) and needs a light tint pair per level; `tokensV2.css`'s own severity block only defines a
 * `-row` tint for ERROR/WARN (the two levels `ResultsTable.module.css` tints at row level), not for
 * INFO/DEBUG/TRACE - rather than invent new named design tokens outside the approved package, `bgVar` derives
 * its tint from the same ink token everything else already uses via `color-mix()`, the same technique
 * `LiveTailPanel.module.css`'s `.toneLive` border already uses for a derived (not separately named) tone -
 * theme-correct for free, since it mixes against a token that itself already flips per theme.
 */
export const SEVERITY_LEVELS: SeverityLevelDef[] = [
  {
    id: 'TRACE',
    label: 'Trace',
    colorVar: 'var(--v2-sev-trace)',
    bgVar: 'color-mix(in srgb, var(--v2-sev-trace) 14%, transparent)',
  },
  {
    id: 'DEBUG',
    label: 'Debug',
    colorVar: 'var(--v2-sev-debug)',
    bgVar: 'color-mix(in srgb, var(--v2-sev-debug) 14%, transparent)',
  },
  {
    id: 'INFO',
    label: 'Info',
    colorVar: 'var(--v2-sev-info)',
    bgVar: 'color-mix(in srgb, var(--v2-sev-info) 14%, transparent)',
  },
  {
    id: 'WARN',
    label: 'Warn',
    colorVar: 'var(--v2-sev-warn)',
    bgVar: 'color-mix(in srgb, var(--v2-sev-warn) 14%, transparent)',
  },
  {
    id: 'ERROR',
    label: 'Error',
    colorVar: 'var(--v2-sev-error)',
    bgVar: 'color-mix(in srgb, var(--v2-sev-error) 14%, transparent)',
  },
];

export const ALL_SEVERITY_LEVEL_IDS: string[] = SEVERITY_LEVELS.map((l) => l.id);

/**
 * Owner requirement (docs/governance/OWNER_REQUIREMENTS_REGISTER.md #30): every level selected by
 * default, on fresh load and on Reset/Clear all - supersedes IMPLEMENTATION_PLAN.md "Phase F" scope
 * item 4's own deliberate INFO/WARN/ERROR default (TRACE/DEBUG excluded as noise). Kept as its own named
 * export, not an inline reference to ALL_SEVERITY_LEVEL_IDS, so a caller reads "the default" rather than
 * "the full set" even though the two are equal today.
 */
export const DEFAULT_SEVERITY_LEVELS: string[] = ALL_SEVERITY_LEVEL_IDS;

export const ERRORS_ONLY_LEVELS: string[] = ['ERROR'];

/** Set-equality for a level-id list, order-independent. Single shared definition - previously duplicated locally in ActiveFilters.tsx. */
export function sameLevelSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const setB = new Set(b);
  return a.every((level) => setB.has(level));
}

/**
 * True when `levels` represents "every level selected" - i.e. no real restriction. Used to decide
 * whether to omit the level filter from the outgoing search request (so the backend's own
 * already-correct "empty levels = no restriction" behaviour applies, which also never excludes an
 * event with a missing or unrecognized severity - see EventFilters.matchesExceptTags) and, for Live
 * tail's local display filter, whether to skip severity filtering entirely.
 */
export function isAllLevelsSelected(levels: string[]): boolean {
  return sameLevelSet(levels, ALL_SEVERITY_LEVEL_IDS);
}
