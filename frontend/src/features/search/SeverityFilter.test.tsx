import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { SeverityFilter } from './SeverityFilter';
import { ALL_SEVERITY_LEVEL_IDS, DEFAULT_SEVERITY_LEVELS } from './severityLevels';

describe('SeverityFilter', () => {
  it('every level chip always shows its text label, never color alone', () => {
    render(<SeverityFilter selected={DEFAULT_SEVERITY_LEVELS} onChange={vi.fn()} />);
    for (const label of ['Trace', 'Debug', 'Info', 'Warn', 'Error']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('marks the active levels with aria-pressed, not color alone', () => {
    render(<SeverityFilter selected={['ERROR']} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Error' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Info' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('clicking a level toggles it in the selection', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SeverityFilter selected={['ERROR']} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Warn' }));
    expect(onChange).toHaveBeenCalledWith(['ERROR', 'WARN']);
  });

  it('clicking an already-active level removes it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SeverityFilter selected={['ERROR', 'WARN']} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Warn' }));
    expect(onChange).toHaveBeenCalledWith(['ERROR']);
  });

  it('"All" selects every level', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SeverityFilter selected={['ERROR']} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(onChange).toHaveBeenCalledWith(ALL_SEVERITY_LEVEL_IDS);
  });

  it('"Errors only" selects just ERROR', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SeverityFilter selected={DEFAULT_SEVERITY_LEVELS} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Errors only' }));
    expect(onChange).toHaveBeenCalledWith(['ERROR']);
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = render(<SeverityFilter selected={DEFAULT_SEVERITY_LEVELS} onChange={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
