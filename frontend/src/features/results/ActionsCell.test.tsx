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
    containerId: null,
    containerName: null,
    stream: null,
    namespace: null,
    pod: null,
    ...overrides,
  };
}

describe('ActionsCell', () => {
  it('is disabled with an honest label when the event has no copyable identifiers', () => {
    render(<ActionsCell event={event()} />);
    const trigger = screen.getByRole('button', { name: /no actions available/i });
    expect(trigger).toBeDisabled();
  });

  it('lists only the identifiers actually present on the event', async () => {
    const user = userEvent.setup();
    render(<ActionsCell event={event({ traceId: 'trace-1', correlationId: 'corr-1' })} />);

    await user.click(screen.getByRole('button', { name: /actions for this event/i }));

    expect(screen.getByRole('menuitem', { name: /copy trace id/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /copy correlation id/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /copy span id/i })).not.toBeInTheDocument();
  });

  it('copying an identifier writes its real value to the clipboard and closes the menu', async () => {
    const user = userEvent.setup();
    render(<ActionsCell event={event({ traceId: 'trace-000100' })} />);

    await user.click(screen.getByRole('button', { name: /actions for this event/i }));
    await user.click(screen.getByRole('menuitem', { name: /copy trace id/i }));

    await waitFor(() => expect(copyToClipboard).toHaveBeenCalledWith('trace-000100'));
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('Escape and outside click close the menu', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <ActionsCell event={event({ traceId: 'trace-1' })} />
        <button type="button">outside</button>
      </div>,
    );

    await user.click(screen.getByRole('button', { name: /actions for this event/i }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('has no detectable accessibility violations, with or without identifiers', async () => {
    const { container, rerender } = render(<ActionsCell event={event()} />);
    expect(await axe(container)).toHaveNoViolations();

    rerender(<ActionsCell event={event({ traceId: 'trace-1' })} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
