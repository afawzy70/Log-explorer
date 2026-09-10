import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { SortControl } from './SortControl';

/** UX-R4 §12/§35 - the sort affordance itself: labelled, keyboard-operable, and always showing the committed direction. */
describe('SortControl', () => {
  it('names both orderings in words, so the ordering is never encoded only in an arrow glyph', () => {
    render(<SortControl value="BACKWARD" onChange={vi.fn()} />);
    const select = screen.getByRole('combobox', { name: /sort/i });
    expect(select).toHaveValue('BACKWARD');
    expect(screen.getByRole('option', { name: 'Newest first' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Oldest first' })).toBeInTheDocument();
  });

  it('always shows the committed direction, not a default', () => {
    const { rerender } = render(<SortControl value="FORWARD" onChange={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: /sort/i })).toHaveValue('FORWARD');

    rerender(<SortControl value="BACKWARD" onChange={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: /sort/i })).toHaveValue('BACKWARD');
  });

  it('commits a direction change', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SortControl value="BACKWARD" onChange={onChange} />);

    await user.selectOptions(screen.getByRole('combobox', { name: /sort/i }), 'FORWARD');

    expect(onChange).toHaveBeenCalledWith('FORWARD');
  });

  it('is disabled while a search is in flight, so a second direction cannot race the first', () => {
    render(<SortControl value="BACKWARD" onChange={vi.fn()} disabled />);
    expect(screen.getByRole('combobox', { name: /sort/i })).toBeDisabled();
  });

  it('has an accessible name and no detectable accessibility violations', async () => {
    const { container } = render(<SortControl value="BACKWARD" onChange={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
