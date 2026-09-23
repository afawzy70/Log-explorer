import { useCallback, useEffect, useRef, useState } from 'react';
import { firstSelectableSourceId, isSourceSelectableInUi } from '../features/search/sourcePolicy';
import {
  fetchClassificationRules,
  fetchComposeProjects,
  fetchContext,
  fetchFieldMappingProfile,
  fetchJourney,
  fetchSourceHealth,
  fetchSourceServices,
  fetchSources,
  isMappingNotReadyError,
  runSearch as runSearchApi,
} from '../shared/api/client';
import type {
  ClassificationSampleScope,
  FieldMappingProfileDto,
  JourneyField,
  LogEvent,
  SearchDirection,
  SearchRequestBody,
  SearchResponse,
  ServiceInfo,
  SourceHealthDetail,
  SourceInfo,
} from '../shared/api/types';
import { DEFAULT_SEVERITY_LEVELS, isAllLevelsSelected } from '../features/search/severityLevels';
import { emptyAdvancedFilterValues } from '../features/search/advancedFilterFields';
import type { AdvancedFilterValues } from '../features/search/advancedFilterFields';
import type { DetectableIdField } from '../features/search/idDetection';
import { emptyQueryAuthoringState, resolveQueryText, resolveRawLogQl } from '../features/search/QueryBuilder';
import type { QueryAuthoringState } from '../features/search/QueryBuilder';
import { DEFAULT_PRESET_ID, TIME_RANGE_PRESETS, CUSTOM_RANGE_ID } from '../shared/time/presets';
import { DEFAULT_PAGE_SIZE } from '../shared/api/pageSize';
import type { CommittedTimeRange } from '../features/timerange/types';
import { formatUtcTimestamp } from '../features/inspector/timestampFormat';
import { JOURNEY_FIELD_LABELS } from '../features/journey/journeyFields';

/** Exported so "remove time range chip" / "Clear all" (UX-R1 §3/§4) can reset to the exact same fresh default this hook itself starts from - one definition, never a second copy that could drift. */
export function defaultTimeRange(): CommittedTimeRange {
  const preset = TIME_RANGE_PRESETS.find((p) => p.id === DEFAULT_PRESET_ID)!;
  const end = new Date();
  const start = new Date(end.getTime() - preset.durationMs);
  return { presetId: DEFAULT_PRESET_ID, start: start.toISOString(), end: end.toISOString() };
}

/**
 * UX-R2 — search-freshness defect (owner-reported, real-Docker-reproduced:
 * selecting a relative preset like "Last 1 hour" commits an *absolute*
 * start/end at that instant; every later Search/Refresh click reused that
 * same, increasingly stale `end`, so a log line created after the preset
 * was picked could never appear no matter how many times Search was
 * clicked - not a backend/adapter bug, proven by replaying the identical
 * window directly against `/api/v1/logs/search`: the stale window
 * legitimately excludes the new event, and a freshly recomputed one
 * legitimately includes it).
 *
 * A RELATIVE preset's effective window must be recomputed - same
 * `presetId`, same `durationMs`, `end` advanced to "now" - on every
 * explicit fresh Search/Refresh (`runSearch`, below). A CUSTOM absolute
 * range must never auto-advance (CLAUDE.md's own "Cancel/Escape/outside
 * click closes without mutating the committed range" spirit extends here:
 * a range the investigator explicitly typed stays exactly what they
 * typed) - returns the *same* object reference in that case, so callers
 * that conditionally `setTimeRange` only on a real change get a natural,
 * free no-op rather than needing their own equality check.
 */
function recomputeRelativeRange(range: CommittedTimeRange): CommittedTimeRange {
  if (range.presetId === CUSTOM_RANGE_ID) {
    return range;
  }
  const preset = TIME_RANGE_PRESETS.find((p) => p.id === range.presetId);
  if (!preset) {
    return range; // defensive: an unrecognized presetId is left untouched, never guessed at
  }
  const end = new Date();
  const start = new Date(end.getTime() - preset.durationMs);
  return { presetId: range.presetId, start: start.toISOString(), end: end.toISOString() };
}

/**
 * A practical, non-sensitive content identity for one event (Legacy
 * Remediation Slice 1) - used both for client-side defensive dedup of
 * appended "Load more" pages, mirroring the backend's own
 * `PageCursorCodec#eventFingerprint` in spirit (never touches
 * `protectedFields`, the frontend never sees a raw sensitive value to
 * begin with), and (OS-1D) as the "strongest available identity" a
 * surrounding-logs context view re-identifies its own root event by
 * (mission §9: "must not rely on message text alone"). `containerName`/
 * `namespace` were added in OS-1D so a repeated log line from a sibling
 * container in the same pod, or the same pod name reused across two
 * different OpenShift namespaces, is never mistaken for the root - `pod`
 * alone was not a strong enough identity for either case.
 */
export function eventIdentity(e: LogEvent): string {
  return [
    e.timestamp, e.sourceId, e.containerId, e.pod, e.containerName, e.namespace, e.stream,
    e.rawLine ?? e.message, e.logger, e.thread, e.traceId, e.spanId, e.correlationId, e.journeyId, e.eventId,
  ].join('');
}

/**
 * UI Gap Closure Pass - "Context ordering": chronological ascending for a
 * "Show ±30 seconds" context view (what happened before -> the event -> what
 * happened after), while the general historical results table stays
 * newest-first, unchanged (CLAUDE.md §4). A pure, bounded (context data is
 * always a small ±30s window, even after a rare "Load more") array copy -
 * never mutates its argument, never touches the ordinary search path.
 * Null/unparseable timestamps sort last, stably, rather than throwing or
 * producing NaN comparisons.
 */
function sortByTimestampAscending(events: LogEvent[]): LogEvent[] {
  const timeOf = (e: LogEvent): number => {
    if (!e.timestamp) {
      return Number.POSITIVE_INFINITY;
    }
    const parsed = Date.parse(e.timestamp);
    return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
  };
  return [...events].sort((a, b) => timeOf(a) - timeOf(b));
}

/**
 * A snapshot of every piece of state that composes one search + its
 * result - what "show context" (IMPLEMENTATION_PLAN.md "Phase H") saves
 * before replacing the visible search, and what "back to original search"
 * restores. Only ever one level deep: a second detour before returning
 * does not overwrite the saved original (see `snapshotOriginalIfAbsent`).
 */
interface SearchSnapshot {
  selectedServices: string[];
  serviceFilterMode: 'INCLUDE' | 'EXCLUDE';
  sortDirection: SearchDirection;
  selectedIndex: number | null;
  selectedLevels: string[];
  selectedTags: string[];
  searchText: string;
  advancedFilters: AdvancedFilterValues;
  queryState: QueryAuthoringState;
  timeRange: CommittedTimeRange;
  searchResult: SearchResponse | null;
  lastSearchedRange: CommittedTimeRange | null;
}

/**
 * Every piece of search state this phase's UI owns, and the orchestration
 * around it. Nothing here is ever written to `localStorage` or the URL
 * (CLAUDE.md §2 rule 4) - state lives entirely in memory for the life of
 * the page.
 */
/** Why the classification workspace was opened - see `classificationWorkspaceIntent`. */
export type ClassificationWorkspaceIntent = 'createRule' | 'addExtraction' | null;

/**
 * PR61_OWNER_NAVIGATION_RECOVERY_2 - where a full-takeover workspace (Field Mapping, Classification Rules)
 * was entered from, so its own "Back" can truthfully return there instead of always assuming Search. `search`
 * covers Shell's own persistent header trigger and the Inspector's "Create tag rule"/"Add extraction" actions;
 * `settings` covers Settings' own inline buttons and either workspace's shared `SettingsNav` sidebar jump.
 */
export type WorkspaceOrigin = 'search' | 'settings';

/** The Settings page's own section ids (`SettingsNav.tsx`'s `SETTINGS_NAV_SECTIONS`) - what `openSettingsWorkspace` can deterministically land on. */
export type SettingsSectionId = 'sources' | 'masking' | 'appearance' | 'mapping' | 'classification' | 'shortcuts';

