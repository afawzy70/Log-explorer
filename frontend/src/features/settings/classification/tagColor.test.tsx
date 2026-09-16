import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { ClassificationRulesWorkspace } from './ClassificationRulesWorkspace';
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
} from '../../../shared/api/client';
import type { ClassificationRule, ClassificationRulesState, ClassificationSampleScope } from '../../../shared/api/types';
import { TAG_COLORS } from '../../../shared/api/types';

/**
 * Owner mission "Classification real search scope, assisted extraction, and visual tagging", third requirement:
 * a rule carries a colour from the controlled `TagColor` palette, chosen in the wizard, and every surface draws
 * the tag in it. Colour is identity, never severity, and never the only signal - the chip always shows its text
 * (CLAUDE.md §7), which is asserted here alongside the colour itself.
 */

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
const mockSuggest = vi.mocked(suggestClassificationExtractions);
const mockTest = vi.mocked(testClassificationRule);
const mockDownload = vi.mocked(downloadClassificationRulesExport);
const mockPreview = vi.mocked(previewClassificationImport);

const SCOPE: ClassificationSampleScope = {
  sourceId: 'local-docker',
  start: '2026-01-01T00:00:00.000Z',
  end: '2026-01-02T00:00:00.000Z',
};

const RULE_BLUE: ClassificationRule = {
  id: 'mw-call',
  name: 'Middleware call',
  tags: ['middleware', 'gateway'],
  displayColor: 'BLUE',
  enabled: true,
  matchMode: 'ALL',
  conditions: [{ field: 'message', matcher: 'STARTS_WITH', value: 'MW call', ignoreCase: false }],
};

const RULE_RED: ClassificationRule = {
  id: 'pay-fail',
  name: 'Payment failure',
  tags: ['payments'],
  displayColor: 'RED',
  enabled: true,
  matchMode: 'ANY',
  conditions: [{ field: 'errorCode', matcher: 'EXACT', value: 'ERR_PAY' }],
};

/** A saved rule whose colour the server has not (yet) resolved - it must still render, never crash or vanish. */
const RULE_UNCOLOURED: ClassificationRule = {
  id: 'legacy',
  name: 'Legacy rule',
  tags: ['legacy'],
  enabled: true,
  matchMode: 'ALL',
  conditions: [{ field: 'message', matcher: 'CONTAINS', value: 'legacy' }],
};

function rulesState(overrides: Partial<ClassificationRulesState> = {}): ClassificationRulesState {
  return {
    revision: 7,
    updatedAt: '2026-01-01T00:00:00Z',
    status: 'OK',
    statusMessage: null,
    storageFile: '/data/classification-rules.json',
    rules: [RULE_BLUE, RULE_RED, RULE_UNCOLOURED],
    tags: ['middleware', 'gateway', 'payments', 'legacy'],
    tagColors: { middleware: 'BLUE', gateway: 'BLUE', payments: 'RED' },
    limits: { maxConditionsPerRule: 3, maxExtractionsPerRule: 4, maxImportBytes: 1000, defaultSampleSize: 200, previewCount: 5 },
    fields: [
      { key: 'message', label: 'Message' },
      { key: 'service', label: 'Service' },
    ],
    runtime: { eventsEvaluated: 10, ruleMatches: 2, evaluationFailures: 0 },
    ...overrides,
  };
}

function renderWorkspace() {
  const onClose = vi.fn();
  const onRulesChanged = vi.fn();
  const buildScope = vi.fn(() => SCOPE);
  const utils = render(
    <ClassificationRulesWorkspace sourceEvent={null} buildScope={buildScope} onRulesChanged={onRulesChanged} onClose={onClose} />,
  );
  return { ...utils, onClose, onRulesChanged, buildScope };
}

type User = ReturnType<typeof userEvent.setup>;

/** Renders the workspace, then walks New rule -> Classification step, where the colour is chosen. */
async function openClassificationStep(user: User) {
  const utils = renderWorkspace();
  await user.click(await screen.findByRole('button', { name: 'New rule' }));
  await user.click(screen.getByRole('button', { name: '2. Classification' }));
  return { ...utils, fieldset: screen.getByRole('group', { name: 'Tag colour' }) };
}

/** The live preview chip beside the "Preview:" label. */
function previewChip(): HTMLElement {
  const row = screen.getByText('Preview:').closest('p') as HTMLElement;
  return row.querySelector('[data-tag-color]') as HTMLElement;
}

function tagChipsIn(container: HTMLElement): { text: string; color: string | null }[] {
  return Array.from(container.querySelectorAll('[data-tag-color]')).map((el) => ({
    text: el.textContent ?? '',
    color: el.getAttribute('data-tag-color'),
  }));
}

beforeEach(() => {
  for (const m of [mockFetch, mockCreate, mockUpdate, mockDelete, mockDetect, mockSuggest, mockTest, mockDownload, mockPreview]) {
    m.mockReset();
  }
  mockFetch.mockResolvedValue(rulesState());
  mockCreate.mockResolvedValue(rulesState({ revision: 8 }));
  mockUpdate.mockResolvedValue(rulesState({ revision: 8 }));
});

