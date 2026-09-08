import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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
});
