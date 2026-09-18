import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { ClassificationRulesWorkspace } from './ClassificationRulesWorkspace';
import {
  ApiError,
  applyClassificationImport,
  createClassificationRule,
  deleteClassificationRule,
  detectClassificationPattern,
  downloadClassificationRulesExport,
  fetchClassificationRules,
  previewClassificationImport,
  suggestClassificationExtractions,
  testClassificationRule,
  updateClassificationRule,
} from '../../../shared/api/client';
import type {
  ClassificationRule,
  ClassificationRulesState,
  ClassificationSampleScope,
  ImportPreviewResult,
  PatternDetectionResult,
  RuleTestResult,
} from '../../../shared/api/types';
import { fullEvent } from '../../inspector/testEventFixture';

vi.mock('../../../shared/api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../shared/api/client')>('../../../shared/api/client');
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
const mockSuggestExtractions = vi.mocked(suggestClassificationExtractions);
const mockTest = vi.mocked(testClassificationRule);
const mockDownload = vi.mocked(downloadClassificationRulesExport);
const mockPreview = vi.mocked(previewClassificationImport);
const mockApply = vi.mocked(applyClassificationImport);

const SCOPE: ClassificationSampleScope = {
  sourceId: 'local-docker',
  composeProject: 'demo',
  start: '2026-01-01T00:00:00.000Z',
  end: '2026-01-02T00:00:00.000Z',
  services: ['gateway'],
  serviceFilterMode: 'INCLUDE',
  levels: ['INFO', 'WARN', 'ERROR'],
};

