import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { SortControl } from './SortControl';

/*
 * B2 (Session 4) RECOMPOSE - the `<select>` became a single toggle button
 * living in the scope strip (`COMPONENT_INVENTORY.md`'s SortControl.tsx
 * entry). There are only ever two orderings, so a click always reaches
 * the other one; the committed direction is still always named in words
 * on the button, never only an arrow glyph (UX-R4 §12/§35's own
 * requirement, unchanged by the recompose).
 */
describe('SortControl', () => {
  it('names the committed ordering in words, never only an arrow glyph', () => {
    render(<SortControl value="BACKWARD" onChange={vi.fn()} />);
    const toggle = screen.getByRole('button', { name: /newest first/i });
    expect(toggle).toHaveTextContent('Newest first');
  });

  it('always shows the committed direction, not a default', () => {
    const { rerender } = render(<SortControl value="FORWARD" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /oldest first/i })).toBeInTheDocument();

    rerender(<SortControl value="BACKWARD" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /newest first/i })).toBeInTheDocument();
  });

  it('a click toggles to the other ordering', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SortControl value="BACKWARD" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /newest first/i }));
    expect(onChange).toHaveBeenCalledWith('FORWARD');
  });

  it('toggles back from Oldest to Newest', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SortControl value="FORWARD" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /oldest first/i }));
    expect(onChange).toHaveBeenCalledWith('BACKWARD');
  });

  it('is disabled while a search is in flight, so a second direction cannot race the first', () => {
    render(<SortControl value="BACKWARD" onChange={vi.fn()} disabled />);
    expect(screen.getByRole('button', { name: /newest first/i })).toBeDisabled();
  });

  it('has an accessible name and no detectable accessibility violations', async () => {
    const { container } = render(<SortControl value="BACKWARD" onChange={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
