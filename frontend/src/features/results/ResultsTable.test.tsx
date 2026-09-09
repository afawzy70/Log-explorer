import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { ResultsTable } from './ResultsTable';
import type { LogEvent } from '../../shared/api/types';

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
    ...overrides,
  };
}

describe('ResultsTable', () => {
  it('renders exactly the seven required columns, in order', () => {
    render(<ResultsTable events={[event()]} />);
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Time', 'Level', 'Service', 'What happened', 'User/Customer', 'Correlation/Trace', 'Actions']);
  });

  it('is one semantic table with one colgroup', () => {
    const { container } = render(<ResultsTable events={[event()]} />);
    expect(container.querySelectorAll('table')).toHaveLength(1);
    expect(container.querySelectorAll('colgroup')).toHaveLength(1);
    expect(container.querySelectorAll('col')).toHaveLength(7);
  });

  it('renders one <tr> per event, each with exactly seven <td> cells (no second action row)', () => {
    const { container } = render(<ResultsTable events={[event(), event({ message: 'second event' })]} />);
    const bodyRows = container.querySelectorAll('tbody tr');
    expect(bodyRows).toHaveLength(2);
    bodyRows.forEach((row) => {
      expect(row.querySelectorAll('td')).toHaveLength(7);
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
    expect(cells).toHaveLength(7);
    expect(cells[0].textContent).toBe('—');
    expect(cells[2].textContent).toBe('—');
    expect(cells[4].textContent).toBe('—');
    expect(cells[5].textContent).toBe('—');
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
    expect(within(row).getAllByRole('cell')[4].textContent).toContain('al***e');
    expect(within(row).getAllByRole('cell')[4].textContent).toContain('User');
  });

  it('shows the Trace ID with its label in Correlation/Trace', () => {
    render(<ResultsTable events={[event({ traceId: 'trace-abc' })]} />);
    const row = screen.getAllByRole('row')[1];
    expect(within(row).getAllByRole('cell')[5].textContent).toContain('trace-abc');
    expect(within(row).getAllByRole('cell')[5].textContent).toContain('Trace ID');
  });

  it('without onOpenJourney, the Correlation/Trace cell has no button at all', () => {
    render(<ResultsTable events={[event({ traceId: 'trace-abc' })]} />);
    const row = screen.getAllByRole('row')[1];
    expect(within(row).getAllByRole('cell')[5].querySelector('button')).toBeNull();
  });

  it('"supported click actions on non-sensitive IDs" (HANDOVER.md §17) - clicking the Correlation/Trace cell calls onOpenJourney with the right field and value', async () => {
    const user = userEvent.setup();
    const onOpenJourney = vi.fn();
    render(<ResultsTable events={[event({ traceId: 'trace-abc' })]} onOpenJourney={onOpenJourney} />);
    await user.click(screen.getByRole('button', { name: /trace id:trace-abc/i }));
    expect(onOpenJourney).toHaveBeenCalledWith('traceId', 'trace-abc');
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
      const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
      expect(headers).toEqual([
        'Time',
        'Level',
        'Service',
        'What happened',
        'User/Customer',
        'Correlation/Trace',
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
      const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
      expect(headers).toEqual(['Time', 'Level', 'What happened', 'User/Customer', 'Correlation/Trace', 'Actions']);
    });

    it('reordering columnOrder changes header and cell order together, so rows still correspond correctly to headers', () => {
      render(
        <ResultsTable
          events={[event({ service: 'gateway-svc' })]}
          columnOrder={['level', 'time', 'service', 'whatHappened', 'userCustomer', 'correlationTrace']}
          hiddenColumnIds={[]}
        />,
      );
      const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
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
      const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
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
      await user.click(screen.getByRole('menuitem', { name: /inspect event/i }));
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
});
