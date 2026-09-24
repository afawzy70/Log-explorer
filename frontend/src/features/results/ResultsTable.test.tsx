import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { ResultsTable } from './ResultsTable';
import { DEFAULT_COLUMN_ORDER } from './columnRegistry';
import { eventIdentity } from '../../app/useSearchState';
import type { LogEvent } from '../../shared/api/types';

/**
 * Pre-closure functional recovery (§17): a sortable header's `textContent`
 * now includes its own accessible sort-state description (e.g. "Level↕,
 * not sorted, activate to sort ascending") after the visible label - real
 * accessibility improvement, not a bug. Tests asserting on the plain
 * label strip everything from the first sort-glyph onward; a
 * non-sortable header (no glyph at all) is returned unchanged.
 */
function headerLabel(header: Element): string {
  return (header.textContent ?? '').replace(/[↕▲▼].*$/, '').trim();
}

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
    rawJson: null,
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

describe('ResultsTable', () => {
  it('renders exactly the eight required columns, in order', () => {
    render(<ResultsTable events={[event()]} />);
    const headers = screen.getAllByRole('columnheader').map((h) => headerLabel(h));
    expect(headers).toEqual([
      'Time',
      'Level',
      'Service',
      'What happened',
      'Tags',
      'User / Customer',
      'Correlation / Trace',
      'Actions',
    ]);
  });

  it('is one semantic table with one colgroup', () => {
    const { container } = render(<ResultsTable events={[event()]} />);
    expect(container.querySelectorAll('table')).toHaveLength(1);
    expect(container.querySelectorAll('colgroup')).toHaveLength(1);
    expect(container.querySelectorAll('col')).toHaveLength(8);
  });

  /*
   * A8 / COMPONENT_INVENTORY.md's ResultsTable.tsx RESTYLE entry ("identity columns narrow when the
   * Inspector opens"). Only Tags declares a `narrowWidth` - every other column's `<col>` width is
   * unaffected by `inspectorOpen`.
   */
  describe('inspectorOpen - Tags column narrows when the Inspector is docked (A8)', () => {
    function tagsColWidth(container: HTMLElement): string {
      const cols = Array.from(container.querySelectorAll('colgroup col'));
      const tagsIndex = DEFAULT_COLUMN_ORDER.indexOf('tags');
      return (cols[tagsIndex] as HTMLElement).style.width;
    }

    it('Tags keeps its normal width when the Inspector is closed (the default)', () => {
      const { container } = render(<ResultsTable events={[event()]} />);
      expect(tagsColWidth(container)).toBe('150px');
    });

    it('Tags narrows to 132px when inspectorOpen is true', () => {
      const { container } = render(<ResultsTable events={[event()]} inspectorOpen />);
      expect(tagsColWidth(container)).toBe('132px');
    });

    it('every other column keeps its own width regardless of inspectorOpen', () => {
      const { container: closed } = render(<ResultsTable events={[event()]} />);
      const { container: open } = render(<ResultsTable events={[event()]} inspectorOpen />);
      const widths = (c: HTMLElement) => Array.from(c.querySelectorAll('colgroup col')).map((c) => (c as HTMLElement).style.width);
      const closedWidths = widths(closed);
      const openWidths = widths(open);
      const tagsIndex = DEFAULT_COLUMN_ORDER.indexOf('tags');
      closedWidths.forEach((w, i) => {
        if (i !== tagsIndex) {
          expect(openWidths[i]).toBe(w);
        }
      });
    });
  });

  it('renders one <tr> per event, each with exactly eight <td> cells (no second action row)', () => {
    const { container } = render(<ResultsTable events={[event(), event({ message: 'second event' })]} />);
    const bodyRows = container.querySelectorAll('tbody tr');
    expect(bodyRows).toHaveLength(2);
    bodyRows.forEach((row) => {
      expect(row.querySelectorAll('td')).toHaveLength(8);
    });
  });

  it('never renders the message under the service column - What happened is message only', () => {
    render(<ResultsTable events={[event({ service: 'gateway', message: 'a very specific message' })]} />);
    const row = screen.getAllByRole('row')[1];
    const cells = within(row).getAllByRole('cell');
    expect(cells[2].textContent).toBe('gateway');
    expect(cells[3].textContent).toContain('a very specific message');
    expect(cells[2].textContent).not.toContain('a very specific message');
  });

  it('falls back to serviceSourceHint (Compose service) when application is missing', () => {
    render(<ResultsTable events={[event({ service: null, serviceSourceHint: 'compose-gateway' })]} />);
    const row = screen.getAllByRole('row')[1];
    expect(within(row).getAllByRole('cell')[2].textContent).toBe('compose-gateway');
  });

  it('never omits a cell - missing values render the placeholder, not a blank/absent cell', () => {
    const bare = event({
      timestamp: null,
      severity: null,
      service: null,
      serviceSourceHint: null,
      message: null,
      protectedFields: { cif: null, userName: null, customerId: null, deviceId: null, deviceIp: null },
      traceId: null,
      correlationId: null,
    });
    render(<ResultsTable events={[bare]} />);
    const row = screen.getAllByRole('row')[1];
    const cells = within(row).getAllByRole('cell');
    expect(cells).toHaveLength(8);
    expect(cells[0].textContent).toBe('—');
    expect(cells[2].textContent).toBe('—');
    // Tags (4) is empty for an unclassified event, and still renders the placeholder rather than an absent cell.
    expect(cells[4].textContent).toBe('—');
    expect(cells[5].textContent).toBe('—');
    expect(cells[6].textContent).toBe('—');
  });

  it('renders malformed events with their raw line, marked malformed, other fields empty', () => {
    const malformed = event({
      malformed: true,
      message: null,
      rawLine: 'NOT-JSON garbage line',
      timestamp: null,
      severity: null,
      traceId: null,
    });
    render(<ResultsTable events={[malformed]} />);
    expect(screen.getByText('NOT-JSON garbage line')).toBeInTheDocument();
    expect(screen.getByText('malformed')).toBeInTheDocument();
  });

  it('shows the masked User/Customer value with its label, never a raw-looking substitute', () => {
    render(<ResultsTable events={[event({ protectedFields: { cif: null, userName: 'al***e', customerId: null, deviceId: null, deviceIp: null } })]} />);
    const row = screen.getAllByRole('row')[1];
    expect(within(row).getAllByRole('cell')[5].textContent).toContain('al***e');
    expect(within(row).getAllByRole('cell')[5].textContent).toContain('User');
  });

  it('shows the Trace ID with its label in Correlation/Trace', () => {
    render(<ResultsTable events={[event({ traceId: 'trace-abc' })]} />);
    const row = screen.getAllByRole('row')[1];
    expect(within(row).getAllByRole('cell')[6].textContent).toContain('trace-abc');
    expect(within(row).getAllByRole('cell')[6].textContent).toContain('Trace ID');
  });

  it('without onOpenJourney, the Correlation/Trace cell has no button at all', () => {
    render(<ResultsTable events={[event({ traceId: 'trace-abc' })]} />);
    const row = screen.getAllByRole('row')[1];
    expect(within(row).getAllByRole('cell')[6].querySelector('button')).toBeNull();
  });

  it('"supported click actions on non-sensitive IDs" (HANDOVER.md §17) - clicking the Correlation/Trace cell calls onOpenJourney with the right field, value, and this event as root (owner mission "Mapping Verification and Investigation Workspace")', async () => {
    const user = userEvent.setup();
    const onOpenJourney = vi.fn();
    const theEvent = event({ traceId: 'trace-abc' });
    render(<ResultsTable events={[theEvent]} onOpenJourney={onOpenJourney} />);
    await user.click(screen.getByRole('button', { name: /trace id:trace-abc/i }));
    expect(onOpenJourney).toHaveBeenCalledWith('traceId', 'trace-abc', theEvent);
  });

  it('renders rows in exactly the order given - no client-side reordering, no dropped/duplicated rows', () => {
    const events = [
      event({ message: 'newest' }),
      event({ message: 'middle' }),
      event({ message: 'oldest' }),
    ];
    render(<ResultsTable events={events} />);
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('newest');
    expect(rows[1].textContent).toContain('middle');
    expect(rows[2].textContent).toContain('oldest');
  });

  it('the table itself has no independent grid/flex layout system - table-layout is fixed', () => {
    const { container } = render(<ResultsTable events={[event()]} />);
    const table = container.querySelector('table')!;
    expect(getComputedStyle(table).tableLayout).toBe('fixed');
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = render(<ResultsTable events={[event(), event({ malformed: true, message: null, rawLine: 'x' })]} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  describe('arrow-key row navigation (UI Parity Acceleration Pass §6/§10)', () => {
    function actionsButtons() {
      return screen.getAllByRole('button', { name: /actions for this event/i });
    }

    it('ArrowDown moves focus from the current row to the next row\'s Actions button', async () => {
      const user = userEvent.setup();
      render(<ResultsTable events={[event({ message: 'first' }), event({ message: 'second' }), event({ message: 'third' })]} />);
      const buttons = actionsButtons();
      buttons[0].focus();

      await user.keyboard('{ArrowDown}');
      expect(buttons[1]).toHaveFocus();

      await user.keyboard('{ArrowDown}');
      expect(buttons[2]).toHaveFocus();
    });

    it('ArrowUp moves focus to the previous row', async () => {
      const user = userEvent.setup();
      render(<ResultsTable events={[event({ message: 'first' }), event({ message: 'second' })]} />);
      const buttons = actionsButtons();
      buttons[1].focus();

      await user.keyboard('{ArrowUp}');
      expect(buttons[0]).toHaveFocus();
    });

    it('ArrowDown on the last row, or ArrowUp on the first row, is a no-op (stays put)', async () => {
      const user = userEvent.setup();
      render(<ResultsTable events={[event({ message: 'only' })]} />);
      const [button] = actionsButtons();
      button.focus();

      await user.keyboard('{ArrowUp}');
      expect(button).toHaveFocus();
      await user.keyboard('{ArrowDown}');
      expect(button).toHaveFocus();
    });

    it('works correctly with a custom, reordered column configuration too', async () => {
      const user = userEvent.setup();
      render(
        <ResultsTable
          events={[event({ message: 'first' }), event({ message: 'second' })]}
          columnOrder={['level', 'time', 'service', 'whatHappened', 'userCustomer', 'correlationTrace']}
          hiddenColumnIds={[]}
        />,
      );
      const buttons = actionsButtons();
      buttons[0].focus();
      await user.keyboard('{ArrowDown}');
      expect(buttons[1]).toHaveFocus();
    });
  });

  describe('Legacy Remediation Slice 4 - column customization props', () => {
    it('showing an optional column via hiddenColumnIds renders its genuine field value, Actions still last', () => {
      const { container } = render(
        <ResultsTable
          events={[event({ logger: 'com.example.Gateway' })]}
          columnOrder={['time', 'level', 'service', 'whatHappened', 'userCustomer', 'correlationTrace', 'logger']}
          hiddenColumnIds={[]}
        />,
      );
      const headers = screen.getAllByRole('columnheader').map((h) => headerLabel(h));
      expect(headers).toEqual([
        'Time',
        'Level',
        'Service',
        'What happened',
        'User / Customer',
        'Correlation / Trace',
        'Logger',
        'Actions',
      ]);
      expect(container.querySelectorAll('col')).toHaveLength(8);
      const row = screen.getAllByRole('row')[1];
      const cells = within(row).getAllByRole('cell');
      expect(cells).toHaveLength(8);
      expect(cells[6].textContent).toBe('com.example.Gateway');
    });

    it('hiding a default column via hiddenColumnIds removes it, Actions unaffected', () => {
      render(
        <ResultsTable
          events={[event()]}
          columnOrder={['time', 'level', 'service', 'whatHappened', 'userCustomer', 'correlationTrace']}
          hiddenColumnIds={['service']}
        />,
      );
      const headers = screen.getAllByRole('columnheader').map((h) => headerLabel(h));
      expect(headers).toEqual(['Time', 'Level', 'What happened', 'User / Customer', 'Correlation / Trace', 'Actions']);
    });

    it('reordering columnOrder changes header and cell order together, so rows still correspond correctly to headers', () => {
      render(
        <ResultsTable
          events={[event({ service: 'gateway-svc' })]}
          columnOrder={['level', 'time', 'service', 'whatHappened', 'userCustomer', 'correlationTrace']}
          hiddenColumnIds={[]}
        />,
      );
      const headers = screen.getAllByRole('columnheader').map((h) => headerLabel(h));
      expect(headers[0]).toBe('Level');
      expect(headers[1]).toBe('Time');
      const row = screen.getAllByRole('row')[1];
      const cells = within(row).getAllByRole('cell');
      expect(cells[0].textContent).toBe('INFO'); // Level moved to first cell
      expect(cells[2].textContent).toBe('gateway-svc'); // Service still third
    });

    it('the mandatory Actions column is always rendered last regardless of columnOrder content', () => {
      render(
        <ResultsTable
          events={[event()]}
          columnOrder={['correlationTrace', 'userCustomer', 'whatHappened', 'service', 'level', 'time']}
          hiddenColumnIds={[]}
        />,
      );
      const headers = screen.getAllByRole('columnheader').map((h) => headerLabel(h));
      expect(headers[headers.length - 1]).toBe('Actions');
    });

    it('density="compact" applies the compact CSS class to the table', () => {
      const { container } = render(<ResultsTable events={[event()]} density="compact" />);
      const table = container.querySelector('table')!;
      expect(table.className).toMatch(/compact/i);
    });

    it('default density ("comfortable") does not apply the compact class', () => {
      const { container } = render(<ResultsTable events={[event()]} />);
      const table = container.querySelector('table')!;
      expect(table.className).not.toMatch(/compact/i);
    });

    it('column customization does not affect row selection / inspector wiring - onInspect still fires from Actions', async () => {
      const user = userEvent.setup();
      const onInspect = vi.fn();
      render(
        <ResultsTable
          events={[event()]}
          onInspect={onInspect}
          columnOrder={['level', 'time', 'service', 'whatHappened', 'userCustomer', 'correlationTrace', 'logger']}
          hiddenColumnIds={[]}
          density="compact"
        />,
      );
      await user.click(screen.getByRole('button', { name: /actions for this event/i }));
      await user.click(screen.getByRole('menuitem', { name: /view details/i }));
      expect(onInspect).toHaveBeenCalled();
    });

    it('the selected row still gets its selected styling with a custom column configuration', () => {
      const { container } = render(
        <ResultsTable
          events={[event(), event({ message: 'second' })]}
          selectedIndex={1}
          columnOrder={['level', 'time', 'service', 'whatHappened', 'userCustomer', 'correlationTrace']}
          hiddenColumnIds={['service']}
          density="compact"
        />,
      );
      const rows = container.querySelectorAll('tbody tr');
      expect(rows[1].className).toMatch(/selected/i);
      expect(rows[0].className).not.toMatch(/selected/i);
    });
  });

  describe('contextRootIdentity (UI Gap Closure Pass) - marking the original event under investigation', () => {
    it('marks the matching row with the contextRootRow class and aria-current="location"', () => {
      const root = event({ message: 'the one under investigation' });
      const other = event({ message: 'a neighbor' });
      const { container } = render(
        <ResultsTable events={[other, root]} contextRootIdentity={eventIdentity(root)} />,
      );
      const rows = container.querySelectorAll('tbody tr');
      expect(rows[0].className).not.toMatch(/contextRoot/i);
      expect(rows[0]).not.toHaveAttribute('aria-current');
      expect(rows[1].className).toMatch(/contextRoot/i);
      expect(rows[1]).toHaveAttribute('aria-current', 'location');
    });

    it('renders a visually-hidden "Original event you were investigating" label on the matching row only', () => {
      const root = event({ message: 'the one under investigation' });
      const other = event({ message: 'a neighbor' });
      render(<ResultsTable events={[other, root]} contextRootIdentity={eventIdentity(root)} />);
      expect(screen.getByText('Original event you were investigating')).toBeInTheDocument();
      const rows = screen.getAllByRole('row').slice(1);
      expect(within(rows[0]).queryByText('Original event you were investigating')).toBeNull();
      expect(within(rows[1]).getByText('Original event you were investigating')).toBeInTheDocument();
    });

    it('marks no row at all when contextRootIdentity is null/unset - never a false positive match', () => {
      const { container } = render(<ResultsTable events={[event(), event({ message: 'second' })]} />);
      const rows = container.querySelectorAll('tbody tr');
      rows.forEach((row) => {
        expect(row.className).not.toMatch(/contextRoot/i);
        expect(row).not.toHaveAttribute('aria-current');
      });
      expect(screen.queryByText('Original event you were investigating')).toBeNull();
    });

    it('combines correctly with .selectedRow when the same row is both selected and the context root', () => {
      const root = event({ message: 'the one under investigation' });
      const { container } = render(
        <ResultsTable events={[root]} contextRootIdentity={eventIdentity(root)} selectedIndex={0} />,
      );
      const row = container.querySelector('tbody tr')!;
      expect(row.className).toMatch(/selected/i);
      expect(row.className).toMatch(/contextRoot/i);
      expect(row).toHaveAttribute('aria-current', 'location');
    });

    /*
     * Session 3 - the combined SELECTED x ROOT state model (ResultsTable.module.css's own comment on
     * `.selectedRow`/`.contextRootRow` has the full rationale): selection and root each own a
     * non-competing visual channel, so all four combinations are genuinely, independently legible, not
     * just class-name presence. `.rootMarker` (the ring around the Time cell's severity mark) is the one
     * piece of DOM structure unique to root, injected only into the `time` column's own `<td>` - these
     * tests assert its presence/absence tracks `isContextRoot` exactly, for all four states.
     */
    describe('the four SELECTED x ROOT combinations', () => {
      function timeCellOf(row: Element): Element {
        return row.querySelector('[class*="timeCell"]')!;
      }

      it('UNSELECTED_NON_ROOT: neither class, no root marker', () => {
        const e = event({ message: 'plain' });
        const { container } = render(<ResultsTable events={[e]} />);
        const row = container.querySelector('tbody tr')!;
        expect(row.className).not.toMatch(/selected/i);
        expect(row.className).not.toMatch(/contextRoot/i);
        expect(timeCellOf(row).querySelector('[class*="rootMarker"]')).toBeNull();
      });

      it('SELECTED_NON_ROOT: selectedRow only, no root marker', () => {
        const e = event({ message: 'plain' });
        const { container } = render(<ResultsTable events={[e]} selectedIndex={0} />);
        const row = container.querySelector('tbody tr')!;
        expect(row.className).toMatch(/selected/i);
        expect(row.className).not.toMatch(/contextRoot/i);
        expect(timeCellOf(row).querySelector('[class*="rootMarker"]')).toBeNull();
      });

      it('UNSELECTED_ROOT: contextRootRow only, root marker present, aria-current set, not aria-selected', () => {
        const root = event({ message: 'the root' });
        const { container } = render(<ResultsTable events={[root]} contextRootIdentity={eventIdentity(root)} />);
        const row = container.querySelector('tbody tr')!;
        expect(row.className).not.toMatch(/selected/i);
        expect(row.className).toMatch(/contextRoot/i);
        expect(row).toHaveAttribute('aria-current', 'location');
        expect(row).toHaveAttribute('aria-selected', 'false');
        const marker = timeCellOf(row).querySelector('[class*="rootMarker"]');
        expect(marker).not.toBeNull();
        expect(marker).toHaveAttribute('aria-hidden', 'true');
      });

      it('SELECTED_ROOT: both classes, root marker present, both aria-current and aria-selected true', () => {
        const root = event({ message: 'the root, also selected' });
        const { container } = render(
          <ResultsTable events={[root]} contextRootIdentity={eventIdentity(root)} selectedIndex={0} />,
        );
        const row = container.querySelector('tbody tr')!;
        expect(row.className).toMatch(/selected/i);
        expect(row.className).toMatch(/contextRoot/i);
        expect(row).toHaveAttribute('aria-current', 'location');
        expect(row).toHaveAttribute('aria-selected', 'true');
        const marker = timeCellOf(row).querySelector('[class*="rootMarker"]');
        expect(marker).not.toBeNull();
        expect(marker).toHaveAttribute('aria-hidden', 'true');
        // The visually-hidden non-visual label for root still renders even when also selected - neither
        // state's non-visual cue is dropped when both are true.
        expect(screen.getByText('Original event you were investigating')).toBeInTheDocument();
      });
    });

    it('OS-1D §9/§40-C - a repeated message+timestamp from a SIBLING CONTAINER in the same pod is never mistaken for the root', () => {
      // Same message, same timestamp, same pod - only the container differs.
      // Root identity must not rely on message text (or pod) alone.
      const root = event({ message: 'started', timestamp: '2026-01-01T00:00:00.000Z', pod: 'payment-api-abc', containerName: 'app' });
      const sibling = event({ message: 'started', timestamp: '2026-01-01T00:00:00.000Z', pod: 'payment-api-abc', containerName: 'sidecar' });
      const { container } = render(
        <ResultsTable events={[sibling, root]} contextRootIdentity={eventIdentity(root)} />,
      );
      const rows = container.querySelectorAll('tbody tr');
      expect(rows[0].className).not.toMatch(/contextRoot/i); // the sibling container's identical-looking line
      expect(rows[1].className).toMatch(/contextRoot/i); // the real root
    });

    it('OS-1D §9 - the same pod name in a different namespace is never mistaken for the root', () => {
      const root = event({ message: 'started', timestamp: '2026-01-01T00:00:00.000Z', pod: 'worker-0', namespace: 'prod', containerName: 'app' });
      const lookalike = event({ message: 'started', timestamp: '2026-01-01T00:00:00.000Z', pod: 'worker-0', namespace: 'staging', containerName: 'app' });
      const { container } = render(
        <ResultsTable events={[lookalike, root]} contextRootIdentity={eventIdentity(root)} />,
      );
      const rows = container.querySelectorAll('tbody tr');
      expect(rows[0].className).not.toMatch(/contextRoot/i);
      expect(rows[1].className).toMatch(/contextRoot/i);
    });

    // Pre-closure functional recovery (§37/§40) - the one real gap the
    // audit found: the root row was marked, but nothing brought it into
    // view.
    it('auto-scrolls the root row into view when a context view opens', () => {
      const scrollIntoView = vi.fn();
      HTMLElement.prototype.scrollIntoView = scrollIntoView;
      const root = event({ message: 'the one under investigation' });
      const other = event({ message: 'a neighbor' });
      render(<ResultsTable events={[other, root]} contextRootIdentity={eventIdentity(root)} />);

      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'center' }));
      // Called on the actual root row's own DOM node, not some other row.
      const rows = screen.getAllByRole('row').slice(1);
      expect(scrollIntoView.mock.instances[0]).toBe(rows[1]);
    });

    it('does not re-scroll on a re-render while the same context view stays open (e.g. a density change)', () => {
      const scrollIntoView = vi.fn();
      HTMLElement.prototype.scrollIntoView = scrollIntoView;
      const root = event({ message: 'the one under investigation' });
      const other = event({ message: 'a neighbor' });
      const { rerender } = render(
        <ResultsTable events={[other, root]} contextRootIdentity={eventIdentity(root)} density="comfortable" />,
      );
      expect(scrollIntoView).toHaveBeenCalledTimes(1);

      rerender(<ResultsTable events={[other, root]} contextRootIdentity={eventIdentity(root)} density="compact" />);
      expect(scrollIntoView).toHaveBeenCalledTimes(1); // still just the one, initial scroll
    });

    it('never scrolls when no context view is open', () => {
      const scrollIntoView = vi.fn();
      HTMLElement.prototype.scrollIntoView = scrollIntoView;
      render(<ResultsTable events={[event(), event({ message: 'second' })]} />);
      expect(scrollIntoView).not.toHaveBeenCalled();
    });
  });

  describe('gaps prop - investigation-gap markers (Legacy Remediation Slice 6)', () => {
    const gap = {
      afterIndex: 0,
      fromTimestamp: '2026-01-01T00:00:00.000Z',
      toTimestamp: '2026-01-01T00:00:20.000Z',
      durationMs: 20_000,
      reason: 'large_interval' as const,
      confidence: 'observed' as const,
    };

    it('renders no extra rows when gaps is empty/unset - never inserts a fake event', () => {
      const { container } = render(<ResultsTable events={[event(), event({ message: 'second' })]} />);
      expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
      expect(screen.queryByTestId('gap-row')).toBeNull();
    });

    it('inserts a gap marker row immediately after the event at afterIndex, with the same cell count as every other row', () => {
      const { container } = render(
        <ResultsTable events={[event({ message: 'first' }), event({ message: 'second' })]} gaps={[gap]} />,
      );
      const rows = container.querySelectorAll('tbody tr');
      expect(rows).toHaveLength(3); // 2 events + 1 gap row
      expect(rows[0].textContent).toContain('first');
      expect(rows[1]).toHaveAttribute('data-testid', 'gap-row');
      expect(rows[2].textContent).toContain('second');

      // Same td count as a real event row (the results-table geometry
      // invariant, CLAUDE.md §4 - never a merged/colSpan cell).
      const eventRowCellCount = rows[0].querySelectorAll('td').length;
      expect(rows[1].querySelectorAll('td')).toHaveLength(eventRowCellCount);
    });

    it('the gap row describes duration and the from/to window as text - "gap detected", never implying something broke', () => {
      render(<ResultsTable events={[event(), event({ message: 'second' })]} gaps={[gap]} />);
      const gapRow = screen.getByTestId('gap-row');
      expect(gapRow.textContent).toMatch(/gap detected/i);
      expect(gapRow.textContent).toMatch(/20s/);
      expect(gapRow.textContent).not.toMatch(/missing|broken|failed|error/i);
    });

    it('a gap row has no Actions button - there is no event to inspect', () => {
      render(<ResultsTable events={[event(), event({ message: 'second' })]} gaps={[gap]} />);
      const gapRow = screen.getByTestId('gap-row');
      expect(within(gapRow).queryByRole('button')).toBeNull();
    });

    it('multiple gaps in one result set each render their own marker row, in the right positions', () => {
      const events = [event({ message: 'a' }), event({ message: 'b' }), event({ message: 'c' })];
      const gaps = [
        { ...gap, afterIndex: 0 },
        { ...gap, afterIndex: 1, fromTimestamp: '2026-01-01T00:00:20Z', toTimestamp: '2026-01-01T00:00:50Z', durationMs: 30_000 },
      ];
      const { container } = render(<ResultsTable events={events} gaps={gaps} />);
      const rows = container.querySelectorAll('tbody tr');
      expect(rows).toHaveLength(5); // a, gap, b, gap, c
      expect(rows[0].textContent).toContain('a');
      expect(rows[1]).toHaveAttribute('data-testid', 'gap-row');
      expect(rows[2].textContent).toContain('b');
      expect(rows[3]).toHaveAttribute('data-testid', 'gap-row');
      expect(rows[4].textContent).toContain('c');
    });

    it('ArrowDown/ArrowUp skip past a gap row to reach the next real event row', async () => {
      const user = userEvent.setup();
      render(<ResultsTable events={[event({ message: 'first' }), event({ message: 'second' })]} gaps={[gap]} />);
      const buttons = screen.getAllByRole('button', { name: /actions for this event/i });
      buttons[0].focus();

      await user.keyboard('{ArrowDown}');
      expect(buttons[1]).toHaveFocus(); // not stuck on the gap row in between

      await user.keyboard('{ArrowUp}');
      expect(buttons[0]).toHaveFocus();
    });

    it('has no detectable accessibility violations with a gap row present', async () => {
      const { container } = render(<ResultsTable events={[event(), event({ message: 'second' })]} gaps={[gap]} />);
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  describe('free-text redaction display (Legacy Remediation Slice 7)', () => {
    it('renders an already-redacted message as plain text in the What happened column', () => {
      const redacted = event({ message: 'Login failed for customerId=[REDACTED] card [REDACTED_CARD] declined' });
      render(<ResultsTable events={[redacted]} />);
      const row = screen.getAllByRole('row')[1];
      const whatHappened = within(row).getAllByRole('cell')[3];
      expect(whatHappened.textContent).toContain('customerId=[REDACTED]');
      expect(whatHappened.textContent).toContain('[REDACTED_CARD]');
    });

    it('renders an already-redacted malformed rawLine as plain text too', () => {
      const redacted = event({ malformed: true, message: null, rawLine: 'NOT-JSON password=[REDACTED]' });
      render(<ResultsTable events={[redacted]} />);
      expect(screen.getByText(/password=\[REDACTED\]/)).toBeInTheDocument();
    });

    it('the Actions menu never offers a way to copy message/exception content - only non-sensitive IDs are ever copyable', async () => {
      const user = userEvent.setup();
      const redacted = event({
        message: 'Login failed for customerId=[REDACTED]',
        traceId: 'trace-abc',
      });
      render(<ResultsTable events={[redacted]} />);
      await user.click(screen.getByRole('button', { name: /actions for this event/i }));
      const menuItems = screen.getAllByRole('menuitem').map((el) => el.textContent);
      expect(menuItems.some((t) => /message|exception/i.test(t ?? ''))).toBe(false);
      expect(menuItems.some((t) => /copy trace id/i.test(t ?? ''))).toBe(true);
    });
  });

  describe('pre-closure functional recovery §17/§18 - per-column sorting', () => {
    function svc(name: string, severity: string, sevNum: number) {
      return event({ service: name, severity, severityNumber: sevNum });
    }

    it('a column with no sortAccessor (e.g. What happened) renders no sort button - truthfully not sortable', () => {
      render(<ResultsTable events={[event()]} />);
      const whatHappenedHeader = screen.getAllByRole('columnheader').find((h) => headerLabel(h) === 'What happened')!;
      expect(within(whatHappenedHeader).queryByRole('button')).not.toBeInTheDocument();
      expect(whatHappenedHeader).not.toHaveAttribute('aria-sort');
    });

    it('a sortable column (e.g. Service) renders a real, keyboard-operable sort button with aria-sort="none" before any click', () => {
      render(<ResultsTable events={[event()]} />);
      const serviceHeader = screen.getAllByRole('columnheader').find((h) => headerLabel(h) === 'Service')!;
      expect(within(serviceHeader).getByRole('button')).toBeInTheDocument();
      expect(serviceHeader).toHaveAttribute('aria-sort', 'none');
    });

    it('clicking a sortable column header reorders the DISPLAYED rows client-side, first click ascending', async () => {
      const user = userEvent.setup();
      const events = [svc('charlie', 'INFO', 20000), svc('alpha', 'INFO', 20000), svc('bravo', 'INFO', 20000)];
      render(<ResultsTable events={events} />);
      const serviceHeader = screen.getAllByRole('columnheader').find((h) => headerLabel(h) === 'Service')!;
      await user.click(within(serviceHeader).getByRole('button'));
      const rows = screen.getAllByRole('row').slice(1);
      expect(rows.map((r) => within(r).getAllByRole('cell')[2].textContent)).toEqual(['alpha', 'bravo', 'charlie']);
      expect(serviceHeader).toHaveAttribute('aria-sort', 'ascending');
    });

    it('clicking the same column header again reverses to descending; a third click returns to ascending', async () => {
      const user = userEvent.setup();
      const events = [svc('charlie', 'INFO', 20000), svc('alpha', 'INFO', 20000), svc('bravo', 'INFO', 20000)];
      render(<ResultsTable events={events} />);
      const serviceHeader = screen.getAllByRole('columnheader').find((h) => headerLabel(h) === 'Service')!;
      const button = within(serviceHeader).getByRole('button');
      await user.click(button);
      await user.click(button);
      expect(screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[2].textContent)).toEqual([
        'charlie',
        'bravo',
        'alpha',
      ]);
      expect(serviceHeader).toHaveAttribute('aria-sort', 'descending');
      await user.click(button);
      expect(screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[2].textContent)).toEqual([
        'alpha',
        'bravo',
        'charlie',
      ]);
    });

    it('sorting by Level orders by real severity priority (severityNumber), not alphabetically', async () => {
      const user = userEvent.setup();
      const events = [svc('a', 'WARN', 30000), svc('b', 'INFO', 20000), svc('c', 'ERROR', 40000)];
      render(<ResultsTable events={events} />);
      const levelHeader = screen.getAllByRole('columnheader').find((h) => headerLabel(h) === 'Level')!;
      await user.click(within(levelHeader).getByRole('button'));
      // Ascending severity: INFO(20000) < WARN(30000) < ERROR(40000).
      expect(screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[2].textContent)).toEqual([
        'b',
        'a',
        'c',
      ]);
    });

    it('only ONE column shows an active sort indicator at a time - sorting a second column clears the first', async () => {
      const user = userEvent.setup();
      const events = [svc('b', 'INFO', 20000), svc('a', 'WARN', 30000)];
      render(<ResultsTable events={events} />);
      const headers = screen.getAllByRole('columnheader');
      const serviceHeader = headers.find((h) => headerLabel(h) === 'Service')!;
      const levelHeader = headers.find((h) => headerLabel(h) === 'Level')!;
      await user.click(within(serviceHeader).getByRole('button'));
      expect(serviceHeader).toHaveAttribute('aria-sort', 'ascending');
      await user.click(within(levelHeader).getByRole('button'));
      expect(levelHeader).toHaveAttribute('aria-sort', 'ascending');
      expect(serviceHeader).toHaveAttribute('aria-sort', 'none');
    });

    it('missing values always sort last, in both directions', async () => {
      const user = userEvent.setup();
      const events = [svc('zeta', 'INFO', 20000), event({ service: null, serviceSourceHint: null }), svc('alpha', 'INFO', 20000)];
      render(<ResultsTable events={events} />);
      const serviceHeader = screen.getAllByRole('columnheader').find((h) => headerLabel(h) === 'Service')!;
      const button = within(serviceHeader).getByRole('button');
      await user.click(button); // ascending
      let cells = screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[2].textContent);
      expect(cells).toEqual(['alpha', 'zeta', '—']);
      await user.click(button); // descending
      cells = screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[2].textContent);
      expect(cells).toEqual(['zeta', 'alpha', '—']);
    });

    it('Time column, when wired with timeSortDirection/onTimeSortChange, is clickable and aliases the exact same state - never a second competing sort', async () => {
      const user = userEvent.setup();
      const onTimeSortChange = vi.fn();
      render(<ResultsTable events={[event()]} timeSortDirection="BACKWARD" onTimeSortChange={onTimeSortChange} />);
      const timeHeader = screen.getAllByRole('columnheader').find((h) => headerLabel(h) === 'Time')!;
      expect(timeHeader).toHaveAttribute('aria-sort', 'descending'); // BACKWARD = Newest first = descending
      await user.click(within(timeHeader).getByRole('button'));
      expect(onTimeSortChange).toHaveBeenCalledWith('FORWARD');
    });

    it('Time column has no sort button at all when timeSortDirection is not provided (e.g. a context view)', () => {
      render(<ResultsTable events={[event()]} />);
      const timeHeader = screen.getAllByRole('columnheader').find((h) => headerLabel(h) === 'Time')!;
      expect(within(timeHeader).queryByRole('button')).not.toBeInTheDocument();
    });

    it('sortable={false} disables every column sort button, even Time - the context-view contract', () => {
      render(<ResultsTable events={[event()]} sortable={false} timeSortDirection="BACKWARD" onTimeSortChange={vi.fn()} />);
      for (const header of screen.getAllByRole('columnheader')) {
        expect(within(header).queryByRole('button')).not.toBeInTheDocument();
      }
    });

    it('clicking Time clears any active column sort, reverting display to the given (fetch) order', async () => {
      const user = userEvent.setup();
      const onTimeSortChange = vi.fn();
      const events = [svc('charlie', 'INFO', 20000), svc('alpha', 'INFO', 20000)];
      render(<ResultsTable events={events} timeSortDirection="BACKWARD" onTimeSortChange={onTimeSortChange} />);
      const headers = screen.getAllByRole('columnheader');
      const serviceHeader = headers.find((h) => headerLabel(h) === 'Service')!;
      await user.click(within(serviceHeader).getByRole('button'));
      expect(screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[2].textContent)).toEqual(['alpha', 'charlie']);
      const timeHeader = headers.find((h) => headerLabel(h) === 'Time')!;
      await user.click(within(timeHeader).getByRole('button'));
      expect(screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[2].textContent)).toEqual(['charlie', 'alpha']);
    });

    it('selection (selectedIndex/onInspect) stays correct against the ORIGINAL row identity even while a column sort reorders display', async () => {
      const user = userEvent.setup();
      const onInspect = vi.fn();
      const events = [svc('charlie', 'INFO', 20000), svc('alpha', 'INFO', 20000), svc('bravo', 'INFO', 20000)];
      // selectedIndex=1 is "alpha" in the ORIGINAL order.
      render(<ResultsTable events={events} selectedIndex={1} onInspect={onInspect} />);
      const serviceHeader = screen.getAllByRole('columnheader').find((h) => headerLabel(h) === 'Service')!;
      await user.click(within(serviceHeader).getByRole('button')); // ascending: alpha, bravo, charlie
      const rows = screen.getAllByRole('row').slice(1);
      // "alpha" is now the FIRST displayed row, but it is still original index 1.
      expect(within(rows[0]).getAllByRole('cell')[2].textContent).toBe('alpha');
      expect(rows[0]).toHaveAttribute('aria-selected', 'true');
      await user.click(rows[0]);
      expect(onInspect).toHaveBeenCalledWith(1);
    });

    it('has no detectable accessibility violations with sortable headers present', async () => {
      const { container } = render(<ResultsTable events={[event()]} timeSortDirection="BACKWARD" onTimeSortChange={vi.fn()} />);
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
