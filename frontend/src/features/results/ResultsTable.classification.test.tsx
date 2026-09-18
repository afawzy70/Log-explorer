import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { axe } from 'jest-axe';
import { ResultsTable } from './ResultsTable';
import { DEFAULT_HIDDEN_COLUMN_IDS } from './columnRegistry';
import type { LogEvent, RuleMatchDto } from '../../shared/api/types';

/**
 * Owner mission "Classification real search scope, assisted extraction, and visual tagging", fourth requirement:
 * once a rule is saved and Search re-run, a matched event must be visibly classified **in the results table** -
 * finding out must never require opening the inspector.
 *
 * The `event()` factory is the same one `ResultsTable.test.tsx` uses (copied rather than shared so this file stays
 * readable on its own and neither file can quietly change the other's fixtures).
 */
function event(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    timestamp: '2026-01-01T00:00:00.500Z',
    timestampRaw: '2026-01-01T00:00:00.500Z',
    schemaVersion: '1',
    service: 'gateway',
    serviceSourceHint: null,
    severity: 'INFO',
    severityNumber: 20000,
    message: 'connection timeout',
    logger: 'com.example.Gateway',
    thread: 'main',
    exception: null,
    traceId: 'trace-1',
    spanId: null,
    journeyId: null,
    eventId: null,
    businessStep: null,
    uiIdentifier: null,
    errorCode: null,
    correlationId: null,
    protectedFields: { cif: null, userName: 'al***e', customerId: null, deviceId: null, deviceIp: null },
    devicePlatformType: null,
    language: null,
    serverIp: null,
    serverHost: null,
    unknownTopLevelFields: {},
    unknownMdcFields: {},
    malformed: false,
    rawLine: null,
    sourceId: 'fixture',
    composeProject: null,
    composeService: null,
    containerId: null,
    containerName: null,
    stream: null,
    namespace: null,
    pod: null,
    contextTargetProof: null,
    tags: [],
    classifications: [],
    ...overrides,
  };
}

/** Default column order: Time, Level, Service, What happened, **Tags**, User/Customer, Correlation/Trace, Actions. */
const TAGS_CELL = 4;

function match(overrides: Partial<RuleMatchDto> = {}): RuleMatchDto {
  return {
    ruleId: 'mw-call',
    ruleName: 'Middleware call',
    tags: ['middleware'],
    displayColor: 'BLUE',
    extracted: [],
    ...overrides,
  };
}

const CLASSIFIED = event({
  message: 'MW call /accounts took 120ms',
  tags: ['middleware'],
  classifications: [match()],
});

function tagsCellOf(row: HTMLElement): HTMLElement {
  return within(row).getAllByRole('cell')[TAGS_CELL];
}

function chipColorsIn(cell: HTMLElement): (string | null)[] {
  return Array.from(cell.querySelectorAll('[data-tag-color]')).map((el) => el.getAttribute('data-tag-color'));
}

