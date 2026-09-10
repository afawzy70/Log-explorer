import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { KeyboardShortcutsHelp } from './KeyboardShortcutsHelp';
import { ShortcutRegistryProvider, useShortcut } from '../shared/keyboard/ShortcutRegistry';

/**
 * Legacy Remediation Slice 8 - `KeyboardShortcutsHelp` no longer owns a
 * hardcoded shortcut list; it renders whatever is currently registered on
 * {@link useRegisteredShortcuts}. So this file tests the *generic*
 * rendering/grouping/dismissal behavior against small fixture shortcuts
 * registered right here, rather than asserting on the real app's specific
 * bindings (Ctrl/Cmd+Enter, the four Live letters, etc.) - those are
 * covered by the real components' own tests (`useProductivityShortcuts`
 * has no dedicated test file but is exercised via `App`/E2E,
 * `useLiveKeyboardShortcuts.test.ts`, `EventInspector.test.tsx`) and by
 * this mission's required E2E scenario ("shortcut help opens and reflects
 * real bindings").
 */
function FixtureShortcut({
  id = 'fixture.one',
  keys = 'Z',
  description = 'Fixture action one',
  group = 'Search & filters',
}: {
  id?: string;
  keys?: string;
  description?: string;
  group?: string;
}) {
  useShortcut({
    id,
    keys,
    description,
    group,
    test: (e) => e.key.toLowerCase() === keys.toLowerCase(),
    onTrigger: () => {},
  });
  return null;
}

function renderHelp(extra: ReactNode = null) {
  return render(
    <ShortcutRegistryProvider>
      <KeyboardShortcutsHelp />
      {extra}
    </ShortcutRegistryProvider>,
  );
}

describe('KeyboardShortcutsHelp', () => {
  it('shows only the trigger until opened', () => {
    renderHelp();
    expect(screen.getByRole('button', { name: /keyboard shortcuts/i })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('clicking the trigger opens the shortcuts list, reflecting a shortcut registered elsewhere in the tree', async () => {
    const user = userEvent.setup();
    renderHelp(<FixtureShortcut description="Run the fixture search" />);
    await user.click(screen.getByRole('button', { name: /keyboard shortcuts/i }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/run the fixture search/i);
    expect(dialog).toHaveTextContent('Z');
  });

  it('never lists a fixture shortcut whose owning component has unmounted', async () => {
    const user = userEvent.setup();
    const { rerender } = renderHelp(<FixtureShortcut description="Ephemeral fixture action" />);
    rerender(
      <ShortcutRegistryProvider>
        <KeyboardShortcutsHelp />
      </ShortcutRegistryProvider>,
    );
    await user.click(screen.getByRole('button', { name: /keyboard shortcuts/i }));
    expect(screen.getByRole('dialog')).not.toHaveTextContent(/ephemeral fixture action/i);
  });

  it('groups entries under their declared group heading, in the fixed group order', async () => {
    const user = userEvent.setup();
    renderHelp(
      <>
        <FixtureShortcut id="fixture.live" keys="Q" description="Fixture live action" group="Live" />
        <FixtureShortcut id="fixture.search" keys="Y" description="Fixture search action" group="Search & filters" />
      </>,
    );
    await user.click(screen.getByRole('button', { name: /keyboard shortcuts/i }));

    const dialog = screen.getByRole('dialog');
    const text = dialog.textContent ?? '';
    const searchHeadingIndex = text.indexOf('Search & filters');
    const liveHeadingIndex = text.indexOf('Live');
    const searchEntryIndex = text.indexOf('Fixture search action');
    const liveEntryIndex = text.indexOf('Fixture live action');
    expect(searchHeadingIndex).toBeGreaterThanOrEqual(0);
    expect(liveHeadingIndex).toBeGreaterThan(searchHeadingIndex);
    expect(searchEntryIndex).toBeGreaterThan(searchHeadingIndex);
    expect(liveEntryIndex).toBeGreaterThan(liveHeadingIndex);
  });

  it('always shows the element-scoped row/actions-menu shortcuts once any "Results & inspector" entry exists', async () => {
    const user = userEvent.setup();
    renderHelp(<FixtureShortcut id="fixture.inspector" keys="X" description="Fixture inspector action" group="Results & inspector" />);
    await user.click(screen.getByRole('button', { name: /keyboard shortcuts/i }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(/move between result rows/i);
    expect(dialog).toHaveTextContent(/open the focused row.s actions menu/i);
    expect(dialog).toHaveTextContent(/fixture inspector action/i);
  });

  it('the global "?" key opens it, unless focus is inside a text field', async () => {
    const user = userEvent.setup();
    renderHelp(
      <div>
        <input aria-label="other field" />
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
    renderHelp();
    await user.click(screen.getByRole('button', { name: /keyboard shortcuts/i }));
    await user.click(screen.getByRole('button', { name: /^close$/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /keyboard shortcuts/i }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('has no detectable accessibility violations, closed or open', async () => {
    const user = userEvent.setup();
    const { container } = renderHelp(<FixtureShortcut />);
    expect(await axe(container)).toHaveNoViolations();

    await user.click(screen.getByRole('button', { name: /keyboard shortcuts/i }));
    expect(await axe(container)).toHaveNoViolations();
  });
});
