import type { SourceInfo } from '../../shared/api/types';

/**
 * User-facing source selector policy (owner decision, PR #59 pre-merge).
 *
 * The backend's `GET /api/v1/sources` order is not a contract (the registry
 * iterates an unordered map), so the selector never relies on API,
 * registration, enum, or object iteration order. It applies this explicit,
 * deterministic policy keyed by stable source ids — never display names:
 *
 * 1. `local-docker` (Docker)
 * 2. `openshift` (OpenShift)
 * 3. `openshift-loki` (OpenShift Loki)
 *
 * Any other source (for example the dev/test-only `fixture` source) keeps
 * its existing availability and follows these three, in API order.
 *
 * OpenShift Loki is temporarily NOT selectable in the UI: it stays visible
 * as a native disabled option ("OpenShift Loki — Not available") and can
 * never become the active source. This is a current UI availability
 * decision only — the backend adapter, APIs, and tests are unchanged, and
 * re-enabling it means removing its id from `UI_UNAVAILABLE_SOURCE_IDS`.
 */
export const SOURCE_SELECTOR_PRIORITY: readonly string[] = ['local-docker', 'openshift', 'openshift-loki'];

export const UI_UNAVAILABLE_SOURCE_IDS: ReadonlySet<string> = new Set(['openshift-loki']);

export const UNAVAILABLE_SOURCE_SUFFIX = ' — Not available';

export function isSourceSelectableInUi(sourceId: string): boolean {
  return !UI_UNAVAILABLE_SOURCE_IDS.has(sourceId);
}

/** Stable ordering: the priority list first, then every other source in its original relative order. */
export function orderSourcesForSelector(sources: readonly SourceInfo[]): SourceInfo[] {
  const rank = (id: string) => {
    const index = SOURCE_SELECTOR_PRIORITY.indexOf(id);
    return index === -1 ? SOURCE_SELECTOR_PRIORITY.length : index;
  };
  return sources
    .map((source, index) => ({ source, index }))
    .sort((a, b) => rank(a.source.id) - rank(b.source.id) || a.index - b.index)
    .map(({ source }) => source);
}

/** The highest-priority selectable source (Docker, then OpenShift, then any other selectable source), or null. */
export function firstSelectableSourceId(sources: readonly SourceInfo[]): string | null {
  return orderSourcesForSelector(sources).find((source) => isSourceSelectableInUi(source.id))?.id ?? null;
}

export function sourceOptionLabel(source: SourceInfo): string {
  return isSourceSelectableInUi(source.id) ? source.displayName : `${source.displayName}${UNAVAILABLE_SOURCE_SUFFIX}`;
}
