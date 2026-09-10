import { SourceHealthBadge } from './SourceHealthBadge';
import { DockerSettingsPanel } from '../features/settings/DockerSettingsPanel';
import { KeyboardShortcutsHelp } from './KeyboardShortcutsHelp';
import { EnvironmentBadge } from './EnvironmentBadge';
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
/**
 * UX-R3 §12 - the selected Compose project must stay visible in the main
 * investigation workspace, not only inside Settings, and remain visible
 * across Search results/inspector/context/Live (this header renders above
 * `.mainRow` unconditionally in `App.tsx`, so it never disappears when
 * those views swap). Rendered only when the active source actually has a
 * real Compose-project concept (`composeProjectScoping`) and a project is
 * currently selected - "All projects" (the unscoped default) adds no new
 * chip, since it changes nothing about today's pre-UX-R3 behavior.
 */
function ScopeTrail({ state }: ShellProps) {
  if (!state.selectedSource) {
    return null;
  }
  const showProject = state.selectedSource.capabilities.composeProjectScoping && state.selectedComposeProject;
  return (
    <span className={styles.sourceName}>
      {state.selectedSource.displayName}
      {showProject ? (
        <>
          <span className={styles.scopeSeparator} aria-hidden="true">
            ›
          </span>
          <span className={styles.scopeProject}>{state.selectedComposeProject}</span>
        </>
      ) : null}
    </span>
  );
}

export function Shell({ state }: ShellProps) {
  return (
    <header className={styles.header}>
      <h1 className={styles.title}>Log Explorer</h1>
      <EnvironmentBadge />
      <ScopeTrail state={state} />
      <div className={styles.spacer} />
      <DockerSettingsPanel />
      <KeyboardShortcutsHelp />
      <SourceHealthBadge health={state.health} loading={state.healthLoading} onRetry={state.retryHealth} />
    </header>
  );
}