describe('Tag colour - choosing it in the Classification step', () => {
  it('offers the whole controlled palette, each entry named in words so the choice is never colour-only', async () => {
    const user = userEvent.setup();
    const { fieldset } = await openClassificationStep(user);
    const radios = within(fieldset).getAllByRole('radio');
    expect(radios).toHaveLength(TAG_COLORS.length);
    for (const name of ['Grey', 'Blue', 'Cyan', 'Green', 'Amber', 'Orange', 'Red', 'Purple']) {
      expect(within(fieldset).getByRole('radio', { name })).toBeInTheDocument();
    }
    // Neutral by default, so an untouched rule never claims a meaning it was not given.
    expect(within(fieldset).getByRole('radio', { name: 'Grey' })).toBeChecked();
    expect(
      within(fieldset).getByText(/Colour is a label, not a severity, and every tag always shows its name\./),
    ).toBeInTheDocument();
  });

  it('the live preview chip follows the chosen colour and shows the rule\'s own first tag', async () => {
    const user = userEvent.setup();
    const { fieldset } = await openClassificationStep(user);

    expect(previewChip()).toHaveAttribute('data-tag-color', 'GRAY');

    await user.click(within(fieldset).getByRole('radio', { name: 'Purple' }));
    expect(within(fieldset).getByRole('radio', { name: 'Purple' })).toBeChecked();
    expect(previewChip()).toHaveAttribute('data-tag-color', 'PURPLE');

    await user.type(screen.getByLabelText('Tags (comma-separated, required)'), 'Middleware');
    expect(previewChip()).toHaveTextContent('middleware');
    expect(previewChip()).toHaveAttribute('data-tag-color', 'PURPLE');

    await user.click(within(fieldset).getByRole('radio', { name: 'Green' }));
    expect(previewChip()).toHaveAttribute('data-tag-color', 'GREEN');
    expect(previewChip()).toHaveTextContent('middleware');
  });

  it('an edited rule opens on its saved colour rather than resetting to the neutral default', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(await screen.findByRole('button', { name: 'Edit Payment failure' }));
    const fieldset = screen.getByRole('group', { name: 'Tag colour' });
    expect(within(fieldset).getByRole('radio', { name: 'Red' })).toBeChecked();
    expect(previewChip()).toHaveAttribute('data-tag-color', 'RED');
  });
});

describe('Tag colour - what actually reaches the server', () => {
  async function saveNewRule(user: User, pickColour?: string) {
    const { fieldset } = await openClassificationStep(user);
    await user.type(screen.getByLabelText('Rule name'), 'Middleware call');
    await user.type(screen.getByLabelText('Tags (comma-separated, required)'), 'middleware');
    if (pickColour) {
      await user.click(within(fieldset).getByRole('radio', { name: pickColour }));
    }
    await user.click(screen.getByRole('button', { name: '5. Save' }));
    await user.click(screen.getByRole('button', { name: 'Save rule' }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    return mockCreate.mock.calls[0][1];
  }

  it('a rule saved without touching the colour sends no displayColor, so the server\'s deterministic default applies', async () => {
    const user = userEvent.setup();
    const sent = await saveNewRule(user);
    expect(sent).toMatchObject({ name: 'Middleware call', tags: ['middleware'] });
    expect(sent.displayColor).toBeUndefined();
    expect(Object.keys(sent)).not.toContain('displayColor');
  });

  /*
   * These two cases exist because the colour really was dropped once: every write goes through `toWritableRule`
   * in `ruleDraft.ts`, which builds its output field by field, and the colour was missing from that list - so a
   * picked colour never reached the server, and an enable-toggle or edit of an already-coloured rule silently
   * reset it. The helper now carries it through; these assert the contract from both directions.
   */
  it('sends the chosen Tag colour with the created rule', async () => {
    const user = userEvent.setup();
    const sent = await saveNewRule(user, 'Purple');
    expect(screen.queryByRole('radio', { name: 'Purple' })).not.toBeInTheDocument(); // wizard closed after saving
    expect(sent.displayColor).toBe('PURPLE');
  });

  it("keeps an existing rule's colour when the list's Enabled switch re-sends it", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(await screen.findByRole('switch', { name: 'Enabled: Payment failure' }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const [id, revision, sent] = mockUpdate.mock.calls[0];
    expect(id).toBe('pay-fail');
    expect(revision).toBe(7);
    expect(sent.displayColor).toBe('RED');
  });
});

describe('Tag colour - the rules list', () => {
  it('draws every rule\'s tags as chips in that rule\'s colour, with the tag text always present', async () => {
    renderWorkspace();
    const table = await screen.findByRole('table', { name: 'Classification rules' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);

    expect(tagChipsIn(rows[0])).toEqual([
      { text: 'middleware', color: 'BLUE' },
      { text: 'gateway', color: 'BLUE' },
    ]);
    expect(tagChipsIn(rows[1])).toEqual([{ text: 'payments', color: 'RED' }]);
    // No colour saved yet: the neutral palette entry, never an invented one, and never a chip with no text.
    expect(tagChipsIn(rows[2])).toEqual([{ text: 'legacy', color: 'GRAY' }]);
  });

  it('two rules never share one colour by accident - each row reads its own rule', async () => {
    renderWorkspace();
    const table = await screen.findByRole('table', { name: 'Classification rules' });
    const colors = tagChipsIn(table).map((c) => c.color);
    expect(new Set(colors)).toEqual(new Set(['BLUE', 'RED', 'GRAY']));
  });

  it('has no axe violations on the rules list', async () => {
    const { container } = renderWorkspace();
    await screen.findByRole('table', { name: 'Classification rules' });
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has no axe violations on the Classification step with the colour palette on screen', async () => {
    const user = userEvent.setup();
    const { container } = await openClassificationStep(user);
    expect(await axe(container)).toHaveNoViolations();
  });
});
