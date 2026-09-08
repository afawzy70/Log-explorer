import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { SourceHealthBadge } from './SourceHealthBadge';

describe('SourceHealthBadge', () => {
  it('shows a checking state while loading', () => {
    render(<SourceHealthBadge health={null} loading onRetry={vi.fn()} />);
    expect(screen.getByText(/checking/i)).toBeInTheDocument();
  });

  it('shows Healthy for UP with no retry button', () => {
    render(<SourceHealthBadge health={{ status: 'UP', message: 'ok', checkedAt: '2026-01-01T00:00:00Z' }} loading={false} onRetry={vi.fn()} />);
    expect(screen.getByText(/healthy/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });

  it('shows Unhealthy for DOWN with a retry button', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<SourceHealthBadge health={{ status: 'DOWN', message: 'unreachable', checkedAt: '2026-01-01T00:00:00Z' }} loading={false} onRetry={onRetry} />);

    expect(screen.getByText(/unhealthy/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('has no detectable accessibility violations in every state', async () => {
    const { container, rerender } = render(<SourceHealthBadge health={null} loading onRetry={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();

    rerender(<SourceHealthBadge health={{ status: 'DOWN', message: 'x', checkedAt: '2026-01-01T00:00:00Z' }} loading={false} onRetry={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
