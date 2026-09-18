import { useEffect, useRef, useState } from 'react';
import {
  fetchOpenShiftConnection,
  fetchOpenShiftContainers,
  fetchOpenShiftPods,
  fetchOpenShiftWorkloads,
  selectOpenShiftContainer,
  selectOpenShiftPod,
  selectOpenShiftProject,
  selectOpenShiftWorkload,
} from '../../../shared/api/client';
import type {
  OpenShiftConnectionSummary,
  OpenShiftPodDiscovery,
  OpenShiftScopeSummary,
  OpenShiftWorkloadDiscovery,
  OpenShiftWorkloadKind,
} from '../../../shared/api/types';
import { parseWorkloadOptionValue } from './workloadKindLabels';

export interface OpenShiftScopeEditor {
  connection: OpenShiftConnectionSummary | null;
  /** Set only when the connection fetch itself failed (distinct from "still loading" - both start as `null`). */
  connectionError: string | null;
  workloadDiscovery: OpenShiftWorkloadDiscovery | undefined;
  selectedWorkload: { kind: OpenShiftWorkloadKind; name: string } | null;
  pods: OpenShiftPodDiscovery | undefined;
  selectedPod: string | null;
  containers: string[] | undefined;
  selectedContainer: string | null;
  scopeError: string | null;
  busy: boolean;
  selectProject: (project: string | null) => void;
  selectWorkload: (value: string) => void;
  selectPod: (value: string) => void;
  selectContainer: (value: string) => void;
}

/**
 * SOURCE_EXPERIENCE_PARITY_DOCKER_OPENSHIFT - the mutation/discovery layer
 * for OpenShift Project -> Workload -> Pod -> Container, now owned by
 * Search (`OpenShiftScopeSelect.tsx`) rather than Settings
 * (`OpenShiftSettingsPanel.tsx` keeps a read-only summary only - see its
 * own doc comment). There is still exactly ONE authoritative scope: the
 * backend session (`OpenShiftSession`, OS-1B) - this hook only issues the
 * same mutation calls Settings used to issue directly, then calls
 * `onScopeChanged` so the ALREADY-LIFTED `useOpenShiftScopeSummary`
 * instance in `App.tsx` re-reads that one truth (never a second, parallel
 * scope authority). `scope` (that same lifted summary) is read, not
 * re-fetched, to seed the current Workload/Pod/Container selection on
 * mount/reconnect - avoiding a duplicate `GET /scope` call for data this
 * hook's caller already has.
 *
 * Discovery calls carry a monotonic generation token (the same "a slow
 * previous response must never overwrite a newer selection" pattern
 * `useSearchState.ts`'s own search/service discovery already uses) so a
 * slow workload/pod/container list can never land after a newer
 * project/workload/pod change has already moved the UI on.
 */
