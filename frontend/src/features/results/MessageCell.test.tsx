import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { MessageCell } from './MessageCell';
import type { LogEvent } from '../../shared/api/types';

function event(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    timestamp: null,
    timestampRaw: null,
    schemaVersion: null,
    service: null,
    serviceSourceHint: null,
    severity: null,
    severityNumber: null,
    message: 'short message',
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

describe('MessageCell', () => {
  it('shows the message text', () => {
    render(<MessageCell event={event({ message: 'connection timeout occurred' })} />);
    expect(screen.getByText('connection timeout occurred')).toBeInTheDocument();
  });

  it('shows no expand toggle for short text', () => {
    render(<MessageCell event={event({ message: 'short' })} />);
    expect(screen.queryByRole('button', { name: /more/i })).not.toBeInTheDocument();
  });

  it('shows an accessible expand toggle for long text, and it actually expands', async () => {
    const user = userEvent.setup();
    const longMessage = 'x'.repeat(150);
    render(<MessageCell event={event({ message: longMessage })} />);

    const toggle = screen.getByRole('button', { name: /more/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /less/i })).toBeInTheDocument();
  });

  it('marks a malformed event distinctly and shows its raw line', () => {
    render(<MessageCell event={event({ malformed: true, message: null, rawLine: 'NOT-JSON garbage' })} />);
    expect(screen.getByText('NOT-JSON garbage')).toBeInTheDocument();
    expect(screen.getByText('malformed')).toBeInTheDocument();
  });

  it('has no detectable accessibility violations, collapsed or expanded', async () => {
    const user = userEvent.setup();
    const { container } = render(<MessageCell event={event({ message: 'x'.repeat(150) })} />);
    expect(await axe(container)).toHaveNoViolations();

    await user.click(screen.getByRole('button', { name: /more/i }));
    expect(await axe(container)).toHaveNoViolations();
  });
});
