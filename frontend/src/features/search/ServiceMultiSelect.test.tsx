import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { ServiceMultiSelect } from './ServiceMultiSelect';
import type { ServiceInfo } from '../../shared/api/types';

const SERVICES: ServiceInfo[] = [
  { name: 'gateway', runningCount: 1, totalCount: 1 },
  { name: 'accounts-api', runningCount: 2, totalCount: 2 },
  { name: 'payments-api', runningCount: 0, totalCount: 1 },
];

describe('ServiceMultiSelect', () => {
  it('shows "All services" when nothing is selected', () => {
    render(<ServiceMultiSelect services={SERVICES} selected={[]} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /all services/i })).toBeInTheDocument();
  });

  it('shows a selected count when services are selected', () => {
    render(<ServiceMultiSelect services={SERVICES} selected={['gateway', 'accounts-api']} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /2 services/i })).toBeInTheDocument();
  });

  it('opens a checkbox list of every service with running/total metadata', async () => {
    const user = userEvent.setup();
    render(<ServiceMultiSelect services={SERVICES} selected={[]} onChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /all services/i }));

    expect(screen.getByRole('checkbox', { name: /gateway/i })).toBeInTheDocument();
    expect(screen.getByText('1/1 running')).toBeInTheDocument();
    expect(screen.getByText('0/1 running')).toBeInTheDocument();
  });

  it('the search box filters the visible services', async () => {
    const user = userEvent.setup();
    render(<ServiceMultiSelect services={SERVICES} selected={[]} onChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /all services/i }));
    await user.type(screen.getByPlaceholderText(/search services/i), 'gateway');

    expect(screen.getByRole('checkbox', { name: /gateway/i })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /accounts-api/i })).not.toBeInTheDocument();
  });

  it('toggling a checkbox calls onChange with the updated selection', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ServiceMultiSelect services={SERVICES} selected={['gateway']} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /gateway/i }));
    await user.click(screen.getByRole('checkbox', { name: /accounts-api/i }));

    expect(onChange).toHaveBeenCalledWith(['gateway', 'accounts-api']);
  });

  it('unchecking a selected service removes it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ServiceMultiSelect services={SERVICES} selected={['gateway', 'accounts-api']} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /2 services/i }));
    await user.click(screen.getByRole('checkbox', { name: /gateway/i }));

    expect(onChange).toHaveBeenCalledWith(['accounts-api']);
  });

  it('Clear deselects everything', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ServiceMultiSelect services={SERVICES} selected={['gateway', 'accounts-api']} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /2 services/i }));
    await user.click(screen.getByRole('button', { name: /clear/i }));

    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('Escape and outside click close the panel', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <ServiceMultiSelect services={SERVICES} selected={[]} onChange={vi.fn()} />
        <button type="button">outside</button>
      </div>,
    );

    await user.click(screen.getByRole('button', { name: /all services/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /all services/i }));
    await user.click(screen.getByRole('button', { name: 'outside' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('has no detectable accessibility violations, closed or open', async () => {
    const user = userEvent.setup();
    const { container } = render(<ServiceMultiSelect services={SERVICES} selected={[]} onChange={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();

    await user.click(screen.getByRole('button', { name: /all services/i }));
    expect(await axe(container)).toHaveNoViolations();
  });
});
