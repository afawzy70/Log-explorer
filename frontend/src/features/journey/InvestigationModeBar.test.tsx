import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { InvestigationModeBar } from './InvestigationModeBar';
import { copyToClipboard } from '../../shared/browser/clipboard';

vi.mock('../../shared/browser/clipboard', () => ({ copyToClipboard: vi.fn() }));

describe('InvestigationModeBar', () => {
  it('renders the Back button with its label and the "B" keyboard hint', () => {
    render(<InvestigationModeBar backLabel="Back to search results" onBack={vi.fn()} title="Trace" />);
    const back = screen.getByRole('button', { name: /back to search results/i });
    expect(back).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('clicking Back calls onBack', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<InvestigationModeBar backLabel="Back to search results" onBack={onBack} title="Trace" />);
    await user.click(screen.getByRole('button', { name: /back to search results/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('renders the title and, when given, the ID value beside it, joined by a real colon (the established, tested heading shape - e.g. "Trace: t-1234")', () => {
    render(<InvestigationModeBar backLabel="Back" onBack={vi.fn()} title="Trace" idValue="t-1234" />);
    expect(screen.getByRole('heading', { name: 'Trace: t-1234' })).toBeInTheDocument();
    expect(screen.getByText('t-1234')).toBeInTheDocument();
  });

  it('renders no ID span at all when idValue is not given (Surroundings)', () => {
    const { container } = render(<InvestigationModeBar backLabel="Back" onBack={vi.fn()} title="Surroundings" />);
    expect(container.querySelector('h1')?.textContent).toBe('Surroundings');
  });

  it('renders a Copy ID button only when both idValue and copyLabel are given, and it copies the real ID', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<InvestigationModeBar backLabel="Back" onBack={vi.fn()} title="Trace" idValue="t-1234" />);
    expect(screen.queryByRole('button', { name: /copy/i })).not.toBeInTheDocument();

    rerender(<InvestigationModeBar backLabel="Back" onBack={vi.fn()} title="Trace" idValue="t-1234" copyLabel="trace" />);
    await user.click(screen.getByRole('button', { name: /copy trace id/i }));
    expect(copyToClipboard).toHaveBeenCalledWith('t-1234');
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = render(
      <InvestigationModeBar backLabel="Back to search results" onBack={vi.fn()} title="Trace" idValue="t-1234" copyLabel="trace" />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