const RULE_A: ClassificationRule = {
  id: 'mw-call',
  name: 'Middleware call',
  description: 'Calls to the middleware',
  tags: ['middleware'],
  enabled: true,
  priority: 100,
  matchMode: 'ALL',
  conditions: [{ field: 'message', matcher: 'STARTS_WITH', value: 'MW call', ignoreCase: false }],
  extractions: [
    { name: 'endpoint', label: 'Endpoint', sourceField: 'message', type: 'REGEX', expression: 'MW call (?P<endpoint>\\S+)', valueType: 'STRING', sensitive: false },
  ],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const RULE_B: ClassificationRule = {
  id: 'pay-fail',
  name: 'Payment failure',
  tags: ['payments'],
  enabled: false,
  matchMode: 'ANY',
  conditions: [
    { field: 'errorCode', matcher: 'EXACT', value: 'ERR_PAY' },
    { field: 'message', matcher: 'CONTAINS', value: 'payment failed' },
  ],
};

function rulesState(overrides: Partial<ClassificationRulesState> = {}): ClassificationRulesState {
  return {
    revision: 7,
    updatedAt: '2026-01-01T00:00:00Z',
    status: 'OK',
    statusMessage: null,
    storageFile: '/data/classification-rules.json',
    rules: [RULE_A, RULE_B],
    tags: ['middleware', 'payments'],
    tagColors: { middleware: 'BLUE', payments: 'GREEN' },
    limits: { maxConditionsPerRule: 3, maxExtractionsPerRule: 4, maxImportBytes: 1000, defaultSampleSize: 200, previewCount: 5 },
    fields: [
      { key: 'message', label: 'Message' },
      { key: 'service', label: 'Service' },
      { key: 'cif', label: 'CIF' },
      { key: 'journeyName', label: 'Journey Name' },
    ],
    runtime: { eventsEvaluated: 10, ruleMatches: 2, evaluationFailures: 0 },
    ...overrides,
  };
}

const MESSAGE = 'MW call /accounts took 120ms';

const DETECTION: PatternDetectionResult = {
  status: 'SUGGESTED',
  reason: null,
  field: 'message',
  structure: 'TEXT',
  sampledEvents: 200,
  valuesWithField: 150,
  similarEvents: 40,
  stableSegments: ['MW call ', ' took '],
  variableSegments: [
    { name: 'endpoint', kind: 'PATH', example: '/accounts' },
    { name: 'durationMs', kind: 'INTEGER', example: '120' },
  ],
  suggestedMatchMode: 'ALL',
  suggestedConditions: [{ field: 'message', matcher: 'REGEX', value: '^MW call \\S+ took \\d+ms$', ignoreCase: false }],
  suggestedPattern: '^MW call \\S+ took \\d+ms$',
  coverage: { matchedSimilar: 40, similar: 40, matchedOther: 2, other: 110 },
  suggestedExtractions: [
    {
      definition: { name: 'endpoint', label: 'Endpoint', sourceField: 'message', type: 'REGEX', expression: '^MW call (?P<endpoint>\\S+)', valueType: 'STRING', sensitive: false },
      extracted: 40,
      of: 40,
    },
  ],
  warnings: ['2 other sampled events also match this pattern.'],
};

const REVIEW_NOTE = 'Review these matches for false positives before saving. A sample cannot prove a rule is correct.';

const TEST_RESULT: RuleTestResult = {
  sampledEvents: 200,
  sampleLimitReached: true,
  matched: 12,
  notMatched: 188,
  extractionCoverage: [{ name: 'endpoint', label: 'Endpoint', extracted: 11, invalid: 1, of: 12 }],
  matchedPreview: [
    {
      timestamp: '2026-01-01T12:00:00.123Z',
      service: 'gateway',
      severity: 'INFO',
      field: 'message',
      fieldValue: MESSAGE,
      fieldValueTruncated: false,
      conditionsMatched: 1,
      conditionsTotal: 1,
      extracted: [{ name: 'endpoint', label: 'Endpoint', value: '/accounts-preview', status: 'PRESENT', redacted: false, truncated: false }],
    },
  ],
  nearMissPreview: [
    {
      timestamp: null,
      service: 'batch',
      severity: 'WARN',
      field: 'message',
      fieldValue: 'MW callback queued',
      fieldValueTruncated: false,
      conditionsMatched: 1,
      conditionsTotal: 2,
      extracted: [],
    },
  ],
  reviewNote: REVIEW_NOTE,
};

function importPreview(overrides: Partial<ImportPreviewResult> = {}): ImportPreviewResult {
  return {
    pack: { name: 'Team pack', version: '2' },
    rulesInPack: 3,
    newRules: 1,
    identical: 1,
    conflicts: 1,
    invalid: 0,
    items: [
      { index: 0, id: 'new-rule', name: 'New rule A', tags: ['x'], status: 'NEW', existingName: null, errors: [], displayColor: 'CYAN' },
      { index: 1, id: 'mw-call', name: 'Middleware call v2', tags: ['middleware'], status: 'CONFLICT', existingName: 'Middleware call', errors: [], displayColor: 'BLUE' },
      { index: 2, id: 'pay-fail', name: 'Payment failure', tags: ['payments'], status: 'IDENTICAL', existingName: null, errors: [], displayColor: 'RED' },
    ],
    currentRevision: 9,
    tagColorConflicts: [],
    ...overrides,
  };
}

function renderWorkspace(props: Partial<Parameters<typeof ClassificationRulesWorkspace>[0]> = {}) {
  const onClose = vi.fn();
  const onRulesChanged = vi.fn();
  const buildScope = vi.fn(() => SCOPE);
  const utils = render(
    <ClassificationRulesWorkspace
      sourceEvent={null}
      buildScope={buildScope}
      onRulesChanged={onRulesChanged}
      onClose={onClose}
      onOpenMapping={vi.fn()}
      onOpenSettings={vi.fn()}
      {...props}
    />,
  );
  return { ...utils, onClose, onRulesChanged, buildScope };
}

type User = ReturnType<typeof userEvent.setup>;

async function uploadPack(user: User, content = '{"format":"log-explorer-classification-pack"}', name = 'pack.json') {
  const file = new File([content], name, { type: 'application/json' });
  await user.upload(screen.getByLabelText('Import rules file'), file);
  return content;
}

function conflictError() {
  return new ApiError(409, { status: 409, reason: 'RULES_REVISION_CONFLICT', currentRevision: 8, detail: 'Revision conflict' });
}

beforeEach(() => {
  for (const m of [mockFetch, mockCreate, mockUpdate, mockDelete, mockDetect, mockSuggestExtractions, mockTest, mockDownload, mockPreview, mockApply]) {
    m.mockReset();
  }
  mockFetch.mockResolvedValue(rulesState());
  mockDownload.mockResolvedValue(undefined);
  // The extraction step asks for suggestions on arrival; tests that care override this.
  mockSuggestExtractions.mockResolvedValue({
    status: 'NO_SUGGESTION',
    reason: 'No extraction could be suggested safely from the sampled events.',
    field: 'message',
    sampledEvents: 200,
    matchedEvents: 12,
    suggestions: [],
    alreadyDefined: [],
    warnings: [],
  });
});

describe('ClassificationRulesWorkspace - list', () => {
  it('lists rules with tags, match summary and enabled state, plus revision and storage file', async () => {
    renderWorkspace();
    const table = await screen.findByRole('table', { name: 'Classification rules' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getByText('Middleware call')).toBeInTheDocument();
    expect(within(rows[1]).getByText('middleware')).toBeInTheDocument();
    expect(within(rows[1]).getByText('message · STARTS_WITH')).toBeInTheDocument();
    expect(within(rows[2]).getByText('2 conditions (ANY)')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Enabled: Middleware call' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Enabled: Payment failure' })).not.toBeChecked();
    expect(screen.getByText(/Revision 7/)).toBeInTheDocument();
    expect(screen.getByText('/data/classification-rules.json')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: /recovered/i })).not.toBeInTheDocument();
  });

  it('a rule with several tags shows the first as a real chip plus a NEUTRAL "+n" counter - never a chip per tag, never a second coloured chip (§22.11 A11/A3)', async () => {
    mockFetch.mockResolvedValue(rulesState({ rules: [{ ...RULE_A, tags: ['middleware', 'payments', 'slow'] }] }));
    renderWorkspace();
    const table = await screen.findByRole('table', { name: 'Classification rules' });
    const row = within(table).getAllByRole('row')[1];

    const coloured = within(row).getAllByText((_, el) => el?.hasAttribute('data-tag-color') === true);
    expect(coloured).toHaveLength(1);
    expect(coloured[0]).toHaveTextContent('middleware');

    expect(within(row).getByText('+2')).toBeInTheDocument();
    // The complete list is discoverable, not only in a hover: the cell's own accessible name carries it.
    expect(within(row).getByRole('cell', { name: 'Tags: middleware, payments, slow' })).toBeInTheDocument();
  });

  it('a rule with one tag shows no overflow counter at all', async () => {
    renderWorkspace();
    const table = await screen.findByRole('table', { name: 'Classification rules' });
    const row = within(table).getAllByRole('row')[1];
    expect(within(row).queryByText(/^\+\d+$/)).not.toBeInTheDocument();
  });

  it('shows a status banner with the server message when status is not OK', async () => {
    mockFetch.mockResolvedValue(rulesState({ status: 'RECOVERED_FROM_BACKUP', statusMessage: 'Primary file was unreadable.' }));
    renderWorkspace();
    expect(await screen.findByText('Rules were recovered from a backup file.')).toBeInTheDocument();
    expect(screen.getByText(/Primary file was unreadable\./)).toBeInTheDocument();
  });

  it('filters rules by name or tag', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await screen.findByRole('table');
    await user.type(screen.getByLabelText('Filter rules by name or tag'), 'payments');
    expect(screen.queryByText('Middleware call')).not.toBeInTheDocument();
    expect(screen.getByText('Payment failure')).toBeInTheDocument();
  });

  it('explains how to create a rule from an event when there are no rules', async () => {
    mockFetch.mockResolvedValue(rulesState({ rules: [], tags: [] }));
    renderWorkspace();
    expect(await screen.findByText('No classification rules yet.')).toBeInTheDocument();
    expect(screen.getByText(/Create tag rule from this event/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export all' })).toBeDisabled();
  });

  it('the Enabled switch PUTs the rule with enabled flipped and the current revision', async () => {
    const user = userEvent.setup();
    const { onRulesChanged } = renderWorkspace();
    mockUpdate.mockResolvedValue(rulesState({ revision: 8, rules: [{ ...RULE_A, enabled: false }, RULE_B] }));

    await user.click(await screen.findByRole('switch', { name: 'Enabled: Middleware call' }));

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const [id, revision, rule] = mockUpdate.mock.calls[0];
    expect(id).toBe('mw-call');
    expect(revision).toBe(7);
    expect(rule).toMatchObject({ id: 'mw-call', name: 'Middleware call', enabled: false, tags: ['middleware'] });
    expect(rule).not.toHaveProperty('createdAt');
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Enabled: Middleware call' })).not.toBeChecked());
    expect(onRulesChanged).toHaveBeenCalled();
  });

  it('Delete asks for confirmation naming the rule, and only then calls DELETE with the revision', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    mockDelete.mockResolvedValue(rulesState({ revision: 8, rules: [RULE_B] }));

    await user.click(await screen.findByRole('button', { name: 'Delete Middleware call' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete rule?' });
    expect(within(dialog).getByText('Delete the rule "Middleware call"? This cannot be undone.')).toBeInTheDocument();
    expect(mockDelete).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(mockDelete).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete Middleware call' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete rule' }));
    expect(mockDelete).toHaveBeenCalledWith('mw-call', 7);
    await waitFor(() => expect(screen.queryByText('Middleware call')).not.toBeInTheDocument());
  });

  it('Duplicate opens the editor prefilled as "Copy of …" without an id, and saving creates a new rule', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    mockCreate.mockResolvedValue(rulesState({ revision: 8 }));

    await user.click(await screen.findByRole('button', { name: 'Duplicate Middleware call' }));
    expect(screen.getByRole('heading', { name: 'Duplicate rule' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Step 2 of 5: Classification' })).toBeInTheDocument();
    expect(screen.getByLabelText('Rule name')).toHaveValue('Copy of Middleware call');
    expect(screen.getByLabelText('Tags (comma-separated, required)')).toHaveValue('middleware');

    await user.click(screen.getByRole('button', { name: '5. Save' }));
    await user.click(screen.getByRole('button', { name: 'Save rule' }));
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const [revision, rule] = mockCreate.mock.calls[0];
    expect(revision).toBe(7);
    expect(rule.id).toBeUndefined();
    expect(rule).toMatchObject({ name: 'Copy of Middleware call', tags: ['middleware'], conditions: RULE_A.conditions });
    expect(await screen.findByText('Rule saved. Re-run Search to classify currently loaded results.')).toBeInTheDocument();
  });

  it('Export all downloads every rule; Export selected sends only the selected ids', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await screen.findByRole('table');
    expect(screen.getByRole('button', { name: 'Export selected' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Export all' }));
    expect(mockDownload).toHaveBeenLastCalledWith(undefined);

    await user.click(screen.getByRole('checkbox', { name: 'Select Payment failure for export' }));
    await user.click(screen.getByRole('button', { name: 'Export selected (1)' }));
    expect(mockDownload).toHaveBeenLastCalledWith(['pay-fail']);
  });

  it('shows the error when an export fails', async () => {
    const user = userEvent.setup();
    mockDownload.mockRejectedValue(new ApiError(503, { status: 503, detail: 'Rules storage unavailable' }));
    renderWorkspace();
    await user.click(await screen.findByRole('button', { name: 'Export all' }));
    expect(await screen.findByText('Export failed: Rules storage unavailable')).toBeInTheDocument();
  });

  it('a 409 on toggle shows the conflict message, and Reload rules re-fetches the state', async () => {
    const user = userEvent.setup();
    mockUpdate.mockRejectedValue(conflictError());
    renderWorkspace();
    await user.click(await screen.findByRole('switch', { name: 'Enabled: Middleware call' }));
    expect(
      await screen.findByText('These rules were changed elsewhere. Reload the latest rules, then save again.'),
    ).toBeInTheDocument();

    mockFetch.mockResolvedValue(rulesState({ revision: 8 }));
    await user.click(screen.getByRole('button', { name: 'Reload rules' }));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/Revision 8/)).toBeInTheDocument();
    expect(screen.queryByText(/changed elsewhere/)).not.toBeInTheDocument();
  });

  it('has no axe violations on the list view', async () => {
    const { container } = renderWorkspace();
    await screen.findByRole('table');
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('ClassificationRulesWorkspace - import', () => {
  it('rejects a file over maxImportBytes client-side without calling preview', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await screen.findByRole('table');
    await uploadPack(user, 'x'.repeat(2000), 'big.json');
    expect(await screen.findByText(/"big\.json" is 2 KB, larger than the 1000 bytes import limit\./)).toBeInTheDocument();
    expect(mockPreview).not.toHaveBeenCalled();
  });

  it('draws each pack rule\'s tags as a real coloured chip, in that rule\'s OWN colour, never the matched rule\'s colour (§22.11 A12)', async () => {
    const user = userEvent.setup();
    mockPreview.mockResolvedValue(importPreview());
    renderWorkspace();
    await screen.findByRole('table');
    await uploadPack(user);
    await screen.findByRole('heading', { name: 'Import classification rules' });

    const newRow = screen.getByText('New rule A').closest('li') as HTMLElement;
    const newChip = within(newRow).getByText('x').closest('[data-tag-color]') as HTMLElement;
    expect(newChip).toHaveAttribute('data-tag-color', 'CYAN');

    // CONFLICT: the pack rule's own colour (BLUE), never the existing "Middleware call" rule's colour - here they
    // happen to coincide, which would hide a bug that substitutes one for the other, so also proved below with a
    // pack whose colour genuinely differs from the existing rule's.
    const conflictRow = screen.getByText('Middleware call v2').closest('li') as HTMLElement;
    expect(within(conflictRow).getByText('middleware').closest('[data-tag-color]')).toHaveAttribute('data-tag-color', 'BLUE');
  });

  it('a CONFLICT item keeps drawing the PACK rule\'s own colour even when it genuinely differs from the existing rule\'s (never silently substituted)', async () => {
    const user = userEvent.setup();
    mockPreview.mockResolvedValue(
      importPreview({
        conflicts: 1,
        items: [
          { index: 0, id: 'mw-call', name: 'Middleware call v2', tags: ['middleware'], status: 'CONFLICT', existingName: 'Middleware call', errors: [], displayColor: 'PURPLE' },
        ],
      }),
    );
    renderWorkspace();
    await screen.findByRole('table');
    await uploadPack(user);
    const row = (await screen.findByText('Middleware call v2')).closest('li') as HTMLElement;
    expect(within(row).getByText('middleware').closest('[data-tag-color]')).toHaveAttribute('data-tag-color', 'PURPLE');
  });

  it('previews counts; merge with conflicts requires a resolution; Apply sends the preview revision and shows the summary', async () => {
    const user = userEvent.setup();
    mockPreview.mockResolvedValue(importPreview());
    const { onRulesChanged } = renderWorkspace();
    await screen.findByRole('table');
    const text = await uploadPack(user);

    expect(await screen.findByRole('heading', { name: 'Import classification rules' })).toBeInTheDocument();
    expect(mockPreview).toHaveBeenCalledWith(text);
    expect(screen.getByText(/Team pack · version 2/)).toBeInTheDocument();
    for (const label of ['Rules in pack: 3', 'New: 1', 'Identical: 1', 'Conflicts: 1', 'Invalid: 0']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText(/existing rule: Middleware call/)).toBeInTheDocument();

    const apply = screen.getByRole('button', { name: 'Apply import' });
    expect(apply).toBeDisabled();
    expect(screen.getByText('Choose how to handle rules that conflict with existing rules.')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Use imported rule' }));
    expect(apply).toBeEnabled();

    mockApply.mockResolvedValue({ state: rulesState({ revision: 10 }), added: 1, replaced: 1, unchanged: 1, keptExisting: 0, removed: 0 });
    await user.click(apply);
    expect(mockApply).toHaveBeenCalledWith({
      packJson: text,
      mode: 'MERGE',
      conflictResolution: 'USE_IMPORTED',
      expectedRevision: 9,
      confirmReplaceAll: undefined,
    });
    expect(
      await screen.findByText('Import applied. Added 1, replaced 1, unchanged 1, kept existing 0, removed 0.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Revision 10/)).toBeInTheDocument();
    expect(onRulesChanged).toHaveBeenCalled();
  });

  it('surfaces a tag colour conflict BEFORE Apply and blocks both MERGE and REPLACE_ALL until it is resolved outside the app (§22.11 A1a)', async () => {
    const user = userEvent.setup();
    mockPreview.mockResolvedValue(
      importPreview({
        conflicts: 0,
        tagColorConflicts: [
          { path: 'rules[0].displayColor', message: 'Tag "payments" is already shown in BLUE by "Payment failure". Every rule that uses a tag must show it in the same colour — change one of the two colours.' },
        ],
      }),
    );
    renderWorkspace();
    await screen.findByRole('table');
    await uploadPack(user);

    expect(await screen.findByText('Tag colour conflicts: 1')).toBeInTheDocument();
    expect(screen.getByText(/Tag "payments" is already shown in BLUE by "Payment failure"/)).toBeInTheDocument();
    expect(screen.getByText(/resolve it by editing the pack file or an existing rule's colour/)).toBeInTheDocument();

    // MERGE is blocked, with no resolution radios offered for a colour conflict - there is nothing to pick between.
    const apply = screen.getByRole('button', { name: 'Apply import' });
    expect(apply).toBeDisabled();

    // Blocked under REPLACE_ALL too, even after its own confirmation is checked - the colour conflict is a
    // separate, independent blocker that survives switching modes.
    await user.click(screen.getByRole('radio', { name: 'Replace all rules' }));
    await user.click(screen.getByRole('checkbox', { name: 'I understand this deletes every existing rule that is not in this pack' }));
    expect(apply).toBeDisabled();
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('a clean pack (no colour conflict) shows the zero count and never blocks on it', async () => {
    const user = userEvent.setup();
    mockPreview.mockResolvedValue(importPreview({ conflicts: 0, tagColorConflicts: [] }));
    renderWorkspace();
    await screen.findByRole('table');
    await uploadPack(user);
    expect(await screen.findByText('Tag colour conflicts: 0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply import' })).toBeEnabled();
  });

  it('disables Apply with an explanation when the pack contains invalid rules', async () => {
    const user = userEvent.setup();
    mockPreview.mockResolvedValue(
      importPreview({
        conflicts: 0,
        invalid: 1,
        items: [
          { index: 0, id: 'broken', name: 'Broken rule', tags: [], status: 'INVALID', existingName: null, errors: [{ path: 'tags', message: 'At least one tag is required' }], displayColor: 'GRAY' },
        ],
      }),
    );
    renderWorkspace();
    await screen.findByRole('table');
    await uploadPack(user);
    expect(await screen.findByText('Invalid: 1')).toBeInTheDocument();
    expect(screen.getByText(/At least one tag is required/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply import' })).toBeDisabled();
    expect(screen.getByText(/This pack contains 1 invalid rule\. Apply is disabled/)).toBeInTheDocument();
  });

  it('Replace all requires the explicit confirmation before Apply is enabled', async () => {
    const user = userEvent.setup();
    mockPreview.mockResolvedValue(importPreview());
    renderWorkspace();
    await screen.findByRole('table');
    const text = await uploadPack(user);
    await screen.findByRole('heading', { name: 'Import classification rules' });

    await user.click(screen.getByRole('radio', { name: 'Replace all rules' }));
    expect(screen.queryByRole('radio', { name: 'Use imported rule' })).not.toBeInTheDocument();
    const apply = screen.getByRole('button', { name: 'Apply import' });
    expect(apply).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: 'I understand this deletes every existing rule that is not in this pack' }));
    expect(apply).toBeEnabled();
    mockApply.mockResolvedValue({ state: rulesState(), added: 1, replaced: 0, unchanged: 1, keptExisting: 0, removed: 1 });
    await user.click(apply);
    expect(mockApply).toHaveBeenCalledWith({
      packJson: text,
      mode: 'REPLACE_ALL',
      conflictResolution: undefined,
      expectedRevision: 9,
      confirmReplaceAll: true,
    });
  });

  it('Cancel closes the import without ever calling apply', async () => {
    const user = userEvent.setup();
    mockPreview.mockResolvedValue(importPreview());
    renderWorkspace();
    await screen.findByRole('table');
    await uploadPack(user);
    await screen.findByRole('heading', { name: 'Import classification rules' });
    await user.click(screen.getByRole('radio', { name: 'Keep existing rule' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Import classification rules' })).not.toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('a 409 on apply shows the conflict message; Reload rules refreshes the preview revision', async () => {
    const user = userEvent.setup();
    mockPreview.mockResolvedValueOnce(importPreview()).mockResolvedValueOnce(importPreview({ currentRevision: 11 }));
    mockApply.mockRejectedValueOnce(conflictError());
    renderWorkspace();
    await screen.findByRole('table');
    await uploadPack(user);
    await user.click(await screen.findByRole('radio', { name: 'Keep existing rule' }));
    await user.click(screen.getByRole('button', { name: 'Apply import' }));
    expect(
      await screen.findByText('These rules were changed elsewhere. Reload the latest rules, then save again.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reload rules' }));
    await waitFor(() => expect(mockPreview).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText(/changed elsewhere/)).not.toBeInTheDocument());
    mockApply.mockResolvedValue({ state: rulesState(), added: 0, replaced: 0, unchanged: 2, keptExisting: 1, removed: 0 });
    await user.click(screen.getByRole('button', { name: 'Apply import' }));
    expect(mockApply).toHaveBeenLastCalledWith(expect.objectContaining({ expectedRevision: 11, conflictResolution: 'KEEP_EXISTING' }));
  });
});

describe('Rule wizard - create from event', () => {
  const event = fullEvent({ message: MESSAGE });

  async function renderFromEvent() {
    const utils = renderWorkspace({ sourceEvent: event });
    await screen.findByRole('heading', { name: 'Step 1 of 6: Source' });
    return utils;
  }

  it('Source step: shows the event summary, defaults the field to message, and previews its value', async () => {
    const user = userEvent.setup();
    await renderFromEvent();
    expect(screen.getByRole('heading', { name: 'Create tag rule from event' })).toBeInTheDocument();
    expect(screen.getByText('payments-api')).toBeInTheDocument();
    expect(screen.getByText('ERROR')).toBeInTheDocument();

    const field = screen.getByLabelText('Field');
    expect(field).toHaveValue('message');
    expect(screen.getByLabelText('Sample value')).toHaveValue(MESSAGE);

    const optionValues = within(field).getAllByRole('option').map((o) => (o as HTMLOptionElement).value);
    expect(optionValues).toContain('service');
    expect(optionValues).toContain('extra.extraField');
    expect(optionValues).toContain('mdc.custom.mdc.key');
    // Protected fields and fields with no value on this event are not offered.
    expect(optionValues).not.toContain('cif');
    expect(optionValues).not.toContain('journeyName');

    await user.selectOptions(field, 'mdc.custom.mdc.key');
    expect(screen.getByLabelText('Sample value')).toHaveValue('mdc-value');
  });

  it('Detect: shows loading, then the suggestion details; the request carries the field value and search scope', async () => {
    const user = userEvent.setup();
    let resolveDetect: (r: PatternDetectionResult) => void = () => undefined;
    mockDetect.mockImplementation(() => new Promise((resolve) => { resolveDetect = resolve; }));
    const { buildScope } = await renderFromEvent();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { name: 'Step 2 of 6: Detect' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Detect pattern' }));

    expect(screen.getByRole('button', { name: 'Detecting…' })).toBeDisabled();
    expect(buildScope).toHaveBeenCalled();
    expect(mockDetect).toHaveBeenCalledWith({ field: 'message', anchorValue: MESSAGE, scope: SCOPE, sampleSize: 200 });

    resolveDetect(DETECTION);
    expect(await screen.findByText('Sampled: 200')).toBeInTheDocument();
    expect(screen.getByText('With this field: 150')).toBeInTheDocument();
    expect(screen.getByText('Similar: 40')).toBeInTheDocument();
    expect(screen.getByText('"MW call "')).toBeInTheDocument();
    expect(screen.getByText(/\(INTEGER\), e\.g\./)).toBeInTheDocument();
    expect(screen.getByText('^MW call \\S+ took \\d+ms$')).toBeInTheDocument();
    expect(screen.getByText('Matches 40 of 40 similar events; also matches 2 other sampled events.')).toBeInTheDocument();
    expect(screen.getByText('2 other sampled events also match this pattern.')).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('Detect: NO_SAFE_PATTERN_SUGGESTION shows the reason and the manual path', async () => {
    const user = userEvent.setup();
    mockDetect.mockResolvedValue({
      ...DETECTION,
      status: 'NO_SAFE_PATTERN_SUGGESTION',
      reason: 'Too few similar events in the sample.',
      suggestedConditions: [],
      suggestedExtractions: [],
      suggestedPattern: null,
      coverage: null,
      warnings: [],
    });
    await renderFromEvent();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Detect pattern' }));
    expect(await screen.findByText('Too few similar events in the sample.')).toBeInTheDocument();
    expect(
      screen.getByText('No safe pattern could be suggested. You can still create the rule manually (Advanced).'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use this suggestion' })).not.toBeInTheDocument();
  });

  it('Detect: shows the API error message', async () => {
    const user = userEvent.setup();
    mockDetect.mockRejectedValue(new ApiError(503, { status: 503, detail: 'Source is unreachable' }));
    await renderFromEvent();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Detect pattern' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Source is unreachable');
  });

  it('"Use this suggestion" fills conditions and extractions; extractions can be renamed, added and removed; Test and Save work end to end', async () => {
    const user = userEvent.setup();
    mockDetect.mockResolvedValue(DETECTION);
    mockTest.mockResolvedValue(TEST_RESULT);
    const saved = rulesState({ revision: 8 });
    mockCreate.mockResolvedValue(saved);
    const { onRulesChanged } = await renderFromEvent();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Detect pattern' }));
    await user.click(await screen.findByRole('button', { name: 'Use this suggestion' }));
    expect(screen.getByText(/Suggestion copied into the draft\. Nothing is saved yet/)).toBeInTheDocument();

    // Classification
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { name: 'Step 3 of 6: Classification' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Rule name'), 'Middleware call');
    await user.type(screen.getByLabelText('Tags (comma-separated, required)'), 'Middleware, MW ,middleware');
    expect(within(screen.getByRole('list', { name: 'Tags to save' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'middleware',
      'mw',
    ]);
    await user.click(screen.getByRole('button', { name: /advanced/i }));
    const condition = screen.getByRole('group', { name: 'Condition 1' });
    expect(within(condition).getByLabelText('Field')).toHaveValue('message');
    expect(within(condition).getByLabelText('Matcher')).toHaveValue('REGEX');
    expect(within(condition).getByLabelText('Regular expression')).toHaveValue('^MW call \\S+ took \\d+ms$');

    // Extraction - the suggestion already put one confirmed value in the draft; it can still be renamed,
    // and a manual one added and removed.
    await user.click(screen.getByRole('button', { name: 'Next' }));
    const extraction1 = await screen.findByRole('group', { name: 'Endpoint (confirmed)' });
    expect(within(extraction1).getByLabelText('Name')).toHaveValue('endpoint');
    await user.clear(within(extraction1).getByLabelText('Name'));
    await user.type(within(extraction1).getByLabelText('Name'), 'target');
    await user.click(screen.getByRole('button', { name: 'Add extraction manually' }));
    expect(screen.getByRole('group', { name: 'Extraction 2' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove extraction 2' }));
    expect(screen.queryByRole('group', { name: 'Extraction 2' })).not.toBeInTheDocument();

    // Test
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Test rule' }));
    expect(mockTest).toHaveBeenCalledWith({
      rule: expect.objectContaining({ name: 'Middleware call', tags: ['middleware', 'mw'] }),
      scope: SCOPE,
      sampleSize: 200,
    });
    expect(await screen.findByText('Sampled events: 200')).toBeInTheDocument();
    expect(screen.getByText(/Sample limit reached/)).toBeInTheDocument();
    expect(screen.getByText('Matched: 12')).toBeInTheDocument();
    expect(screen.getByText('Not matched: 188')).toBeInTheDocument();
    expect(screen.getByText('Endpoint — 11 / 12 (1 could not be read)')).toBeInTheDocument();
    expect(screen.getByText(MESSAGE)).toBeInTheDocument();
    expect(screen.getByText('/accounts-preview')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Borderline (matched some conditions)' })).toBeInTheDocument();
    expect(screen.getByText('MW callback queued')).toBeInTheDocument();
    expect(screen.getByText(REVIEW_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(/no false positives/i)).not.toBeInTheDocument();

    // Save
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { name: 'Step 6 of 6: Save' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save rule' }));
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const [revision, rule] = mockCreate.mock.calls[0];
    expect(revision).toBe(7);
    expect(rule.id).toBeUndefined();
    expect(rule).toMatchObject({
      name: 'Middleware call',
      tags: ['middleware', 'mw'],
      matchMode: 'ALL',
      conditions: DETECTION.suggestedConditions,
    });
    expect(rule.extractions).toHaveLength(1);
    expect(rule.extractions?.[0]).toMatchObject({ name: 'target', label: 'Endpoint', type: 'REGEX' });
    expect(await screen.findByText('Rule saved. Re-run Search to classify currently loaded results.')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Classification rules' })).toBeInTheDocument();
    expect(onRulesChanged).toHaveBeenCalled();
  });

  it('Advanced lets a user choose REGEX and edit the expression without using Detect', async () => {
    const user = userEvent.setup();
    mockCreate.mockResolvedValue(rulesState({ revision: 8 }));
    await renderFromEvent();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Skip / write conditions manually' }));

    expect(screen.getByRole('heading', { name: 'Step 3 of 6: Classification' })).toBeInTheDocument();
    const condition = screen.getByRole('group', { name: 'Condition 1' });
    expect(within(condition).getByLabelText('Value')).toBeInTheDocument();
    await user.selectOptions(within(condition).getByLabelText('Matcher'), 'REGEX');
    await user.type(within(condition).getByLabelText('Regular expression'), '^MW call .+');
    await user.click(within(condition).getByLabelText('Ignore case'));
    await user.type(screen.getByLabelText('Rule name'), 'MW');
    await user.type(screen.getByLabelText('Tags (comma-separated, required)'), 'middleware');

    await user.click(screen.getByRole('button', { name: '6. Save' }));
    await user.click(screen.getByRole('button', { name: 'Save rule' }));
    expect(mockCreate.mock.calls[0][1].conditions).toEqual([
      { field: 'message', matcher: 'REGEX', value: '^MW call .+', ignoreCase: true },
    ]);
  });

  it('Save requires a name and at least one tag before calling the server', async () => {
    const user = userEvent.setup();
    await renderFromEvent();
    await user.click(screen.getByRole('button', { name: '6. Save' }));
    await user.click(screen.getByRole('button', { name: 'Save rule' }));
    expect(screen.getByText('Enter a rule name (Classification step).')).toBeInTheDocument();
    expect(screen.getByText('Add at least one tag (Classification step).')).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('RULE_INVALID errors are listed and shown next to the offending condition', async () => {
    const user = userEvent.setup();
    mockCreate.mockRejectedValue(
      new ApiError(400, {
        status: 400,
        reason: 'RULE_INVALID',
        detail: 'The rule is invalid.',
        errors: [{ path: 'conditions[0].value', message: 'Pattern uses unsupported lookahead' }],
      }),
    );
    await renderFromEvent();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Skip / write conditions manually' }));
    await user.type(screen.getByLabelText('Rule name'), 'MW');
    await user.type(screen.getByLabelText('Tags (comma-separated, required)'), 'middleware');
    await user.click(screen.getByRole('button', { name: '6. Save' }));
    await user.click(screen.getByRole('button', { name: 'Save rule' }));

    expect(await screen.findByText('The rule is invalid.')).toBeInTheDocument();
    expect(screen.getByText('This rule is not valid yet:')).toBeInTheDocument();
    expect(screen.getByText('conditions[0].value')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '3. Classification' }));
    const condition = screen.getByRole('group', { name: 'Condition 1' });
    expect(within(condition).getByText('Pattern uses unsupported lookahead')).toBeInTheDocument();
  });

  it('a 409 on save keeps the draft; Reload rules re-fetches and the next save uses the new revision', async () => {
    const user = userEvent.setup();
    mockCreate.mockRejectedValueOnce(conflictError()).mockResolvedValueOnce(rulesState({ revision: 9 }));
    await renderFromEvent();
    await user.click(screen.getByRole('button', { name: '3. Classification' }));
    await user.type(screen.getByLabelText('Rule name'), 'MW');
    await user.type(screen.getByLabelText('Tags (comma-separated, required)'), 'middleware');
    await user.click(screen.getByRole('button', { name: '6. Save' }));
    await user.click(screen.getByRole('button', { name: 'Save rule' }));

    expect(
      await screen.findByText('These rules were changed elsewhere. Reload the latest rules, then save again.'),
    ).toBeInTheDocument();
    mockFetch.mockResolvedValue(rulesState({ revision: 8 }));
    await user.click(screen.getByRole('button', { name: 'Reload rules' }));
    expect(await screen.findByText(/Your draft is kept/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save rule' }));
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate.mock.calls[1][0]).toBe(8);
    expect(mockCreate.mock.calls[1][1]).toMatchObject({ name: 'MW', tags: ['middleware'] });
  });

  it('has no axe violations on the wizard (source step and detect results)', async () => {
    const user = userEvent.setup();
    mockDetect.mockResolvedValue(DETECTION);
    const { container } = await renderFromEvent();
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Detect pattern' }));
    await screen.findByText('Sampled: 200');
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Rule wizard - new rule without an event', () => {
  it('skips the Source step and disables Detect until a sample value is pasted, saying why', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(await screen.findByRole('button', { name: 'New rule' }));
    expect(screen.getByRole('heading', { name: 'Step 1 of 5: Detect' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Detect pattern' })).toBeDisabled();
    expect(screen.getByText('Detect needs a sample value. Paste one above, or write conditions manually.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Sample value'), 'MW call /x');
    expect(screen.getByRole('button', { name: 'Detect pattern' })).toBeEnabled();
  });
});