export function useSearchState() {
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [selectedSourceId, setSelectedSourceIdState] = useState<string | null>(null);
  /**
   * Owner decision (PR #59 pre-merge, `features/search/sourcePolicy.ts`): a
   * source that is not selectable in the UI (currently OpenShift Loki) can
   * never become the active source — not from the selector, not from stale
   * or malformed client state, not from the initial auto-selection — so no
   * health/service/search request is ever made for it as the active source.
   */
  const setSelectedSourceId = useCallback((sourceId: string | null) => {
    if (sourceId !== null && !isSourceSelectableInUi(sourceId)) {
      return;
    }
    setSelectedSourceIdState(sourceId);
  }, []);

  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  /**
   * Owner mission "Service Filter, Docker Performance, and Verified
   * Default Mapping" §A — whether `selectedServices` is an allow-list
   * ("Include selected") or a deny-list ("Exclude selected"). Defaults to
   * INCLUDE, matching every prior release's only behavior. Session/search
   * state only - never persisted (CLAUDE.md §2 rule 4).
   */
  const [serviceFilterMode, setServiceFilterMode] = useState<'INCLUDE' | 'EXCLUDE'>('INCLUDE');
  /**
   * UX-R3 §7/§8/§9 — the request/session-scoped Docker Compose "investigation
   * scope" (never a global mutation of backend config; travels on each
   * request the same way every other structured filter already does).
   * `null` means "no project selected" - every relevant Docker operation
   * then falls back to the deployment's own static `composeProjectFilter`
   * (or no filter at all), the same behavior this app already had before
   * this slice. Reset to `null` whenever the source itself changes (a new
   * source is a new scope entirely) - see the source-change effect below.
   */
  const [selectedComposeProject, setSelectedComposeProject] = useState<string | null>(null);
  /** Real projects discovered on the current source's own connection (empty when unsupported or genuinely none exist - the caller distinguishes those via `selectedSource.capabilities.composeProjectScoping`). */
  const [composeProjects, setComposeProjects] = useState<string[]>([]);
  const [composeProjectsLoading, setComposeProjectsLoading] = useState(false);
  const [composeProjectsError, setComposeProjectsError] = useState<string | null>(null);
  const [selectedLevels, setSelectedLevels] = useState<string[]>(DEFAULT_SEVERITY_LEVELS);
  /**
   * Event Classification & Extraction Rules - the committed tag filter
   * (an event matches when it has ANY selected tag; enforced server-side).
   * Session state only: never written to localStorage or the URL.
   */
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  /** Every tag the saved rules can apply (`GET .../classification-rules` `tags`) - `null` until first loaded. Fetched lazily, never on startup. */
  const [classificationTags, setClassificationTags] = useState<string[] | null>(null);
  const [classificationTagsError, setClassificationTagsError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [timeRange, setTimeRange] = useState<CommittedTimeRange>(defaultTimeRange);
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilterValues>(emptyAdvancedFilterValues);
  /**
   * Guided/text/raw-LogQL query authoring (Legacy Remediation Slice 2) -
   * committed state only; `QueryBuilder` owns its own draft state and only
   * ever reaches this via `applyQuery` (Apply), the same draft/apply/cancel
   * shape `advancedFilters` already uses. Composes with every other
   * structured filter (ANDed server-side, `core.search.EventFilters`) -
   * never replaces them.
   */
  const [queryState, setQueryState] = useState<QueryAuthoringState>(emptyQueryAuthoringState);

  const [health, setHealth] = useState<SourceHealthDetail | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  const [searchResult, setSearchResult] = useState<SearchResponse | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  /**
   * Legacy Remediation Slice 1 - deliberately separate from `searchError`:
   * a failed "Load more" must never replace the results already on screen
   * with a full-page error state (the already-loaded events stay exactly
   * as they were), only offer an inline retry next to the button itself.
   */
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [lastSearchedRange, setLastSearchedRange] = useState<CommittedTimeRange | null>(null);

  /** The event inspector's selection (IMPLEMENTATION_PLAN.md "Phase H") - an index into `searchResult.events`, since events have no stable id (see `ResultsTable`'s own comment on why it keys by index). */
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  /**
   * UX-R4 §9 - the committed sort direction, sent to the backend as
   * `direction` on every search and every "Load more" alike. `BACKWARD`
   * (newest first) is both this UI's default and the backend's own
   * default (`SearchRequest`'s compact constructor), so the pre-UX-R4
   * request shape is unchanged when the investigator never touches the
   * control.
   *
   * <p><b>This is a real, source-side sort, never a client-side
   * reordering</b> (UX-R4 §9/§11 - the explicit "do not fake global
   * sorting in React" constraint). Every adapter honors it natively:
   * `LokiLogSource` passes `direction=forward|backward` to Loki's own
   * query-range API, `FixtureLogSource` and `DockerLogSource` sort/merge
   * in direction-of-travel order, and `PageCursorCodec` binds the
   * direction into the cursor's own request-binding fingerprint, so a
   * cursor issued for one direction can never be replayed against the
   * other. Verified end-to-end against the real backend before this
   * control was built - see the UX-R4 report's "Sorting architecture".
   */
  const [sortDirection, setSortDirectionState] = useState<SearchDirection>('BACKWARD');
  const focusRestoreRef = useRef<HTMLElement | null>(null);

  /** "Show ±30 seconds" breadcrumb (HANDOVER.md §16.7 "breadcrumb back to the original search"). */
  const [breadcrumbLabel, setBreadcrumbLabel] = useState<string | null>(null);
  const [originalSnapshot, setOriginalSnapshot] = useState<SearchSnapshot | null>(null);
  /**
   * UI Gap Closure Pass - the identity (`eventIdentity`) of the event a
   * "Show ±30 seconds" context view is centered on, so the resulting
   * (now chronologically-ascending) table can mark that row as "the
   * original event you were investigating" - independent of
   * `selectedIndex`/the inspector's own open state, which the context
   * fetch itself already closes (see `showContext`).
   */
  const [contextRootIdentity, setContextRootIdentity] = useState<string | null>(null);

  /**
   * UX-R6 §21 - supersession for **source-scoped discovery** (services,
   * Compose projects, health), the same protection `activeRequestRef`
   * already gives searches.
   *
   * <p>Without it these three `fetch(...).then(setState)` chains had no
   * ordering guarantee at all, so a slow response for the *previously*
   * selected source could land after a fast one for the newly-selected
   * source and overwrite it. That is not hypothetical: it is the root
   * cause of the long-unexplained "environment-specific" Phase-M Task 1
   * failure. Captured live from the real app - the default `local-docker`
   * services request is issued on load, the user selects `fixture`, the
   * fixture response arrives first with its four services, and then
   * Docker's response arrives last and replaces them, leaving the service
   * filter listing `caddy`/`db`/`web` while the selected source is
   * Fixture. It only reproduced on machines with a responsive Docker
   * daemon that actually has containers, which is why CI never saw it.
   *
   * <p>A monotonic generation counter rather than an `AbortController`:
   * these are plain idempotent GETs whose responses are cheap, and the
   * only thing that must be guaranteed is that a stale one never *wins*.
   * Every effect that starts source-scoped discovery bumps the counter and
   * captures the value; every `setState` it performs is gated on the
   * counter still matching.
   */
  const discoveryGenerationRef = useRef(0);

  /**
   * "Find this trace/correlation/journey/event" (IMPLEMENTATION_PLAN.md
   * "Phase I") - unlike "Show ±30 seconds", journey mode never mutates
   * `searchResult`/the toolbar's own filters at all; it is a pure overlay
   * state `App.tsx` renders `JourneyView` instead of `ResultsPanel` for.
   * "Preserves and restores the original search state" (HANDOVER.md
   * §17.5) therefore holds by construction - there is nothing to restore
   * because nothing was ever changed; `closeJourney` just clears this.
   */
  const [journeyQuery, setJourneyQuery] = useState<{ field: JourneyField; value: string } | null>(null);
  const [journeyResult, setJourneyResult] = useState<SearchResponse | null>(null);
  const [journeyLoading, setJourneyLoading] = useState(false);
  const [journeyError, setJourneyError] = useState<string | null>(null);
  /**
   * Owner mission "Mapping Verification and Investigation Workspace" -
   * "Root event anchoring": the exact event the investigator launched
   * this Trace/Span/Correlation/Journey view FROM, captured once at
   * launch time so the resulting (server-ordered) list can highlight it,
   * show its position ("Selected event: N of M"), and honestly report
   * when the backend result does not actually contain it (a bounded
   * window/guardrail limit excluded it) - never silently highlight a
   * different event instead.
   */
  const [journeyRootEvent, setJourneyRootEvent] = useState<LogEvent | null>(null);
  /**
   * Owner mission "Mapping Verification and Investigation Workspace" -
   * "Investigation navigation/continuity": when Show Surroundings is
   * launched from WITHIN a Trace/Span/Correlation/Journey view (not from
   * plain Search), this snapshot lets `restoreOriginalSearch` bring that
   * SAME view back on close ("Back to Trace"/"Back to Span"/...) instead
   * of dropping all the way back to plain search - the underlying plain
   * search state is still separately preserved in `originalSnapshot`
   * (Surroundings always operates through that shared mechanism), which
   * only gets restored to the visible screen once this snapshot is empty
   * again (a real "Back to search results").
   */
  const [journeySnapshotForSurroundings, setJourneySnapshotForSurroundings] = useState<{
    field: JourneyField;
    value: string;
    result: SearchResponse | null;
    rootEvent: LogEvent | null;
  } | null>(null);

  /**
   * "Cancelled" state (IMPLEMENTATION_PLAN.md "Phase G" scope item 11): a
   * new search must never be raced by a still-in-flight older one
   * overwriting its results. Tracks the one active request so starting a
   * new one aborts whatever came before it - there is no user-facing
   * Cancel control in this UI yet, so this is request-supersession
   * protection, not a separate visible state.
   */
  const activeRequestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSources()
      .then((list) => {
        if (cancelled) {
          return;
        }
        setSources(list);
        if (list.length > 0) {
          // Explicit selector policy, never API/registration order: keep a
          // still-valid selectable current source, otherwise the
          // highest-priority selectable one (Docker, then OpenShift, then
          // any other selectable source such as the dev-only Fixture).
          setSelectedSourceIdState((current) =>
            current !== null && isSourceSelectableInUi(current) && list.some((source) => source.id === current)
              ? current
              : firstSelectableSourceId(list));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSourcesLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Configurable Log Field Mapping mission §15 — the app-wide search
   * readiness gate. Loaded once on mount (mirroring how `sources` loads),
   * and re-fetched via `refreshFieldMappingProfile` any time the Log
   * Schema & Field Mapping settings panel edits/saves/resets the profile
   * elsewhere — the same "something changed in a settings panel, re-check
   * top-level state" callback shape `onOpenShiftScopeChanged` already
   * establishes for OpenShift scope. `Toolbar` disables Search using
   * `fieldMappingSearchReady === false`; `runSearch`'s own catch clause
   * below is a defensive fallback in case Search still somehow fires
   * while blocked (mission §15: "Do NOT fail silently with zero results").
   */
  const [fieldMappingProfile, setFieldMappingProfile] = useState<FieldMappingProfileDto | null>(null);
  const [fieldMappingProfileError, setFieldMappingProfileError] = useState<string | null>(null);

  /**
   * Owner mission "Mapping Verification and Investigation Workspace" -
   * Part A: the Mapping Verification workspace is now a real, dedicated
   * page (`FieldMappingWorkspace`), not a hidden popover - a mutually-
   * exclusive overlay in `App.tsx`'s main slot, following the exact same
   * pattern `journeyQuery`/`openJourney`/`closeJourney` already establish
   * for `JourneyView`. Deliberately a plain boolean (unlike `journeyQuery`)
   * - this workspace has no per-open query/result of its own to preserve.
   */
  const [mappingWorkspaceOpen, setMappingWorkspaceOpen] = useState(false);
  /** PR61_OWNER_NAVIGATION_RECOVERY_2 - see {@link WorkspaceOrigin}; decides where `closeMappingWorkspace` returns to. */
  const [mappingWorkspaceOrigin, setMappingWorkspaceOrigin] = useState<WorkspaceOrigin>('search');

  /**
   * Event Classification & Extraction Rules - a second takeover workspace,
   * mutually exclusive with the mapping workspace above (opening one closes
   * the other). `classificationWorkspaceEvent` is the event a "Create tag
   * rule from this event" action carried in; it lives only in React state,
   * never the URL or localStorage. `classificationWorkspaceKey` changes on
   * every open so the workspace remounts with a fresh draft each time.
   */
  const [classificationWorkspaceOpen, setClassificationWorkspaceOpen] = useState(false);
  const [classificationWorkspaceEvent, setClassificationWorkspaceEvent] = useState<LogEvent | null>(null);
  const [classificationWorkspaceKey, setClassificationWorkspaceKey] = useState(0);
  /**
   * Why the workspace was opened, so one action never means two things (owner mission §"Inspector action
   * semantics"): `createRule` authors a new rule from the event, `addExtraction` extends a rule that already
   * matched it. `null` is the plain Settings entry point.
   */
  const [classificationWorkspaceIntent, setClassificationWorkspaceIntent] =
    useState<ClassificationWorkspaceIntent>(null);
  /** PR61_OWNER_NAVIGATION_RECOVERY_2 - see {@link WorkspaceOrigin}; decides where `closeClassificationWorkspace` returns to. */
  const [classificationWorkspaceOrigin, setClassificationWorkspaceOrigin] = useState<WorkspaceOrigin>('settings');
  /**
   * Set only by the Inspector's own "Create tag rule"/"Add extraction" actions (which close the Inspector to
   * open this workspace - `openClassificationRuleFromEvent`/`openClassificationExtractionFromEvent` below), so
   * a search-origin close can reopen the Inspector on the same event rather than leaving the user on bare
   * Search results, which would silently lose where they were.
   */
  const [classificationReturnInspectorIndex, setClassificationReturnInspectorIndex] = useState<number | null>(null);

  /**
   * B2 (Session 4) - the consolidated Settings entry point (COMPONENT_INVENTORY.md's `app/Shell.tsx`
   * RECOMPOSE entry: "the three settings popover triggers become one Settings entry"). A third takeover,
   * mutually exclusive with the two above on the exact same basis - opening it closes the mapping/
   * classification workspaces, and each of those closes it in turn.
   */
  const [settingsWorkspaceOpen, setSettingsWorkspaceOpen] = useState(false);
  /** PR61_OWNER_NAVIGATION_RECOVERY_2 - which section `SettingsWorkspace` should render as active/in view on arrival; see {@link SettingsSectionId}. */
  const [settingsTargetSection, setSettingsTargetSection] = useState<SettingsSectionId>('sources');

  /**
   * PR61_OWNER_NAVIGATION_RECOVERY_2 - the single Settings entry point, now deterministic about which section
   * it lands on (owner-observed defect: every caller landed on the default "Sources" section regardless of
   * where the user actually asked to go - a plain click-based `SettingsNav` highlight inside `SettingsWorkspace`
   * itself is preserved for navigating BETWEEN sections once already there; this is only about the section
   * Settings first renders as active when it is (re)opened).
   */
  const openSettingsWorkspace = useCallback((targetSection: SettingsSectionId = 'sources') => {
    setMappingWorkspaceOpen(false);
    setClassificationWorkspaceOpen(false);
    setClassificationWorkspaceEvent(null);
    setClassificationWorkspaceIntent(null);
    setSettingsTargetSection(targetSection);
    setSettingsWorkspaceOpen(true);
  }, []);
  const closeSettingsWorkspace = useCallback(() => setSettingsWorkspaceOpen(false), []);

  /**
   * PR61_OWNER_NAVIGATION_RECOVERY_2 - `origin` defaults to `'settings'` because every caller except Shell's
   * own persistent header trigger reaches this through Settings/a sibling workspace's own `SettingsNav`
   * sidebar (both already "I am browsing Settings" contexts); Shell's header button is the one call site that
   * explicitly passes `'search'`.
   */
  const openMappingWorkspace = useCallback((origin: WorkspaceOrigin = 'settings') => {
    setClassificationWorkspaceOpen(false);
    setClassificationWorkspaceEvent(null);
    setClassificationWorkspaceIntent(null);
    setSettingsWorkspaceOpen(false);
    setMappingWorkspaceOrigin(origin);
    setMappingWorkspaceOpen(true);
  }, []);
  /** Returns to Settings (positioned back on the Field Mapping section) if that is where this was opened from; otherwise plain Search, untouched. */
  const closeMappingWorkspace = useCallback(() => {
    setMappingWorkspaceOpen(false);
    if (mappingWorkspaceOrigin === 'settings') {
      openSettingsWorkspace('mapping');
    }
  }, [mappingWorkspaceOrigin, openSettingsWorkspace]);

  /** Same `origin` default and reasoning as {@link openMappingWorkspace}. */
  const openClassificationWorkspace = useCallback((origin: WorkspaceOrigin = 'settings') => {
    setMappingWorkspaceOpen(false);
    setSettingsWorkspaceOpen(false);
    setClassificationWorkspaceEvent(null);
    setClassificationWorkspaceIntent(null);
    setClassificationWorkspaceOrigin(origin);
    setClassificationReturnInspectorIndex(null);
    setClassificationWorkspaceKey((k) => k + 1);
    setClassificationWorkspaceOpen(true);
  }, []);
  /**
   * Returns to Settings (positioned back on the Classification rules section) if that is where this was
   * opened from; a search-origin close instead reopens the Inspector on the same event when the workspace was
   * reached from there (`classificationReturnInspectorIndex`), or leaves plain Search alone otherwise - never
   * auto-runs Search, never touches any other Search state.
   */
  const closeClassificationWorkspace = useCallback(() => {
    setClassificationWorkspaceOpen(false);
    setClassificationWorkspaceEvent(null);
    setClassificationWorkspaceIntent(null);
    if (classificationWorkspaceOrigin === 'settings') {
      openSettingsWorkspace('classification');
      return;
    }
    if (classificationReturnInspectorIndex != null) {
      setSelectedIndex(classificationReturnInspectorIndex);
      setClassificationReturnInspectorIndex(null);
    }
  }, [classificationWorkspaceOrigin, classificationReturnInspectorIndex, openSettingsWorkspace]);

  const refreshClassificationTags = useCallback(() => {
    fetchClassificationRules()
      .then((result) => {
        setClassificationTags(result.tags);
        setClassificationTagsError(null);
      })
      .catch((error: unknown) =>
        setClassificationTagsError(error instanceof Error ? error.message : 'Failed to load classification tags'),
      );
  }, []);

  /**
   * Owner mission "Project-Scoped Schema Scan" §7/§8 — scoped to a real
   * source + selected project/namespace so the readiness gate reflects
   * THAT scope's own saved mapping, never a single global one.
   * `overrideProject`, when passed, wins over `selectedComposeProject`
   * (Docker's own request-scoped selection) — used by `App.tsx` to pass
   * the resolved OpenShift project instead, since this hook has no
   * knowledge of OpenShift scope itself (owned by `useOpenShiftScopeSummary`).
   */
  const refreshFieldMappingProfile = useCallback(
    (overrideProject?: string | null) => {
      if (!selectedSourceId) {
        setFieldMappingProfile(null);
        setFieldMappingProfileError(null);
        return;
      }
      const project = overrideProject !== undefined ? overrideProject : selectedComposeProject;
      fetchFieldMappingProfile(selectedSourceId, project)
        .then((result) => {
          setFieldMappingProfile(result);
          setFieldMappingProfileError(null);
        })
        .catch((error: unknown) =>
          setFieldMappingProfileError(error instanceof Error ? error.message : 'Failed to load log field mapping settings'),
        );
    },
    [selectedSourceId, selectedComposeProject],
  );

  useEffect(() => {
    refreshFieldMappingProfile();
  }, [refreshFieldMappingProfile]);

  const checkHealth = useCallback((sourceId: string) => {
    // Carries the caller's generation so a health response (which includes
    // the source's own declared capabilities) can never be painted under a
    // different source's name - see `discoveryGenerationRef`.
    const generation = discoveryGenerationRef.current;
    const isCurrent = () => discoveryGenerationRef.current === generation;
    setHealthLoading(true);
    fetchSourceHealth(sourceId)
      .then((result) => {
        if (isCurrent()) {
          setHealth(result);
        }
      })
      .catch(() => {
        if (isCurrent()) {
          setHealth({
            status: 'DOWN',
            message: 'Unable to reach the health endpoint',
            checkedAt: new Date().toISOString(),
            warnings: [],
            latencyMs: null,
            capabilities: null,
          });
        }
      })
      .finally(() => {
        if (isCurrent()) {
          setHealthLoading(false);
        }
      });
  }, []);

  useEffect(() => {
    if (!selectedSourceId) {
      return;
    }
    const source = sources.find((s) => s.id === selectedSourceId);
    setSelectedServices([]);
    // UX-R3 §7 - a new source is an entirely new scope; whatever Compose
    // project was selected for the *previous* source can never carry over
    // (its own project-switch effect below handles clearing stale results/
    // requests - this just makes sure that effect actually fires by
    // changing the value, even the common case of switching from one
    // Docker-like source to a different one where a same-named project
    // might otherwise look unchanged).
    setSelectedComposeProject(null);
    setComposeProjects([]);
    setComposeProjectsError(null);
    // "Raw LogQL... must never be silently translated into normal DSL;
    // never be accepted by an unsupported source" (Legacy Remediation
    // Slice 2) - if the newly-selected source doesn't support it, the
    // committed query mode is defensively switched back to guided rather
    // than leaving a mode selected the toolbar can no longer even show a
    // control for. The typed raw-LogQL text itself is preserved (never
    // silently discarded), only the *active* mode changes - switching back
    // to a capable source, or the user reopening Query, still finds it.
    if (source && !source.capabilities.rawLogQL) {
      setQueryState((prev) => (prev.mode === 'rawLogQl' ? { ...prev, mode: 'guided' } : prev));
    }
    // UX-R6 §21 - everything below is source-scoped discovery, so it all
    // belongs to one generation. Bumping here also invalidates whatever
    // the *previous* source still has in flight.
    const generation = ++discoveryGenerationRef.current;
    const isCurrent = () => discoveryGenerationRef.current === generation;
    if (source?.capabilities.serviceDiscovery) {
      fetchSourceServices(selectedSourceId)
        .then((result) => {
          if (isCurrent()) {
            setServices(result);
          }
        })
        .catch(() => {
          if (isCurrent()) {
            setServices([]);
          }
        });
    } else {
      setServices([]);
    }
    if (source?.capabilities.composeProjectScoping) {
      setComposeProjectsLoading(true);
      fetchComposeProjects(selectedSourceId)
        .then((result) => {
          if (isCurrent()) {
            setComposeProjects(result);
          }
        })
        .catch((error: unknown) => {
          if (isCurrent()) {
            setComposeProjectsError(error instanceof Error ? error.message : 'Failed to discover Compose projects');
          }
        })
        .finally(() => {
          if (isCurrent()) {
            setComposeProjectsLoading(false);
          }
        });
    }
    checkHealth(selectedSourceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSourceId]);

  /**
   * SOURCE_EXPERIENCE_PARITY_TARGETED_RECOVERY_1 - the source/scope-agnostic half of the "never show scope
   * A's results under scope B's header" invariant UX-R3 §11 first established for Docker's own Compose
   * project switch (below). Extracted so OpenShift's own scope mutations (Project/Workload/Pod/Container, all
   * now selected from Search - see `OpenShiftScopeSelect.tsx`) can reuse the identical reset instead of a
   * second, driftable copy. Deliberately does NOT touch `selectedServices`/service (re)discovery - that half
   * is Docker-specific and stays in the effect below, which calls this function for its own scope-agnostic
   * reset and then does its own Docker-specific work.
   */
  const invalidateSearchForScopeChange = useCallback(() => {
    activeRequestRef.current?.abort(); // stale in-flight A request must never resolve into B's view
    setSearchResult(null);
    setSearchError(null);
    setLoadMoreError(null);
    setLastSearchedRange(null);
    setSelectedIndex(null);
    setBreadcrumbLabel(null);
    setOriginalSnapshot(null);
    setContextRootIdentity(null);
    setJourneyQuery(null);
    setJourneyResult(null);
    setJourneyError(null);
  }, []);

  /**
   * UX-R3 §11 (project-switch lifecycle) - fires whenever the selected
   * Compose project itself changes (including "unselected" -> a real
   * project, and switching directly between two real projects). Mirrors
   * `runSearch`'s own "fresh search" resets, but deliberately does NOT
   * fire a new search - matching this app's consistent "explicit search"
   * behavior everywhere else. Unlike a plain source switch (which leaves
   * stale results on screen until the next explicit Search, unchanged
   * prior behavior), a Compose project switch clears the result set
   * immediately: the mission's own explicit requirement is "never show
   * Project A rows under a Project B scope header," and the scope header
   * itself (the toolbar's own active-scope indicator) changes the instant
   * this state changes, so the two must never be allowed to disagree even
   * for one render.
   */
  useEffect(() => {
    if (!selectedSourceId) {
      return;
    }
    const source = sources.find((s) => s.id === selectedSourceId);
    if (!source?.capabilities.composeProjectScoping) {
      return; // this source has no project concept - nothing to switch
    }
    invalidateSearchForScopeChange();
    setSelectedServices([]); // B's own service set is about to be (re)discovered - A's selections cannot carry over
    if (source.capabilities.serviceDiscovery) {
      // Same generation guard as the source-change effect: switching
      // project A -> B must not let A's slower service list land under B.
      const generation = ++discoveryGenerationRef.current;
      const isCurrent = () => discoveryGenerationRef.current === generation;
      fetchSourceServices(selectedSourceId, selectedComposeProject ?? undefined)
        .then((result) => {
          if (isCurrent()) {
            setServices(result);
          }
        })
        .catch(() => {
          if (isCurrent()) {
            setServices([]);
          }
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedComposeProject]);

  const applyDetectedField = useCallback((field: DetectableIdField, value: string) => {
    setAdvancedFilters((prev) => ({ ...prev, [field]: value }));
  }, []);

  const applyAdvancedFilters = useCallback((next: AdvancedFilterValues) => {
    setSearchText(next.text);
    setAdvancedFilters({ ...next, text: '' });
  }, []);

  const applyQuery = useCallback((next: QueryAuthoringState) => {
    setQueryState(next);
  }, []);

  /**
   * "Clear all" (UX-R1 §4): clears investigation *criteria* only - search
   * text, selected services, severity, every advanced filter, the query,
   * and the time range (back to a fresh default) - and deliberately never
   * touches `selectedSourceId` or anything else considered environment/
   * source scope, not a disposable filter (CLAUDE.md-aligned "define
   * source/project as SCOPE, not disposable filters"). Table preferences
   * and Settings live entirely outside this hook, so there is nothing here
   * that could touch them either way.
   */
  const clearAllFilters = useCallback(() => {
    setSearchText('');
    setSelectedServices([]);
    setServiceFilterMode('INCLUDE');
    setSelectedLevels(DEFAULT_SEVERITY_LEVELS);
    setSelectedTags([]);
    setAdvancedFilters(emptyAdvancedFilterValues());
    setQueryState(emptyQueryAuthoringState());
    setTimeRange(defaultTimeRange());
  }, []);

  const buildRequestBody = useCallback(
    (
      cursor?: string,
      timeRangeOverride?: CommittedTimeRange,
      directionOverride?: SearchDirection,
    ): SearchRequestBody | null => {
      if (!selectedSourceId) {
        return null;
      }
      const effectiveTimeRange = timeRangeOverride ?? timeRange;
      return {
        sourceId: selectedSourceId,
        direction: directionOverride ?? sortDirection,
        start: effectiveTimeRange.start,
        end: effectiveTimeRange.end,
        // PR65_FRESH_SEARCH_CUSTOM_TIME_AND_BATCH_RECOVERY (defect 3) - sent
        // explicitly on every fresh Search AND every Load More (this same
        // function builds both), so "the default requested page size is
        // 500" is a real request-body property, not just a backend
        // default this UI happens to inherit - see pageSize.ts.
        limit: DEFAULT_PAGE_SIZE,
        services: selectedServices,
        serviceFilterMode,
        // Every level selected == no restriction: omit the filter entirely so the backend's own
        // "empty levels" path applies (EventFilters.matchesExceptTags), which never excludes an event
        // with a missing or unrecognized severity. Sending the full id list explicitly would instead
        // filter to exactly those known ids, silently dropping e.g. a genuine but unlisted "FATAL" event.
        levels: isAllLevelsSelected(selectedLevels) ? undefined : selectedLevels,
        text: searchText || undefined,
        traceId: advancedFilters.traceId || undefined,
        spanId: advancedFilters.spanId || undefined,
        correlationId: advancedFilters.correlationId || undefined,
        journeyId: advancedFilters.journeyId || undefined,
        eventId: advancedFilters.eventId || undefined,
        errorCode: advancedFilters.errorCode || undefined,
        businessStep: advancedFilters.businessStep || undefined,
        uiIdentifier: advancedFilters.uiIdentifier || undefined,
        loggerContains: advancedFilters.loggerContains || undefined,
        devicePlatform: advancedFilters.devicePlatform || undefined,
        language: advancedFilters.language || undefined,
        userName: advancedFilters.userName || undefined,
        customerId: advancedFilters.customerId || undefined,
        cif: advancedFilters.cif || undefined,
        deviceId: advancedFilters.deviceId || undefined,
        deviceIp: advancedFilters.deviceIp || undefined,
        query: resolveQueryText(queryState),
        rawLogQl: resolveRawLogQl(queryState),
        cursor,
        composeProject: selectedComposeProject ?? undefined,
        tags: selectedTags.length > 0 ? selectedTags : undefined,
      };
    },
    [selectedSourceId, timeRange, sortDirection, selectedServices, serviceFilterMode, selectedLevels, selectedTags, searchText, advancedFilters, queryState, selectedComposeProject],
  );

  /**
   * The bounded sample scope a classification detect/test call reads.
   *
   * It is the *committed search* itself - built from the very same
   * `buildRequestBody` the results table was filled by, so free text, the
   * query DSL / raw LogQL, every advanced and identifier filter, services and
   * their include/exclude mode, severities, the Compose project and the time
   * range (resolved exactly as a fresh Search would resolve it: relative
   * presets end "now", a custom range stays as typed) all apply. Before this
   * it carried only source/project/window/services/levels, so a search
   * narrowed by text sampled mostly unrelated events and Detect/Test reported
   * almost no matches for a screen visibly full of them.
   *
   * Three things are deliberately not carried: `direction`, `limit`/`cursor`
   * (a sample is one bounded newest-first page of its own size) and `tags` -
   * see `ClassificationSampleScope`. `anchorTimestamp` is the selected
   * event's own timestamp, so the server can guarantee it takes part.
   * Commits nothing.
   */
  const buildClassificationSampleScope = useCallback(
    (anchor?: LogEvent | null): ClassificationSampleScope | null => {
      const body = buildRequestBody(undefined, recomputeRelativeRange(timeRange));
      if (!body) {
        return null;
      }
      const { direction: _direction, cursor: _cursor, tags: _tags, ...scope } = body;
      return { ...scope, anchorTimestamp: anchor?.timestamp ?? null };
    },
    [buildRequestBody, timeRange],
  );

  /** Aborts whatever request is currently in flight, so its result can never race a newer one. */
  function supersedeActiveRequest(): AbortController {
    activeRequestRef.current?.abort();
    const controller = new AbortController();
    activeRequestRef.current = controller;
    return controller;
  }

  /**
   * `timeRangeOverride` (bug fix, found while verifying UX-R1's own E2E
   * regression suite): "Search last 1 day" (`ResultsPanel.tsx`'s zero-
   * results recovery affordance, CLAUDE.md §4 - "zero results offers
   * one-click 'Search last 1 day'") used to call `setTimeRange` alone,
   * never re-running the search - "one-click" only ever adjusted the
   * committed range, silently leaving the stale (still-empty) result set
   * on screen. Calling `setTimeRange` then `runSearch()` back-to-back in
   * the same handler does not fix this on its own: React state updates
   * are not synchronous, so `runSearch`'s own `buildRequestBody` closure
   * would still read the *previous* `timeRange` value at call time. This
   * override lets a caller supply the new range directly, in the same
   * tick it commits it, so the search that fires actually reflects it.
   *
   * Absent an override, a plain Search/Refresh click (UX-R2 - the search-
   * freshness defect, `recomputeRelativeRange`'s own doc comment above)
   * recomputes a fresh window for a relative preset before searching, and
   * commits that recomputed window back as the new `timeRange` - "what the
   * UI says is active = what the request actually submitted" (the same
   * invariant UX-R1's own chip-state work established) - so a repeated
   * Search after a custom range is a true no-op (`recomputeRelativeRange`
   * returns the same reference), never triggering an extra render.
   */
  const runSearch = useCallback((timeRangeOverride?: CommittedTimeRange, directionOverride?: SearchDirection) => {
    const effectiveTimeRange = timeRangeOverride ?? recomputeRelativeRange(timeRange);
    const body = buildRequestBody(undefined, effectiveTimeRange, directionOverride);
    if (!body) {
      return; // no source selected yet - nothing committed, nothing searched, same as before
    }
    if (!timeRangeOverride) {
      setTimeRange(effectiveTimeRange);
    }
    const controller = supersedeActiveRequest();
    setSearchLoading(true);
    setSearchError(null);
    setLoadMoreError(null); // a fresh search always starts back at page 1
    // A genuinely new, user-initiated search invalidates the inspector's
    // selection (row indices belong to the list about to be replaced),
    // any "back to original search" breadcrumb (this new search IS the
    // current state now, not a detour from something to return to), and
    // journey mode (a fresh search means the investigator is no longer
    // looking at the journey timeline).
    setSelectedIndex(null);
    setBreadcrumbLabel(null);
    setOriginalSnapshot(null);
    setContextRootIdentity(null);
    setJourneyQuery(null);
    setJourneyResult(null);
    setJourneyError(null);
    const searchedRange = effectiveTimeRange;
    runSearchApi(body, controller.signal)
      .then((result) => {
        setSearchResult(result);
        setLastSearchedRange(searchedRange);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return; // superseded by a newer search - the newer request owns the UI now
        }
        if (isMappingNotReadyError(error)) {
          // Defense-in-depth (mission §15): Search fired despite the
          // Toolbar gate (e.g. a stale readiness snapshot) - re-sync
          // immediately so the button reflects reality on the very next
          // render, rather than staying (wrongly) enabled.
          refreshFieldMappingProfile();
        }
        setSearchError(error instanceof Error ? error.message : 'Search failed');
      })
      .finally(() => {
        if (activeRequestRef.current === controller) {
          setSearchLoading(false);
        }
      });
  }, [buildRequestBody, timeRange, refreshFieldMappingProfile]);

  /**
   * UX-R4 §10 - committing a new sort direction always starts a **fresh
   * result set**, never appends to or re-orders the one on screen: the
   * direction is passed to `runSearch` as an override (same
   * already-established reason `timeRangeOverride` exists - React state
   * updates are not synchronous, so `buildRequestBody`'s closure would
   * otherwise still read the previous direction in this same tick), and
   * `runSearch` itself drops the cursor, resets to page 1 and clears the
   * inspector selection. That is what makes "switch Newest -> Oldest"
   * safe: the previous direction's cursor is never carried across, so
   * the two directions' pages can never be interleaved into one
   * contradictory list.
   *
   * <p>Selecting the direction already committed is a deliberate no-op -
   * it never re-issues a request or discards the current results.
   */
  const setSortDirection = useCallback(
    (next: SearchDirection) => {
      if (next === sortDirection) {
        return;
      }
      setSortDirectionState(next);
      runSearch(undefined, next);
    },
    [sortDirection, runSearch],
  );

  /**
   * "One pagination model (bounded cursor)" (scope item 9) - appends the
   * next page's events to what's already shown, using the exact opaque
   * cursor the backend returned (Legacy Remediation Slice 1 wires a real,
   * integrity-protected cursor server-side; this hook's own contract with
   * it is unchanged from Phase G). Appended events are deduped defensively
   * against everything already on screen (`eventIdentity`) - belt-and-
   * suspenders on top of the backend's own boundary-safe pagination, never
   * trusting a single line of defense. A page-load failure never touches
   * `searchResult` (already-loaded events stay visible) and is reported
   * through `loadMoreError`, not `searchError` - see that state's own
   * comment.
   */
  const loadMore = useCallback(() => {
    const cursor = searchResult?.nextCursor;
    if (!cursor) {
      return;
    }
    const body = buildRequestBody(cursor);
    if (!body) {
      return;
    }
    const controller = supersedeActiveRequest();
    setLoadingMore(true);
    setLoadMoreError(null);
    // Captured once per call, not read inside the `.then` - a fresh
    // `loadMore` closure is created whenever `breadcrumbLabel` changes
    // (it's a dependency below), so this always reflects whether the page
    // being appended still belongs to a context view.
    const isContextView = breadcrumbLabel !== null;
    runSearchApi(body, controller.signal)
      .then((result) => {
        setSearchResult((prev) => {
          if (!prev) {
            return result;
          }
          const seen = new Set(prev.events.map(eventIdentity));
          const newEvents = result.events.filter((e) => !seen.has(eventIdentity(e)));
          const combined = [...prev.events, ...newEvents];
          // "Context ordering" (UI Gap Closure Pass): re-sort the whole
          // (still-bounded - a ±30s context window) accumulated set
          // ascending again after every append, rather than assuming
          // append order already matches - the general search endpoint's
          // own page order is otherwise unspecified relative to a
          // chronological-ascending presentation. Historical (non-context)
          // results are entirely unaffected - they keep the exact append
          // order they always had.
          return {
            events: isContextView ? sortByTimestampAscending(combined) : combined,
            counts: result.counts,
            nextCursor: result.nextCursor,
            queryPlan: result.queryPlan,
          };
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        setLoadMoreError(error instanceof Error ? error.message : 'Loading more results failed');
      })
      .finally(() => {
        if (activeRequestRef.current === controller) {
          setLoadingMore(false);
        }
      });
  }, [buildRequestBody, searchResult, breadcrumbLabel]);

  const events = searchResult?.events ?? [];
  const selectedEvent: LogEvent | null = selectedIndex != null ? (events[selectedIndex] ?? null) : null;
  const hasPreviousEvent = selectedIndex != null && selectedIndex > 0;
  const hasNextEvent = selectedIndex != null && selectedIndex < events.length - 1;

  /** Opens the inspector on `index`, remembering whatever had keyboard focus so `closeInspector` can restore it (WCAG 2.2 AA logical focus restoration, CLAUDE.md §7). */
  const openInspector = useCallback((index: number) => {
    focusRestoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelectedIndex(index);
  }, []);

  const closeInspector = useCallback(() => {
    setSelectedIndex(null);
    focusRestoreRef.current?.focus();
    focusRestoreRef.current = null;
  }, []);

  /**
   * "Create tag rule from this event" - closes the inspector and opens the classification workspace in
   * create-from-event mode. PR61_OWNER_NAVIGATION_RECOVERY_2 - remembers which event's Inspector was open
   * (`classificationReturnInspectorIndex`) and marks the origin `'search'`, so `closeClassificationWorkspace`
   * can truthfully reopen the Inspector on the same event on the way back, instead of stranding the user on
   * bare Search results.
   */
  const openClassificationRuleFromEvent = useCallback((event: LogEvent) => {
    setClassificationReturnInspectorIndex(selectedIndex);
    setSelectedIndex(null);
    focusRestoreRef.current = null;
    setMappingWorkspaceOpen(false);
    setSettingsWorkspaceOpen(false);
    setClassificationWorkspaceEvent(event);
    setClassificationWorkspaceIntent('createRule');
    setClassificationWorkspaceOrigin('search');
    setClassificationWorkspaceKey((k) => k + 1);
    setClassificationWorkspaceOpen(true);
  }, [selectedIndex]);

  /**
   * "Add extraction from this event" - the event is already classified, so this extends one of the rules that
   * matched it rather than authoring a new one. The workspace asks which rule when more than one matched, and
   * never mutates a rule without an explicit Save. Same origin/return-index handling as
   * {@link openClassificationRuleFromEvent}.
   */
  const openClassificationExtractionFromEvent = useCallback((event: LogEvent) => {
    setClassificationReturnInspectorIndex(selectedIndex);
    setSelectedIndex(null);
    focusRestoreRef.current = null;
    setMappingWorkspaceOpen(false);
    setSettingsWorkspaceOpen(false);
    setClassificationWorkspaceEvent(event);
    setClassificationWorkspaceIntent('addExtraction');
    setClassificationWorkspaceOrigin('search');
    setClassificationWorkspaceKey((k) => k + 1);
    setClassificationWorkspaceOpen(true);
  }, [selectedIndex]);

  const selectPreviousEvent = useCallback(() => {
    setSelectedIndex((prev) => (prev != null && prev > 0 ? prev - 1 : prev));
  }, []);

  const selectNextEvent = useCallback(() => {
    setSelectedIndex((prev) => (prev != null && prev < events.length - 1 ? prev + 1 : prev));
  }, [events.length]);

  const snapshotCurrent = useCallback(
    (): SearchSnapshot => ({
      selectedServices,
      serviceFilterMode,
      sortDirection,
      selectedIndex,
      selectedLevels,
      selectedTags,
      searchText,
      advancedFilters,
      queryState,
      timeRange,
      searchResult,
      lastSearchedRange,
    }),
    [selectedServices, serviceFilterMode, sortDirection, selectedIndex, selectedLevels, selectedTags, searchText, advancedFilters, queryState, timeRange, searchResult, lastSearchedRange],
  );

  /** "Preserves and restores the original search state" (HANDOVER.md §17.5, applied here to both Phase H detour actions) - only the true original is ever kept, never a chain of detours. */
  const snapshotOriginalIfAbsent = useCallback(() => {
    setOriginalSnapshot((prev) => prev ?? snapshotCurrent());
  }, [snapshotCurrent]);

  /**
   * Owner mission "Mapping Verification and Investigation Workspace" -
   * "Investigation navigation/continuity": the single Back action used by
   * both plain Show-Surroundings ("Back to original search") and
   * Show-Surroundings-launched-from-a-journey-view ("Back to Trace" / "Back
   * to Span" / "Back to Correlation" / "Back to Journey"). The underlying
   * plain-search workstation state is ALWAYS restored first from {@link
   * originalSnapshot} exactly as before - Surroundings never touched it
   * either way. What differs is what happens on top of that: if a journey
   * view was open when Surroundings was launched (`journeySnapshotForSurroundings`
   * set by `showContext`), that view is restored too and `originalSnapshot`
   * is deliberately KEPT (not cleared) so a later, genuine "Back to
   * original search" from within that restored journey view still works -
   * only `closeJourney` (the one true exit back to plain search) clears it.
   */
  const restoreOriginalSearch = useCallback(() => {
    const snapshot = originalSnapshot;
    if (!snapshot) {
      return;
    }
    setSelectedServices(snapshot.selectedServices);
    setServiceFilterMode(snapshot.serviceFilterMode);
    setSelectedLevels(snapshot.selectedLevels);
    setSelectedTags(snapshot.selectedTags);
    setSearchText(snapshot.searchText);
    setAdvancedFilters(snapshot.advancedFilters);
    setQueryState(snapshot.queryState);
    setTimeRange(snapshot.timeRange);
    setSearchResult(snapshot.searchResult);
    setLastSearchedRange(snapshot.lastSearchedRange);
    // UX-R4 §20 - returning from a detour restores the *whole* workstation
    // state the investigator left, not just the result rows: the committed
    // sort direction comes back with them (a context view is always
    // ascending regardless of it, so without this the investigator would
    // silently land back on newest-first after returning from a detour
    // they entered while reading oldest-first), and so does the row they
    // were inspecting. `snapshot.searchResult` is the very same array
    // instance that was on screen, so the saved index still addresses the
    // same event - but it is re-validated against that array's length
    // rather than trusted blindly.
    setSortDirectionState(snapshot.sortDirection);
    const restoredEvents = snapshot.searchResult?.events ?? [];
    const restorableIndex =
      snapshot.selectedIndex != null && snapshot.selectedIndex < restoredEvents.length
        ? snapshot.selectedIndex
        : null;
    setBreadcrumbLabel(null);
    setContextRootIdentity(null);

    if (journeySnapshotForSurroundings) {
      setJourneyQuery({ field: journeySnapshotForSurroundings.field, value: journeySnapshotForSurroundings.value });
      setJourneyResult(journeySnapshotForSurroundings.result);
      setJourneyError(null);
      setJourneyRootEvent(journeySnapshotForSurroundings.rootEvent);
      setJourneySnapshotForSurroundings(null);
      setSelectedIndex(null);
      // `originalSnapshot` is intentionally left set here - the restored
      // journey view still needs it for its own future "back to original
      // search" (`closeJourney` clears it when that finally happens).
      return;
    }

    setOriginalSnapshot(null);
    setSelectedIndex(restorableIndex);
  }, [originalSnapshot, journeySnapshotForSurroundings]);

  /**
   * "Find this trace / correlation / journey / event" (IMPLEMENTATION_PLAN.md
   * "Phase I" scope item 1, HANDOVER.md §17) - fetches the dedicated
   * `/journey` endpoint (never `/search`), which enforces ascending order
   * server-side and never widens the caller's own currently-committed
   * time range ("bounded time window"). Closes the inspector first so the
   * two panels never overlap. "Handles missing identifier ... cleanly":
   * guarded here too, though every real caller already only ever passes a
   * concrete, non-empty value it read off a rendered event.
   */
  const openJourney = useCallback(
    (field: JourneyField, value: string, rootEvent?: LogEvent) => {
      if (!selectedSourceId || !value) {
        return;
      }
      closeInspector();
      setJourneyQuery({ field, value });
      setJourneyResult(null);
      setJourneyError(null);
      setJourneyRootEvent(rootEvent ?? null);

      const controller = supersedeActiveRequest();
      setJourneyLoading(true);
      fetchJourney(
        {
          sourceId: selectedSourceId,
          start: timeRange.start,
          end: timeRange.end,
          field,
          value,
          composeProject: selectedComposeProject ?? undefined,
        },
        controller.signal,
      )
        .then((result) => setJourneyResult(result))
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') {
            return;
          }
          setJourneyError(error instanceof Error ? error.message : 'Journey search failed');
        })
        .finally(() => {
          if (activeRequestRef.current === controller) {
            setJourneyLoading(false);
          }
        });
    },
    [selectedSourceId, timeRange, closeInspector, selectedComposeProject],
  );

  /**
   * "Preserves and restores the original search state": closing journey
   * mode never had anything to restore - `searchResult`/the toolbar's
   * filters were never touched while it was open. Also clears any
   * lingering Surroundings-detour snapshots (owner mission "Mapping
   * Verification and Investigation Workspace"): this is the one true
   * "Back to Search" exit point from any Trace/Span/Correlation/Journey
   * view, so any in-progress "return to this view after Surroundings"
   * state is no longer meaningful once the investigator leaves the view
   * entirely - `restoreOriginalSearch` already restored the true original
   * `searchResult`/toolbar state onto the screen before this can ever be
   * reached with a non-null snapshot still pending.
   */
  const closeJourney = useCallback(() => {
    setJourneyQuery(null);
    setJourneyResult(null);
    setJourneyError(null);
    setJourneyRootEvent(null);
    setJourneySnapshotForSurroundings(null);
    setOriginalSnapshot(null);
  }, []);

  /**
   * "Show ±30 seconds" (HANDOVER.md §16.7): calls the dedicated `/context`
   * endpoint (never `/search`) so container/pod scoping - which the
   * general search has no UI filter for - can still be honored server-side.
   * Reflects the resulting service/time-range in the toolbar so it never
   * shows filters that don't match what's actually displayed.
   */
  const showContext = useCallback(
    (event: LogEvent) => {
      if (!selectedSourceId || !event.timestamp) {
        return;
      }
      snapshotOriginalIfAbsent();
      // Owner mission "Mapping Verification and Investigation Workspace" -
      // "Investigation navigation/continuity": Show Surroundings launched
      // from WITHIN a Trace/Span/Correlation/Journey view must return to
      // THAT view on close, not drop all the way back to plain search.
      // Snapshotting here (rather than requiring every caller to say
      // where it was invoked from) means every existing and future
      // Show-Surroundings entry point gets this for free just by reusing
      // this one function - never a second, parallel implementation.
      if (journeyQuery) {
        setJourneySnapshotForSurroundings({
          field: journeyQuery.field,
          value: journeyQuery.value,
          result: journeyResult,
          rootEvent: journeyRootEvent,
        });
        setJourneyQuery(null);
        setJourneyResult(null);
        setJourneyError(null);
      }
      closeInspector();
      const windowMs = 30_000;
      const centerMs = new Date(event.timestamp).getTime();
      const nextTimeRange: CommittedTimeRange = {
        presetId: CUSTOM_RANGE_ID,
        start: new Date(centerMs - windowMs).toISOString(),
        end: new Date(centerMs + windowMs).toISOString(),
      };
      const nextServices = event.service ? [event.service] : [];
      setSelectedServices(nextServices);
      setTimeRange(nextTimeRange);
      setBreadcrumbLabel(`Context — ±30s around ${formatUtcTimestamp(event.timestamp)}`);
      // Captured before the fetch, from the exact event the investigator
      // clicked - so the resulting (re-ordered) context table can mark
      // this same row, even though its position in the array is about to
      // change (see the render below and ResultsTable's own
      // `contextRootIdentity` prop).
      setContextRootIdentity(eventIdentity(event));

      const controller = supersedeActiveRequest();
      setSearchLoading(true);
      setSearchError(null);
      fetchContext(
        {
          sourceId: selectedSourceId,
          timestamp: event.timestamp,
          service: event.service ?? undefined,
          containerId: event.containerId ?? undefined,
          pod: event.pod ?? undefined,
          composeProject: selectedComposeProject ?? undefined,
          // OS-1D — every OpenShift event carries its own container name;
          // a source with no such concept (Docker, Loki) simply never sets
          // it, so this is a no-op for them.
          containerName: event.containerName ?? undefined,
          // OS-1D review recovery — echoed back verbatim; the backend
          // requires it only when this target has since left its cached
          // scope (see ContextRequestBody#contextTargetProof).
          contextTargetProof: event.contextTargetProof ?? undefined,
        },
        controller.signal,
      )
        .then((result) => {
          // "Context ordering" (UI Gap Closure Pass): chronological
          // ascending for a bounded ±30s window - what happened before,
          // the event itself, what happened after - rather than the main
          // table's own newest-first convention (CLAUDE.md §4's fixed-
          // order invariant governs the historical results table only;
          // this is a deliberately distinct, dedicated view, matching the
          // journey timeline's own precedent for ascending order).
          setSearchResult({ ...result, events: sortByTimestampAscending(result.events) });
          setLastSearchedRange(nextTimeRange);
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') {
            return;
          }
          setSearchError(error instanceof Error ? error.message : 'Context search failed');
        })
        .finally(() => {
          if (activeRequestRef.current === controller) {
            setSearchLoading(false);
          }
        });
    },
    [selectedSourceId, snapshotOriginalIfAbsent, closeInspector, selectedComposeProject, journeyQuery, journeyResult, journeyRootEvent],
  );

  const selectedSource = sources.find((s) => s.id === selectedSourceId) ?? null;

  /**
   * Owner mission "Mapping Verification and Investigation Workspace" -
   * "Investigation navigation/continuity": the Back button's label must
   * say where it's actually going ("Back to Trace") rather than always
   * claiming "Back to original search" when Surroundings was really
   * launched from within a Trace/Span/Correlation/Journey view.
   */
  const restoreOriginalSearchLabel = journeySnapshotForSurroundings
    ? `Back to ${JOURNEY_FIELD_LABELS[journeySnapshotForSurroundings.field]}`
    : 'Back to original search';

  return {
    sources,
    sourcesLoading,
    selectedSource,
    selectedSourceId,
    setSelectedSourceId,
    services,
    selectedServices,
    setSelectedServices,
    serviceFilterMode,
    setServiceFilterMode,
    selectedComposeProject,
    setSelectedComposeProject,
    composeProjects,
    composeProjectsLoading,
    composeProjectsError,
    selectedLevels,
    setSelectedLevels,
    /** Event Classification & Extraction Rules - committed tag filter (session only). */
    selectedTags,
    setSelectedTags,
    classificationTags,
    classificationTagsError,
    refreshClassificationTags,
    buildClassificationSampleScope,
    searchText,
    setSearchText,
    timeRange,
    setTimeRange,
    /** UX-R4 §9/§12 - the committed, source-side sort direction and its single commit path. */
    sortDirection,
    setSortDirection,
    advancedFilters,
    applyAdvancedFilters,
    queryState,
    applyQuery,
    applyDetectedField,
    clearAllFilters,
    health,
    healthLoading,
    retryHealth: () => selectedSourceId && checkHealth(selectedSourceId),
    /**
     * SOURCE_EXPERIENCE_PARITY_TARGETED_RECOVERY_1 - the same reset Docker's own Compose-project switch
     * already performs (search/investigation state only, never services - that half is source-specific).
     * `App.tsx` calls this after a successful OpenShift Project/Workload/Pod/Container mutation, so a result
     * set can never remain presented as belonging to a scope that did not produce it. Never triggers a new
     * search itself - the user runs Search again explicitly, exactly like every other scope change in this
     * app.
     */
    invalidateSearchForScopeChange,
    searchResult,
    searchLoading,
    loadingMore,
    searchError,
    loadMoreError,
    lastSearchedRange,
    runSearch,
    /**
     * "Refresh" (Legacy Remediation Slice 1) - re-runs the exact committed
     * search from page 1: same source/filters/time interval, cancels any
     * in-flight request, and never touches un-applied draft filter state -
     * `runSearch` already does precisely this (it never carries a cursor
     * forward), so Refresh is not a separate code path, only a second
     * name for the same one, kept distinct here for callers/tests that
     * want to express "re-run" intent explicitly rather than "run".
     */
    refresh: runSearch,
    loadMore,
    selectedIndex,
    selectedEvent,
    hasPreviousEvent,
    hasNextEvent,
    openInspector,
    closeInspector,
    selectPreviousEvent,
    selectNextEvent,
    breadcrumbLabel,
    contextRootIdentity,
    restoreOriginalSearch,
    restoreOriginalSearchLabel,
    showContext,
    journeyQuery,
    journeyResult,
    journeyLoading,
    journeyError,
    journeyRootEvent,
    openJourney,
    closeJourney,
    /** Configurable Log Field Mapping mission §15 — `null` while still loading on first mount; once loaded, `Toolbar` disables Search when `.searchReady` is `false`. */
    fieldMappingProfile,
    fieldMappingProfileError,
    /** `true` only once loaded and ready — a still-loading/unknown state never silently permits Search (mission §15: "Do NOT fail silently"). */
    fieldMappingSearchReady: fieldMappingProfile?.searchReady === true,
    refreshFieldMappingProfile,
    mappingWorkspaceOpen,
    mappingWorkspaceOrigin,
    openMappingWorkspace,
    closeMappingWorkspace,
    settingsWorkspaceOpen,
    settingsTargetSection,
    openSettingsWorkspace,
    closeSettingsWorkspace,
    classificationWorkspaceOpen,
    classificationWorkspaceEvent,
    classificationWorkspaceIntent,
    classificationWorkspaceKey,
    classificationWorkspaceOrigin,
    openClassificationExtractionFromEvent,
    openClassificationWorkspace,
    openClassificationRuleFromEvent,
    closeClassificationWorkspace,
  };
}

export type SearchState = ReturnType<typeof useSearchState>;
