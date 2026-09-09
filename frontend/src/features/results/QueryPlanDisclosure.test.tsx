import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { QueryPlanDisclosure } from './QueryPlanDisclosure';
import { EMPTY_QUERY_PLAN } from '../../shared/api/testFixtures';
import type { QueryPlan } from '../../shared/api/types';

describe('QueryPlanDisclosure', () => {
  it('is collapsed by default (a native <details> not [open])', () => {
    render(<QueryPlanDisclosure queryPlan={EMPTY_QUERY_PLAN} />);
    const details = screen.getByText('Query details').closest('details');
    expect(details).not.toHaveAttribute('open');
  });

  it('renders the executed query', () => {
    const plan: QueryPlan = { ...EMPTY_QUERY_PLAN, resolvedQuery: '(service = *** AND level = ***)' };
    render(<QueryPlanDisclosure queryPlan={plan} />);
    expect(screen.getByText('(service = *** AND level = ***)')).toBeInTheDocument();
  });

  it('shows a Raw LogQL badge only when rawLogQlMode is true', () => {
    const { rerender } = render(<QueryPlanDisclosure queryPlan={EMPTY_QUERY_PLAN} />);
    expect(screen.queryByText('Raw LogQL')).not.toBeInTheDocument();

    rerender(<QueryPlanDisclosure queryPlan={{ ...EMPTY_QUERY_PLAN, rawLogQlMode: true }} />);
    expect(screen.getByText('Raw LogQL')).toBeInTheDocument();
  });

  it('honestly renders an empty push-down list as "None", never fabricating a pushed-down condition', () => {
    render(<QueryPlanDisclosure queryPlan={EMPTY_QUERY_PLAN} />);
    expect(screen.getByText(/none.*every condition was applied after retrieval/i)).toBeInTheDocument();
  });

  it('renders actual push-down conditions when the source reported them', () => {
    const plan: QueryPlan = {
      ...EMPTY_QUERY_PLAN,
      pushedDownConditions: ['namespace = "prod" (Loki stream label, from source configuration)'],
    };
    render(<QueryPlanDisclosure queryPlan={plan} />);
    expect(screen.getByText('namespace = "prod" (Loki stream label, from source configuration)')).toBeInTheDocument();
  });

  it('renders post-filter (applied-after-retrieval) conditions', () => {
    const plan: QueryPlan = { ...EMPTY_QUERY_PLAN, postFilterConditions: ['service in [gateway]', 'level in [ERROR]'] };
    render(<QueryPlanDisclosure queryPlan={plan} />);
    expect(screen.getByText('service in [gateway]')).toBeInTheDocument();
    expect(screen.getByText('level in [ERROR]')).toBeInTheDocument();
  });

  it('never renders a raw protected value - only pre-redacted strings from the backend, verbatim', () => {
    // The component performs no masking of its own; this proves it renders
    // exactly what it was given and nothing more, i.e. it would faithfully
    // reflect a leak if the backend ever regressed - the backend's own
    // redaction is proven separately (api.QueryPlanLeakTest).
    const plan: QueryPlan = { ...EMPTY_QUERY_PLAN, postFilterConditions: ['cif = ***', 'userName = ***'] };
    render(<QueryPlanDisclosure queryPlan={plan} />);
    expect(screen.getByText('cif = ***')).toBeInTheDocument();
    expect(screen.getByText('userName = ***')).toBeInTheDocument();
  });

  it('renders notes when present, omits the row when empty', () => {
    const { rerender } = render(<QueryPlanDisclosure queryPlan={EMPTY_QUERY_PLAN} />);
    expect(screen.queryByText('Notes')).not.toBeInTheDocument();

    rerender(<QueryPlanDisclosure queryPlan={{ ...EMPTY_QUERY_PLAN, notes: ['Raw LogQL mode: the query text is sent as-is.'] }} />);
    expect(screen.getByText('Notes')).toBeInTheDocument();
    expect(screen.getByText('Raw LogQL mode: the query text is sent as-is.')).toBeInTheDocument();
  });

  it('has no detectable accessibility violations, collapsed or expanded', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    const plan: QueryPlan = {
      resolvedQuery: 'service = ***',
      rawLogQlMode: false,
      pushedDownConditions: ['namespace = "prod"'],
      postFilterConditions: ['service in [gateway]'],
      notes: ['a note'],
    };
    const { container } = render(<QueryPlanDisclosure queryPlan={plan} />);
    expect(await axe(container)).toHaveNoViolations();

    await user.click(screen.getByText('Query details'));
    expect(await axe(container)).toHaveNoViolations();
  });
});
