import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchComposeProjects,
  fetchContext,
  fetchJourney,
  fetchSourceHealth,
  fetchSourceServices,
  fetchSources,
  runSearch as runSearchApi,
} from '../shared/api/client';
import type {
  JourneyField,
  LogEvent,
  SearchDirection,
  SearchRequestBody,
  SearchResponse,
  ServiceInfo,
  SourceHealthDetail,
  SourceInfo,
} from '../shared/api/types';
import { DEFAULT_SEVERITY_LEVELS } from '../features/search/severityLevels';
import { emptyAdvancedFilterValues } from '../features/search/advancedFilterFields';
import type { AdvancedFilterValues } from '../features/search/advancedFilterFields';
import type { DetectableIdField } from '../features/search/idDetection';
import { emptyQueryAuthoringState, resolveQueryText, resolveRawLogQl } from '../features/search/QueryBuilder';
import type { QueryAuthoringState } from '../features/search/QueryBuilder';
import { DEFAULT_PRESET_ID, TIME_RANGE_PRESETS, CUSTOM_RANGE_ID } from '../shared/time/presets';
import type { CommittedTimeRange } from '../features/timerange/types';
import { formatUtcTimestamp } from '../features/inspector/timestampFormat';

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
 * Remediation Slice 1) - used only for client-side defensive dedup of
 * appended "Load more" pages, mirroring the backend's own
 * `PageCursorCodec#eventFingerprint` in spirit (never touches
 * `protectedFields`, the frontend never sees a raw sensitive value to
 * begin with).
 */
export function eventIdentity(e: LogEvent): string {
  return [
    e.timestamp, e.sourceId, e.containerId, e.pod, e.stream, e.rawLine ?? e.message,
    e.logger, e.thread, e.traceId, e.spanId, e.correlationId, e.journeyId, e.eventId,
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
  sortDirection: SearchDirection;
  selectedIndex: number | null;
  selectedLevels: string[];
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
export function useSearchState() {
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);

  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
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
          setSelectedSourceId((current) => current ?? list[0].id);
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

  const checkHealth = useCallback((sourceId: string) => {
    setHealthLoading(true);
    fetchSourceHealth(sourceId)
      .then(setHealth)
      .catch(() =>
        setHealth({
          status: 'DOWN',
          message: 'Unable to reach the health endpoint',
          checkedAt: new Date().toISOString(),
          warnings: [],
          latencyMs: null,
          capabilities: null,
        }),
      )
      .finally(() => setHealthLoading(false));
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
    if (source?.capabilities.serviceDiscovery) {
      fetchSourceServices(selectedSourceId)
        .then(setServices)
        .catch(() => setServices([]));
    } else {
      setServices([]);
    }
    if (source?.capabilities.composeProjectScoping) {
      setComposeProjectsLoading(true);
      fetchComposeProjects(selectedSourceId)
        .then(setComposeProjects)
        .catch((error: unknown) =>
          setComposeProjectsError(error instanceof Error ? error.message : 'Failed to discover Compose projects'),
        )
        .finally(() => setComposeProjectsLoading(false));
    }
    checkHealth(selectedSourceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSourceId]);

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
    setSelectedServices([]); // B's own service set is about to be (re)discovered - A's selections cannot carry over
    if (source.capabilities.serviceDiscovery) {
      fetchSourceServices(selectedSourceId, selectedComposeProject ?? undefined)
        .then(setServices)
        .catch(() => setServices([]));
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
    setSelectedLevels(DEFAULT_SEVERITY_LEVELS);
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
        services: selectedServices,
        levels: selectedLevels,
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
      };
    },
    [selectedSourceId, timeRange, sortDirection, selectedServices, selectedLevels, searchText, advancedFilters, queryState, selectedComposeProject],
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
        setSearchError(error instanceof Error ? error.message : 'Search failed');
      })
      .finally(() => {
        if (activeRequestRef.current === controller) {
          setSearchLoading(false);
        }
      });
  }, [buildRequestBody, timeRange]);

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

  const selectPreviousEvent = useCallback(() => {
    setSelectedIndex((prev) => (prev != null && prev > 0 ? prev - 1 : prev));
  }, []);

  const selectNextEvent = useCallback(() => {
    setSelectedIndex((prev) => (prev != null && prev < events.length - 1 ? prev + 1 : prev));
  }, [events.length]);

  const snapshotCurrent = useCallback(
    (): SearchSnapshot => ({
      selectedServices,
      sortDirection,
      selectedIndex,
      selectedLevels,
      searchText,
      advancedFilters,
      queryState,
      timeRange,
      searchResult,
      lastSearchedRange,
    }),
    [selectedServices, sortDirection, selectedIndex, selectedLevels, searchText, advancedFilters, queryState, timeRange, searchResult, lastSearchedRange],
  );

  /** "Preserves and restores the original search state" (HANDOVER.md §17.5, applied here to both Phase H detour actions) - only the true original is ever kept, never a chain of detours. */
  const snapshotOriginalIfAbsent = useCallback(() => {
    setOriginalSnapshot((prev) => prev ?? snapshotCurrent());
  }, [snapshotCurrent]);

  const restoreOriginalSearch = useCallback(() => {
    const snapshot = originalSnapshot;
    if (!snapshot) {
      return;
    }
    setSelectedServices(snapshot.selectedServices);
    setSelectedLevels(snapshot.selectedLevels);
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
    setOriginalSnapshot(null);
    setBreadcrumbLabel(null);
    setSelectedIndex(restorableIndex);
    setContextRootIdentity(null);
  }, [originalSnapshot]);

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
    (field: JourneyField, value: string) => {
      if (!selectedSourceId || !value) {
        return;
      }
      closeInspector();
      setJourneyQuery({ field, value });
      setJourneyResult(null);
      setJourneyError(null);

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

  /** "Preserves and restores the original search state": closing journey mode never had anything to restore - `searchResult`/the toolbar's filters were never touched while it was open. */
  const closeJourney = useCallback(() => {
    setJourneyQuery(null);
    setJourneyResult(null);
    setJourneyError(null);
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
    [selectedSourceId, snapshotOriginalIfAbsent, closeInspector, selectedComposeProject],
  );

  const selectedSource = sources.find((s) => s.id === selectedSourceId) ?? null;

  return {
    sources,
    sourcesLoading,
    selectedSource,
    selectedSourceId,
    setSelectedSourceId,
    services,
    selectedServices,
    setSelectedServices,
    selectedComposeProject,
    setSelectedComposeProject,
    composeProjects,
    composeProjectsLoading,
    composeProjectsError,
    selectedLevels,
    setSelectedLevels,
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
    showContext,
    journeyQuery,
    journeyResult,
    journeyLoading,
    journeyError,
    openJourney,
    closeJourney,
  };
}

export type SearchState = ReturnType<typeof useSearchState>;