describe('ResultsTable - classification tags column', () => {
  it('shows a classified event\'s tag in the Tags column with no inspector interaction at all', () => {
    render(<ResultsTable events={[CLASSIFIED]} />);
    const headers = screen.getAllByRole('columnheader');
    expect((headers[TAGS_CELL].textContent ?? '').replace(/[↕▲▼].*$/, '').trim()).toBe('Tags');

    const row = screen.getAllByRole('row')[1];
    const cell = tagsCellOf(row);
    expect(cell.textContent).toContain('middleware');
    // No click, no menu, no dialog was needed to learn this.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('draws the tag in the colour of the rule that applied it, not a fixed default', () => {
    const green = event({ tags: ['payments'], classifications: [match({ ruleId: 'pay', ruleName: 'Payment failure', tags: ['payments'], displayColor: 'GREEN' })] });
    render(<ResultsTable events={[CLASSIFIED, green]} />);
    const rows = screen.getAllByRole('row').slice(1);
    expect(chipColorsIn(tagsCellOf(rows[0]))).toEqual(['BLUE']);
    expect(chipColorsIn(tagsCellOf(rows[1]))).toEqual(['GREEN']);
  });

  it('falls back to the neutral palette entry when the matching rule carries no colour - never an invented one', () => {
    const uncoloured = event({ tags: ['legacy'], classifications: [match({ tags: ['legacy'], displayColor: null })] });
    render(<ResultsTable events={[uncoloured]} />);
    expect(chipColorsIn(tagsCellOf(screen.getAllByRole('row')[1]))).toEqual(['GRAY']);
  });

  it('renders the first tag as a real (coloured) chip plus a NEUTRAL "+n" overflow counter - never a second coloured chip (§22.11 A3) - and puts the COMPLETE list in the cell\'s accessible name and title, never hover-only', () => {
    const many = event({
      tags: ['middleware', 'payments', 'slow'],
      classifications: [
        match({ tags: ['middleware'], displayColor: 'BLUE' }),
        match({ ruleId: 'pay', ruleName: 'Payment failure', tags: ['payments', 'slow'], displayColor: 'AMBER' }),
      ],
    });
    render(<ResultsTable events={[many]} />);
    const cell = tagsCellOf(screen.getAllByRole('row')[1]);

    // Exactly one real (coloured) tag chip: the first tag. The overflow counter carries no
    // `data-tag-color` at all - it counts identities, it is not one, so nothing can mistake
    // it for a second tag or paint it in the first tag's colour.
    const coloured = Array.from(cell.querySelectorAll('[data-tag-color]'));
    expect(coloured).toHaveLength(1);
    expect(coloured[0].textContent).toBe('middleware');
    expect(coloured[0]).toHaveAttribute('data-tag-color', 'BLUE');

    const overflow = cell.querySelector('[data-tag-color]')!.nextElementSibling as HTMLElement;
    expect(overflow.textContent).toBe('+2');
    expect(overflow).not.toHaveAttribute('data-tag-color');

    // The full list is readable as text, both for assistive technology and as a tooltip.
    expect(within(screen.getAllByRole('row')[1]).getByRole('cell', { name: 'Tags: middleware, payments, slow' })).toBe(cell);
    const titled = Array.from(cell.querySelectorAll('[title]'));
    expect(titled.length).toBeGreaterThan(0);
    for (const el of titled) {
      expect(el).toHaveAttribute('title', 'middleware, payments, slow');
    }
  });

  it('an unclassified event renders the placeholder in the Tags cell - the cell is never omitted', () => {
    render(<ResultsTable events={[event()]} />);
    const row = screen.getAllByRole('row')[1];
    const cells = within(row).getAllByRole('cell');
    expect(cells).toHaveLength(8);
    expect(cells[TAGS_CELL].textContent).toBe('—');
    expect(cells[TAGS_CELL].querySelector('[data-tag-color]')).toBeNull();
  });

  it('a classified row is exactly as tall as an unclassified one', () => {
    const { container } = render(<ResultsTable events={[CLASSIFIED, event({ message: 'plain line' })]} />);
    const rows = Array.from(container.querySelectorAll('tbody tr'));
    expect(rows).toHaveLength(2);
    expect(rows[0].getBoundingClientRect().height).toBe(rows[1].getBoundingClientRect().height);
    expect(rows[0].querySelectorAll('td')).toHaveLength(rows[1].querySelectorAll('td').length);

    /*
     * jsdom has no layout engine, so the rect comparison above can only catch a structural difference (an extra
     * row, a merged cell), never a real pixel one - it is kept because that is exactly the class of regression
     * that produced CLAUDE.md §4's "one event = one <tr>" rule. The actual guarantee that a chip cannot grow the
     * row is the chip's own capped height, which IS computable here, so it is asserted directly.
     */
    const chip = rows[0].querySelector('[data-tag-color]') as HTMLElement;
    expect(getComputedStyle(chip).height).toBe('18px');
  });

  it('the Tags column can be hidden through hiddenColumnIds, leaving every other column untouched', () => {
    function headerLabels() {
      return screen.getAllByRole('columnheader').map((h) => (h.textContent ?? '').replace(/[↕▲▼].*$/, '').trim());
    }
    const { rerender } = render(<ResultsTable events={[CLASSIFIED]} />);
    expect(headerLabels()).toEqual([
      'Time',
      'Level',
      'Service',
      'What happened',
      'Tags',
      'User / Customer',
      'Correlation / Trace',
      'Actions',
    ]);

    rerender(<ResultsTable events={[CLASSIFIED]} hiddenColumnIds={[...DEFAULT_HIDDEN_COLUMN_IDS, 'tags']} />);
    expect(headerLabels()).toEqual([
      'Time',
      'Level',
      'Service',
      'What happened',
      'User / Customer',
      'Correlation / Trace',
      'Actions',
    ]);
    const row = screen.getAllByRole('row')[1];
    const cells = within(row).getAllByRole('cell');
    expect(cells).toHaveLength(7);
    expect(cells[2].textContent).toBe('gateway');
    expect(cells[3].textContent).toContain('MW call /accounts took 120ms');
    expect(cells[4].textContent).toContain('al***e');
    expect(cells[5].textContent).toContain('trace-1');
    expect(row.querySelector('[data-tag-color]')).toBeNull();
  });

  it('has no axe violations with classified, multi-tagged and unclassified rows together', async () => {
    const { container } = render(
      <ResultsTable
        events={[
          CLASSIFIED,
          event({ tags: ['a', 'b'], classifications: [match({ tags: ['a', 'b'], displayColor: 'PURPLE' })] }),
          event({ message: 'plain line' }),
        ]}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
