import { SourceHealthBadge } from './SourceHealthBadge';
import { DockerSettingsPanel } from '../features/settings/DockerSettingsPanel';
import { KeyboardShortcutsHelp } from './KeyboardShortcutsHelp';
import type { SearchState } from './useSearchState';
import styles from './Shell.module.css';

export interface ShellProps {
  state: SearchState;
}

/**
 * One product title, active source/environment, compact health + retry
 * (IMPLEMENTATION_PLAN.md "Phase F" scope item 1). "Log Explorer" only -
 * never a duplicated "Multi-Source Log Explorer" + "Log Explorer" pair
 * (CLAUDE.md §7 / scope item 1), and no fabricated branding.
 */
export function Shell({ state }: ShellProps) {
  return (
    <header className={styles.header}>
      <h1 className={styles.title}>Log Explorer</h1>
      {state.selectedSource ? <span className={styles.sourceName}>{state.selectedSource.displayName}</span> : null}
      <div className={styles.spacer} />
      <DockerSettingsPanel />
      <KeyboardShortcutsHelp />
      <SourceHealthBadge health={state.health} loading={state.healthLoading} onRetry={state.retryHealth} />
    </header>
  );
}
