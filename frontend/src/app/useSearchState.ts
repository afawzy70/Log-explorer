import { useCallback, useEffect, useState } from 'react';
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
  const [searchError, setSearchError] = useState<string | null>(null);
  const [lastSearchedRange, setLastSearchedRange] = useState<CommittedTimeRange | null>(null);

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

  const runSearch = useCallback(() => {
    if (!selectedSourceId) {
      return;
    }
    setSearchLoading(true);
    setSearchError(null);
    const body: SearchRequestBody = {
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
    };
    const searchedRange = timeRange;
    runSearchApi(body)
      .then((result) => {
        setSearchResult(result);
        setLastSearchedRange(searchedRange);
      })
      .catch((error: unknown) => setSearchError(error instanceof Error ? error.message : 'Search failed'))
      .finally(() => setSearchLoading(false));
  }, [selectedSourceId, timeRange, selectedServices, selectedLevels, searchText, advancedFilters]);

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
    searchError,
    lastSearchedRange,
    runSearch,
  };
}

export type SearchState = ReturnType<typeof useSearchState>;
