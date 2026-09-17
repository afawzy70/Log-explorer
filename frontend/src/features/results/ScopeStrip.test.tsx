import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { ScopeStrip } from './ScopeStrip';
import { EMPTY_QUERY_PLAN } from '../../shared/api/testFixtures';
import { defaultTablePreferences } from './tablePreferences';
import type { TablePreferencesHandle } from './tablePreferences';

function tableHandle(): TablePreferencesHandle {
  return {
    preferences: defaultTablePreferences(),
    setColumnVisible: vi.fn(),
    moveColumn: vi.fn(),
    moveColumnToIndex: vi.fn(),
    setDensity: vi.fn(),
    reset: vi.fn(),
  };
}

/*
 * B2 (Session 4) - the "scope strip" (`COMPONENT_INVENTORY.md`'s
 * ActiveFilters/ResultsPanel/SortControl/QueryPlanDisclosure RECOMPOSE
 * rows): a purely presentational wrapper. `ResultsPanel` (the real
 * caller) owns exactly which of the optional props apply to its current
 * state branch - these tests only prove the wrapper itself renders
 * (or omits) each slot correctly, matching what it was given.
 */
describe('ScopeStrip', () => {
  it('always renders the activeFilters element, even with no other props', () => {
    render(<ScopeStrip activeFilters={<div data-testid="chips">chips</div>} />);
    expect(screen.getByTestId('chips')).toBeInTheDocument();
  });

  it('renders no right-side content at all when none of readout/onRefresh/queryPlan/sort/table are given', () => {
    const { container } = render(<ScopeStrip activeFilters={<div>chips</div>} />);
    expect(screen.queryByRole('button', { name: /refresh/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^columns$/i })).not.toBeInTheDocument();
    expect(container.querySelector('[aria-live="polite"]')).toBeNull();
  });

  it('renders the readout sentence when given', () => {
    render(<ScopeStrip activeFilters={<div>chips</div>} readout="Showing 3 events" />);
    expect(screen.getByText('Showing 3 events')).toBeInTheDocument();
  });

  it('renders Refresh when onRefresh is given, and it fires that exact handler', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    render(<ScopeStrip activeFilters={<div>chips</div>} onRefresh={onRefresh} />);
    await user.click(screen.getByRole('button', { name: /refresh/i }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('disables Refresh via refreshDisabled', () => {
    render(<ScopeStrip activeFilters={<div>chips</div>} onRefresh={vi.fn()} refreshDisabled />);
    expect(screen.getByRole('button', { name: /refresh/i })).toBeDisabled();
  });

  it('renders Sort only when the sort prop is given, and forwards its onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<ScopeStrip activeFilters={<div>chips</div>} />);
    expect(screen.queryByRole('button', { name: /newest first/i })).not.toBeInTheDocument();

    rerender(
      <ScopeStrip activeFilters={<div>chips</div>} sort={{ value: 'BACKWARD', onChange }} />,
    );
    await user.click(screen.getByRole('button', { name: /newest first/i }));
    expect(onChange).toHaveBeenCalledWith('FORWARD');
  });

  it('renders Columns only when the table prop is given', () => {
    const { rerender } = render(<ScopeStrip activeFilters={<div>chips</div>} />);
    expect(screen.queryByRole('button', { name: /^columns$/i })).not.toBeInTheDocument();

    rerender(<ScopeStrip activeFilters={<div>chips</div>} table={tableHandle()} />);
    expect(screen.getByRole('button', { name: /^columns$/i })).toBeInTheDocument();
  });

  it('renders Query details only when the queryPlan prop is given', () => {
    const { rerender } = render(<ScopeStrip activeFilters={<div>chips</div>} />);
    expect(screen.queryByText('Query details')).not.toBeInTheDocument();

    rerender(<ScopeStrip activeFilters={<div>chips</div>} queryPlan={EMPTY_QUERY_PLAN} />);
    expect(screen.getByText('Query details')).toBeInTheDocument();
  });

  it('has no detectable accessibility violations with every slot populated', async () => {
    const { container } = render(
      <ScopeStrip
        activeFilters={<div>chips</div>}
        readout="Showing 3 events"
        onRefresh={vi.fn()}
        queryPlan={EMPTY_QUERY_PLAN}
        sort={{ value: 'BACKWARD', onChange: vi.fn() }}
        table={tableHandle()}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
