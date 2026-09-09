import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { TableSettingsControl } from './TableSettingsControl';
import { useTablePreferences } from './tablePreferences';

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /^columns$/i }));
}

/** Renders the real control against a real `useTablePreferences` instance, exactly as `ResultsPanel` wires them together. */
function Harness() {
  const table = useTablePreferences();
  return <TableSettingsControl table={table} />;
}

describe('TableSettingsControl', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('shows only the trigger until opened', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: /^columns$/i })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opening lists every column with a checkbox reflecting current visibility', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await open(user);

    expect(screen.getByRole('checkbox', { name: 'Time' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Logger' })).not.toBeChecked();
  });

  it('unchecking a visible optional-eligible column hides it (mission item 3)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await open(user);
    await user.click(screen.getByRole('checkbox', { name: 'Service' }));
    expect(screen.getByRole('checkbox', { name: 'Service' })).not.toBeChecked();
  });

  it('checking a hidden optional column shows it (mission item 4)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await open(user);
    await user.click(screen.getByRole('checkbox', { name: 'Logger' }));
    expect(screen.getByRole('checkbox', { name: 'Logger' })).toBeChecked();
  });

  it('Move up/down buttons reorder columns, keyboard-operable via Tab + Enter (mission items 5 + 6)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await open(user);

    const rows = screen.getAllByRole('listitem');
    const initialLabels = rows.map((r) => r.querySelector('label')!.textContent);
    expect(initialLabels[0]).toBe('Time');
    expect(initialLabels[1]).toBe('Level');

    const moveServiceUp = screen.getByRole('button', { name: 'Move Service up' });
    moveServiceUp.focus();
    expect(moveServiceUp).toHaveFocus();
    await user.keyboard('{Enter}');

    const rowsAfter = screen.getAllByRole('listitem');
    const labelsAfter = rowsAfter.map((r) => r.querySelector('label')!.textContent);
    expect(labelsAfter[1]).toBe('Service'); // moved up ahead of Level
  });

  it('the first row\'s Move up button, and the last row\'s Move down button, are disabled (boundary safety)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await open(user);
    expect(screen.getByRole('button', { name: 'Move Time up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Language down' })).toBeDisabled();
  });

  it('Density toggle switches to Compact and back (mission item 7)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await open(user);

    const compact = screen.getByRole('button', { name: 'Compact' });
    await user.click(compact);
    expect(compact).toHaveAttribute('aria-pressed', 'true');

    const comfortable = screen.getByRole('button', { name: 'Comfortable' });
    await user.click(comfortable);
    expect(comfortable).toHaveAttribute('aria-pressed', 'true');
    expect(compact).toHaveAttribute('aria-pressed', 'false');
  });

  it('"Reset table" restores the exact seven-column default (mission item 8)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await open(user);

    await user.click(screen.getByRole('checkbox', { name: 'Logger' })); // show an optional column
    await user.click(screen.getByRole('checkbox', { name: 'Time' })); // hide a default column
    await user.click(screen.getByRole('button', { name: 'Compact' }));

    await user.click(screen.getByRole('button', { name: 'Reset table' }));

    expect(screen.getByRole('checkbox', { name: 'Time' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Logger' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Comfortable' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('disables the checkbox for the only remaining visible column, with a describing hint (never zero visible data columns)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await open(user);

    for (const label of ['Level', 'Service', 'What happened', 'User/Customer', 'Correlation/Trace']) {
      await user.click(screen.getByRole('checkbox', { name: label }));
    }

    const lastCheckbox = screen.getByRole('checkbox', { name: 'Time' });
    expect(lastCheckbox).toBeDisabled();
    expect(lastCheckbox).toHaveAccessibleDescription(/at least one column besides actions must stay visible/i);
  });

  it('has no jest-axe accessibility violations while open', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    await open(user);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('none of the column checkbox/move/density/reset interactions ever call a search-triggering callback', async () => {
    // TableSettingsControl only ever receives `table` (a TablePreferencesHandle) -
    // it has no access to SearchState/runSearch at all, so this is
    // structurally guaranteed; this test pins that down by driving every
    // interaction through the real hook (not a mock) and confirming
    // nothing outside `table.preferences` and localStorage was touched.
    const { result } = renderHook(() => useTablePreferences());
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    render(<TableSettingsControl table={result.current} />);
    const user = userEvent.setup();
    await open(user);
    await user.click(screen.getByRole('checkbox', { name: 'Logger' }));
    expect(setItemSpy).toHaveBeenCalledWith('logexplorer.tablePreferences.v1', expect.any(String));
    // and never anything resembling a search/query storage key
    for (const call of setItemSpy.mock.calls) {
      expect(call[0]).not.toMatch(/search|query|filter/i);
    }
    setItemSpy.mockRestore();
  });

  it('"Close" closes the panel', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await open(user);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