export function useOpenShiftScopeEditor(
  active: boolean,
  scope: OpenShiftScopeSummary | null,
  onScopeChanged: () => void,
): OpenShiftScopeEditor {
  const [connection, setConnection] = useState<OpenShiftConnectionSummary | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [workloadDiscovery, setWorkloadDiscovery] = useState<OpenShiftWorkloadDiscovery | undefined>(undefined);
  const [selectedWorkload, setSelectedWorkload] = useState<{ kind: OpenShiftWorkloadKind; name: string } | null>(
    null,
  );
  const [pods, setPods] = useState<OpenShiftPodDiscovery | undefined>(undefined);
  const [selectedPod, setSelectedPod] = useState<string | null>(null);
  const [containers, setContainers] = useState<string[] | undefined>(undefined);
  const [selectedContainer, setSelectedContainer] = useState<string | null>(null);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const workloadGenerationRef = useRef(0);
  const podGenerationRef = useRef(0);
  const containerGenerationRef = useRef(0);
  // Tracks which project the currently-loaded workload/pod discovery belongs to, so a project switch never
  // shows a moment of the PREVIOUS project's workload list under the new project's label.
  const loadedForProjectRef = useRef<string | null>(null);

  function resetDescendants() {
    workloadGenerationRef.current += 1;
    podGenerationRef.current += 1;
    containerGenerationRef.current += 1;
    setWorkloadDiscovery(undefined);
    setSelectedWorkload(null);
    setPods(undefined);
    setSelectedPod(null);
    setContainers(undefined);
    setSelectedContainer(null);
  }

  useEffect(() => {
    if (!active) {
      setConnection(null);
      setConnectionError(null);
      resetDescendants();
      loadedForProjectRef.current = null;
      return;
    }
    setConnectionError(null);
    void fetchOpenShiftConnection()
      .then(setConnection)
      .catch(() => setConnectionError('Could not load the OpenShift connection.'));
    // Fetch once when this becomes the active source - not on every render, and reset everything the moment
    // it stops being active (switching to Docker/Fixture must never leave a stale OpenShift scope editor
    // showing this project's workloads).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  async function loadWorkloads() {
    const generation = ++workloadGenerationRef.current;
    try {
      const discovery = await fetchOpenShiftWorkloads();
      if (workloadGenerationRef.current !== generation) {
        return;
      }
      setWorkloadDiscovery(discovery);
      void loadPods();
    } catch {
      if (workloadGenerationRef.current === generation) {
        setScopeError('Could not discover workloads for this project.');
      }
    }
  }

  async function loadPods() {
    const generation = ++podGenerationRef.current;
    try {
      const result = await fetchOpenShiftPods();
      if (podGenerationRef.current !== generation) {
        return;
      }
      setPods(result);
    } catch {
      if (podGenerationRef.current === generation) {
        setScopeError('Could not discover pods for this scope.');
      }
    }
  }

  async function loadContainers() {
    const generation = ++containerGenerationRef.current;
    try {
      const result = await fetchOpenShiftContainers();
      if (containerGenerationRef.current !== generation) {
        return;
      }
      setContainers(result);
    } catch {
      if (containerGenerationRef.current === generation) {
        setScopeError('Could not discover containers for this pod.');
      }
    }
  }

  // Seed/refresh workload discovery (and the current Workload/Pod/Container selection) from the authoritative
  // `scope` summary whenever the selected project changes underneath us - including on first becoming active,
  // and including a project selected earlier in the same session (the backend session outlives this hook's
  // own mount/unmount, e.g. switching away from OpenShift and back).
  useEffect(() => {
    if (!active || !scope?.selectedProject) {
      return;
    }
    if (loadedForProjectRef.current === scope.selectedProject) {
      return;
    }
    loadedForProjectRef.current = scope.selectedProject;
    setSelectedWorkload(
      scope.selectedWorkloadKind && scope.selectedWorkloadName
        ? { kind: scope.selectedWorkloadKind, name: scope.selectedWorkloadName }
        : null,
    );
    setSelectedPod(scope.selectedPod);
    setSelectedContainer(scope.selectedContainer);
    void loadWorkloads();
    if (scope.selectedPod) {
      void loadContainers();
    }
    // Intentionally re-runs only on project identity change - loadWorkloads/loadPods/loadContainers close over
    // fresh state each call and are not stable across renders, so listing them would defeat the "only once per
    // project" guard above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, scope?.selectedProject]);

  function selectProject(project: string | null) {
    setScopeError(null);
    resetDescendants();
    loadedForProjectRef.current = project;
    setBusy(true);
    selectOpenShiftProject(project)
      .then((updated) => {
        setConnection(updated);
        onScopeChanged();
        if (project) {
          void loadWorkloads();
        }
      })
      .catch(() => setScopeError('Could not select that project. Try again.'))
      .finally(() => setBusy(false));
  }

  function selectWorkload(value: string) {
    setScopeError(null);
    podGenerationRef.current += 1;
    containerGenerationRef.current += 1;
    setPods(undefined);
    setSelectedPod(null);
    setContainers(undefined);
    setSelectedContainer(null);
    const workload = parseWorkloadOptionValue(value);
    setBusy(true);
    selectOpenShiftWorkload(workload)
      .then(() => {
        setSelectedWorkload(workload);
        onScopeChanged();
        void loadPods();
      })
      .catch(() => setScopeError('That workload is no longer available. Refresh and try again.'))
      .finally(() => setBusy(false));
  }

  function selectPod(value: string) {
    setScopeError(null);
    containerGenerationRef.current += 1;
    setContainers(undefined);
    setSelectedContainer(null);
    const pod = value || null;
    setBusy(true);
    selectOpenShiftPod(pod)
      .then(() => {
        setSelectedPod(pod);
        onScopeChanged();
        if (pod) {
          void loadContainers();
        }
      })
      .catch(() => setScopeError('That pod is no longer available. Refresh and try again.'))
      .finally(() => setBusy(false));
  }

  function selectContainer(value: string) {
    setScopeError(null);
    const container = value || null;
    setBusy(true);
    selectOpenShiftContainer(container)
      .then(() => {
        setSelectedContainer(container);
        onScopeChanged();
      })
      .catch(() => setScopeError('That container is no longer available on this pod.'))
      .finally(() => setBusy(false));
  }

  return {
    connection,
    connectionError,
    workloadDiscovery,
    selectedWorkload,
    pods,
    selectedPod,
    containers,
    selectedContainer,
    scopeError,
    busy,
    selectProject,
    selectWorkload,
    selectPod,
    selectContainer,
  };
}
