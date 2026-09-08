import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { SourceSelect } from './SourceSelect';
import type { SourceInfo } from '../../shared/api/types';

const CAPS = { historicalSearch: true, liveTail: false, rawLogQL: false, serviceDiscovery: true, queryStatistics: false, contextView: false };
const SOURCES: SourceInfo[] = [
  { id: 'fixture', displayName: 'Fixture', capabilities: CAPS },
  { id: 'local-docker', displayName: 'Local Docker Compose', capabilities: CAPS },
];

describe('SourceSelect', () => {
  it('lists every source by display name', () => {
    render(<SourceSelect sources={SOURCES} selectedId="fixture" onChange={vi.fn()} />);
    expect(screen.getByRole('option', { name: 'Fixture' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Local Docker Compose' })).toBeInTheDocument();
  });

  it('reflects the selected source', () => {
    render(<SourceSelect sources={SOURCES} selectedId="local-docker" onChange={vi.fn()} />);
    expect(screen.getByRole('combobox')).toHaveValue('local-docker');
  });

  it('calls onChange when a different source is chosen', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SourceSelect sources={SOURCES} selectedId="fixture" onChange={onChange} />);

    await user.selectOptions(screen.getByRole('combobox'), 'local-docker');
    expect(onChange).toHaveBeenCalledWith('local-docker');
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = render(<SourceSelect sources={SOURCES} selectedId="fixture" onChange={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
