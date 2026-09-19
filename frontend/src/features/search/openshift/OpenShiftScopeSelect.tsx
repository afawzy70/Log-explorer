import { useId } from 'react';
import type { OpenShiftScopeSummary } from '../../../shared/api/types';
import { useOpenShiftScopeEditor } from './useOpenShiftScopeEditor';
import type { OpenShiftScopeChangeLevel } from './useOpenShiftScopeEditor';
import { OpenShiftScopeControls } from './OpenShiftScopeControls';
import styles from './OpenShiftScopeControls.module.css';

export interface OpenShiftScopeSelectProps {
  /** The already-lifted, authoritative scope summary (`App.tsx`'s `openShiftScopeState.scope`) - read, not re-fetched, to seed the current Workload/Pod/Container selection. */
  scope: OpenShiftScopeSummary | null;
  /**
   * Fires after any successful mutation here, naming which level changed. `App.tsx`'s handler re-reads the
   * one authoritative scope (same `openShiftScopeState.refresh` Settings already used), invalidates any
   * search/investigation results left over from the old scope (SOURCE_EXPERIENCE_PARITY_TARGETED_RECOVERY_1),
   * and - only for `'project'`, the one level that affects `OpenShiftLogSource#health()` - re-checks source
   * health.
   */
  onScopeChanged: (level: OpenShiftScopeChangeLevel) => void;
}

/**
 * SOURCE_EXPERIENCE_PARITY_DOCKER_OPENSHIFT - the Search toolbar's OpenShift
 * scope control (Project/Namespace -> Workload -> optional Pod -> optional
 * Container), the UX-equivalent of Docker's `ComposeProjectSelect` +
 * `ServiceMultiSelect` pair rendered in the same row. Only rendered by
 * `Toolbar.tsx` while OpenShift is the selected source - this component
 * assumes it is always "active" while mounted, so it fetches its own
 * connection summary (for the Project list) on mount rather than taking an
 * `active` flag itself.
 *
 * OpenShift Workload is the UX-equivalent scope level to Docker Service
 * (owner requirements register §28) - this renders in the exact toolbar
 * position Docker's Service selector would occupy, never alongside it
 * (`Toolbar.tsx` renders one or the other, never both, for a given
 * source).
 */
export function OpenShiftScopeSelect({ scope, onScopeChanged }: OpenShiftScopeSelectProps) {
  const projectId = useId();
  const workloadId = useId();
  const podId = useId();
  const containerId = useId();
  const editor = useOpenShiftScopeEditor(true, scope, onScopeChanged);

  if (editor.connectionError) {
    return (
      <span role="alert" className={styles.error}>
        {editor.connectionError}
      </span>
    );
  }
  if (!editor.connection) {
    return (
      <span className={styles.hint} role="status" aria-live="polite">
        Loading OpenShift connection…
      </span>
    );
  }
  if (editor.connection.state !== 'CONNECTED') {
    return (
      <span className={styles.hint} role="status">
        OpenShift is not connected — connect it in Settings.
      </span>
    );
  }

  const isNamespaceMode = editor.connection.projectApi === 'NAMESPACES';
  const scopeLabelSingular = isNamespaceMode ? 'Namespace' : 'Project';
  const scopeLabelPlural = isNamespaceMode ? 'Namespaces' : 'Projects';

  if (editor.connection.projectCount === 0) {
    return (
      <span className={styles.hint} role="status">
        This account can sign in, but has no {scopeLabelPlural.toLowerCase()}.
      </span>
    );
  }

  return (
    <>
      <div className={styles.wrapper}>
        <label htmlFor={projectId} className={styles.label}>
          {scopeLabelSingular}
        </label>
        <select
          id={projectId}
          className={styles.select}
          value={editor.connection.selectedProject ?? ''}
          disabled={editor.busy}
          onChange={(e) => editor.selectProject(e.target.value || null)}
        >
          <option value="">All {scopeLabelPlural.toLowerCase()} (none selected)</option>
          {editor.connection.projects.map((project) => (
            <option key={project} value={project}>
              {project}
            </option>
          ))}
        </select>
      </div>
      {editor.connection.selectedProject ? (
        <OpenShiftScopeControls
          workloadId={workloadId}
          podId={podId}
          containerId={containerId}
          busy={editor.busy}
          workloadDiscovery={editor.workloadDiscovery}
          selectedWorkload={editor.selectedWorkload}
          pods={editor.pods}
          selectedPod={editor.selectedPod}
          containers={editor.containers}
          selectedContainer={editor.selectedContainer}
          scopeError={editor.scopeError}
          onSelectWorkload={editor.selectWorkload}
          onSelectPod={editor.selectPod}
          onSelectContainer={editor.selectContainer}
        />
      ) : null}
    </>
  );
}
