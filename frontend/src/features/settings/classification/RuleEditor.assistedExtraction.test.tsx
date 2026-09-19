import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { RuleEditor } from './RuleEditor';
import {
  createClassificationRule,
  detectClassificationPattern,
  suggestClassificationExtractions,
  testClassificationRule,
  updateClassificationRule,
} from '../../../shared/api/client';
import type {
  ClassificationRule,
  ClassificationRulesState,
  ClassificationSampleScope,
  ExtractionSuggestionResult,
} from '../../../shared/api/types';
import { fullEvent } from '../../inspector/testEventFixture';

/*
 * `RuleEditor` is rendered directly rather than driven through
 * `ClassificationRulesWorkspace`. The workspace path is already covered end to end in
 * `ClassificationRulesWorkspace.test.tsx`; what is under test here is one step of the wizard, and reaching it
 * through the workspace would mean replaying Source -> Detect -> "Use this suggestion" -> Classification before
 * every single assertion, which buries the behaviour being verified and couples these tests to unrelated steps.
 * Rendering the editor on `initialStep="extraction"` is exactly what the workspace itself does for
 * "Add extraction from this event", so this is a real entry point, not a test-only shortcut.
 */

vi.mock('../../../shared/api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../shared/api/client')>('../../../shared/api/client');
  return {
    ...actual,
    createClassificationRule: vi.fn(),
    updateClassificationRule: vi.fn(),
    detectClassificationPattern: vi.fn(),
    suggestClassificationExtractions: vi.fn(),
    testClassificationRule: vi.fn(),
  };
});

const mockSuggest = vi.mocked(suggestClassificationExtractions);
const mockCreate = vi.mocked(createClassificationRule);
const mockUpdate = vi.mocked(updateClassificationRule);
const mockTest = vi.mocked(testClassificationRule);
const mockDetect = vi.mocked(detectClassificationPattern);

const MESSAGE = 'MW call /accounts took 120ms';
const EVENT = fullEvent({ message: MESSAGE });

const SCOPE: ClassificationSampleScope = {
  sourceId: 'local-docker',
  composeProject: 'demo',
  start: '2026-01-01T00:00:00.000Z',
  end: '2026-01-02T00:00:00.000Z',
  services: ['gateway'],
  serviceFilterMode: 'INCLUDE',
  levels: ['INFO', 'WARN', 'ERROR'],
  text: 'MW call',
  anchorTimestamp: '2026-01-01T12:00:00.123Z',
};

const CONDITIONS = [{ field: 'message', matcher: 'STARTS_WITH' as const, value: 'MW call', ignoreCase: false }];

const ENDPOINT_EXTRACTION = {
  name: 'endpoint',
  label: 'Endpoint',
  sourceField: 'message',
  type: 'REGEX' as const,
  expression: 'MW call (?P<endpoint>\\S+)',
  valueType: 'STRING' as const,
  sensitive: false,
};

function rule(overrides: Partial<ClassificationRule> = {}): ClassificationRule {
  return {
    id: 'mw-call',
    name: 'Middleware call',
    tags: ['middleware'],
    enabled: true,
    matchMode: 'ALL',
    conditions: CONDITIONS,
    extractions: [],
    ...overrides,
  };
}

function rulesState(overrides: Partial<ClassificationRulesState> = {}): ClassificationRulesState {
  return {
    revision: 7,
    updatedAt: '2026-01-01T00:00:00Z',
    status: 'OK',
    statusMessage: null,
    storageFile: '/data/classification-rules.json',
    rules: [rule()],
    tags: ['middleware'],
    tagColors: { middleware: 'BLUE' },
    limits: { maxConditionsPerRule: 3, maxExtractionsPerRule: 4, maxImportBytes: 1000, defaultSampleSize: 200, previewCount: 5 },
    fields: [
      { key: 'message', label: 'Message' },
      { key: 'service', label: 'Service' },
      { key: 'cif', label: 'CIF' },
    ],
    runtime: { eventsEvaluated: 10, ruleMatches: 2, evaluationFailures: 0 },
    ...overrides,
  };
}

function suggestionResult(overrides: Partial<ExtractionSuggestionResult> = {}): ExtractionSuggestionResult {
  return {
    status: 'SUGGESTED',
    reason: null,
    field: 'message',
    sampledEvents: 200,
    matchedEvents: 40,
    suggestions: [
      { definition: { ...ENDPOINT_EXTRACTION }, extracted: 38, of: 40 },
      {
        definition: {
          name: 'durationMs',
          label: 'Duration',
          sourceField: 'message',
          type: 'REGEX',
          expression: 'took (?P<durationMs>\\d+)ms',
          valueType: 'INTEGER',
          sensitive: false,
        },
        extracted: 40,
        of: 40,
      },
    ],
    alreadyDefined: [],
    warnings: [],
    ...overrides,
  };
}

