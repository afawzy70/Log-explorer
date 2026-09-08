import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchSourceHealth, fetchSourceServices, fetchSources, runSearch as runSearchApi } from '../shared/api/client';
import type {
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
import { DEFAULT_PRESET_ID, TIME_RANGE_PRESETS } from '../shared/time/presets';
import type { CommittedTimeRange } from '../features/timerange/types';

function defaultTimeRange(): CommittedTimeRange {
  const preset = TIME_RANGE_PRESETS.find((p) => p.id === DEFAULT_PRESET_ID)!;
  const end = new Date();
  const start = new Date(end.getTime() - preset.durationMs);
  return { presetId: DEFAULT_PRESET_ID, start: start.toISOString(), end: end.toISOString() };
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
  };
}

export type SearchState = ReturnType<typeof useSearchState>;
