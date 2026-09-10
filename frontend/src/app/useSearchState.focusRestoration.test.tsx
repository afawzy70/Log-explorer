import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSearchState } from './useSearchState';

/**
 * A minimal harness standing in for the row/`ActionsCell` "View details"
 * trigger (named "Inspect event" before UX-R4 §17) and
 * `InspectorHeader`'s close button, to prove `openInspector`/
 * `closeInspector`'s real DOM focus-restoration contract without pulling
 * in the whole inspector tree or mocking a real search. Renders the close
 * button off `selectedIndex` rather than `selectedEvent` - no search ever
 * ran in this harness, so `searchResult` stays `null` and `selectedEvent`
 * would stay `null` too; `selectedIndex` alone is enough to exercise
 * `openInspector`/`closeInspector`'s focus bookkeeping, which doesn't
 * itself depend on there being a real event behind the index.
 */
function Harness() {
  const state = useSearchState();
  return (
    <div>
      <button type="button" onClick={() => state.openInspector(0)}>
        open
      </button>
      {state.selectedIndex != null ? (
        <button type="button" onClick={state.closeInspector}>
          close
        </button>
      ) : null}
    </div>
  );
}

describe('useSearchState inspector focus restoration', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } }))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('closeInspector restores focus to whatever had focus when openInspector was called (WCAG 2.2 AA)', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const openButton = screen.getByRole('button', { name: 'open' });
    openButton.focus();
    expect(openButton).toHaveFocus();

    await user.click(openButton);
    const closeButton = await screen.findByRole('button', { name: 'close' });
    closeButton.focus();

    await user.click(closeButton);
    expect(screen.getByRole('button', { name: 'open' })).toHaveFocus();
  });
});
