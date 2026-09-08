import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { LiveTailPanel } from './LiveTailPanel';
import type { LiveTailHandle } from './useLiveTail';
import type { LiveConnectionState } from './liveTailTypes';
import type { LogEvent } from '../../shared/api/types';

function event(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    timestamp: '2026-01-01T00:00:00Z',
    timestampRaw: null,
    schemaVersion: null,
    service: 'gateway',
    serviceSourceHint: null,
    severity: 'INFO',
    severityNumber: null,
    message: 'live event',
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
    containerId: null,
    containerName: null,
    stream: null,
    namespace: null,
    pod: null,
    ...overrides,
  };
}

function baseLive(overrides: Partial<LiveTailHandle> = {}): LiveTailHandle {
  return {
    connectionState: 'idle',
    visibleEvents: [],
    totalReceived: 0,
    bufferedCount: 0,
    clientDroppedCount: 0,
    serverDroppedCount: 0,
    errorMessage: null,
    start: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    exit: vi.fn(),
    ...overrides,
  };
}

function renderPanel(state: LiveConnectionState, overrides: Partial<LiveTailHandle> = {}) {
  const live = baseLive({ connectionState: state, ...overrides });
  const onStart = vi.fn();
  const utils = render(<LiveTailPanel live={live} sourceDisplayName="Fixture" onStart={onStart} />);
  return { ...utils, live, onStart };
}

describe('LiveTailPanel', () => {
  it('idle: shows only Start, plus the "not a complete historical record" disclaimer', () => {
    renderPanel('idle');
    expect(screen.getByRole('button', { name: /^start$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^pause$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^resume$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^stop$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/not a complete historical record/i)).toBeInTheDocument();
  });

  it('clicking Start in idle calls onStart', async () => {
    const user = userEvent.setup();
    const { onStart } = renderPanel('idle');
    await user.click(screen.getByRole('button', { name: /^start$/i }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('connecting: shows Stop but not Start/Pause/Resume, and a connecting message', () => {
    renderPanel('connecting');
    expect(screen.queryByRole('button', { name: /^start$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^stop$/i })).toBeInTheDocument();
    expect(screen.getAllByText(/connecting/i).length).toBeGreaterThan(0);
  });

  it('live: shows Pause and Stop, not Start/Resume', () => {
    renderPanel('live');
    expect(screen.getByRole('button', { name: /^pause$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^stop$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^start$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^resume$/i })).not.toBeInTheDocument();
  });

  it('clicking Pause while live calls live.pause', async () => {
    const user = userEvent.setup();
    const { live } = renderPanel('live');
    await user.click(screen.getByRole('button', { name: /^pause$/i }));
    expect(live.pause).toHaveBeenCalledTimes(1);
  });

  it('paused: shows Resume and Stop, not Pause/Start', () => {
    renderPanel('paused');
    expect(screen.getByRole('button', { name: /^resume$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^stop$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^pause$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^start$/i })).not.toBeInTheDocument();
  });

  it('clicking Resume while paused calls live.resume', async () => {
    const user = userEvent.setup();
    const { live } = renderPanel('paused');
    await user.click(screen.getByRole('button', { name: /^resume$/i }));
    expect(live.resume).toHaveBeenCalledTimes(1);
  });

  it('clicking Stop while live calls live.stop', async () => {
    const user = userEvent.setup();
    const { live } = renderPanel('live');
    await user.click(screen.getByRole('button', { name: /^stop$/i }));
    expect(live.stop).toHaveBeenCalledTimes(1);
  });

  it('stopped: shows only Start again, not Pause/Resume/Stop', () => {
    renderPanel('stopped');
    expect(screen.getByRole('button', { name: /^start$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^pause$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^resume$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^stop$/i })).not.toBeInTheDocument();
  });

  it('error: shows Start (to retry) and surfaces the real error message via role="alert"', () => {
    renderPanel('error', { errorMessage: 'Live connection lost.' });
    expect(screen.getByRole('button', { name: /^start$/i })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Live connection lost.');
  });

  it('clicking "Back to search results" calls live.exit', async () => {
    const user = userEvent.setup();
    const { live } = renderPanel('live');
    await user.click(screen.getByRole('button', { name: /back to search results/i }));
    expect(live.exit).toHaveBeenCalledTimes(1);
  });

  it('renders received/visible/dropped/buffered counts distinctly - never conflated', () => {
    renderPanel('paused', {
      totalReceived: 42,
      visibleEvents: [event()],
      bufferedCount: 3,
      clientDroppedCount: 5,
      serverDroppedCount: 7,
    });
    const counts = screen.getByText(/received:/i);
    expect(counts).toHaveTextContent('Received: 42');
    expect(counts).toHaveTextContent('Visible: 1');
    expect(counts).toHaveTextContent('Buffered while paused: 3');
    expect(counts).toHaveTextContent('Dropped (display cap): 5');
    expect(counts).toHaveTextContent('Dropped (server buffer full): 7');
  });

  it('renders each visible event using the journey-style entry row, never the seven-column results table', () => {
    renderPanel('live', {
      visibleEvents: [event({ message: 'alpha' }), event({ message: 'beta' })],
    });
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('beta')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('list')).toBeInTheDocument();
  });

  it('shows an empty-state message rather than nothing when there are no visible events yet', () => {
    renderPanel('live');
    expect(screen.getByText(/waiting for new events/i)).toBeInTheDocument();
  });

  it('has no detectable accessibility violations in the live state', async () => {
    const { container } = renderPanel('live', { visibleEvents: [event()] });
    expect(await axe(container)).toHaveNoViolations();
  });
});
