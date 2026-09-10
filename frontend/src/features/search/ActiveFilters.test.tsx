import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { ActiveFilters } from './ActiveFilters';
import type { ActiveFiltersProps } from './ActiveFilters';
import { emptyAdvancedFilterValues } from './advancedFilterFields';
import { DEFAULT_SEVERITY_LEVELS } from './severityLevels';

const SENTINEL = 'RAW-SENSITIVE-VALUE-77aa';

function baseProps(overrides: Partial<ActiveFiltersProps> = {}): ActiveFiltersProps {
  return {
    timeRangeLabel: 'Last 1 day',
    onRemoveTimeRange: vi.fn(),
    selectedLevels: DEFAULT_SEVERITY_LEVELS,
    onRemoveSeverity: vi.fn(),
    selectedServices: [],
    onRemoveService: vi.fn(),
    advancedValues: emptyAdvancedFilterValues(),
    onRemoveAdvancedField: vi.fn(),
    onClearAll: vi.fn(),
    ...overrides,
  };
}

describe('ActiveFilters', () => {
  it('always shows the current time range', () => {
    render(<ActiveFilters {...baseProps()} />);
    expect(screen.getByText('Last 1 day')).toBeInTheDocument();
  });

  it('shows a non-sensitive field chip with its raw value', () => {
    const advancedValues = { ...emptyAdvancedFilterValues(), traceId: 'trace-000100' };
    render(<ActiveFilters {...baseProps({ advancedValues })} />);
    expect(screen.getByText('trace-000100')).toBeInTheDocument();
  });

  it('shows "Protected" for every sensitive field, never the raw value - remove button included', () => {
    const advancedValues = {
      ...emptyAdvancedFilterValues(),
      cif: SENTINEL,
      userName: SENTINEL,
      customerId: SENTINEL,
      deviceId: SENTINEL,
      deviceIp: SENTINEL,
    };
    const { container } = render(<ActiveFilters {...baseProps({ advancedValues })} />);

    expect(screen.queryByText(SENTINEL)).not.toBeInTheDocument();
    expect(screen.getAllByText('Protected')).toHaveLength(5);
    // The raw value must never appear anywhere in the rendered markup,
    // including inside a remove button's accessible name/aria-label.
    expect(container.innerHTML).not.toContain(SENTINEL);
  });

  it('never renders the text field as its own chip', () => {
    const advancedValues = { ...emptyAdvancedFilterValues(), text: 'connection timeout' };
    render(<ActiveFilters {...baseProps({ advancedValues })} />);
    expect(screen.queryByText('connection timeout')).not.toBeInTheDocument();
  });

  it('shows no Severity chip when at the default INFO/WARN/ERROR selection', () => {
    render(<ActiveFilters {...baseProps({ selectedLevels: DEFAULT_SEVERITY_LEVELS })} />);
    expect(screen.queryByText(/^severity:/i)).not.toBeInTheDocument();
  });

  it('shows a Severity chip, with its own remove control, once the selection differs from the default', () => {
    render(<ActiveFilters {...baseProps({ selectedLevels: ['ERROR'] })} />);
    expect(screen.getByText(/^severity:/i)).toBeInTheDocument();
    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove severity filter error/i })).toBeInTheDocument();
  });

  it('shows one removable chip per selected service', () => {
    render(<ActiveFilters {...baseProps({ selectedServices: ['payments', 'gateway'] })} />);
    expect(screen.getByRole('button', { name: /remove service filter payments/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove service filter gateway/i })).toBeInTheDocument();
  });

  describe('individual chip removal (UX-R1 §3/§9/§10)', () => {
    it('removing the time range chip calls onRemoveTimeRange only', async () => {
      const user = userEvent.setup();
      const onRemoveTimeRange = vi.fn();
      const onRemoveAdvancedField = vi.fn();
      render(
        <ActiveFilters
          {...baseProps({
            onRemoveTimeRange,
            onRemoveAdvancedField,
            advancedValues: { ...emptyAdvancedFilterValues(), traceId: 'trace-1' },
          })}
        />,
      );

      await user.click(screen.getByRole('button', { name: /remove time range filter/i }));
      expect(onRemoveTimeRange).toHaveBeenCalledTimes(1);
      expect(onRemoveAdvancedField).not.toHaveBeenCalled();
    });

    it('removing one service chip calls onRemoveService with exactly that service, leaving the others alone', async () => {
      const user = userEvent.setup();
      const onRemoveService = vi.fn();
      render(<ActiveFilters {...baseProps({ selectedServices: ['payments', 'gateway'], onRemoveService })} />);

      await user.click(screen.getByRole('button', { name: /remove service filter payments/i }));
      expect(onRemoveService).toHaveBeenCalledTimes(1);
      expect(onRemoveService).toHaveBeenCalledWith('payments');
      // The unrelated chip is still rendered - this component never removes
      // anything itself, it only ever reports which one was clicked.
      expect(screen.getByText('gateway')).toBeInTheDocument();
    });

    it('removing one advanced field chip calls onRemoveAdvancedField with exactly that key, unrelated fields stay reported as active', async () => {
      const user = userEvent.setup();
      const onRemoveAdvancedField = vi.fn();
      const advancedValues = { ...emptyAdvancedFilterValues(), traceId: 'trace-1', errorCode: 'ERR_TIMEOUT' };
      render(<ActiveFilters {...baseProps({ advancedValues, onRemoveAdvancedField })} />);

      await user.click(screen.getByRole('button', { name: /remove trace id filter/i }));
      expect(onRemoveAdvancedField).toHaveBeenCalledTimes(1);
      expect(onRemoveAdvancedField).toHaveBeenCalledWith('traceId');
      // The unrelated errorCode chip is still rendered unchanged.
      expect(screen.getByText('ERR_TIMEOUT')).toBeInTheDocument();
    });

    it('removing a sensitive field chip never puts the raw value in the callback-triggering control itself', async () => {
      const user = userEvent.setup();
      const onRemoveAdvancedField = vi.fn();
      const advancedValues = { ...emptyAdvancedFilterValues(), customerId: SENTINEL };
      render(<ActiveFilters {...baseProps({ advancedValues, onRemoveAdvancedField })} />);

      await user.click(screen.getByRole('button', { name: /remove customer id filter/i }));
      expect(onRemoveAdvancedField).toHaveBeenCalledWith('customerId');
    });
  });

  describe('Clear all', () => {
    it('is always present, even with no active filters (matches the OLD empty-state reference)', () => {
      render(<ActiveFilters {...baseProps()} />);
      expect(screen.getByRole('button', { name: /^clear all$/i })).toBeInTheDocument();
    });

    it('clicking it calls onClearAll', async () => {
      const user = userEvent.setup();
      const onClearAll = vi.fn();
      render(<ActiveFilters {...baseProps({ onClearAll })} />);
      await user.click(screen.getByRole('button', { name: /^clear all$/i }));
      expect(onClearAll).toHaveBeenCalledTimes(1);
    });
  });

  it('has no detectable accessibility violations', async () => {
    const advancedValues = { ...emptyAdvancedFilterValues(), traceId: 'trace-1', cif: 'x' };
    const { container } = render(
      <ActiveFilters {...baseProps({ advancedValues, selectedLevels: ['ERROR'], selectedServices: ['payments'] })} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