const NO_SUGGESTION: ExtractionSuggestionResult = {
  status: 'NO_SUGGESTION',
  reason: 'Every candidate value was unique to a single event.',
  field: 'message',
  sampledEvents: 200,
  matchedEvents: 3,
  suggestions: [],
  alreadyDefined: [],
  warnings: [],
};

function renderEditor(props: Partial<Parameters<typeof RuleEditor>[0]> = {}) {
  const onSaved = vi.fn();
  const onCancel = vi.fn();
  const onReloadRules = vi.fn(async () => undefined);
  const buildScope = vi.fn(() => SCOPE);
  const utils = render(
    <RuleEditor
      mode="edit"
      initialRule={rule()}
      initialStep="extraction"
      sourceEvent={EVENT}
      rulesState={rulesState()}
      buildScope={buildScope}
      onReloadRules={onReloadRules}
      onSaved={onSaved}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { ...utils, onSaved, onCancel, onReloadRules, buildScope };
}

/** Waits for the one automatic suggestion request the extraction step fires on arrival. */
async function settled() {
  await waitFor(() => expect(mockSuggest).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.queryByText(/Looking for values/)).not.toBeInTheDocument());
}

beforeEach(() => {
  for (const m of [mockSuggest, mockCreate, mockUpdate, mockTest, mockDetect]) {
    m.mockReset();
  }
  mockSuggest.mockResolvedValue(suggestionResult());
});

