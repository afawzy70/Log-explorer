import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { EventInspector } from './EventInspector';
import { fullEvent } from './testEventFixture';
import { ResultsTable } from '../results/ResultsTable';
import { ClassificationRulesWorkspace } from '../settings/classification/ClassificationRulesWorkspace';
import {
  createClassificationRule,
  deleteClassificationRule,
  detectClassificationPattern,
  downloadClassificationRulesExport,
  fetchClassificationRules,
  previewClassificationImport,
  suggestClassificationExtractions,
  testClassificationRule,
  updateClassificationRule,
} from '../../shared/api/client';
import type {
  ClassificationRule,
  ClassificationRulesState,
  ClassificationSampleScope,
  LogEvent,
  RuleMatchDto,
} from '../../shared/api/types';
import type { SearchState } from '../../app/useSearchState';
import { emptyAdvancedFilterValues } from '../search/advancedFilterFields';
import { emptyQueryAuthoringState } from '../search/QueryBuilder';
import { DEFAULT_SEVERITY_LEVELS } from '../search/severityLevels';
import { DEFAULT_PRESET_ID } from '../../shared/time/presets';
import { ShortcutRegistryProvider } from '../../shared/keyboard/ShortcutRegistry';

/**
 * Owner mission §"Inspector action semantics": one action never means two things. An unclassified event can only
 * be the seed of a NEW rule; an already-classified one can additionally extend a rule that already matched it,
 * and its "create" action says "another" so the two never read as the same thing. Nothing is written without an
 * explicit Save on either path.
 */

vi.mock('../../shared/api/client', async () => {
  const actual = await vi.importActual<typeof import('../../shared/api/client')>('../../shared/api/client');
  return {
    ...actual,
    fetchClassificationRules: vi.fn(),
    createClassificationRule: vi.fn(),
    updateClassificationRule: vi.fn(),
    deleteClassificationRule: vi.fn(),
    detectClassificationPattern: vi.fn(),
    suggestClassificationExtractions: vi.fn(),
    testClassificationRule: vi.fn(),
    downloadClassificationRulesExport: vi.fn(),
    previewClassificationImport: vi.fn(),
    applyClassificationImport: vi.fn(),
  };
});

const mockFetch = vi.mocked(fetchClassificationRules);
const mockCreate = vi.mocked(createClassificationRule);
const mockUpdate = vi.mocked(updateClassificationRule);
const mockDelete = vi.mocked(deleteClassificationRule);
const mockDetect = vi.mocked(detectClassificationPattern);
const mockSuggest = vi.mocked(suggestClassificationExtractions);
const mockTest = vi.mocked(testClassificationRule);
const mockDownload = vi.mocked(downloadClassificationRulesExport);
const mockPreview = vi.mocked(previewClassificationImport);

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const SCOPE: ClassificationSampleScope = {
  sourceId: 'local-docker',
  start: '2026-01-01T00:00:00.000Z',
  end: '2026-01-02T00:00:00.000Z',
};

const MW_RULE: ClassificationRule = {
  id: 'mw-call',
  name: 'Middleware call',
  tags: ['middleware'],
  displayColor: 'BLUE',
  enabled: true,
  matchMode: 'ALL',
  conditions: [{ field: 'message', matcher: 'STARTS_WITH', value: 'MW call', ignoreCase: false }],
  extractions: [],
};

const PAY_RULE: ClassificationRule = {
  id: 'pay-fail',
  name: 'Payment failure',
  tags: ['payments'],
  displayColor: 'RED',
  enabled: true,
  matchMode: 'ANY',
  conditions: [{ field: 'errorCode', matcher: 'EXACT', value: 'ERR_TIMEOUT' }],
  extractions: [],
};

function match(rule: ClassificationRule, overrides: Partial<RuleMatchDto> = {}): RuleMatchDto {
  return {
    ruleId: rule.id as string,
    ruleName: rule.name,
    tags: rule.tags,
    displayColor: rule.displayColor ?? null,
    extracted: [],
    ...overrides,
  };
}

const UNCLASSIFIED = fullEvent({ message: 'MW call /accounts took 120ms' });

const CLASSIFIED_ONCE = fullEvent({
  message: 'MW call /accounts took 120ms',
  tags: ['middleware'],
  classifications: [
    match(MW_RULE, {
      extracted: [{ name: 'endpoint', label: 'Endpoint', value: '/accounts', status: 'PRESENT', redacted: false, truncated: false }],
    }),
  ],
});

