import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { SequenceTable } from './SequenceTable';
import { eventIdentity } from '../../app/useSearchState';
import type { LogEvent } from '../../shared/api/types';

function event(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    timestamp: '2026-01-01T00:00:00.000Z',
    timestampRaw: null,
    schemaVersion: null,
    service: 'gateway',
    serviceSourceHint: null,
    severity: 'INFO',
    severityNumber: null,
    message: 'hello',
    logger: null,
    thread: null,
    exception: null,
    traceId: null,
    spanId: null,
    journeyId: null,
    eventId: null,
    businessStep: 'validate',
    uiIdentifier: null,
    errorCode: null,
    correlationId: null,
    protectedFields: { cif: null, userName: null, customerId: null, deviceId: null, deviceIp: null },
    devicePlatformType: null,
    language: null,
    serverIp: null,
    serverHost: null,
    unknownTopLevelFields: {},
    unknownMdcFields: {},
    malformed: false,
    rawLine: null,
    sourceId: null,
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

const BASE_MS = Date.parse('2026-01-01T00:00:00.000Z');

describe('SequenceTable', () => {
  it('is one semantic table with one colgroup, one row per event, Actions last', () => {
    const events = [event(), event({ timestamp: '2026-01-01T00:00:01.000Z' })];
    const { container } = render(
      <SequenceTable
        events={events}
        startMs={BASE_MS}
        rootIdentity={null}
        gaps={[]}
        onShowContext={vi.fn()}
        identifierColumn={{ header: 'Span ID', render: () => '—' }}
        ariaLabel="Trace events"
      />,
    );
    expect(container.querySelectorAll('table').length).toBe(1);
    expect(container.querySelectorAll('colgroup').length).toBe(1);
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(3); // header + 2 events
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers[headers.length - 1]).toMatch(/actions/i);
  });

  it('renders the offset relative to startMs, signed and formatted', () => {
    render(
      <SequenceTable
        events={[event({ timestamp: '2026-01-01T00:00:12.000Z' })]}
        startMs={BASE_MS}
        rootIdentity={null}
        gaps={[]}
        onShowContext={vi.fn()}
        identifierColumn={{ header: 'Span ID', render: () => '—' }}
        ariaLabel="Trace events"
      />,
    );
    expect(screen.getByText('+12s')).toBeInTheDocument();
  });

  it('marks the root row distinctly, with a visually-hidden "Selected event" label', () => {
    const root = event({ timestamp: '2026-01-01T00:00:05.000Z' });
    render(
      <SequenceTable
        events={[event(), root]}
        startMs={BASE_MS}
        rootIdentity={eventIdentity(root)}
        gaps={[]}
        onShowContext={vi.fn()}
        identifierColumn={{ header: 'Span ID', render: () => '—' }}
        ariaLabel="Trace events"
      />,
    );
    const currentRow = screen.getAllByRole('row').find((r) => r.getAttribute('aria-current') === 'location');
    expect(currentRow).toBeDefined();
    expect(currentRow).toHaveTextContent('Selected event');
  });

  it('renders a gap row between two events when a gap is given', () => {
    render(
      <SequenceTable
        events={[event(), event({ timestamp: '2026-01-01T00:00:10.000Z' })]}
        startMs={BASE_MS}
        rootIdentity={null}
        gaps={[
          {
            afterIndex: 0,
            fromTimestamp: '2026-01-01T00:00:00.000Z',
            toTimestamp: '2026-01-01T00:00:10.000Z',
            durationMs: 10_000,
            reason: 'large_interval',
            confidence: 'observed',
          },
        ]}
        onShowContext={vi.fn()}
        identifierColumn={{ header: 'Span ID', render: () => '—' }}
        ariaLabel="Trace events"
      />,
    );
    expect(screen.getByText(/gap detected/i)).toBeInTheDocument();
  });

  it('renders the caller-supplied identifier column content per row', () => {
    render(
      <SequenceTable
        events={[event({ traceId: 't-1' })]}
        startMs={BASE_MS}
        rootIdentity={null}
        gaps={[]}
        onShowContext={vi.fn()}
        identifierColumn={{ header: 'Trace', render: (e) => `trace:${e.traceId}` }}
        ariaLabel="Journey events"
      />,
    );
    expect(screen.getByText('trace:t-1')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Trace' })).toBeInTheDocument();
  });

  it('renders a malformed event with its raw line and a "malformed" badge (reused from MessageCell)', () => {
    render(
      <SequenceTable
        events={[event({ malformed: true, rawLine: 'NOT-JSON raw line', message: null })]}
        startMs={BASE_MS}
        rootIdentity={null}
        gaps={[]}
        onShowContext={vi.fn()}
        identifierColumn={{ header: 'Span ID', render: () => '—' }}
        ariaLabel="Trace events"
      />,
    );
    expect(screen.getByText('NOT-JSON raw line')).toBeInTheDocument();
    expect(screen.getByText(/malformed/i)).toBeInTheDocument();
  });

  it('Show Surroundings calls onShowContext with the real event', async () => {
    const user = userEvent.setup();
    const onShowContext = vi.fn();
    const target = event();
    render(
      <SequenceTable
        events={[target]}
        startMs={BASE_MS}
        rootIdentity={null}
        gaps={[]}
        onShowContext={onShowContext}
        identifierColumn={{ header: 'Span ID', render: () => '—' }}
        ariaLabel="Trace events"
      />,
    );
    await user.click(screen.getByRole('button', { name: /surroundings/i }));
    await user.click(screen.getByRole('button', { name: /^run$/i }));
    expect(onShowContext).toHaveBeenCalledWith(target);
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = render(
      <SequenceTable
        events={[event(), event({ timestamp: '2026-01-01T00:00:05.000Z', severity: 'ERROR' })]}
        startMs={BASE_MS}
        rootIdentity={null}
        gaps={[]}
        onShowContext={vi.fn()}
        identifierColumn={{ header: 'Span ID', render: () => '—' }}
        ariaLabel="Trace events"
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
