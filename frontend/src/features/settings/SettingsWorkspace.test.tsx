import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { SettingsWorkspace } from './SettingsWorkspace';
import type { SearchState, SettingsSectionId } from '../../app/useSearchState';
import { emptyAdvancedFilterValues } from '../search/advancedFilterFields';
import { emptyQueryAuthoringState } from '../search/QueryBuilder';
import { DEFAULT_SEVERITY_LEVELS } from '../search/severityLevels';
import { DEFAULT_PRESET_ID } from '../../shared/time/presets';
import { ShortcutRegistryProvider, useShortcut } from '../../shared/keyboard/ShortcutRegistry';

/** Same fixture-shortcut pattern `KeyboardShortcutsHelp.test.tsx` already uses - no shortcut is genuinely
 * "real" in an isolated render; this proves the inline rendering pipeline itself against known content. */
function FixtureShortcut() {
  useShortcut({
    id: 'fixture.one',
    keys: 'Z',
    description: 'Fixture action one',
    group: 'Search & filters',
    test: (e) => e.key.toLowerCase() === 'z',
    onTrigger: () => {},
  });
  return null;
}

/*
 * PR61_OWNER_NAVIGATION_RECOVERY_2 - the two owner-observed defects this file exists to prove fixed:
 * (1) Settings previously always initialized on its default "Sources" section regardless of which one the
 * caller actually asked for; (2) Settings' own "Keyboard shortcuts" section rendered the compact HEADER
 * popover trigger instead of real, inline content. Docker/OpenShift/Privacy panels are not the concern here
 * (each has its own dedicated test file) - their own fetch calls are stubbed to a never-resolving promise so
 * they render their real, harmless loading state without needing their full endpoint contracts replicated.
 */

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function baseState(overrides: Partial<SearchState> = {}): SearchState {
  const caps = {
    historicalSearch: true,
    liveTail: false,
    rawLogQL: false,
    serviceDiscovery: true,
    queryStatistics: false,
    contextView: false,
    composeProjectScoping: false,
    originalSchemaSampling: true,
  };
  return {
    sources: [{ id: 'fixture', displayName: 'Fixture', capabilities: caps }],
    sourcesLoading: false,
    selectedSource: { id: 'fixture', displayName: 'Fixture', capabilities: caps },
    selectedSourceId: 'fixture',
    setSelectedSourceId: vi.fn(),
    services: [],
    selectedServices: [],
    setSelectedServices: vi.fn(),
    serviceFilterMode: 'INCLUDE',
    setServiceFilterMode: vi.fn(),
    selectedComposeProject: null,
    setSelectedComposeProject: vi.fn(),
    composeProjects: [],
    composeProjectsLoading: false,
    composeProjectsError: null,
    selectedLevels: DEFAULT_SEVERITY_LEVELS,
    setSelectedLevels: vi.fn(),
    searchText: '',
    setSearchText: vi.fn(),
    timeRange: { presetId: DEFAULT_PRESET_ID, start: '2026-01-01T00:00:00Z', end: '2026-01-02T00:00:00Z' },
    setTimeRange: vi.fn(),
    sortDirection: 'BACKWARD' as const,
    setSortDirection: vi.fn(),
    advancedFilters: emptyAdvancedFilterValues(),
    applyAdvancedFilters: vi.fn(),
    queryState: emptyQueryAuthoringState(),
    applyQuery: vi.fn(),
    applyDetectedField: vi.fn(),
    clearAllFilters: vi.fn(),
    health: null,
    healthLoading: false,
    retryHealth: vi.fn(),
    invalidateSearchForScopeChange: vi.fn(),
    searchResult: null,
    searchLoading: false,
    loadingMore: false,
    searchError: null,
    loadMoreError: null,
    lastSearchedRange: null,
    runSearch: vi.fn(),
    refresh: vi.fn(),
    loadMore: vi.fn(),
    selectedIndex: null,
    selectedEvent: null,
    hasPreviousEvent: false,
    hasNextEvent: false,
    openInspector: vi.fn(),
    closeInspector: vi.fn(),
    selectPreviousEvent: vi.fn(),
    selectNextEvent: vi.fn(),
    breadcrumbLabel: null,
    contextRootIdentity: null,
    restoreOriginalSearch: vi.fn(),
    restoreOriginalSearchLabel: 'Back to original search',
    showContext: vi.fn(),
    journeyQuery: null,
    journeyResult: null,
    journeyLoading: false,
    journeyError: null,
    journeyRootEvent: null,
    openJourney: vi.fn(),
    closeJourney: vi.fn(),
    fieldMappingProfile: null,
    fieldMappingProfileError: null,
    fieldMappingSearchReady: true,
    refreshFieldMappingProfile: vi.fn(),
    mappingWorkspaceOpen: false,
    mappingWorkspaceOrigin: 'search',
    openMappingWorkspace: vi.fn(),
    closeMappingWorkspace: vi.fn(),
    settingsWorkspaceOpen: true,
    settingsTargetSection: 'sources',
    openSettingsWorkspace: vi.fn(),
    closeSettingsWorkspace: vi.fn(),
    selectedTags: [],
    setSelectedTags: vi.fn(),
    classificationTags: null,
    classificationTagsError: null,
    refreshClassificationTags: vi.fn(),
    buildClassificationSampleScope: vi.fn(() => null),
    classificationWorkspaceOpen: false,
    classificationWorkspaceEvent: null,
    classificationWorkspaceIntent: null,
    classificationWorkspaceOrigin: 'settings',
    openClassificationExtractionFromEvent: vi.fn(),
    classificationWorkspaceKey: 0,
    openClassificationWorkspace: vi.fn(),
    openClassificationRuleFromEvent: vi.fn(),
    closeClassificationWorkspace: vi.fn(),
    ...overrides,
  };
}

