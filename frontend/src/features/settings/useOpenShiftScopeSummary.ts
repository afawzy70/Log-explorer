import { useCallback, useEffect, useState } from 'react';
import { fetchOpenShiftScope } from '../../shared/api/client';
import type { OpenShiftScopeSummary } from '../../shared/api/types';

/**
 * OS-1F - the single, shared source of truth for "where is the OpenShift
 * source currently scoped?" (project/namespace, workload, pod,
 * container), read directly from the backend session via {@link
 * fetchOpenShiftScope} - never inferred from local component state, never
 * duplicated. `Shell`'s `ScopeTrail` and `OpenShiftSettingsPanel` both
 * consume the same instance of this hook's result, so the header
 * breadcrumb and the Settings panel can never silently disagree about
 * what is currently selected.
 *
 * Fetches only while `active` (the currently-selected source is
 * OpenShift) - never a background poll for a source the user isn't even
 * looking at, and clears to `null` the moment OpenShift stops being the
 * active source (switching to Docker/Fixture/Loki must never leave a
 * stale OpenShift breadcrumb behind).
 */
export function useOpenShiftScopeSummary(active: boolean) {
  const [scope, setScope] = useState<OpenShiftScopeSummary | null>(null);

  const refresh = useCallback(() => {
    if (!active) {
      setScope(null);
      return;
    }
    void fetchOpenShiftScope()
      .then(setScope)
      .catch(() => setScope(null));
  }, [active]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { scope, refresh };
}
