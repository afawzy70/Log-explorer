import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { ActionsCell } from './ActionsCell';
import type { LogEvent } from '../../shared/api/types';
import { copyToClipboard } from '../../shared/browser/clipboard';

vi.mock('../../shared/browser/clipboard', () => ({
  copyToClipboard: vi.fn().mockResolvedValue(undefined),
}));

function event(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    timestamp: null,
    timestampRaw: null,
    schemaVersion: null,
    service: null,
    serviceSourceHint: null,
    severity: null,
    severityNumber: null,
    message: null,
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

describe('ActionsCell', () => {
  it('the trigger is never disabled, even with no copyable identifiers - "View details" (Phase H, renamed in UX-R4 §17) is always available', async () => {
    const user = userEvent.setup();
    render(<ActionsCell event={event()} onInspect={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: /actions for this event/i });
    expect(trigger).toBeEnabled();

    await user.click(trigger);
    expect(screen.getByRole('menuitem', { name: /view details/i })).toBeInTheDocument();
  });

  it('clicking "View details" calls onInspect and closes the menu', async () => {
    const user = userEvent.setup();
    const onInspect = vi.fn();
    render(<ActionsCell event={event({ traceId: 'trace-1' })} onInspect={onInspect} />);

    await user.click(screen.getByRole('button', { name: /actions for this event/i }));
    await user.click(screen.getByRole('menuitem', { name: /view details/i }));

    expect(onInspect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('lists only the identifiers actually present on the event', async () => {
    const user = userEvent.setup();
    render(<ActionsCell event={event({ traceId: 'trace-1', correlationId: 'corr-1' })} onInspect={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /actions for this event/i }));

    expect(screen.getByRole('menuitem', { name: /copy trace id/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /copy correlation id/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /copy span id/i })).not.toBeInTheDocument();
  });

  it('copying an identifier writes its real value to the clipboard and closes the menu', async () => {
    const user = userEvent.setup();
    render(<ActionsCell event={event({ traceId: 'trace-000100' })} onInspect={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /actions for this event/i }));
    await user.click(screen.getByRole('menuitem', { name: /copy trace id/i }));

    await waitFor(() => expect(copyToClipboard).toHaveBeenCalledWith('trace-000100'));
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('Escape and outside click close the menu', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <ActionsCell event={event({ traceId: 'trace-1' })} onInspect={vi.fn()} />
        <button type="button">outside</button>
      </div>,
    );

    await user.click(screen.getByRole('button', { name: /actions for this event/i }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('has no detectable accessibility violations, with or without identifiers', async () => {
    const { container, rerender } = render(<ActionsCell event={event()} onInspect={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();

    rerender(<ActionsCell event={event({ traceId: 'trace-1' })} onInspect={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  /*
   * UX-R4 §17/§18/§19 - every row must expose both investigation actions.
   */
  describe('UX-R4 - row investigation actions', () => {
    it('offers "Show surrounding logs" alongside "View details"', async () => {
      const user = userEvent.setup();
      render(
        <ActionsCell
          event={event({ timestamp: '2026-01-01T00:00:00Z' })}
          onInspect={vi.fn()}
          onShowContext={vi.fn()}
        />,
      );

      await user.click(screen.getByRole('button', { name: /actions for this event/i }));

      expect(screen.getByRole('menuitem', { name: /view details/i })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: /show surrounding logs/i })).toBeInTheDocument();
    });

    it('"Show surrounding logs" invokes the bounded context action and closes the menu', async () => {
      const user = userEvent.setup();
      const onShowContext = vi.fn();
      render(
        <ActionsCell
          event={event({ timestamp: '2026-01-01T00:00:00Z' })}
          onInspect={vi.fn()}
          onShowContext={onShowContext}
        />,
      );

      await user.click(screen.getByRole('button', { name: /actions for this event/i }));
      await user.click(screen.getByRole('menuitem', { name: /show surrounding logs/i }));

      expect(onShowContext).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    });

    it('lists the two investigation actions before the copy utilities, in workflow order', async () => {
      const user = userEvent.setup();
      render(
        <ActionsCell
          event={event({ timestamp: '2026-01-01T00:00:00Z', traceId: 'trace-1' })}
          onInspect={vi.fn()}
          onShowContext={vi.fn()}
        />,
      );

      await user.click(screen.getByRole('button', { name: /actions for this event/i }));
      const labels = screen.getAllByRole('menuitem').map((i) => i.textContent);

      expect(labels[0]).toMatch(/view details/i);
      expect(labels[1]).toMatch(/show surrounding logs/i);
      expect(labels.slice(2).every((l) => /^Copy /.test(l ?? ''))).toBe(true);
    });

    it('omits "Show surrounding logs" for an event with no timestamp, rather than offering a dead action', async () => {
      const user = userEvent.setup();
      render(<ActionsCell event={event({ timestamp: null })} onInspect={vi.fn()} onShowContext={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: /actions for this event/i }));

      expect(screen.getByRole('menuitem', { name: /view details/i })).toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: /show surrounding logs/i })).not.toBeInTheDocument();
    });

    it('has no detectable accessibility violations with both investigation actions present', async () => {
      const user = userEvent.setup();
      const { container } = render(
        <ActionsCell
          event={event({ timestamp: '2026-01-01T00:00:00Z', traceId: 'trace-1' })}
          onInspect={vi.fn()}
          onShowContext={vi.fn()}
        />,
      );
      await user.click(screen.getByRole('button', { name: /actions for this event/i }));
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
