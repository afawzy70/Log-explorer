import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { LiveTailPanel } from './LiveTailPanel';
import { useLiveTail } from './useLiveTail';
import type { LiveTailHandle } from './useLiveTail';
import type { LiveConnectionState } from './liveTailTypes';
import { BATCH_FLUSH_MS } from './liveTailTypes';
import { installMockEventSource, latestMockEventSource } from './mockEventSource';
import type { LogEvent } from '../../shared/api/types';

// jsdom does not implement Element.scrollTo - the follow-newest effect
// calls it unconditionally whenever the event list is rendered, so this
// is stubbed globally (not just in the real-scroll describe block below)
// for every test in this file.
Element.prototype.scrollTo = vi.fn();

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

function baseLive(overrides: Partial<LiveTailHandle> = {}): LiveTailHandle {
  return {
    connectionState: 'idle',
    visibleEvents: [],
    totalReceived: 0,
    bufferedCount: 0,
    clientDroppedCount: 0,
    serverDroppedCount: 0,
    errorMessage: null,
    reconnectAttempt: 0,
    reconnectCount: 0,
    followNewest: true,
    unseenCount: 0,
    sourceWarnings: [],
    start: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    exit: vi.fn(),
    clear: vi.fn(),
    retry: vi.fn(),
    setFollowNewest: vi.fn(),
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
    expect(screen.getByText(/not a complete historical record/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^pause$/i })).not.toBeInTheDocument();
  });

  it('clicking Start in idle calls onStart', async () => {
    const user = userEvent.setup();
    const { onStart } = renderPanel('idle');
    await user.click(screen.getByRole('button', { name: /^start$/i }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('connecting: shows Stop but not Start/Pause/Resume, a connecting badge, and a connecting message', () => {
    renderPanel('connecting');
    expect(screen.queryByRole('button', { name: /^start$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^stop$/i })).toBeInTheDocument();
    // UX-R3 §16 - one authoritative status badge (never a second,
    // possibly-disagreeing state label) plus the separate empty-list message.
    expect(screen.getByRole('status')).toHaveTextContent(/connecting/i);
    expect(screen.getByText(/^connecting…$/i)).toBeInTheDocument(); // empty-state message, distinct element
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
  });

  it('UX-R3 §16: the state badge itself (not only a secondary caption) carries visibly distinct text per state - never color alone, and never the same "LIVE" text regardless of state', () => {
    const states: Array<[LiveConnectionState, RegExp]> = [
      ['connecting', /^connecting$/i],
      ['live', /^live$/i],
      ['paused', /^paused$/i],
      ['reconnecting', /^reconnecting/i],
      ['stopped', /^stopped$/i],
      ['failed', /^connection failed$/i],
    ];
    const seenTexts = new Set<string>();
    for (const [state, expected] of states) {
      const { unmount } = renderPanel(state);
      const badge = screen.getByRole('status');
      expect(badge).toHaveTextContent(expected);
      seenTexts.add(badge.textContent ?? '');
      unmount();
    }
    // Every one of the 6 states produced a genuinely distinct badge string
    // - this is the concrete regression test for the friction found via
    // real rendered evidence (BEFORE-K-live-paused.png): the badge used to
    // say "LIVE" for every one of these states, distinguished only by a
    // small secondary "Paused" caption.
    expect(seenTexts.size).toBe(states.length);
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

  it('reconnecting: shows the attempt number, Stop remains available, no Pause/Resume/Start', () => {
    renderPanel('reconnecting', { reconnectAttempt: 2 });
    expect(screen.getByText(/reconnecting \(attempt 2\)/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^stop$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^start$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^pause$/i })).not.toBeInTheDocument();
  });

  it('failed: shows Retry (not Start), and the sanitized error message', () => {
    renderPanel('failed', { errorMessage: 'Live connection lost after 5 reconnect attempts. Click Retry to try again.' });
    expect(screen.getByRole('button', { name: /^retry$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^start$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/click retry to try again/i);
  });

  it('clicking Retry from failed calls live.retry', async () => {
    const user = userEvent.setup();
    const { live } = renderPanel('failed', { errorMessage: 'Live connection lost.' });
    await user.click(screen.getByRole('button', { name: /^retry$/i }));
    expect(live.retry).toHaveBeenCalledTimes(1);
  });

  it('a reconnectCount > 0 shows a persistent, honest continuity notice (never claims exact-once delivery)', () => {
    renderPanel('live', { reconnectCount: 2 });
    expect(screen.getByText(/reconnected 2 times this session/i)).toBeInTheDocument();
    expect(screen.getByText(/may have been missed/i)).toBeInTheDocument();
  });

  it('reconnectCount === 0 shows no continuity notice', () => {
    renderPanel('live', { reconnectCount: 0 });
    expect(screen.queryByText(/reconnected/i)).not.toBeInTheDocument();
  });

  it('OS-1E: sourceWarnings renders each warning truthfully, in order', () => {
    renderPanel('live', {
      sourceWarnings: [
        'Pod payment-api-1 / container app stopped — the pod or container no longer exists (404).',
        'Only 2 pod/container targets are being tailed live; the resolved scope was larger and was capped (TARGET_CAP_REACHED).',
      ],
    });
    const status = screen.getAllByRole('status').map((el) => el.textContent ?? '');
    expect(status.some((text) => text.includes('the pod or container no longer exists (404)'))).toBe(true);
    expect(status.some((text) => text.includes('TARGET_CAP_REACHED'))).toBe(true);
  });

  it('OS-1E: an empty sourceWarnings renders no warnings list at all', () => {
    renderPanel('live', { sourceWarnings: [] });
    expect(screen.queryByText(/TARGET_CAP_REACHED|LIVE_TARGET_STOPPED/i)).not.toBeInTheDocument();
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
    expect(counts).toHaveTextContent('Evicted (retention cap): 5');
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

  it('Clear only appears once there is something to clear', () => {
    renderPanel('live');
    expect(screen.queryByRole('button', { name: /^clear$/i })).not.toBeInTheDocument();

    renderPanel('live', { visibleEvents: [event()] });
    expect(screen.getByRole('button', { name: /^clear$/i })).toBeInTheDocument();
  });

  it('clicking Clear calls live.clear, never live.stop or live.exit', async () => {
    const user = userEvent.setup();
    const { live } = renderPanel('live', { visibleEvents: [event()] });
    await user.click(screen.getByRole('button', { name: /^clear$/i }));
    expect(live.clear).toHaveBeenCalledTimes(1);
    expect(live.stop).not.toHaveBeenCalled();
    expect(live.exit).not.toHaveBeenCalled();
  });

  it('Clear remains available while paused (it does not require an active connection state change)', () => {
    renderPanel('paused', { visibleEvents: [event()] });
    expect(screen.getByRole('button', { name: /^clear$/i })).toBeInTheDocument();
  });

  describe('severity filtering (Legacy Remediation Slice 5)', () => {
    it('shows only events matching the selected severity levels', async () => {
      const user = userEvent.setup();
      renderPanel('live', {
        visibleEvents: [
          event({ message: 'an info line', severity: 'INFO' }),
          event({ message: 'an error line', severity: 'ERROR' }),
        ],
      });
      expect(screen.getByText('an info line')).toBeInTheDocument();
      expect(screen.getByText('an error line')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /^errors only$/i }));

      expect(screen.queryByText('an info line')).not.toBeInTheDocument();
      expect(screen.getByText('an error line')).toBeInTheDocument();
    });

    it('the reused SeverityFilter never fires a search - purely local/display filtering', async () => {
      const user = userEvent.setup();
      const { live } = renderPanel('live', { visibleEvents: [event()] });
      await user.click(screen.getByRole('button', { name: /^errors only$/i }));
      expect(live.start).not.toHaveBeenCalled();
      expect(live.clear).not.toHaveBeenCalled();
    });
  });

  describe('text filtering (Legacy Remediation Slice 5)', () => {
    it('filters displayed events by message substring, case-insensitively', async () => {
      const user = userEvent.setup();
      renderPanel('live', {
        visibleEvents: [event({ message: 'payment authorized' }), event({ message: 'user logged in' })],
      });

      await user.type(screen.getByPlaceholderText(/filter displayed events/i), 'PAYMENT');

      expect(screen.getByText('payment authorized')).toBeInTheDocument();
      expect(screen.queryByText('user logged in')).not.toBeInTheDocument();
    });

    it('shows a "no events match" message when the filter excludes everything, distinct from the true-empty state', async () => {
      const user = userEvent.setup();
      renderPanel('live', { visibleEvents: [event({ message: 'payment authorized' })] });
      await user.type(screen.getByPlaceholderText(/filter displayed events/i), 'no-such-text');
      expect(screen.getByText(/no events match the current filter/i)).toBeInTheDocument();
    });

    it('the counts line reflects filtered vs retained counts distinctly', async () => {
      const user = userEvent.setup();
      renderPanel('live', {
        visibleEvents: [event({ message: 'alpha' }), event({ message: 'beta' })],
      });
      await user.type(screen.getByPlaceholderText(/filter displayed events/i), 'alpha');
      expect(screen.getByText(/visible: 1 \(of 2 retained\)/i)).toBeInTheDocument();
    });
  });

  describe('Follow newest (Legacy Remediation Slice 5)', () => {
    it('the toggle reflects live.followNewest via aria-pressed', () => {
      renderPanel('live', { followNewest: true });
      expect(screen.getByRole('button', { name: /follow newest/i })).toHaveAttribute('aria-pressed', 'true');
    });

    it('clicking the toggle calls setFollowNewest with the opposite value', async () => {
      const user = userEvent.setup();
      const { live } = renderPanel('live', { followNewest: true });
      await user.click(screen.getByRole('button', { name: /follow newest/i }));
      expect(live.setFollowNewest).toHaveBeenCalledWith(false);
    });

    it('"Jump to newest" only appears when follow is suspended, and shows the unseen count', () => {
      renderPanel('live', { followNewest: true, unseenCount: 5 });
      expect(screen.queryByRole('button', { name: /jump to newest/i })).not.toBeInTheDocument();

      renderPanel('live', { followNewest: false, unseenCount: 5 });
      expect(screen.getByRole('button', { name: /jump to newest \(5 new\)/i })).toBeInTheDocument();
    });

    it('clicking "Jump to newest" calls setFollowNewest(true)', async () => {
      const user = userEvent.setup();
      const { live } = renderPanel('live', { followNewest: false, unseenCount: 3 });
      await user.click(screen.getByRole('button', { name: /jump to newest/i }));
      expect(live.setFollowNewest).toHaveBeenCalledWith(true);
    });
  });

  describe('real scroll behavior (integration with useLiveTail)', () => {
    beforeEach(() => {
      installMockEventSource();
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      delete (globalThis as { EventSource?: unknown }).EventSource;
    });

    function Harness() {
      const live = useLiveTail();
      return <LiveTailPanel live={live} sourceDisplayName="Fixture" onStart={() => live.start('fixture', [])} />;
    }

    it('scrolling away from the top suspends follow-newest and reveals "Jump to newest"', () => {
      // fireEvent (not userEvent) throughout - userEvent's own internal
      // delay/scheduling machinery does not mix reliably with fake timers
      // in this combination; these are simple discrete clicks/scrolls
      // with no realistic-typing behavior to simulate.
      render(<Harness />);
      fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
      act(() => latestMockEventSource().emitOpen());
      act(() => latestMockEventSource().emit('log', event()));
      act(() => vi.advanceTimersByTime(BATCH_FLUSH_MS));

      expect(screen.queryByRole('button', { name: /jump to newest/i })).not.toBeInTheDocument();

      const list = screen.getByRole('list');
      Object.defineProperty(list, 'scrollTop', { value: 50, writable: true });
      fireEvent.scroll(list);

      expect(screen.getByRole('button', { name: /jump to newest/i })).toBeInTheDocument();
    });

    it('clicking "Jump to newest" restores follow-newest and hides the button again', () => {
      render(<Harness />);
      fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
      act(() => latestMockEventSource().emitOpen());
      act(() => latestMockEventSource().emit('log', event()));
      act(() => vi.advanceTimersByTime(BATCH_FLUSH_MS));

      const list = screen.getByRole('list');
      Object.defineProperty(list, 'scrollTop', { value: 50, writable: true });
      fireEvent.scroll(list);
      expect(screen.getByRole('button', { name: /jump to newest/i })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /jump to newest/i }));
      expect(screen.queryByRole('button', { name: /jump to newest/i })).not.toBeInTheDocument();
      expect(Element.prototype.scrollTo).toHaveBeenCalled();
    });
  });

  it('has no detectable accessibility violations in the live state', async () => {
    const { container } = renderPanel('live', { visibleEvents: [event()] });
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has no detectable accessibility violations in the reconnecting state', async () => {
    const { container } = renderPanel('reconnecting', { reconnectAttempt: 1 });
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has no detectable accessibility violations in the failed state', async () => {
    const { container } = renderPanel('failed', { errorMessage: 'Live connection lost.' });
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has no detectable accessibility violations with events and active filters', async () => {
    const { container } = renderPanel('live', {
      visibleEvents: [event({ message: 'alpha' }), event({ message: 'beta', severity: 'ERROR' })],
    });
    expect(await axe(container)).toHaveNoViolations();
  });
});
