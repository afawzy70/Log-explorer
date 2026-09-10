import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { ContextAction } from './ContextAction';
import { fullEvent, sparseEvent } from './testEventFixture';

describe('ContextAction', () => {
  it('renders nothing for an event with no timestamp - there is nothing to center a window on', () => {
    const { container } = render(<ContextAction event={sparseEvent()} onConfirm={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('"Display bounded query/time range before execution": the preview shows the exact ±30s window before anything runs', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ContextAction event={fullEvent({ timestamp: '2026-01-01T12:00:00.000Z' })} onConfirm={onConfirm} />);

    await user.click(screen.getByRole('button', { name: /show surrounding logs/i }));

    // 30s before and after the event timestamp, both visible before confirming.
    expect(screen.getByText(/11:59:30/)).toBeInTheDocument();
    expect(screen.getByText(/12:00:30/)).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('scopes the preview to the event service when present', async () => {
    const user = userEvent.setup();
    render(<ContextAction event={fullEvent({ service: 'payments-api' })} onConfirm={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /show surrounding logs/i }));
    expect(screen.getByText(/payments-api/)).toBeInTheDocument();
  });

  it('Run calls onConfirm and closes the preview; Cancel closes without calling it', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ContextAction event={fullEvent()} onConfirm={onConfirm} />);

    await user.click(screen.getByRole('button', { name: /show surrounding logs/i }));
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /show surrounding logs/i }));
    await user.click(screen.getByRole('button', { name: /^run$/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('has no detectable accessibility violations', async () => {
    const user = userEvent.setup();
    const { container } = render(<ContextAction event={fullEvent()} onConfirm={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /show surrounding logs/i }));
    expect(await axe(container)).toHaveNoViolations();
  });
});
