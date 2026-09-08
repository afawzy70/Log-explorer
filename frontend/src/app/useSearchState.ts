import { useCallback, useEffect, useRef, useState } from 'react';
import {
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
  SearchRequestBody,
  SearchResponse,
  ServiceInfo,
  SourceHealth,
  SourceInfo,
} from '../shared/api/types';
import { DEFAULT_SEVERITY_LEVELS } from '../features/search/severityLevels';
import { emptyAdvancedFilterValues } from '../features/search/advancedFilterFields';
import type { AdvancedFilterValues } from '../features/search/advancedFilterFields';
import type { DetectableIdField } from '../features/search/idDetection';
import { DEFAULT_PRESET_ID, TIME_RANGE_PRESETS, CUSTOM_RANGE_ID } from '../shared/time/presets';
import type { CommittedTimeRange } from '../features/timerange/types';
import { formatUtcTimestamp } from '../features/inspector/timestampFormat';

function defaultTimeRange(): CommittedTimeRange {
  const preset = TIME_RANGE_PRESETS.find((p) => p.id === DEFAULT_PRESET_ID)!;
  const end = new Date();
  const start = new Date(end.getTime() - preset.durationMs);
  return { presetId: DEFAULT_PRESET_ID, start: start.toISOString(), end: end.toISOString() };
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
  selectedLevels: string[];
  searchText: string;
  advancedFilters: AdvancedFilterValues;
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
  const [selectedLevels, setSelectedLevels] = useState<string[]>(DEFAULT_SEVERITY_LEVELS);
  const [searchText, setSearchText] = useState('');
  const [timeRange, setTimeRange] = useState<CommittedTimeRange>(defaultTimeRange);
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilterValues>(emptyAdvancedFilterValues);

  const [health, setHealth] = useState<SourceHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  const [searchResult, setSearchResult] = useState<SearchResponse | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [lastSearchedRange, setLastSearchedRange] = useState<CommittedTimeRange | null>(null);

  /** The event inspector's selection (IMPLEMENTATION_PLAN.md "Phase H") - an index into `searchResult.events`, since events have no stable id (see `ResultsTable`'s own comment on why it keys by index). */
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const focusRestoreRef = useRef<HTMLElement | null>(null);

  /** "Show ±30 seconds" breadcrumb (HANDOVER.md §16.7 "breadcrumb back to the original search"). */
  const [breadcrumbLabel, setBreadcrumbLabel] = useState<string | null>(null);
  const [originalSnapshot, setOriginalSnapshot] = useState<SearchSnapshot | null>(null);

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
        setHealth({ status: 'DOWN', message: 'Unable to reach the health endpoint', checkedAt: new Date().toISOString() }),
      )
      .finally(() => setHealthLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedSourceId) {
      return;
    }
    const source = sources.find((s) => s.id === selectedSourceId);
    setSelectedServices([]);
    if (source?.capabilities.serviceDiscovery) {
      fetchSourceServices(selectedSourceId)
        .then(setServices)
        .catch(() => setServices([]));
    } else {
      setServices([]);
    }
    checkHealth(selectedSourceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSourceId]);

  const applyDetectedField = useCallback((field: DetectableIdField, value: string) => {
    setAdvancedFilters((prev) => ({ ...prev, [field]: value }));
  }, []);

  const applyAdvancedFilters = useCallback((next: AdvancedFilterValues) => {
    setSearchText(next.text);
    setAdvancedFilters({ ...next, text: '' });
  }, []);

  const buildRequestBody = useCallback(
    (cursor?: string): SearchRequestBody | null => {
      if (!selectedSourceId) {
        return null;
      }
      return {
        sourceId: selectedSourceId,
        start: timeRange.start,
        end: timeRange.end,
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
        cursor,
      };
    },
    [selectedSourceId, timeRange, selectedServices, selectedLevels, searchText, advancedFilters],
  );

  /** Aborts whatever request is currently in flight, so its result can never race a newer one. */
  function supersedeActiveRequest(): AbortController {
    activeRequestRef.current?.abort();
    const controller = new AbortController();
    activeRequestRef.current = controller;
    return controller;
  }

  const runSearch = useCallback(() => {
    const body = buildRequestBody();
    if (!body) {
      return;
    }
    const controller = supersedeActiveRequest();
    setSearchLoading(true);
    setSearchError(null);
    // A genuinely new, user-initiated search invalidates the inspector's
    // selection (row indices belong to the list about to be replaced),
    // any "back to original search" breadcrumb (this new search IS the
    // current state now, not a detour from something to return to), and
    // journey mode (a fresh search means the investigator is no longer
    // looking at the journey timeline).
    setSelectedIndex(null);
    setBreadcrumbLabel(null);
    setOriginalSnapshot(null);
    setJourneyQuery(null);
    setJourneyResult(null);
    setJourneyError(null);
    const searchedRange = timeRange;
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
   * "One pagination model (bounded cursor)" (scope item 9) - appends the
   * next page's events to what's already shown, using the exact cursor
   * the backend returned. Currently unreachable in practice: no adapter
   * populates `SearchResult#nextCursor` yet (`SearchService#toResult`
   * always returns `null`), so this button never renders today - built
   * correctly and tested regardless, so it works the moment a future
   * phase wires real cursor pagination server-side, and to prove by
   * construction there is only ever one pagination model.
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
    setSearchError(null);
    runSearchApi(body, controller.signal)
      .then((result) => {
        setSearchResult((prev) =>
          prev
            ? { events: [...prev.events, ...result.events], counts: result.counts, nextCursor: result.nextCursor }
            : result,
        );
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        setSearchError(error instanceof Error ? error.message : 'Search failed');
      })
      .finally(() => {
        if (activeRequestRef.current === controller) {
          setLoadingMore(false);
        }
      });
  }, [buildRequestBody, searchResult]);

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
      selectedLevels,
      searchText,
      advancedFilters,
      timeRange,
      searchResult,
      lastSearchedRange,
    }),
    [selectedServices, selectedLevels, searchText, advancedFilters, timeRange, searchResult, lastSearchedRange],
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
    setTimeRange(snapshot.timeRange);
    setSearchResult(snapshot.searchResult);
    setLastSearchedRange(snapshot.lastSearchedRange);
    setOriginalSnapshot(null);
    setBreadcrumbLabel(null);
    setSelectedIndex(null);
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
        { sourceId: selectedSourceId, start: timeRange.start, end: timeRange.end, field, value },
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
    [selectedSourceId, timeRange, closeInspector],
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
        },
        controller.signal,
      )
        .then((result) => {
          setSearchResult(result);
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
    [selectedSourceId, snapshotOriginalIfAbsent, closeInspector],
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
    selectedLevels,
    setSelectedLevels,
    searchText,
    setSearchText,
    timeRange,
    setTimeRange,
    advancedFilters,
    applyAdvancedFilters,
    applyDetectedField,
    health,
    healthLoading,
    retryHealth: () => selectedSourceId && checkHealth(selectedSourceId),
    searchResult,
    searchLoading,
    loadingMore,
    searchError,
    lastSearchedRange,
    runSearch,
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
