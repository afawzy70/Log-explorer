export interface SeverityLevelDef {
  id: string;
  label: string;
  colorVar: string;
  bgVar: string;
}

/** Order matches severity, least to most severe - used for consistent chip ordering everywhere. */
export const SEVERITY_LEVELS: SeverityLevelDef[] = [
  { id: 'TRACE', label: 'Trace', colorVar: 'var(--color-severity-trace)', bgVar: 'var(--color-severity-trace-bg)' },
  { id: 'DEBUG', label: 'Debug', colorVar: 'var(--color-severity-debug)', bgVar: 'var(--color-severity-debug-bg)' },
  { id: 'INFO', label: 'Info', colorVar: 'var(--color-severity-info)', bgVar: 'var(--color-severity-info-bg)' },
  { id: 'WARN', label: 'Warn', colorVar: 'var(--color-severity-warn)', bgVar: 'var(--color-severity-warn-bg)' },
  { id: 'ERROR', label: 'Error', colorVar: 'var(--color-severity-error)', bgVar: 'var(--color-severity-error-bg)' },
];

/** "default INFO/WARN/ERROR (no TRACE/DEBUG noise)" - IMPLEMENTATION_PLAN.md "Phase F" scope item 4. */
export const DEFAULT_SEVERITY_LEVELS: string[] = ['INFO', 'WARN', 'ERROR'];

export const ALL_SEVERITY_LEVEL_IDS: string[] = SEVERITY_LEVELS.map((l) => l.id);

export const ERRORS_ONLY_LEVELS: string[] = ['ERROR'];