const CLASSIFIED_TWICE = fullEvent({
  message: 'MW call /accounts took 120ms',
  tags: ['middleware', 'payments'],
  classifications: [match(MW_RULE), match(PAY_RULE)],
});

function rulesState(overrides: Partial<ClassificationRulesState> = {}): ClassificationRulesState {
  return {
    revision: 7,
    updatedAt: '2026-01-01T00:00:00Z',
    status: 'OK',
    statusMessage: null,
    storageFile: '/data/classification-rules.json',
    rules: [MW_RULE, PAY_RULE],
    tags: ['middleware', 'payments'],
    tagColors: { middleware: 'BLUE', payments: 'RED' },
    limits: { maxConditionsPerRule: 3, maxExtractionsPerRule: 4, maxImportBytes: 1000, defaultSampleSize: 200, previewCount: 5 },
    fields: [
      { key: 'message', label: 'Message' },
      { key: 'service', label: 'Service' },
    ],
    runtime: { eventsEvaluated: 10, ruleMatches: 2, evaluationFailures: 0 },
    ...overrides,
  };
}

/**
 * EventInspector registers its Escape/"["/"]" bindings through the shared shortcut registry - without the
 * provider those would silently no-op, so every inspector render here goes through it (same reasoning as
 * `EventInspector.test.tsx`).
 */
function renderWithRegistry(ui: ReactElement) {
  return render(<ShortcutRegistryProvider>{ui}</ShortcutRegistryProvider>);
}

function baseState(overrides: Partial<SearchState> = {}): SearchState {
  const caps = {
    historicalSearch: true,
    liveTail: false,
    rawLogQL: false,
    serviceDiscovery: true,
    queryStatistics: false,
    contextView: true,
    composeProjectScoping: false,
    originalSchemaSampling: true,
  };
  return {
    sources: [{ id: 'local-docker', displayName: 'Local Docker', capabilities: caps }],
    sourcesLoading: false,
    selectedSource: { id: 'local-docker', displayName: 'Local Docker', capabilities: caps },
    selectedSourceId: 'local-docker',
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
    openMappingWorkspace: vi.fn(),
    closeMappingWorkspace: vi.fn(),
    settingsWorkspaceOpen: false,
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
    classificationWorkspaceKey: 0,
    openClassificationWorkspace: vi.fn(),
    openClassificationRuleFromEvent: vi.fn(),
    openClassificationExtractionFromEvent: vi.fn(),
    closeClassificationWorkspace: vi.fn(),
    ...overrides,
  };
}

function renderWorkspace(sourceEvent: LogEvent) {
  const onClose = vi.fn();
  const onRulesChanged = vi.fn();
  const buildScope = vi.fn(() => SCOPE);
  const utils = render(
    <ClassificationRulesWorkspace
      sourceEvent={sourceEvent}
      intent="addExtraction"
      buildScope={buildScope}
      onRulesChanged={onRulesChanged}
      onClose={onClose}
      onOpenMapping={vi.fn()}
      onOpenSettings={vi.fn()}
    />,
  );
  return { ...utils, onClose, onRulesChanged, buildScope };
}

beforeEach(() => {
  for (const m of [mockFetch, mockCreate, mockUpdate, mockDelete, mockDetect, mockSuggest, mockTest, mockDownload, mockPreview]) {
    m.mockReset();
  }
  mockFetch.mockResolvedValue(rulesState());
  mockSuggest.mockResolvedValue({
    status: 'NO_SUGGESTION',
    reason: null,
    field: 'message',
    sampledEvents: 200,
    matchedEvents: 12,
    suggestions: [],
    alreadyDefined: [],
    warnings: [],
  });
});

/* ------------------------------------------------------------------ */
/* The inspector's two classification actions                          */
/* ------------------------------------------------------------------ */

