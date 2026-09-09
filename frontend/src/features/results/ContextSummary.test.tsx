import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { ContextSummary } from './ContextSummary';
import type { LogEvent } from '../../shared/api/types';
import type { CommittedTimeRange } from '../timerange/types';
import { CUSTOM_RANGE_ID } from '../../shared/time/presets';

function event(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    timestamp: '2026-01-01T00:00:00Z',
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
    businessStep: null,
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
    ...overrides,
  };
}

const range: CommittedTimeRange = {
  presetId: CUSTOM_RANGE_ID,
  start: '2026-01-01T11:59:30Z',
  end: '2026-01-01T12:00:30Z',
};

describe('ContextSummary (UI Parity Acceleration Pass §8)', () => {
  it('shows event/service/error counts and the 60-second window', () => {
    const events = [
      event({ service: 'gateway', severity: 'ERROR' }),
      event({ service: 'gateway', severity: 'INFO' }),
      event({ service: 'payments-api', severity: 'ERROR' }),
    ];
    render(<ContextSummary events={events} range={range} />);

    expect(screen.getByText('Events').nextElementSibling).toHaveTextContent('3');
    expect(screen.getByText('Services').nextElementSibling).toHaveTextContent('2');
    expect(screen.getByText('Errors').nextElementSibling).toHaveTextContent('2');
    expect(screen.getByText(/60 seconds \(±30s\)/i)).toBeInTheDocument();
  });

  it('shows the actual range and its timezone label when one is available', () => {
    render(<ContextSummary events={[]} range={range} />);
    expect(screen.getByText('Range').nextElementSibling?.textContent).toMatch(/UTC/i);
  });

  it('renders zero counts honestly rather than omitting the summary when there are no events', () => {
    render(<ContextSummary events={[]} range={range} />);
    expect(screen.getByText('Events').nextElementSibling).toHaveTextContent('0');
    expect(screen.getByText('Errors').nextElementSibling).toHaveTextContent('0');
  });

  it('never claims causality - states the actual (UI Gap Closure Pass: chronological ascending) ordering honestly', () => {
    render(<ContextSummary events={[event()]} range={range} />);
    expect(screen.getByText(/does not indicate causality/i)).toBeInTheDocument();
    expect(screen.getByText(/sorted chronologically, oldest first/i)).toBeInTheDocument();
  });

  it('renders without a Range row when no range is available', () => {
    render(<ContextSummary events={[event()]} range={null} />);
    expect(screen.queryByText('Range')).not.toBeInTheDocument();
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = render(<ContextSummary events={[event()]} range={range} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('ContextSummary enrichment (Legacy Remediation Slice 6)', () => {
  it('shows a WARN count alongside Errors', () => {
    const events = [
      event({ severity: 'WARN' }),
      event({ severity: 'WARN' }),
      event({ severity: 'ERROR' }),
      event({ severity: 'INFO' }),
    ];
    render(<ContextSummary events={events} range={range} />);
    expect(screen.getByText('Warnings').nextElementSibling).toHaveTextContent('2');
  });

  it('shows the observed span between the first and last event, distinct from the fixed Window', () => {
    const events = [
      event({ timestamp: '2026-01-01T12:00:00Z' }),
      event({ timestamp: '2026-01-01T12:00:12Z' }),
    ];
    render(<ContextSummary events={events} range={range} />);
    expect(screen.getByText('Observed span').nextElementSibling).toHaveTextContent('12s');
  });

  it('omits Observed span when fewer than two timestamped events exist', () => {
    render(<ContextSummary events={[event()]} range={range} />);
    expect(screen.queryByText('Observed span')).not.toBeInTheDocument();
  });

  it('shows the Source name when provided', () => {
    render(<ContextSummary events={[event()]} range={range} source="Fixture" />);
    expect(screen.getByText('Source').nextElementSibling).toHaveTextContent('Fixture');
  });

  it('omits the Source row when none is provided', () => {
    render(<ContextSummary events={[event()]} range={range} />);
    expect(screen.queryByText('Source')).not.toBeInTheDocument();
  });

  it('shows a truthful incomplete-results notice when counts.truncated is true, nothing when false', () => {
    const counts = { estimatedTotal: null, returned: 200, visible: 200, limit: 200, truncated: true };
    const { rerender } = render(<ContextSummary events={[event()]} range={range} counts={counts} />);
    expect(screen.getByText(/results may be incomplete/i)).toBeInTheDocument();

    rerender(<ContextSummary events={[event()]} range={range} counts={{ ...counts, truncated: false }} />);
    expect(screen.queryByText(/results may be incomplete/i)).not.toBeInTheDocument();
  });

  it('shows a Gaps count of 0 and no gap list when the sequence has no detectable gap', () => {
    const events = [event({ timestamp: '2026-01-01T12:00:00Z' }), event({ timestamp: '2026-01-01T12:00:01Z' })];
    render(<ContextSummary events={events} range={range} />);
    expect(screen.getByText('Gaps').nextElementSibling).toHaveTextContent('0');
    expect(screen.queryByText(/sequence gap/i)).not.toBeInTheDocument();
  });

  it('shows a Gaps count and a descriptive list when a real gap is present, computed internally when no gaps prop is given', () => {
    const events = [event({ timestamp: '2026-01-01T12:00:00Z' }), event({ timestamp: '2026-01-01T12:00:20Z' })];
    render(<ContextSummary events={events} range={range} />);
    expect(screen.getByText('Gaps').nextElementSibling).toHaveTextContent('1');
    expect(screen.getByText(/1 sequence gap detected/i)).toBeInTheDocument();
    expect(screen.getByText(/20s with no observed events between/i)).toBeInTheDocument();
  });

  it('uses the caller-supplied gaps prop (computed once) instead of recomputing when provided', () => {
    const events = [event({ timestamp: '2026-01-01T12:00:00Z' }), event({ timestamp: '2026-01-01T12:00:01Z' })]; // no real gap
    const suppliedGaps = [
      { afterIndex: 0, fromTimestamp: '2026-01-01T12:00:00Z', toTimestamp: '2026-01-01T12:00:01Z', durationMs: 1000, reason: 'large_interval' as const, confidence: 'observed' as const },
    ];
    render(<ContextSummary events={events} range={range} gaps={suppliedGaps} />);
    expect(screen.getByText('Gaps').nextElementSibling).toHaveTextContent('1');
  });

  it('never implies causality for a detected gap - explains it means no event was observed, not that something failed', () => {
    const events = [event({ timestamp: '2026-01-01T12:00:00Z' }), event({ timestamp: '2026-01-01T12:00:20Z' })];
    render(<ContextSummary events={events} range={range} />);
    expect(screen.getByText(/not evidence that anything failed/i)).toBeInTheDocument();
  });

  it('has no detectable accessibility violations with warnings, a gap, and a truncation notice all present', async () => {
    const events = [event({ timestamp: '2026-01-01T12:00:00Z' }), event({ timestamp: '2026-01-01T12:00:20Z' })];
    const counts = { estimatedTotal: null, returned: 200, visible: 200, limit: 200, truncated: true };
    const { container } = render(<ContextSummary events={events} range={range} source="Fixture" counts={counts} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