describe('RuleEditor - assisted extraction: asking for suggestions', () => {
  it('arriving at the extraction step asks the server once, carrying the draft rule, the anchor field and the committed scope', async () => {
    const { buildScope } = renderEditor();
    await settled();

    expect(buildScope).toHaveBeenCalledWith(EVENT);
    expect(mockSuggest).toHaveBeenCalledTimes(1);
    const request = mockSuggest.mock.calls[0][0];
    expect(request.field).toBe('message');
    expect(request.anchorValue).toBe(MESSAGE);
    expect(request.scope).toEqual(SCOPE);
    expect(request.sampleSize).toBe(200);
    expect(request.rule).toMatchObject({
      id: 'mw-call',
      name: 'Middleware call',
      tags: ['middleware'],
      matchMode: 'ALL',
      conditions: CONDITIONS,
    });
    // A suggestion is a read: nothing is written before the explicit Save.
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('does not ask at all when the draft has no conditions yet - there is no matched population to mine', async () => {
    renderEditor({ initialRule: rule({ conditions: [] }) });
    expect(await screen.findByRole('button', { name: 'Detect extractable values' })).toBeInTheDocument();
    expect(mockSuggest).not.toHaveBeenCalled();
  });

  it('shows the server error instead of pretending there was nothing to suggest', async () => {
    mockSuggest.mockRejectedValue(new Error('Source is unreachable'));
    renderEditor();
    expect(await screen.findByRole('alert')).toHaveTextContent('Source is unreachable');
    expect(screen.queryByText(/No extraction could be suggested/)).not.toBeInTheDocument();
  });
});

describe('RuleEditor - assisted extraction: the suggestion list', () => {
  function suggestionList() {
    return screen.getByRole('list', { name: 'Suggested extractions' });
  }

  it('lists each suggestion with the coverage actually measured in the sample', async () => {
    renderEditor();
    await settled();
    expect(screen.getByText('Read from 40 matching events in the current search, out of 200 sampled. Counts describe this bounded sample only.')).toBeInTheDocument();
    const items = within(suggestionList()).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText('Endpoint')).toBeInTheDocument();
    expect(within(items[0]).getByText('Found in 38 / 40')).toBeInTheDocument();
    expect(within(items[1]).getByText('Duration')).toBeInTheDocument();
    expect(within(items[1]).getByText('Found in 40 / 40')).toBeInTheDocument();
    expect(within(items[0]).getByLabelText('Output name')).toHaveValue('endpoint');

    // §22.11 A6 - a visual coverage bar alongside the text, decorative (never the only signal - the text above
    // already states the same number). 38/40 = 95%, 40/40 = 100%.
    const fill0 = items[0].querySelector('[class*="coverageBarFill"]') as HTMLElement;
    const fill1 = items[1].querySelector('[class*="coverageBarFill"]') as HTMLElement;
    expect(fill0.style.width).toBe('95%');
    expect(fill1.style.width).toBe('100%');
    expect(items[0].querySelector('[class*="coverageBar"][aria-hidden="true"]')).toBeInTheDocument();
  });

  it('"Add n selected values" moves exactly the ticked suggestions into the rule as confirmed values, renamed and marked sensitive as the user set them', async () => {
    const user = userEvent.setup();
    renderEditor();
    await settled();
    const items = within(suggestionList()).getAllByRole('listitem');

    expect(screen.getByRole('button', { name: 'Add 2 selected values' })).toBeEnabled();

    // Rename the first, mark it sensitive, and untick the second.
    const name = within(items[0]).getByLabelText('Output name');
    await user.clear(name);
    await user.type(name, 'target');
    await user.click(within(items[0]).getByRole('checkbox', { name: 'Never show this value' }));
    await user.click(within(items[1]).getByRole('checkbox', { name: 'Duration' }));

    await user.click(screen.getByRole('button', { name: 'Add 1 selected value' }));

    // The ticked one became a confirmed value of the rule, under its new name.
    const confirmed = screen.getByRole('group', { name: 'Endpoint (confirmed)' });
    expect(within(confirmed).getByLabelText('Name')).toHaveValue('target');
    expect(within(confirmed).getByRole('checkbox', { name: 'Never show this value' })).toBeChecked();

    // The unticked one was not added, and is still on offer.
    expect(screen.queryByRole('group', { name: 'Duration (confirmed)' })).not.toBeInTheDocument();
    expect(within(suggestionList()).getAllByRole('listitem')).toHaveLength(1);
    expect(within(suggestionList()).getByText('Duration')).toBeInTheDocument();
    expect(screen.getByText('Already extracted by this rule: target.')).toBeInTheDocument();
  });

  it('Add is disabled when nothing is ticked, so the button can never claim to add zero values', async () => {
    const user = userEvent.setup();
    renderEditor();
    await settled();
    const items = within(suggestionList()).getAllByRole('listitem');
    await user.click(within(items[0]).getByRole('checkbox', { name: 'Endpoint' }));
    await user.click(within(items[1]).getByRole('checkbox', { name: 'Duration' }));
    expect(screen.getByRole('button', { name: 'Add 0 selected values' })).toBeDisabled();
  });

  it('Remove drops a suggestion from the offer without adding anything to the rule', async () => {
    const user = userEvent.setup();
    renderEditor();
    await settled();
    await user.click(screen.getByRole('button', { name: 'Remove suggestion endpoint' }));
    const items = within(suggestionList()).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(within(items[0]).getByText('Duration')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /confirmed/ })).not.toBeInTheDocument();
    expect(screen.getByText('None yet. Add a suggested value above, or add one yourself.')).toBeInTheDocument();
  });

  it('"Detect extractable values again" re-asks the server with the same scope', async () => {
    const user = userEvent.setup();
    renderEditor();
    await settled();
    mockSuggest.mockResolvedValue(suggestionResult({ suggestions: [{ definition: { ...ENDPOINT_EXTRACTION }, extracted: 12, of: 40 }] }));
    await user.click(screen.getByRole('button', { name: 'Detect extractable values again' }));
    await waitFor(() => expect(mockSuggest).toHaveBeenCalledTimes(2));
    expect(mockSuggest.mock.calls[1][0].scope).toEqual(SCOPE);
    expect(await screen.findByText('Found in 12 / 40')).toBeInTheDocument();
  });

  it('a value the rule already extracts is listed as already extracted, never offered again', async () => {
    mockSuggest.mockResolvedValue(
      suggestionResult({
        alreadyDefined: ['endpoint'],
        suggestions: [suggestionResult().suggestions[1]],
      }),
    );
    renderEditor({ initialRule: rule({ extractions: [{ ...ENDPOINT_EXTRACTION }] }) });
    await settled();

    expect(screen.getByText('Already extracted by this rule: endpoint.')).toBeInTheDocument();
    const items = within(suggestionList()).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(within(items[0]).getByText('Duration')).toBeInTheDocument();
    expect(within(suggestionList()).queryByText('Endpoint')).not.toBeInTheDocument();
    // It is present exactly once, as the rule's own confirmed value.
    expect(screen.getByRole('group', { name: 'Endpoint (confirmed)' })).toBeInTheDocument();
  });
});

