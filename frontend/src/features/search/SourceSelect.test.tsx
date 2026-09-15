import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { SourceSelect } from './SourceSelect';
import type { SourceInfo } from '../../shared/api/types';

const CAPS = {
  historicalSearch: true,
  liveTail: false,
  rawLogQL: false,
  serviceDiscovery: true,
  queryStatistics: false,
  contextView: false,
  composeProjectScoping: false,
  originalSchemaSampling: true,
};
const SOURCES: SourceInfo[] = [
  { id: 'fixture', displayName: 'Fixture', capabilities: CAPS },
  { id: 'local-docker', displayName: 'Local Docker Compose', capabilities: CAPS },
];

/** Deliberately NOT in the required order - the selector must never rely on API order. */
const PRODUCTION_SOURCES: SourceInfo[] = [
  { id: 'openshift-loki', displayName: 'OpenShift Loki', capabilities: CAPS },
  { id: 'openshift', displayName: 'OpenShift', capabilities: CAPS },
  { id: 'local-docker', displayName: 'Local Docker', capabilities: CAPS },
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

  describe('owner source policy: Docker, OpenShift, OpenShift Loki (not available)', () => {
    it('orders Docker before OpenShift before OpenShift Loki regardless of API order', () => {
      render(<SourceSelect sources={PRODUCTION_SOURCES} selectedId="local-docker" onChange={vi.fn()} />);
      const options = within(screen.getByRole('combobox')).getAllByRole('option');
      expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual(['local-docker', 'openshift', 'openshift-loki']);
    });

    it('keeps OpenShift Loki visible as a native disabled option labelled "Not available"', () => {
      render(<SourceSelect sources={PRODUCTION_SOURCES} selectedId="local-docker" onChange={vi.fn()} />);
      const loki = screen.getByRole('option', { name: 'OpenShift Loki — Not available' }) as HTMLOptionElement;
      expect(loki).toBeInTheDocument();
      expect(loki).toBeDisabled();
      expect(loki.disabled).toBe(true);
      expect(screen.getByRole('option', { name: 'Local Docker' })).toBeEnabled();
      expect(screen.getByRole('option', { name: 'OpenShift' })).toBeEnabled();
    });

    it('never reports OpenShift Loki through onChange, by user selection or a forced change event', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<SourceSelect sources={PRODUCTION_SOURCES} selectedId="local-docker" onChange={onChange} />);
      const select = screen.getByRole('combobox');

      // user-event skips a disabled option: the native select keeps its value.
      await user.selectOptions(select, 'openshift-loki').catch(() => undefined);
      expect(select).toHaveValue('local-docker');
      expect((screen.getByRole('option', { name: 'OpenShift Loki — Not available' }) as HTMLOptionElement).selected).toBe(false);
      // Even a forced change event carrying the Loki id is refused.
      fireEvent.change(select, { target: { value: 'openshift-loki' } });
      expect(onChange).not.toHaveBeenCalledWith('openshift-loki');
    });

    it('keeps Docker and OpenShift selectable', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const { rerender } = render(<SourceSelect sources={PRODUCTION_SOURCES} selectedId="local-docker" onChange={onChange} />);
      await user.selectOptions(screen.getByRole('combobox'), 'openshift');
      expect(onChange).toHaveBeenLastCalledWith('openshift');
      rerender(<SourceSelect sources={PRODUCTION_SOURCES} selectedId="openshift" onChange={onChange} />);
      await user.selectOptions(screen.getByRole('combobox'), 'local-docker');
      expect(onChange).toHaveBeenLastCalledWith('local-docker');
    });

    it('keeps the dev-only Fixture source selectable after the production sources', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<SourceSelect sources={[{ id: 'fixture', displayName: 'Fixture', capabilities: CAPS }, ...PRODUCTION_SOURCES]}
        selectedId="local-docker" onChange={onChange} />);
      const options = within(screen.getByRole('combobox')).getAllByRole('option');
      expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual(['local-docker', 'openshift', 'openshift-loki', 'fixture']);
      await user.selectOptions(screen.getByRole('combobox'), 'fixture');
      expect(onChange).toHaveBeenCalledWith('fixture');
    });

    it('shows a truthful placeholder when no source is selectable', () => {
      render(<SourceSelect sources={[PRODUCTION_SOURCES[0]]} selectedId={null} onChange={vi.fn()} />);
      expect(screen.getByRole('option', { name: 'No available source' })).toBeDisabled();
      expect(screen.getByRole('option', { name: 'OpenShift Loki — Not available' })).toBeDisabled();
    });

    it('stays accessible with a disabled option', async () => {
      const { container } = render(<SourceSelect sources={PRODUCTION_SOURCES} selectedId="local-docker" onChange={vi.fn()} />);
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
