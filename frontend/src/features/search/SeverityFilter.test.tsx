import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { SeverityFilter } from './SeverityFilter';
import { ALL_SEVERITY_LEVEL_IDS, DEFAULT_SEVERITY_LEVELS } from './severityLevels';

/*
 * B2 (Session 4) - RECOMPOSE: the level chips now live behind a "Severity" field trigger's popover
 * (COMPONENT_INVENTORY.md), not always inline. Every test that interacts with a chip opens the trigger
 * first - the popover's own content (chip labels, toggle behaviour, aria-pressed) is otherwise unchanged
 * from before this recompose, so those assertions are unchanged too.
 */
async function openPopover(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /^severity:/i }));
}

describe('SeverityFilter', () => {
  describe('the trigger', () => {
    it('states the active set in words, truthfully computed from the selection - never colour/shape alone', () => {
      // A genuine partial selection, not "the default" - PR61_DEFAULT_LOG_LEVELS_SINGLE_JAR_AND_USAGE_DOCS
      // made every level selected the default, so this test names an explicit subset instead; the
      // default-is-now-"All" case is covered by the next test, which already exercises ALL_SEVERITY_LEVEL_IDS.
      render(<SeverityFilter selected={['INFO', 'WARN', 'ERROR']} onChange={vi.fn()} />);
      const trigger = screen.getByRole('button', { name: 'Severity: Info, Warn, Error' });
      expect(trigger).toHaveTextContent('Info, Warn, Error');
    });

    it('reads "All" when every level is selected (the default), "Errors only" when just ERROR is, "None" when none are', () => {
      const { rerender } = render(<SeverityFilter selected={ALL_SEVERITY_LEVEL_IDS} onChange={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Severity: All' })).toBeInTheDocument();

      rerender(<SeverityFilter selected={['ERROR']} onChange={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Severity: Errors only' })).toBeInTheDocument();

      rerender(<SeverityFilter selected={[]} onChange={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Severity: None' })).toBeInTheDocument();
    });

    it('shows one decorative, shape-differentiated mark per active level, matching the count exactly', () => {
      const { container } = render(<SeverityFilter selected={['ERROR', 'WARN']} onChange={vi.fn()} />);
      const marks = container.querySelectorAll('[class*="sevMark"]');
      expect(marks).toHaveLength(2);
      marks.forEach((mark) => expect(mark).toHaveAttribute('aria-hidden', 'true'));
    });

    it('the popover is closed by default, and opens on click', async () => {
      const user = userEvent.setup();
      render(<SeverityFilter selected={DEFAULT_SEVERITY_LEVELS} onChange={vi.fn()} />);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      await openPopover(user);
      expect(screen.getByRole('dialog', { name: 'Severity' })).toBeInTheDocument();
    });
  });

  describe('the popover', () => {
    it('every level chip always shows its text label, never color alone', async () => {
      const user = userEvent.setup();
      render(<SeverityFilter selected={DEFAULT_SEVERITY_LEVELS} onChange={vi.fn()} />);
      await openPopover(user);
      for (const label of ['Trace', 'Debug', 'Info', 'Warn', 'Error', 'Unknown']) {
        expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
      }
    });

    it('owner follow-up - "Unknown" is an ordinary toggleable chip, on the same footing as every real level', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<SeverityFilter selected={['ERROR']} onChange={onChange} />);
      await openPopover(user);

      expect(screen.getByRole('button', { name: 'Unknown' })).toHaveAttribute('aria-pressed', 'false');
      await user.click(screen.getByRole('button', { name: 'Unknown' }));
      expect(onChange).toHaveBeenCalledWith(['ERROR', 'UNKNOWN']);
    });

    it('marks the active levels with aria-pressed, not color alone', async () => {
      const user = userEvent.setup();
      render(<SeverityFilter selected={['ERROR']} onChange={vi.fn()} />);
      await openPopover(user);
      expect(screen.getByRole('button', { name: 'Error' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'Info' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('clicking a level toggles it in the selection', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<SeverityFilter selected={['ERROR']} onChange={onChange} />);
      await openPopover(user);

      await user.click(screen.getByRole('button', { name: 'Warn' }));
      expect(onChange).toHaveBeenCalledWith(['ERROR', 'WARN']);
    });

    it('clicking an already-active level removes it', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<SeverityFilter selected={['ERROR', 'WARN']} onChange={onChange} />);
      await openPopover(user);

      await user.click(screen.getByRole('button', { name: 'Warn' }));
      expect(onChange).toHaveBeenCalledWith(['ERROR']);
    });

    it('"All" selects every level', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<SeverityFilter selected={['ERROR']} onChange={onChange} />);
      await openPopover(user);

      await user.click(screen.getByRole('button', { name: 'All' }));
      expect(onChange).toHaveBeenCalledWith(ALL_SEVERITY_LEVEL_IDS);
    });

    it('"Errors only" selects just ERROR', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<SeverityFilter selected={DEFAULT_SEVERITY_LEVELS} onChange={onChange} />);
      await openPopover(user);

      await user.click(screen.getByRole('button', { name: 'Errors only' }));
      expect(onChange).toHaveBeenCalledWith(['ERROR']);
    });

    it('Escape closes the popover and returns focus to the trigger', async () => {
      const user = userEvent.setup();
      render(<SeverityFilter selected={DEFAULT_SEVERITY_LEVELS} onChange={vi.fn()} />);
      await openPopover(user);
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^severity:/i })).toHaveFocus();
    });
  });

  it('has no detectable accessibility violations, closed or open', async () => {
    const user = userEvent.setup();
    const { container } = render(<SeverityFilter selected={DEFAULT_SEVERITY_LEVELS} onChange={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();

    await openPopover(user);
    expect(await axe(container)).toHaveNoViolations();
  });
});
