import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { AdvancedFilters } from './AdvancedFilters';
import { emptyAdvancedFilterValues } from './advancedFilterFields';

describe('AdvancedFilters', () => {
  it('shows no badge when nothing is active', () => {
    render(<AdvancedFilters values={emptyAdvancedFilterValues()} onApply={vi.fn()} />);
    expect(screen.getByRole('button', { name: /^more filters$/i })).toBeInTheDocument();
  });

  it('shows an active count badge, excluding the text field', () => {
    const values = { ...emptyAdvancedFilterValues(), traceId: 'trace-1', cif: 'x', text: 'ignored' };
    render(<AdvancedFilters values={values} onApply={vi.fn()} />);
    expect(screen.getByRole('button', { name: /more filters.*2.*active/i })).toBeInTheDocument();
  });

  it('renders every field grouped under its user-question heading', async () => {
    const user = userEvent.setup();
    render(<AdvancedFilters values={emptyAdvancedFilterValues()} onApply={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /^more filters$/i }));

    expect(screen.getByRole('group', { name: /who \/ customer/i })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /request flow/i })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /what happened/i })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /client context/i })).toBeInTheDocument();
    expect(screen.getByLabelText('CIF')).toBeInTheDocument();
    expect(screen.getByLabelText('Trace ID')).toBeInTheDocument();
    expect(screen.getByLabelText('Logger / class contains')).toBeInTheDocument();
    expect(screen.getByLabelText('Device platform')).toBeInTheDocument();
  });

  it('editing a field never calls onApply (draft/apply/cancel: editing never fires queries)', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<AdvancedFilters values={emptyAdvancedFilterValues()} onApply={onApply} />);

    await user.click(screen.getByRole('button', { name: /^more filters$/i }));
    await user.type(screen.getByLabelText('Trace ID'), 'trace-1');

    expect(onApply).not.toHaveBeenCalled();
  });

  it('Apply commits the full draft and closes the panel', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<AdvancedFilters values={emptyAdvancedFilterValues()} onApply={onApply} />);

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
    render(<AdvancedFilters values={emptyAdvancedFilterValues()} onApply={onApply} />);

    await user.click(screen.getByRole('button', { name: /^more filters$/i }));
    await user.type(screen.getByLabelText('Trace ID'), 'trace-1');
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onApply).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('reopening after Cancel shows the last-applied values, not the discarded draft', async () => {
    const user = userEvent.setup();
    render(<AdvancedFilters values={emptyAdvancedFilterValues()} onApply={vi.fn()} />);

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
        <AdvancedFilters values={emptyAdvancedFilterValues()} onApply={onApply} />
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
    render(<AdvancedFilters values={emptyAdvancedFilterValues()} onApply={onApply} />);

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
    render(<AdvancedFilters values={values} onApply={onApply} />);

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
    render(<AdvancedFilters values={values} onApply={onApply} />);

    await user.click(screen.getByRole('button', { name: /more filters.*1.*active/i }));
    await user.click(screen.getByRole('button', { name: /^reset$/i }));
    await user.click(screen.getByRole('button', { name: /apply/i }));

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ traceId: '' }));
  });

  it('has no detectable accessibility violations, closed or open', async () => {
    const user = userEvent.setup();
    const { container } = render(<AdvancedFilters values={emptyAdvancedFilterValues()} onApply={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();

    await user.click(screen.getByRole('button', { name: /^more filters$/i }));
    expect(await axe(container)).toHaveNoViolations();
  });
});
