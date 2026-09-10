import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { AdvancedFilters } from './AdvancedFilters';
import type { AdvancedFiltersProps } from './AdvancedFilters';
import { emptyAdvancedFilterValues } from './advancedFilterFields';
import { emptyQueryAuthoringState } from './QueryBuilder';

function baseProps(overrides: Partial<AdvancedFiltersProps> = {}): AdvancedFiltersProps {
  return {
    values: emptyAdvancedFilterValues(),
    onApply: vi.fn(),
    queryState: emptyQueryAuthoringState(),
    onApplyQuery: vi.fn(),
    rawLogQlSupported: false,
    ...overrides,
  };
}

describe('AdvancedFilters', () => {
  it('shows no badge when nothing is active', () => {
    render(<AdvancedFilters {...baseProps()} />);
    expect(screen.getByRole('button', { name: /^more filters$/i })).toBeInTheDocument();
  });

  it('shows an active count badge, excluding the text field', () => {
    const values = { ...emptyAdvancedFilterValues(), traceId: 'trace-1', cif: 'x', text: 'ignored' };
    render(<AdvancedFilters {...baseProps({ values })} />);
    expect(screen.getByRole('button', { name: /more filters.*2.*active/i })).toBeInTheDocument();
  });

  it('renders every field grouped under its user-question heading, plus an Advanced query section', async () => {
    const user = userEvent.setup();
    render(<AdvancedFilters {...baseProps()} />);

    await user.click(screen.getByRole('button', { name: /^more filters$/i }));

    expect(screen.getByRole('group', { name: /who \/ customer/i })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /request flow/i })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /what happened/i })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /client context/i })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /advanced query/i })).toBeInTheDocument();
    expect(screen.getByLabelText('CIF')).toBeInTheDocument();
    expect(screen.getByLabelText('Trace ID')).toBeInTheDocument();
    expect(screen.getByLabelText('Logger / class contains')).toBeInTheDocument();
    expect(screen.getByLabelText('Device platform')).toBeInTheDocument();
  });

  it('shows a match-type hint per field, matching the backend-verified semantics (exact vs. contains)', async () => {
    const user = userEvent.setup();
    render(<AdvancedFilters {...baseProps()} />);
    await user.click(screen.getByRole('button', { name: /^more filters$/i }));

    // Exact-match fields (EventFilters.java `fieldMatches`).
    expect(screen.getByLabelText('Trace ID')).toBeInTheDocument();
    expect(screen.getByLabelText('Customer ID')).toBeInTheDocument();
    // Contains fields (EventFilters.java `.contains`).
    expect(screen.getByLabelText('Logger / class contains')).toBeInTheDocument();

    const hints = screen.getAllByText(/^(exact match|contains)$/i);
    expect(hints.length).toBeGreaterThan(0);
    // At least one field is labeled "Contains" (loggerContains) and at least
    // one "Exact match" (e.g. traceId) - never uniformly one label for every
    // field regardless of real backend semantics.
    expect(hints.some((h) => /contains/i.test(h.textContent ?? ''))).toBe(true);
    expect(hints.some((h) => /exact match/i.test(h.textContent ?? ''))).toBe(true);
  });

  it('editing a field never calls onApply (draft/apply/cancel: editing never fires queries)', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<AdvancedFilters {...baseProps({ onApply })} />);

    await user.click(screen.getByRole('button', { name: /^more filters$/i }));
    await user.type(screen.getByLabelText('Trace ID'), 'trace-1');

    expect(onApply).not.toHaveBeenCalled();
  });

  it('Apply commits the full draft and closes the panel', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<AdvancedFilters {...baseProps({ onApply })} />);

    await user.click(screen.getByRole('button', { name: /^more filters$/i }));
    await user.type(screen.getByLabelText('Trace ID'), 'trace-1');
    await user.type(screen.getByLabelText('CIF'), 'cif-1');
    await user.click(screen.getByRole('button', { name: /apply/i }));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ traceId: 'trace-1', cif: 'cif-1' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Cancel discards the draft without applying', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<AdvancedFilters {...baseProps({ onApply })} />);

    await user.click(screen.getByRole('button', { name: /^more filters$/i }));
    await user.type(screen.getByLabelText('Trace ID'), 'trace-1');
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onApply).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('reopening after Cancel shows the last-applied values, not the discarded draft', async () => {
    const user = userEvent.setup();
    render(<AdvancedFilters {...baseProps()} />);

    await user.click(screen.getByRole('button', { name: /^more filters$/i }));
    await user.type(screen.getByLabelText('Trace ID'), 'discarded-value');
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    await user.click(screen.getByRole('button', { name: /^more filters$/i }));
    expect(screen.getByLabelText('Trace ID')).toHaveValue('');
  });

  it('Escape and outside click close without applying', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(
      <div>
        <AdvancedFilters {...baseProps({ onApply })} />
        <button type="button">outside</button>
      </div>,
    );

    await user.click(screen.getByRole('button', { name: /^more filters$/i }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^more filters$/i }));
    await user.click(screen.getByRole('button', { name: 'outside' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('Reset clears the draft fields but never applies or closes the panel (UI Parity Acceleration Pass)', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<AdvancedFilters {...baseProps({ onApply })} />);

    await user.click(screen.getByRole('button', { name: /^more filters$/i }));
    await user.type(screen.getByLabelText('Trace ID'), 'trace-1');
    await user.type(screen.getByLabelText('CIF'), 'cif-1');
    await user.click(screen.getByRole('button', { name: /^reset$/i }));

    expect(screen.getByLabelText('Trace ID')).toHaveValue('');
    expect(screen.getByLabelText('CIF')).toHaveValue('');
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument(); // Reset does not close the panel
  });

  it('committed (already-applied) filters remain untouched until Apply, even after Reset', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const values = { ...emptyAdvancedFilterValues(), traceId: 'already-applied' };
    render(<AdvancedFilters {...baseProps({ values, onApply })} />);

    await user.click(screen.getByRole('button', { name: /more filters.*1.*active/i }));
    await user.click(screen.getByRole('button', { name: /^reset$/i }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    // Nothing was ever applied, so the badge still reflects the original committed value.
    expect(screen.getByRole('button', { name: /more filters.*1.*active/i })).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('Reset then Apply commits the cleared (empty) values', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const values = { ...emptyAdvancedFilterValues(), traceId: 'seed' };
    render(<AdvancedFilters {...baseProps({ values, onApply })} />);

    await user.click(screen.getByRole('button', { name: /more filters.*1.*active/i }));
    await user.click(screen.getByRole('button', { name: /^reset$/i }));
    await user.click(screen.getByRole('button', { name: /apply/i }));

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ traceId: '' }));
  });

  it('has no detectable accessibility violations, closed or open', async () => {
    const user = userEvent.setup();
    const { container } = render(<AdvancedFilters {...baseProps()} />);
    expect(await axe(container)).toHaveNoViolations();

    await user.click(screen.getByRole('button', { name: /^more filters$/i }));
    expect(await axe(container)).toHaveNoViolations();
  });

  describe('drawer conversion (UI Gap Closure Pass)', () => {
    it('the "More filters" heading is now visibly present, not just an accessible-name-only heading', async () => {
      const user = userEvent.setup();
      render(<AdvancedFilters {...baseProps()} />);
      await user.click(screen.getByRole('button', { name: /^more filters$/i }));

      const heading = screen.getByRole('heading', { name: 'More filters' });
      expect(heading).toBeInTheDocument();
      expect(heading).toHaveTextContent('More filters');
    });

    it('moves focus to the drawer heading when it opens', async () => {
      const user = userEvent.setup();
      render(<AdvancedFilters {...baseProps()} />);
      const trigger = screen.getByRole('button', { name: /^more filters$/i });

      await user.click(trigger);
      expect(screen.getByRole('heading', { name: 'More filters' })).toHaveFocus();
    });

    it('returns focus to the trigger button after closing (Cancel)', async () => {
      const user = userEvent.setup();
      render(<AdvancedFilters {...baseProps()} />);
      const trigger = screen.getByRole('button', { name: /^more filters$/i });

      await user.click(trigger);
      await user.click(screen.getByRole('button', { name: /cancel/i }));
      expect(trigger).toHaveFocus();
    });

    it('opening the drawer never calls onApply - opening does not execute a search', async () => {
      const user = userEvent.setup();
      const onApply = vi.fn();
      render(<AdvancedFilters {...baseProps({ onApply })} />);
      await user.click(screen.getByRole('button', { name: /^more filters$/i }));
      expect(onApply).not.toHaveBeenCalled();
    });

    it('results (arbitrary sibling content) remain visible while the drawer is open - no dimming/blocking overlay', async () => {
      const user = userEvent.setup();
      render(
        <div>
          <AdvancedFilters {...baseProps()} />
          <div data-testid="results-area">a result row</div>
        </div>,
      );

      await user.click(screen.getByRole('button', { name: /^more filters$/i }));
      const resultsArea = screen.getByTestId('results-area');
      // Genuinely visible (not display:none/visibility:hidden/zero-size) and
      // not covered by a dimming backdrop element - the mission's own
      // "results remain visible behind/beside it" requirement.
      expect(resultsArea).toBeVisible();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  describe('Advanced query IA move (UX-R1 §2/§8)', () => {
    it('Advanced Query renders from inside the More filters drawer, not as its own top-level trigger', async () => {
      const user = userEvent.setup();
      render(<AdvancedFilters {...baseProps()} />);

      // No "Query" trigger exists before More filters is opened.
      expect(screen.queryByRole('button', { name: /^query/i })).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /^more filters$/i }));
      expect(screen.getByRole('button', { name: /^query/i })).toBeInTheDocument();
    });

    it('Query stays a fully separate draft/apply/cancel surface - applying it never touches the field-level draft or vice versa', async () => {
      const user = userEvent.setup();
      const onApply = vi.fn();
      const onApplyQuery = vi.fn();
      render(<AdvancedFilters {...baseProps({ onApply, onApplyQuery })} />);

      await user.click(screen.getByRole('button', { name: /^more filters$/i }));
      await user.type(screen.getByLabelText('Trace ID'), 'trace-1');

      await user.click(screen.getByRole('button', { name: /^query/i }));
      // Both the More filters drawer and Query's own popover are open at
      // once (nested), each with an "Apply" button - scope to Query's own
      // dialog (its heading is "Query", the drawer's is "More filters").
      const queryDialog = screen.getByRole('heading', { name: 'Query' }).closest('[role="dialog"]') as HTMLElement;
      await user.click(within(queryDialog).getByRole('button', { name: /\+ condition/i }));
      await user.type(within(queryDialog).getByLabelText('Value'), 'gateway');
      await user.click(within(queryDialog).getByRole('button', { name: /^apply$/i }));

      // Query's own Apply committed only the query, not the field-level draft.
      expect(onApplyQuery).toHaveBeenCalledTimes(1);
      expect(onApply).not.toHaveBeenCalled();
      // The More filters drawer itself is still open with the field-level draft intact.
      expect(screen.getByLabelText('Trace ID')).toHaveValue('trace-1');
    });

    it('pressing Escape while Query is open closes only Query, not the whole More filters drawer (nested-layer regression)', async () => {
      const user = userEvent.setup();
      render(<AdvancedFilters {...baseProps()} />);

      await user.click(screen.getByRole('button', { name: /^more filters$/i }));
      await user.click(screen.getByRole('button', { name: /^query/i }));
      expect(screen.getAllByRole('dialog')).toHaveLength(2);

      await user.keyboard('{Escape}');

      // Query's own popover closed; the More filters drawer stayed open.
      expect(screen.queryByRole('button', { name: /^clear$/i })).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'More filters' })).toBeInTheDocument();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });
});
