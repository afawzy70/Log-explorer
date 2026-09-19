import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { InvestigationScopeBar } from './InvestigationScopeBar';
import { DEFAULT_PRESET_ID } from '../../shared/time/presets';
import type { SearchState } from '../../app/useSearchState';

/** Only the fields this purely-presentational component actually reads - not a full `SearchState`, unlike `ResultsPanel.test.tsx`'s own exhaustive `baseState()` (this component's surface is a handful of read-only fields, not the whole search lifecycle). */
function scopeBarState(overrides: Partial<SearchState> = {}): SearchState {
  const caps = {
    historicalSearch: true,
    liveTail: false,
    rawLogQL: false,
    serviceDiscovery: true,
    queryStatistics: false,
    contextView: true,
    composeProjectScoping: true,
    originalSchemaSampling: true,
  };
  return {
    selectedSource: { id: 'fixture', displayName: 'Fixture', capabilities: caps },
    selectedSourceId: 'fixture',
    selectedComposeProject: 'payments-stack',
    timeRange: { presetId: DEFAULT_PRESET_ID, start: '2026-01-01T00:00:00Z', end: '2026-01-02T00:00:00Z' },
    health: null,
    healthLoading: false,
    retryHealth: vi.fn(),
    ...overrides,
  } as SearchState;
}

describe('InvestigationScopeBar', () => {
  it('shows the active source, project and time range as a read-only summary', () => {
    render(<InvestigationScopeBar state={scopeBarState()} keptNote="Search filters are kept" onEditSearch={vi.fn()} />);
    expect(screen.getByText('Source')).toBeInTheDocument();
    expect(screen.getByText('Fixture')).toBeInTheDocument();
    expect(screen.getByText('Project')).toBeInTheDocument();
    expect(screen.getByText('payments-stack')).toBeInTheDocument();
    expect(screen.getByText(/last 1 day/i)).toBeInTheDocument();
  });

  it('omits the Project field when the source does not advertise composeProjectScoping', () => {
    const caps = {
      historicalSearch: true,
      liveTail: false,
      rawLogQL: false,
      serviceDiscovery: true,
      queryStatistics: false,
      contextView: true,
      composeProjectScoping: false,
      originalSchemaSampling: true,
    };
    render(
      <InvestigationScopeBar
        state={scopeBarState({ selectedSource: { id: 'fixture', displayName: 'Fixture', capabilities: caps } })}
        keptNote="Search filters are kept"
        onEditSearch={vi.fn()}
      />,
    );
    expect(screen.queryByText('Project')).not.toBeInTheDocument();
  });

  it('renders the caller-supplied kept note verbatim', () => {
    render(<InvestigationScopeBar state={scopeBarState()} keptNote="Trace is kept — return with Back" onEditSearch={vi.fn()} />);
    expect(screen.getByText('Trace is kept — return with Back')).toBeInTheDocument();
  });

  it('clicking Edit search calls onEditSearch', async () => {
    const user = userEvent.setup();
    const onEditSearch = vi.fn();
    render(<InvestigationScopeBar state={scopeBarState()} keptNote="Search filters are kept" onEditSearch={onEditSearch} />);
    await user.click(screen.getByRole('button', { name: /edit search/i }));
    expect(onEditSearch).toHaveBeenCalledTimes(1);
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = render(<InvestigationScopeBar state={scopeBarState()} keptNote="Search filters are kept" onEditSearch={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
