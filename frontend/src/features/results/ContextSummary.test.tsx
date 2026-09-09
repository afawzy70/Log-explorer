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
