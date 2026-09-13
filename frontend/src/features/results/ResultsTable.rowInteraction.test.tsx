import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResultsTable } from './ResultsTable';
import type { LogEvent } from '../../shared/api/types';

/**
 * UX-R4 §6/§7/§8/§29 - the row interaction model.
 *
 * These are deliberately *behavioural* assertions ("clicking this row
 * opens THAT event"), not "a handler is wired" assertions: the whole
 * point of §6 is that the investigator can reach the right event, so
 * every test below identifies the opened event by index and checks the
 * index actually reported.
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
    ...overrides,
  };
}

const THREE = [
  event({ message: 'first event', timestamp: '2026-01-01T00:00:03.000Z' }),
  event({ message: 'second event', timestamp: '2026-01-01T00:00:02.000Z', severity: 'ERROR' }),
  event({ message: 'third event', timestamp: '2026-01-01T00:00:01.000Z', severity: 'WARN' }),
];

function rows() {
  return screen.getAllByRole('row').slice(1); // drop the header row
}

describe('UX-R4 §6 - row click opens the event', () => {
  it('clicking anywhere on a row opens that exact event, not merely "an" event', async () => {
    const user = userEvent.setup();
    const onInspect = vi.fn();
    render(<ResultsTable events={THREE} onInspect={onInspect} />);

    await user.click(screen.getByText('second event'));

    expect(onInspect).toHaveBeenCalledTimes(1);
    expect(onInspect).toHaveBeenCalledWith(1);
  });

  it('clicking a different row opens that row - the index is never stale', async () => {
    const user = userEvent.setup();
    const onInspect = vi.fn();
    render(<ResultsTable events={THREE} onInspect={onInspect} />);

    await user.click(screen.getByText('third event'));
    expect(onInspect).toHaveBeenLastCalledWith(2);

    await user.click(screen.getByText('first event'));
    expect(onInspect).toHaveBeenLastCalledWith(0);
  });

  it('clicking the Actions trigger opens the menu WITHOUT also opening the inspector underneath it', async () => {
    const user = userEvent.setup();
    const onInspect = vi.fn();
    render(<ResultsTable events={THREE} onInspect={onInspect} />);

    await user.click(screen.getAllByRole('button', { name: 'Actions for this event' })[1]);

    expect(screen.getByRole('menu', { name: 'Event actions' })).toBeInTheDocument();
    expect(onInspect).not.toHaveBeenCalled();
  });

  it('clicking a Correlation/Trace journey link does not also open the inspector', async () => {
    const user = userEvent.setup();
    const onInspect = vi.fn();
    const onOpenJourney = vi.fn();
    render(<ResultsTable events={THREE} onInspect={onInspect} onOpenJourney={onOpenJourney} />);

    const traceLink = screen.getAllByRole('button', { name: /trace-1/ })[0];
    await user.click(traceLink);

    expect(onOpenJourney).toHaveBeenCalled();
    expect(onInspect).not.toHaveBeenCalled();
  });
});

describe('UX-R4 §6/§35 - keyboard opens the event', () => {
  it('Enter on a focused row opens that row', async () => {
    const user = userEvent.setup();
    const onInspect = vi.fn();
    render(<ResultsTable events={THREE} onInspect={onInspect} />);

    rows()[2].focus();
    await user.keyboard('{Enter}');

    expect(onInspect).toHaveBeenCalledWith(2);
  });

  it('Space on a focused row opens that row', async () => {
    const user = userEvent.setup();
    const onInspect = vi.fn();
    render(<ResultsTable events={THREE} onInspect={onInspect} />);

    rows()[1].focus();
    await user.keyboard(' ');

    expect(onInspect).toHaveBeenCalledWith(1);
  });

  it('ArrowDown/ArrowUp move row focus without selecting anything', async () => {
    const user = userEvent.setup();
    const onInspect = vi.fn();
    render(<ResultsTable events={THREE} onInspect={onInspect} />);

    rows()[0].focus();
    await user.keyboard('{ArrowDown}');
    expect(rows()[1]).toHaveFocus();

    await user.keyboard('{ArrowUp}');
    expect(rows()[0]).toHaveFocus();

    // A pure focus move - never an inspector side effect of its own.
    expect(onInspect).not.toHaveBeenCalled();
  });

  it('uses a roving tabindex: exactly one row is in the tab order', () => {
    render(<ResultsTable events={THREE} onInspect={vi.fn()} />);
    const tabbable = rows().filter((r) => r.getAttribute('tabindex') === '0');
    expect(tabbable).toHaveLength(1);
  });

  it('the roving tab stop follows the selection, so Tab returns to the row being investigated', () => {
    render(<ResultsTable events={THREE} selectedIndex={2} onInspect={vi.fn()} />);
    expect(rows()[2]).toHaveAttribute('tabindex', '0');
    expect(rows()[0]).toHaveAttribute('tabindex', '-1');
  });
});

describe('UX-R4 §7/§8 - selected state', () => {
  it('exposes the selected row semantically, not by styling alone', () => {
    render(<ResultsTable events={THREE} selectedIndex={1} onInspect={vi.fn()} />);
    expect(rows()[1]).toHaveAttribute('aria-selected', 'true');
    expect(rows()[0]).toHaveAttribute('aria-selected', 'false');
  });

  it('marks exactly one row as selected', () => {
    render(<ResultsTable events={THREE} selectedIndex={0} onInspect={vi.fn()} />);
    expect(rows().filter((r) => r.getAttribute('aria-selected') === 'true')).toHaveLength(1);
  });
});

describe('UX-R4 §15 - severity is marked on the row, never by colour alone', () => {
  it('gives ERROR and WARN rows their own class and leaves INFO rows unmarked', () => {
    render(<ResultsTable events={THREE} onInspect={vi.fn()} />);
    const [info, error, warn] = rows();
    expect(error.className).toMatch(/errorRow/);
    expect(warn.className).toMatch(/warnRow/);
    expect(info.className || '').not.toMatch(/errorRow|warnRow/);
  });

  it('still spells the level out in text, so the marking is never the only cue', () => {
    render(<ResultsTable events={THREE} onInspect={vi.fn()} />);
    expect(rows()[1]).toHaveTextContent('ERROR');
    expect(rows()[2]).toHaveTextContent('WARN');
  });
});
