import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { ComposeProjectSelect } from './ComposeProjectSelect';

describe('ComposeProjectSelect (UX-R3 §5/§6/§9)', () => {
  it('always offers "All projects" as the explicit unscoped choice, plus every discovered project', () => {
    render(
      <ComposeProjectSelect
        projects={['project-a', 'project-b']}
        selected={null}
        loading={false}
        error={null}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('option', { name: 'All projects' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'project-a' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'project-b' })).toBeInTheDocument();
  });

  it('reflects the currently selected project', () => {
    render(
      <ComposeProjectSelect
        projects={['project-a', 'project-b']}
        selected="project-b"
        loading={false}
        error={null}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('combobox')).toHaveValue('project-b');
  });

  it('calls onChange(null) when "All projects" is chosen, never an empty string', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ComposeProjectSelect
        projects={['project-a']}
        selected="project-a"
        loading={false}
        error={null}
        onChange={onChange}
      />,
    );
    await user.selectOptions(screen.getByRole('combobox'), 'All projects');
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('calls onChange with the chosen project id', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ComposeProjectSelect projects={['project-a', 'project-b']} selected={null} loading={false} error={null} onChange={onChange} />,
    );
    await user.selectOptions(screen.getByRole('combobox'), 'project-b');
    expect(onChange).toHaveBeenCalledWith('project-b');
  });

  it('shows the truthful empty state when discovery found zero real projects - never a fabricated list', () => {
    render(<ComposeProjectSelect projects={[]} selected={null} loading={false} error={null} onChange={vi.fn()} />);
    expect(screen.getByText(/no docker compose projects detected on this docker engine/i)).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeDisabled();
  });

  it('surfaces a discovery error distinctly from the empty state', () => {
    render(
      <ComposeProjectSelect projects={[]} selected={null} loading={false} error="timed out" onChange={vi.fn()} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/timed out/i);
    expect(screen.queryByText(/no docker compose projects detected/i)).not.toBeInTheDocument();
  });

  it('disables the control while discovery is loading', () => {
    render(<ComposeProjectSelect projects={[]} selected={null} loading={true} error={null} onChange={vi.fn()} />);
    expect(screen.getByRole('combobox')).toBeDisabled();
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = render(
      <ComposeProjectSelect projects={['project-a']} selected={null} loading={false} error={null} onChange={vi.fn()} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
