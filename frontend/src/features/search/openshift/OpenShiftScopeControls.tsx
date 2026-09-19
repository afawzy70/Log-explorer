import type { OpenShiftPodDiscovery, OpenShiftWorkloadDiscovery, OpenShiftWorkloadKind } from '../../../shared/api/types';
import { WORKLOAD_KIND_LABELS, workloadOptionValue } from './workloadKindLabels';
import styles from './OpenShiftScopeControls.module.css';

export interface OpenShiftScopeControlsProps {
  workloadId: string;
  podId: string;
  containerId: string;
  busy: boolean;
  workloadDiscovery: OpenShiftWorkloadDiscovery | undefined;
  selectedWorkload: { kind: OpenShiftWorkloadKind; name: string } | null;
  pods: OpenShiftPodDiscovery | undefined;
  selectedPod: string | null;
  containers: string[] | undefined;
  selectedContainer: string | null;
  scopeError: string | null;
  onSelectWorkload: (value: string) => void;
  onSelectPod: (value: string) => void;
  onSelectContainer: (value: string) => void;
}

/**
 * SOURCE_EXPERIENCE_PARITY_DOCKER_OPENSHIFT - the Workload -> Pod ->
 * Container hierarchy, relocated from `OpenShiftSettingsPanel.tsx` (which
 * no longer edits search scope - see that file's own doc comment) into
 * the Search toolbar via `OpenShiftScopeSelect.tsx`, its only remaining
 * caller. Every loading/empty/forbidden/partial state below (OS-1B §24)
 * is preserved byte-for-byte in behavior; only the CSS module changed,
 * from `OpenShiftSettingsPanel.module.css`'s full-width settings-form
 * field layout to this file's own compact, inline toolbar-row layout
 * (matching `ComposeProjectSelect`'s existing pattern) - a vertical
 * settings form and a horizontal, wrapping toolbar row need different
 * geometry for the same semantics.
 */
export function OpenShiftScopeControls({
  workloadId,
  podId,
  containerId,
  busy,
  workloadDiscovery,
  selectedWorkload,
  pods,
  selectedPod,
  containers,
  selectedContainer,
  scopeError,
  onSelectWorkload,
  onSelectPod,
  onSelectContainer,
}: OpenShiftScopeControlsProps) {
  const problemKinds = (workloadDiscovery?.kindOutcomes ?? []).filter(
    (o) => o.status === 'FORBIDDEN' || o.status === 'ERROR',
  );

  return (
    <>
      {scopeError ? (
        <span role="alert" className={styles.error}>
          {scopeError}
        </span>
      ) : null}

      <div className={styles.wrapper}>
        <label htmlFor={workloadId} className={styles.label}>
          Workload
        </label>
        {workloadDiscovery === undefined ? (
          <span className={styles.hint} aria-live="polite">
            Discovering workloads…
          </span>
        ) : workloadDiscovery.status === 'FORBIDDEN' ? (
          <span role="alert" className={styles.error}>
            Not permitted to list workloads
          </span>
        ) : (
          <>
            <select
              id={workloadId}
              className={styles.select}
              disabled={busy}
              value={selectedWorkload ? workloadOptionValue(selectedWorkload.kind, selectedWorkload.name) : ''}
              onChange={(e) => onSelectWorkload(e.target.value)}
            >
              <option value="">All workloads</option>
              {workloadDiscovery.workloads.map((w) => (
                <option key={workloadOptionValue(w.kind, w.name)} value={workloadOptionValue(w.kind, w.name)}>
                  {w.name} ({WORKLOAD_KIND_LABELS[w.kind]})
                </option>
              ))}
            </select>
            {workloadDiscovery.workloads.length === 0 ? (
              <span className={styles.hint}>No workloads in this project</span>
            ) : null}
            {problemKinds.length > 0 ? (
              <span className={styles.hint} title={problemKinds.map((o) => WORKLOAD_KIND_LABELS[o.kind]).join(', ')}>
                Some workload types could not be listed
              </span>
            ) : null}
          </>
        )}
      </div>

      <div className={styles.wrapper}>
        <label htmlFor={podId} className={styles.label}>
          Pod
        </label>
        {pods === undefined ? (
          <span className={styles.hint} aria-live="polite">
            Discovering pods…
          </span>
        ) : (
          <>
            <select
              id={podId}
              className={styles.select}
              disabled={busy}
              value={selectedPod ?? ''}
              onChange={(e) => onSelectPod(e.target.value)}
            >
              <option value="">All matching pods</option>
              {pods.pods.map((pod) => (
                <option key={pod.name} value={pod.name}>
                  {pod.name} ({pod.phase}, {pod.readySummary})
                </option>
              ))}
            </select>
            {pods.pods.length === 0 ? <span className={styles.hint}>No pods currently match this scope</span> : null}
            {pods.status === 'PARTIAL' ? <span className={styles.hint}>Pod list may be incomplete</span> : null}
          </>
        )}
      </div>

      <div className={styles.wrapper}>
        <label htmlFor={containerId} className={styles.label}>
          Container
        </label>
        {selectedPod === null ? (
          <span className={styles.hint}>Select a pod first</span>
        ) : containers === undefined ? (
          <span className={styles.hint} aria-live="polite">
            Discovering containers…
          </span>
        ) : (
          <select
            id={containerId}
            className={styles.select}
            disabled={busy}
            value={selectedContainer ?? ''}
            onChange={(e) => onSelectContainer(e.target.value)}
          >
            <option value="">All applicable containers</option>
            {containers.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        )}
      </div>
    </>
  );
}