function renderSettings(targetSection: SettingsSectionId = 'sources', stateOverrides: Partial<SearchState> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      // Docker/OpenShift/Privacy each have their own dedicated test file for their real endpoint contracts;
      // a never-resolving promise here renders their real, harmless loading state without replicating it.
      if (url.includes('/proxy') || url.includes('/connection') || url.includes('/openshift') || url.includes('/masking')) {
        return new Promise<Response>(() => undefined);
      }
      return Promise.resolve(jsonResponse({}));
    }),
  );
  const onClose = vi.fn();
  const onOpenShiftScopeChanged = vi.fn();
  const onThemePreferenceChanged = vi.fn();
  const utils = render(
    <ShortcutRegistryProvider>
      <FixtureShortcut />
      <SettingsWorkspace
        state={baseState(stateOverrides)}
        openShiftScope={null}
        onOpenShiftScopeChanged={onOpenShiftScopeChanged}
        onClose={onClose}
        targetSection={targetSection}
        themePreference="system"
        onThemePreferenceChanged={onThemePreferenceChanged}
      />
    </ShortcutRegistryProvider>,
  );
  return { ...utils, onClose, onThemePreferenceChanged };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SettingsWorkspace - deterministic target section (PR61_OWNER_NAVIGATION_RECOVERY_2)', () => {
  it('defaults to Sources when no target is specified, unchanged from before this mission', () => {
    renderSettings('sources');
    expect(screen.getByRole('navigation', { name: 'Settings sections' }).querySelector('[aria-current="page"]'))
      .toHaveTextContent('Sources & connections');
  });

  it('lands on Keyboard shortcuts when that is the requested target - not the default Sources', () => {
    renderSettings('shortcuts');
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(within(nav).getByRole('button', { name: 'Keyboard shortcuts' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('button', { name: 'Sources & connections' })).not.toHaveAttribute('aria-current');
  });

  it('lands on Appearance when that is the requested target', () => {
    renderSettings('appearance');
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(within(nav).getByRole('button', { name: 'Appearance' })).toHaveAttribute('aria-current', 'page');
  });

  it('lands on Field mapping when returning from that workspace', () => {
    renderSettings('mapping');
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(within(nav).getByRole('button', { name: 'Field mapping' })).toHaveAttribute('aria-current', 'page');
  });

  it('lands on Classification rules when returning from that workspace', () => {
    renderSettings('classification');
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(within(nav).getByRole('button', { name: 'Classification rules' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('SettingsWorkspace - Appearance in the shared nav (PR61_OWNER_NAVIGATION_RECOVERY_2)', () => {
  it('SettingsNav lists Appearance alongside every other section', () => {
    renderSettings();
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    for (const label of ['Sources & connections', 'Privacy & masking', 'Appearance', 'Field mapping', 'Classification rules', 'Keyboard shortcuts']) {
      expect(within(nav).getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('the Appearance section itself is present, with the theme radios wired to the passed preference/callback', async () => {
    const user = userEvent.setup();
    const { onThemePreferenceChanged } = renderSettings('appearance', {});
    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Match system' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(onThemePreferenceChanged).toHaveBeenCalledWith('dark');
  });
});

describe('SettingsWorkspace - Keyboard shortcuts renders inline, not the compact popover (PR61_OWNER_NAVIGATION_RECOVERY_2)', () => {
  it('shows real shortcut content directly - no trigger button, no dialog, nothing to click first', () => {
    renderSettings('shortcuts');
    const section = screen.getByRole('heading', { name: 'Keyboard shortcuts' }).closest('section')!;
    // The compact header popover's own affordances must be absent here.
    expect(within(section).queryByRole('button', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument();
    expect(within(section).queryByRole('dialog')).not.toBeInTheDocument();
    // Real, grouped, registry-derived content is already visible.
    expect(within(section).getAllByRole('definition').length).toBeGreaterThan(0);
  });
});

describe('SettingsWorkspace - Back button', () => {
  it('always names Search results - Settings is entered directly, its destination never varies', async () => {
    const user = userEvent.setup();
    const { onClose } = renderSettings();
    await user.click(screen.getByRole('button', { name: 'Back to Search results' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('SettingsWorkspace - accessibility', () => {
  /*
   * Scoped to the header + the one section each test is actually about, not the whole page: `#settings-
   * masking` has a PRE-EXISTING, unrelated landmark-uniqueness violation (PrivacyMaskingSettingsPanel.tsx
   * nests its own <section aria-labelledby> one level inside this workspace's own same-named
   * "settings-masking" section - both resolve to the same accessible name "Privacy & masking"). Confirmed
   * unrelated to this mission: that panel's own nesting is untouched here, and axe was never previously run
   * against a full SettingsWorkspace render (no such test file existed before this one) to have caught it.
   * Recorded here rather than silently fixed - out of this mission's scope (owner-observed navigation/Settings
   * defects only) per its own "record it, do not expand scope automatically" instruction.
   */
  it('has no detectable accessibility violations with Keyboard shortcuts as the landed section', async () => {
    renderSettings('shortcuts');
    const scope = screen.getByRole('heading', { name: 'Keyboard shortcuts' }).closest('section')!;
    expect(await axe(scope)).toHaveNoViolations();
  });

  it('has no detectable accessibility violations with Appearance as the landed section', async () => {
    renderSettings('appearance');
    const scope = screen.getByRole('heading', { name: 'Appearance' }).closest('section')!;
    expect(await axe(scope)).toHaveNoViolations();
  });
});
