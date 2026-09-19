import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { InvestigationStatRow } from './InvestigationStatRow';

describe('InvestigationStatRow', () => {
  it('renders each stat as a label immediately followed by its value', () => {
    render(
      <InvestigationStatRow
        stats={[
          { key: 'events', label: 'Events', value: 12 },
          { key: 'services', label: 'Services', value: 3 },
        ]}
      />,
    );
    expect(screen.getByText('Events').nextElementSibling).toHaveTextContent('12');
    expect(screen.getByText('Services').nextElementSibling).toHaveTextContent('3');
  });

  it('sets role="note" and the aria-label only when ariaLabel is given', () => {
    const { rerender } = render(<InvestigationStatRow stats={[{ key: 'events', label: 'Events', value: 1 }]} />);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();

    rerender(<InvestigationStatRow stats={[{ key: 'events', label: 'Events', value: 1 }]} ariaLabel="Investigation summary" />);
    expect(screen.getByRole('note', { name: 'Investigation summary' })).toBeInTheDocument();
  });

  it('renders caller-supplied children (a claim/disclaimer block) after the stats', () => {
    render(
      <InvestigationStatRow stats={[{ key: 'events', label: 'Events', value: 1 }]}>
        <p>This order does not indicate causality.</p>
      </InvestigationStatRow>,
    );
    expect(screen.getByText(/does not indicate causality/i)).toBeInTheDocument();
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = render(
      <InvestigationStatRow
        stats={[
          { key: 'events', label: 'Events', value: 12 },
          { key: 'errors', label: 'Errors', value: 2, variant: 'danger' },
        ]}
        ariaLabel="Investigation summary"
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
