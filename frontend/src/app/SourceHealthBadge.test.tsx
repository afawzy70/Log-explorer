import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { SourceHealthBadge } from './SourceHealthBadge';
import type { SourceHealthDetail } from '../shared/api/types';

function health(overrides: Partial<SourceHealthDetail> = {}): SourceHealthDetail {
  return {
    status: 'UP',
    message: 'ok',
    checkedAt: '2026-01-01T00:00:00Z',
    warnings: [],
    latencyMs: 12,
    capabilities: { historicalSearch: true, liveTail: true, rawLogQL: false, serviceDiscovery: true, queryStatistics: false, contextView: false },
    ...overrides,
  };
}

describe('SourceHealthBadge', () => {
  it('shows a checking state while loading', () => {
    render(<SourceHealthBadge health={null} loading onRetry={vi.fn()} />);
    expect(screen.getByText(/checking/i)).toBeInTheDocument();
  });

  it('shows Healthy for UP with no retry button', () => {
    render(<SourceHealthBadge health={health({ status: 'UP' })} loading={false} onRetry={vi.fn()} />);
    expect(screen.getByText(/healthy/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^retry$/i })).not.toBeInTheDocument();
  });

  it('shows Unhealthy for DOWN with a retry button', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<SourceHealthBadge health={health({ status: 'DOWN', message: 'unreachable' })} loading={false} onRetry={onRetry} />);

    expect(screen.getByText(/unhealthy/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^retry$/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows Degraded distinctly from Unhealthy, with its own retry button', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<SourceHealthBadge health={health({ status: 'DEGRADED', message: 'reachable but empty' })} loading={false} onRetry={onRetry} />);

    expect(screen.getByText(/degraded/i)).toBeInTheDocument();
    expect(screen.queryByText(/unhealthy/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^retry$/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('has no detectable accessibility violations in every state', async () => {
    const { container, rerender } = render(<SourceHealthBadge health={null} loading onRetry={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();

    rerender(<SourceHealthBadge health={health({ status: 'DOWN', message: 'x' })} loading={false} onRetry={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  describe('progressive disclosure (Legacy Remediation Slice 6)', () => {
    it('the compact badge alone distinguishes Healthy/Degraded/Unavailable without opening details', () => {
      const { rerender } = render(<SourceHealthBadge health={health({ status: 'UP' })} loading={false} onRetry={vi.fn()} />);
      expect(screen.getByText(/healthy/i)).toBeInTheDocument();

      rerender(<SourceHealthBadge health={health({ status: 'DEGRADED' })} loading={false} onRetry={vi.fn()} />);
      expect(screen.getByText(/degraded/i)).toBeInTheDocument();

      rerender(<SourceHealthBadge health={health({ status: 'DOWN' })} loading={false} onRetry={vi.fn()} />);
      expect(screen.getByText(/unhealthy/i)).toBeInTheDocument();
    });

    it('clicking the details trigger reveals message, latency, checked time, and capabilities', async () => {
      const user = userEvent.setup();
      render(
        <SourceHealthBadge
          health={health({ message: 'Docker daemon reachable', latencyMs: 42, checkedAt: '2026-01-01T00:00:00Z' })}
          loading={false}
          onRetry={vi.fn()}
        />,
      );

      await user.click(screen.getByRole('button', { name: /source health details/i }));

      expect(screen.getByRole('dialog', { name: /source health details/i })).toBeInTheDocument();
      expect(screen.getByText('Docker daemon reachable')).toBeInTheDocument();
      expect(screen.getByText('42 ms')).toBeInTheDocument();
      expect(screen.getByText(/historical search/i)).toBeInTheDocument();
      expect(screen.getByText(/live/i)).toBeInTheDocument();
    });

    it('shows "Not measured" rather than a fabricated latency when latencyMs is null', async () => {
      const user = userEvent.setup();
      render(<SourceHealthBadge health={health({ latencyMs: null })} loading={false} onRetry={vi.fn()} />);
      await user.click(screen.getByRole('button', { name: /source health details/i }));
      expect(screen.getByText(/not measured/i)).toBeInTheDocument();
      expect(screen.queryByText(/null ms/i)).not.toBeInTheDocument();
    });

    it('lists every sanitized warning when present, shows nothing when there are none', async () => {
      const user = userEvent.setup();
      const { rerender } = render(
        <SourceHealthBadge
          health={health({ status: 'DEGRADED', warnings: ['No containers matched the configured Compose project filter'] })}
          loading={false}
          onRetry={vi.fn()}
        />,
      );
      await user.click(screen.getByRole('button', { name: /source health details/i }));
      expect(screen.getByText('No containers matched the configured Compose project filter')).toBeInTheDocument();

      rerender(<SourceHealthBadge health={health({ status: 'UP', warnings: [] })} loading={false} onRetry={vi.fn()} />);
      expect(screen.queryByText(/warnings/i)).not.toBeInTheDocument();
    });

    it('opening details never causes any network request - it only reveals the already-fetched health prop', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const user = userEvent.setup();
      render(<SourceHealthBadge health={health()} loading={false} onRetry={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: /source health details/i }));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(fetchSpy).not.toHaveBeenCalled();

      fetchSpy.mockRestore();
    });

    it('Escape closes the details popover and returns focus to its trigger', async () => {
      const user = userEvent.setup();
      render(<SourceHealthBadge health={health()} loading={false} onRetry={vi.fn()} />);
      const trigger = screen.getByRole('button', { name: /source health details/i });

      await user.click(trigger);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });

    it('Close button closes the details popover', async () => {
      const user = userEvent.setup();
      render(<SourceHealthBadge health={health()} loading={false} onRetry={vi.fn()} />);
      await user.click(screen.getByRole('button', { name: /source health details/i }));
      await user.click(screen.getByRole('button', { name: /^close$/i }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('has no detectable accessibility violations with details open', async () => {
      const user = userEvent.setup();
      const { container } = render(
        <SourceHealthBadge health={health({ status: 'DEGRADED', warnings: ['a warning'] })} loading={false} onRetry={vi.fn()} />,
      );
      await user.click(screen.getByRole('button', { name: /source health details/i }));
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