describe('RuleEditor - assisted extraction: nothing could be suggested', () => {
  beforeEach(() => {
    mockSuggest.mockResolvedValue(NO_SUGGESTION);
  });

  it('explains why and offers all three ways forward - retry, author one, or skip', async () => {
    renderEditor();
    await settled();
    // The server's own reason is the explanation when it sends one - never replaced by a generic guess.
    expect(screen.getByText('Every candidate value was unique to a single event.')).toBeInTheDocument();
    for (const name of ['Detect extractable values again', 'Add extraction manually', 'Skip extraction']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    // One control, one name: the step's own action row does not repeat the manual button.
    expect(screen.getAllByRole('button', { name: 'Add extraction manually' })).toHaveLength(1);
  });

  it('falls back to a plain explanation when the server sends no reason, rather than an empty block', async () => {
    mockSuggest.mockResolvedValue({ ...NO_SUGGESTION, reason: null });
    renderEditor();
    await settled();
    expect(screen.getByText('No extraction could be suggested safely from the sampled events.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skip extraction' })).toBeInTheDocument();
  });

  it('"Add extraction manually" adds one empty value whose Advanced disclosure already holds the expression field', async () => {
    const user = userEvent.setup();
    renderEditor();
    await settled();
    await user.click(screen.getByRole('button', { name: 'Add extraction manually' }));

    const group = screen.getByRole('group', { name: 'Extraction 1' });
    expect(within(group).getByLabelText('Name')).toHaveValue('');
    expect(within(group).getByLabelText('Source field')).toHaveValue('message');
    // Opened for the user, because a hand-written value is nothing without its expression.
    expect(within(group).getByRole('button', { name: /Advanced: how this value is read/ })).toHaveAttribute('aria-expanded', 'true');
    expect(within(group).getByLabelText('Expression')).toHaveValue('');
    expect(within(group).getByLabelText('Method')).toHaveValue('REGEX');
    expect(within(group).getByText('RE2 syntax with a named group, e.g. (?P<name>...).')).toBeInTheDocument();

    await user.selectOptions(within(group).getByLabelText('Method'), 'JSON_POINTER');
    expect(within(group).getByText('A JSON pointer starting with "/".')).toBeInTheDocument();
  });

  it('"Skip extraction" leaves the rule with no extractions and says so plainly', async () => {
    const user = userEvent.setup();
    renderEditor();
    await settled();
    await user.click(screen.getByRole('button', { name: 'Skip extraction' }));
    expect(screen.getByRole('heading', { name: 'Step 4 of 5: Test' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '3. Extraction' }));
    expect(screen.getByText('Extraction skipped. The rule will still tag matching events.')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /confirmed/ })).not.toBeInTheDocument();
  });
});

describe('RuleEditor - assisted extraction: regex stays behind the disclosure', () => {
  it('a confirmed value shows no method, group or expression until "Advanced: how this value is read" is opened', async () => {
    const user = userEvent.setup();
    mockSuggest.mockResolvedValue(suggestionResult({ status: 'NO_SUGGESTION', reason: null, suggestions: [] }));
    renderEditor({ initialRule: rule({ extractions: [{ ...ENDPOINT_EXTRACTION }] }) });
    await settled();

    const group = screen.getByRole('group', { name: 'Endpoint (confirmed)' });
    const disclosure = within(group).getByRole('button', { name: /Advanced: how this value is read/ });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(within(group).queryByLabelText('Expression')).not.toBeInTheDocument();
    expect(within(group).queryByLabelText('Method')).not.toBeInTheDocument();
    expect(within(group).queryByLabelText('Group (optional)')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('MW call (?P<endpoint>\\S+)')).not.toBeInTheDocument();
    // The plain-language fields stay visible throughout - only the syntax is folded away.
    expect(within(group).getByLabelText('Name')).toHaveValue('endpoint');
    expect(within(group).getByLabelText('Value type')).toHaveValue('STRING');

    await user.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(within(group).getByLabelText('Expression')).toHaveValue('MW call (?P<endpoint>\\S+)');
    expect(within(group).getByLabelText('Method')).toHaveValue('REGEX');
  });
});

describe('RuleEditor - assisted extraction: accessibility', () => {
  it('has no axe violations on the extraction step with suggestions on offer', async () => {
    const { container } = renderEditor();
    await settled();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has no axe violations on the extraction step with a confirmed value and its disclosure open', async () => {
    const user = userEvent.setup();
    const { container } = renderEditor({ initialRule: rule({ extractions: [{ ...ENDPOINT_EXTRACTION }] }) });
    await settled();
    await user.click(screen.getByRole('button', { name: /Advanced: how this value is read/ }));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has no axe violations on the "nothing could be suggested" state', async () => {
    mockSuggest.mockResolvedValue(NO_SUGGESTION);
    const { container } = renderEditor();
    await settled();
    expect(await axe(container)).toHaveNoViolations();
  });
});