describe('EventInspector - classification actions', () => {
  it('an unclassified event offers only "Create tag rule from this event"', async () => {
    const openClassificationRuleFromEvent = vi.fn();
    const openClassificationExtractionFromEvent = vi.fn();
    renderWithRegistry(
      <EventInspector
        state={baseState({
          selectedEvent: UNCLASSIFIED,
          selectedIndex: 0,
          openClassificationRuleFromEvent,
          openClassificationExtractionFromEvent,
        })}
      />,
    );

    expect(screen.getByRole('button', { name: 'Create tag rule from this event' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add extraction from this event' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create another tag rule' })).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Create tag rule from this event' }));
    expect(openClassificationRuleFromEvent).toHaveBeenCalledWith(UNCLASSIFIED);
    expect(openClassificationExtractionFromEvent).not.toHaveBeenCalled();
  });

  it('a classified event offers "Add extraction from this event" and "Create another tag rule", and never the unclassified wording', () => {
    renderWithRegistry(<EventInspector state={baseState({ selectedEvent: CLASSIFIED_ONCE, selectedIndex: 0 })} />);
    expect(screen.getByRole('button', { name: 'Add extraction from this event' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create another tag rule' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create tag rule from this event' })).not.toBeInTheDocument();
  });

  it('"Add extraction from this event" hands that exact event to openClassificationExtractionFromEvent, and creating stays a separate action', async () => {
    const user = userEvent.setup();
    const openClassificationExtractionFromEvent = vi.fn();
    const openClassificationRuleFromEvent = vi.fn();
    renderWithRegistry(
      <EventInspector
        state={baseState({
          selectedEvent: CLASSIFIED_ONCE,
          selectedIndex: 0,
          openClassificationExtractionFromEvent,
          openClassificationRuleFromEvent,
        })}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Add extraction from this event' }));
    expect(openClassificationExtractionFromEvent).toHaveBeenCalledTimes(1);
    expect(openClassificationExtractionFromEvent).toHaveBeenCalledWith(CLASSIFIED_ONCE);
    expect(openClassificationRuleFromEvent).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Create another tag rule' }));
    expect(openClassificationRuleFromEvent).toHaveBeenCalledWith(CLASSIFIED_ONCE);
    expect(openClassificationExtractionFromEvent).toHaveBeenCalledTimes(1);
  });

  it('has no axe violations with both classification actions present', async () => {
    const { container } = renderWithRegistry(
      <EventInspector state={baseState({ selectedEvent: CLASSIFIED_ONCE, selectedIndex: 0 })} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

/* ------------------------------------------------------------------ */
/* One tag, one identity, across two surfaces                          */
/* ------------------------------------------------------------------ */

describe('Tag identity is the same in the table and the inspector', () => {
  function chips(root: HTMLElement) {
    return Array.from(root.querySelectorAll('[data-tag-color]')).map((el) => ({
      text: (el.textContent ?? '').toLowerCase(),
      color: el.getAttribute('data-tag-color'),
    }));
  }

  it('the same event draws the same tag text and the same colour in both surfaces', () => {
    const table = render(<ResultsTable events={[CLASSIFIED_ONCE]} />);
    const tableCell = within(screen.getAllByRole('row')[1]).getAllByRole('cell')[4];
    const fromTable = chips(tableCell);
    table.unmount();

    renderWithRegistry(<EventInspector state={baseState({ selectedEvent: CLASSIFIED_ONCE, selectedIndex: 0 })} />);
    const tagList = screen.getByRole('list', { name: 'Tags' });
    const fromInspector = chips(tagList);

    expect(fromTable).toEqual([{ text: 'middleware', color: 'BLUE' }]);
    expect(fromInspector).toEqual([{ text: 'middleware', color: 'BLUE' }]);
    // The inspector shows the tag in caps; the identity underneath is identical.
    expect(within(tagList).getByText('MIDDLEWARE')).toBeInTheDocument();
  });

  it('two rules with different colours keep their own identity on both surfaces', () => {
    const table = render(<ResultsTable events={[CLASSIFIED_TWICE]} />);
    const tableCell = within(screen.getAllByRole('row')[1]).getAllByRole('cell')[4];
    // The table shows the first tag plus a counter, so colour identity is asserted on the first chip.
    expect(chips(tableCell)[0]).toEqual({ text: 'middleware', color: 'BLUE' });
    expect(tableCell.textContent).toContain('Tags: middleware, payments');
    table.unmount();

    renderWithRegistry(<EventInspector state={baseState({ selectedEvent: CLASSIFIED_TWICE, selectedIndex: 0 })} />);
    expect(chips(screen.getByRole('list', { name: 'Tags' }))).toEqual([
      { text: 'middleware', color: 'BLUE' },
      { text: 'payments', color: 'RED' },
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* "Add extraction from this event" in the workspace                   */
/* ------------------------------------------------------------------ */

describe('ClassificationRulesWorkspace - intent="addExtraction"', () => {
  it('asks which rule to extend when several saved rules classified the event, then opens that rule on the extraction step', async () => {
    const user = userEvent.setup();
    renderWorkspace(CLASSIFIED_TWICE);

    expect(await screen.findByRole('heading', { name: 'Which rule should this value be added to?' })).toBeInTheDocument();
    expect(screen.getByText(/2 saved rules classified this event\./)).toBeInTheDocument();
    const chooser = screen.getByRole('list', { name: 'Rules that classified this event' });
    const options = within(chooser).getAllByRole('listitem');
    expect(options).toHaveLength(2);
    expect(within(options[0]).getByRole('button', { name: 'Add extraction to Middleware call' })).toBeInTheDocument();
    expect(within(options[1]).getByRole('button', { name: 'Add extraction to Payment failure' })).toBeInTheDocument();
    // The chooser draws each candidate in its own rule's colour.
    expect(options[0].querySelector('[data-tag-color]')).toHaveAttribute('data-tag-color', 'BLUE');
    expect(options[1].querySelector('[data-tag-color]')).toHaveAttribute('data-tag-color', 'RED');
    // Nothing is authored while the question is still open.
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();

    await user.click(within(options[1]).getByRole('button', { name: 'Add extraction to Payment failure' }));
    expect(screen.getByRole('heading', { name: 'Edit rule: Payment failure' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Step 3 of 5: Extraction' })).toBeInTheDocument();
    await waitFor(() => expect(mockSuggest).toHaveBeenCalledTimes(1));
    expect(mockSuggest.mock.calls[0][0].rule).toMatchObject({ id: 'pay-fail', name: 'Payment failure' });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('Cancel on the chooser returns to the rules list without touching any rule', async () => {
    const user = userEvent.setup();
    renderWorkspace(CLASSIFIED_TWICE);
    await screen.findByRole('heading', { name: 'Which rule should this value be added to?' });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('table', { name: 'Classification rules' })).toBeInTheDocument();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('exactly one matching rule opens that rule\'s editor directly on the extraction step - no needless question', async () => {
    renderWorkspace(CLASSIFIED_ONCE);
    expect(await screen.findByRole('heading', { name: 'Edit rule: Middleware call' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Step 3 of 5: Extraction' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Which rule should this value be added to?' })).not.toBeInTheDocument();
    await waitFor(() => expect(mockSuggest).toHaveBeenCalledTimes(1));
    expect(mockSuggest.mock.calls[0][0].rule).toMatchObject({ id: 'mw-call' });
    expect(mockSuggest.mock.calls[0][0].scope).toEqual(SCOPE);
  });

  it('says so plainly when the rule that classified the event is no longer saved, instead of authoring something else', async () => {
    const deletedRule: ClassificationRule = { ...MW_RULE, id: 'deleted-rule', name: 'Deleted rule' };
    const staleEvent = fullEvent({ tags: ['middleware'], classifications: [match(deletedRule)] });
    renderWorkspace(staleEvent);

    expect(
      await screen.findByText(
        'The rules that classified this event are no longer saved. Choose a rule to edit, or create a new one.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Classification rules' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^Edit rule/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Which rule should this value be added to?' })).not.toBeInTheDocument();
    expect(mockSuggest).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('says so plainly when the event carries no classification at all', async () => {
    renderWorkspace(UNCLASSIFIED);
    expect(
      await screen.findByText('This event is not classified yet, so there is no rule to extend. Create a tag rule first.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Classification rules' })).toBeInTheDocument();
  });

  /** The repo's local `jest-axe` declaration returns `violations: unknown[]`; this narrows it for assertions. */
  async function violationIds(container: Element): Promise<string[]> {
    const { violations } = (await axe(container)) as { violations: { id: string }[] };
    return violations.map((v) => v.id);
  }

  it('has no axe violations on the rule chooser', async () => {
    const { container } = renderWorkspace(CLASSIFIED_TWICE);
    await screen.findByRole('heading', { name: 'Which rule should this value be added to?' });
    expect(await violationIds(container)).toEqual([]);
  });

  /*
   * The chooser's heading was an `<h3>` directly under the workspace's `<h1>`, which jumped a level in the
   * document outline (CLAUDE.md §7: semantic HTML, WCAG 2.2 AA). It is an `<h2>`, like every other view of this
   * workspace, and this pins the level so the outline cannot drift again.
   */
  it('keeps the document outline intact - the chooser heading is one level under the workspace title', async () => {
    renderWorkspace(CLASSIFIED_TWICE);
    expect(
      await screen.findByRole('heading', { name: 'Which rule should this value be added to?', level: 2 }),
    ).toBeInTheDocument();
  });
});
