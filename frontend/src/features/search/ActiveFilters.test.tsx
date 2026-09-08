import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { ActiveFilters } from './ActiveFilters';
import { emptyAdvancedFilterValues } from './advancedFilterFields';

const SENTINEL = 'RAW-SENSITIVE-VALUE-77aa';

describe('ActiveFilters', () => {
  it('always shows the current time range', () => {
    render(<ActiveFilters timeRangeLabel="Last 1 day" advancedValues={emptyAdvancedFilterValues()} />);
    expect(screen.getByText('Last 1 day')).toBeInTheDocument();
  });

  it('shows a non-sensitive field chip with its raw value', () => {
    const values = { ...emptyAdvancedFilterValues(), traceId: 'trace-000100' };
    render(<ActiveFilters timeRangeLabel="Last 1 day" advancedValues={values} />);
    expect(screen.getByText('trace-000100')).toBeInTheDocument();
  });

  it('shows "Protected" for every sensitive field, never the raw value', () => {
    const values = {
      ...emptyAdvancedFilterValues(),
      cif: SENTINEL,
      userName: SENTINEL,
      customerId: SENTINEL,
      deviceId: SENTINEL,
      deviceIp: SENTINEL,
    };
    render(<ActiveFilters timeRangeLabel="Last 1 day" advancedValues={values} />);

    expect(screen.queryByText(SENTINEL)).not.toBeInTheDocument();
    expect(screen.getAllByText('Protected')).toHaveLength(5);
  });

  it('never renders the text field as its own chip', () => {
    const values = { ...emptyAdvancedFilterValues(), text: 'connection timeout' };
    render(<ActiveFilters timeRangeLabel="Last 1 day" advancedValues={values} />);
    expect(screen.queryByText('connection timeout')).not.toBeInTheDocument();
  });

  it('has no detectable accessibility violations', async () => {
    const values = { ...emptyAdvancedFilterValues(), traceId: 'trace-1', cif: 'x' };
    const { container } = render(<ActiveFilters timeRangeLabel="Last 1 day" advancedValues={values} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
