import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TimelinePlot } from './TimelinePlot';
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
    rawJson: null,
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

/*
 * B5 Investigation - non-causality is a hard requirement (the mission's own "B5 non-causality rule"): this
 * plot draws independent points and gap bands, never an arrow or a line connecting two events, so these tests
 * assert the DOM never contains an SVG/canvas connector element between points, alongside the ordinary
 * structural assertions.
 */
describe('TimelinePlot', () => {
  it('renders one lane label per distinct service, in first-seen order, service name always as text', () => {
    const events = [
      event({ timestamp: '2026-01-01T00:00:00.000Z', service: 'gateway' }),
      event({ timestamp: '2026-01-01T00:00:01.000Z', service: 'payments-api' }),
      event({ timestamp: '2026-01-01T00:00:02.000Z', service: 'gateway' }),
    ];
    render(
      <TimelinePlot
        events={events}
        rootIdentity={null}
        gaps={[]}
        loMs={BASE_MS}
        hiMs={BASE_MS + 2_000}
        originMs={BASE_MS}
        ariaLabel="Timeline"
      />,
    );
    expect(screen.getByText('gateway')).toBeInTheDocument();
    expect(screen.getByText('payments-api')).toBeInTheDocument();
  });

  it('marks the root event distinctly and states "Selected event" as real text, never colour alone', () => {
    const root = event({ timestamp: '2026-01-01T00:00:01.000Z' });
    render(
      <TimelinePlot
        events={[event(), root]}
        rootIdentity={eventIdentity(root)}
        gaps={[]}
        loMs={BASE_MS}
        hiMs={BASE_MS + 2_000}
        originMs={BASE_MS + 1_000}
        ariaLabel="Timeline"
      />,
    );
    expect(screen.getByText('Selected event')).toBeInTheDocument();
  });

  it('renders a gap band with its real duration text', () => {
    const events = [
      event({ timestamp: '2026-01-01T00:00:00.000Z' }),
      event({ timestamp: '2026-01-01T00:00:10.000Z' }),
    ];
    render(
      <TimelinePlot
        events={events}
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
        loMs={BASE_MS}
        hiMs={BASE_MS + 10_000}
        originMs={BASE_MS}
        ariaLabel="Timeline"
      />,
    );
    expect(screen.getByText('10s')).toBeInTheDocument();
  });

  it('never draws an arrow marker, connector polyline, or causal-flow glyph between two events - only independent points and a gap band', () => {
    const events = [
      event({ timestamp: '2026-01-01T00:00:00.000Z' }),
      event({ timestamp: '2026-01-01T00:00:01.000Z' }),
    ];
    const { container } = render(
      <TimelinePlot
        events={events}
        rootIdentity={null}
        gaps={[]}
        loMs={BASE_MS}
        hiMs={BASE_MS + 1_000}
        originMs={BASE_MS}
        ariaLabel="Timeline"
      />,
    );
    // The crosshair icon on the trigger flag is a legitimate decorative SVG (an "AT this point" marker, not a
    // connector) - the actual invariant is no arrow marker, no polyline/path joining two DIFFERENT points, and
    // no <canvas> (which this plot has no reason to ever need).
    expect(container.querySelectorAll('marker, polyline, canvas').length).toBe(0);
    expect(container.querySelectorAll('svg path[d]').length).toBe(0);
  });

  it('renders one trace bracket per distinct trace when given, labeled with the short index (never the raw ID)', () => {
    render(
      <TimelinePlot
        events={[event()]}
        rootIdentity={null}
        gaps={[]}
        loMs={BASE_MS}
        hiMs={BASE_MS + 2_000}
        originMs={BASE_MS}
        ariaLabel="Timeline"
        traces={[
          { id: 'trace-aaaaaaaaaaaaaaaaaaaaaaaaaaaaa', label: 'T1', startMs: BASE_MS, endMs: BASE_MS + 1_000 },
        ]}
      />,
    );
    expect(screen.getByText('T1')).toBeInTheDocument();
    expect(screen.queryByText('trace-aaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).not.toBeInTheDocument();
  });

  it('has an accessible name describing what the plot shows', () => {
    render(
      <TimelinePlot
        events={[event()]}
        rootIdentity={null}
        gaps={[]}
        loMs={BASE_MS}
        hiMs={BASE_MS + 1_000}
        originMs={BASE_MS}
        ariaLabel="Timeline of 1 event by service; the selected event is marked."
      />,
    );
    expect(screen.getByRole('img', { name: /timeline of 1 event/i })).toBeInTheDocument();
  });
});
