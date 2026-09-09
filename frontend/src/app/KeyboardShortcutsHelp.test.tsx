import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { KeyboardShortcutsHelp } from './KeyboardShortcutsHelp';

describe('KeyboardShortcutsHelp', () => {
  it('shows only the trigger until opened', () => {
    render(<KeyboardShortcutsHelp />);
    expect(screen.getByRole('button', { name: /keyboard shortcuts/i })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('clicking the trigger opens the shortcuts list', async () => {
    const user = userEvent.setup();
    render(<KeyboardShortcutsHelp />);
    await user.click(screen.getByRole('button', { name: /keyboard shortcuts/i }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/ctrl\/cmd \+ enter/i);
    expect(dialog).toHaveTextContent(/run the current search/i);
  });

  it('the global "?" key opens it, unless focus is inside a text field', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <input aria-label="other field" />
        <KeyboardShortcutsHelp />
      </div>,
    );

    const input = screen.getByLabelText('other field');
    await user.click(input);
    await user.keyboard('a?b'); // "?" typed while focused in a text field must not open the popover
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(input).toHaveValue('a?b');

    await user.click(document.body);
    await user.keyboard('{Shift>}?{/Shift}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('Close and Escape both dismiss it', async () => {
    const user = userEvent.setup();
    render(<KeyboardShortcutsHelp />);
    await user.click(screen.getByRole('button', { name: /keyboard shortcuts/i }));
    await user.click(screen.getByRole('button', { name: /^close$/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /keyboard shortcuts/i }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('has no detectable accessibility violations, closed or open', async () => {
    const user = userEvent.setup();
    const { container } = render(<KeyboardShortcutsHelp />);
    expect(await axe(container)).toHaveNoViolations();

    await user.click(screen.getByRole('button', { name: /keyboard shortcuts/i }));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('documents the four new Live keyboard shortcuts (UI Gap Closure Pass)', async () => {
    const user = userEvent.setup();
    render(<KeyboardShortcutsHelp />);
    await user.click(screen.getByRole('button', { name: /keyboard shortcuts/i }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(/pause \/ resume live/i);
    expect(dialog).toHaveTextContent(/stop live/i);
    expect(dialog).toHaveTextContent(/clear live events/i);
    expect(dialog).toHaveTextContent(/toggle follow newest/i);
  });
});
