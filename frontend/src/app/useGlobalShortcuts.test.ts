import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useGlobalShortcuts } from './useGlobalShortcuts';

describe('useGlobalShortcuts', () => {
  it('Ctrl+Enter runs the current search from anywhere on the page, even while typing', async () => {
    const user = userEvent.setup();
    const runSearch = vi.fn();
    document.body.innerHTML = '<input aria-label="scratch" />';
    renderHook(() => useGlobalShortcuts(runSearch));

    await user.click(document.querySelector('input')!);
    await user.keyboard('{Control>}{Enter}{/Control}');

    expect(runSearch).toHaveBeenCalledTimes(1);
  });

  it('Cmd/Meta+Enter also runs the current search', async () => {
    const user = userEvent.setup();
    const runSearch = vi.fn();
    renderHook(() => useGlobalShortcuts(runSearch));

    await user.keyboard('{Meta>}{Enter}{/Meta}');

    expect(runSearch).toHaveBeenCalledTimes(1);
  });

  it('plain Enter (no modifier) does not run a search', async () => {
    const user = userEvent.setup();
    const runSearch = vi.fn();
    renderHook(() => useGlobalShortcuts(runSearch));

    await user.keyboard('{Enter}');

    expect(runSearch).not.toHaveBeenCalled();
  });

  it('"/" focuses the universal search input when nothing else has focus', async () => {
    const user = userEvent.setup();
    document.body.innerHTML = '<input data-shortcut="universal-search" aria-label="search" />';
    renderHook(() => useGlobalShortcuts(vi.fn()));

    await user.keyboard('/');

    expect(document.querySelector('[data-shortcut="universal-search"]')).toHaveFocus();
  });

  it('"/" typed inside an existing text field is never hijacked - it just types the character', async () => {
    const user = userEvent.setup();
    document.body.innerHTML =
      '<input data-shortcut="universal-search" aria-label="search" />' +
      '<input aria-label="other field" />';
    renderHook(() => useGlobalShortcuts(vi.fn()));

    const other = document.querySelector('[aria-label="other field"]') as HTMLInputElement;
    await user.click(other);
    await user.keyboard('a/b');

    expect(other).toHaveValue('a/b');
    expect(document.querySelector('[data-shortcut="universal-search"]')).not.toHaveFocus();
  });
});
