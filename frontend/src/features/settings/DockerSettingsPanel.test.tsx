import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { DockerSettingsPanel } from './DockerSettingsPanel';
import { fetchDockerConnectionSummary, testDockerConnection } from '../../shared/api/client';
import type { DockerConnectionSummary, SourceHealth } from '../../shared/api/types';

vi.mock('../../shared/api/client', () => ({
  fetchDockerConnectionSummary: vi.fn(),
  testDockerConnection: vi.fn(),
}));

const mockFetchSummary = vi.mocked(fetchDockerConnectionSummary);
const mockTestConnection = vi.mocked(testDockerConnection);

function localSummary(overrides: Partial<DockerConnectionSummary> = {}): DockerConnectionSummary {
  return {
    mode: 'LOCAL',
    host: null,
    port: null,
    tlsEnabled: false,
    composeProjectFilter: null,
    runtimeMutationSupported: false,
    settingsNote: 'Permanent connection changes require deployment/runtime configuration and a restart.',
    connectionName: null,
    ...overrides,
  };
}

/*
 * B6.2 (Session 7) - this panel is no longer a trigger-button popover: it
 * renders persistently and fetches its summary on mount (COMPONENT_
 * INVENTORY.md's own RECOMPOSE row for this file - "Popover dialog content
 * moves into the Settings workspace"). Every test below either asserts the
 * always-visible content directly or waits on the mount-time fetch instead
 * of clicking an "open" trigger that no longer exists.
 */
describe('DockerSettingsPanel', () => {
  beforeEach(() => {
    mockFetchSummary.mockReset();
    mockTestConnection.mockReset();
    mockFetchSummary.mockResolvedValue(localSummary());
  });

  it('fetches the connection summary on mount, without requiring any click first', async () => {
    render(<DockerSettingsPanel />);
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('heading', { name: /local docker/i })).toBeInTheDocument();
  });

  it('displays a "Docker source only" scope tag and a read-only marker, matching the approved always-visible section', () => {
    render(<DockerSettingsPanel />);
    expect(screen.getByText(/docker source only/i)).toBeInTheDocument();
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
  });

  it('fetches and displays the current connection summary for LOCAL mode', async () => {
    const { container } = render(<DockerSettingsPanel />);
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledTimes(1));
    const summary = within(container.querySelector('dl')!);
    await waitFor(() => expect(summary.getByText('Local')).toBeInTheDocument());
    expect(summary.getByText('Disabled')).toBeInTheDocument();
    expect(summary.getByText(/none configured/i)).toBeInTheDocument();
    expect(screen.getByText(/permanent connection changes require deployment/i)).toBeInTheDocument();
  });

  it('shows host and port for REMOTE mode', async () => {
    mockFetchSummary.mockResolvedValue(
      localSummary({ mode: 'REMOTE', host: '203.0.113.5', port: 2375, tlsEnabled: true }),
    );
    const { container } = render(<DockerSettingsPanel />);

    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalled());
    const summary = within(container.querySelector('dl')!);
    await waitFor(() => expect(summary.getByText('Remote')).toBeInTheDocument());
    expect(summary.getByText('203.0.113.5')).toBeInTheDocument();
    expect(summary.getByText('2375')).toBeInTheDocument();
    expect(summary.getByText('Enabled')).toBeInTheDocument();
  });

  it('displays a configured Compose project filter value', async () => {
    mockFetchSummary.mockResolvedValue(localSummary({ composeProjectFilter: 'project-a' }));
    render(<DockerSettingsPanel />);

    await waitFor(() => expect(screen.getByText('project-a')).toBeInTheDocument());
  });

  it('UX-R3 §6: shows the Connection name for REMOTE mode when configured', async () => {
    mockFetchSummary.mockResolvedValue(
      localSummary({ mode: 'REMOTE', host: '203.0.113.5', port: 2375, connectionName: 'QA Docker' }),
    );
    const { container } = render(<DockerSettingsPanel />);

    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalled());
    const summary = within(container.querySelector('dl')!);
    await waitFor(() => expect(summary.getByText('QA Docker')).toBeInTheDocument());
    expect(summary.getByText('Connection name')).toBeInTheDocument();
  });

  it('UX-R3 §6: shows "Not set" for REMOTE mode with no configured Connection name - never fabricated', async () => {
    mockFetchSummary.mockResolvedValue(
      localSummary({ mode: 'REMOTE', host: '203.0.113.5', port: 2375, connectionName: null }),
    );
    const { container } = render(<DockerSettingsPanel />);

    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalled());
    const summary = within(container.querySelector('dl')!);
    await waitFor(() => expect(summary.getByText('Not set')).toBeInTheDocument());
  });

  it('UX-R3 §6: never shows Connection name for LOCAL mode - it is a REMOTE-only, purely cosmetic field', async () => {
    mockFetchSummary.mockResolvedValue(localSummary({ mode: 'LOCAL' }));
    const { container } = render(<DockerSettingsPanel />);

    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalled());
    const summary = within(container.querySelector('dl')!);
    await waitFor(() => expect(summary.getByText('Local')).toBeInTheDocument());
    expect(screen.queryByText('Connection name')).not.toBeInTheDocument();
  });

  // Pre-closure functional recovery (§11): the informational "Protected
  // field masking" block that used to live here (UX-R3 §14) was moved
  // out of Docker Settings entirely - masking is a global, source-
  // independent concern, not Docker-specific. It is now a real,
  // configurable control in its own PrivacyMaskingSettingsPanel, with its
  // own tests (PrivacyMaskingSettingsPanel.test.tsx).

  it('shows a sanitized error if the summary fetch fails', async () => {
    mockFetchSummary.mockRejectedValue(new Error('Failed to load Docker connection settings'));
    render(<DockerSettingsPanel />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to load/i);
  });

  it('the Test Connection form defaults to LOCAL mode and reveals REMOTE fields only when selected', async () => {
    const user = userEvent.setup();
    render(<DockerSettingsPanel />);
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalled());

    expect(screen.queryByLabelText('Host')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Mode'), 'REMOTE');
    expect(screen.getByLabelText('Host')).toBeInTheDocument();
    expect(screen.getByLabelText('Port')).toBeInTheDocument();
    expect(screen.queryByLabelText(/certificate directory path/i)).not.toBeInTheDocument();

    await user.click(screen.getByLabelText(/use tls/i));
    expect(screen.getByLabelText(/certificate directory path/i)).toBeInTheDocument();
  });

  it('Test Connection success shows a reachable status with the sanitized message', async () => {
    const health: SourceHealth = { status: 'UP', message: 'Docker daemon reachable', checkedAt: '2026-01-01T00:00:00Z', warnings: [] };
    mockTestConnection.mockResolvedValue(health);
    const user = userEvent.setup();
    render(<DockerSettingsPanel />);
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: /^test connection$/i }));

    expect(await screen.findByText(/reachable: docker daemon reachable/i)).toBeInTheDocument();
  });

  it('Test Connection failure shows a sanitized DOWN diagnosis, never a raw exception', async () => {
    const health: SourceHealth = {
      status: 'DOWN',
      message: 'Docker daemon unreachable - connection refused. Confirm the daemon is running and reachable at the configured host/port.',
      checkedAt: '2026-01-01T00:00:00Z',
      warnings: [],
    };
    mockTestConnection.mockResolvedValue(health);
    const user = userEvent.setup();
    render(<DockerSettingsPanel />);
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: /^test connection$/i }));

    const status = await screen.findByText(/unreachable: docker daemon unreachable/i);
    expect(status).toBeInTheDocument();
    expect(status.textContent).not.toContain('Exception');
    expect(status.textContent).not.toContain('\tat ');
  });

  it('Test Connection sends only the fields relevant to the selected mode', async () => {
    mockTestConnection.mockResolvedValue({ status: 'UP', message: 'ok', checkedAt: '2026-01-01T00:00:00Z', warnings: [] });
    const user = userEvent.setup();
    render(<DockerSettingsPanel />);
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalled());

    await user.selectOptions(screen.getByLabelText('Mode'), 'REMOTE');
    await user.type(screen.getByLabelText('Host'), '203.0.113.9');
    await user.type(screen.getByLabelText('Port'), '2376');
    await user.click(screen.getByRole('button', { name: /^test connection$/i }));

    await waitFor(() => expect(mockTestConnection).toHaveBeenCalledTimes(1));
    expect(mockTestConnection).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'REMOTE', host: '203.0.113.9', port: 2376, tls: false }),
    );
  });

  it('never writes anything to localStorage or sessionStorage while filling and testing the form', async () => {
    const localSet = vi.spyOn(Storage.prototype, 'setItem');
    const sessionSet = vi.spyOn(window.sessionStorage, 'setItem');
    mockTestConnection.mockResolvedValue({ status: 'UP', message: 'ok', checkedAt: '2026-01-01T00:00:00Z', warnings: [] });

    const user = userEvent.setup();
    render(<DockerSettingsPanel />);
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalled());
    await user.selectOptions(screen.getByLabelText('Mode'), 'REMOTE');
    await user.type(screen.getByLabelText('Host'), 'sensitive-host.example');
    await user.click(screen.getByRole('button', { name: /^test connection$/i }));
    await waitFor(() => expect(mockTestConnection).toHaveBeenCalled());

    expect(localSet).not.toHaveBeenCalled();
    expect(sessionSet).not.toHaveBeenCalled();
    localSet.mockRestore();
    sessionSet.mockRestore();
  });

  it('a fresh mount re-fetches rather than reusing a stale candidate draft - the Settings workspace remounts this panel every time it opens', async () => {
    const { unmount } = render(<DockerSettingsPanel />);
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledTimes(1));
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Mode'), 'REMOTE');
    await user.type(screen.getByLabelText('Host'), 'discarded-value');
    unmount();

    render(<DockerSettingsPanel />);
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('Mode')).toHaveValue('LOCAL');
  });

  it('has no detectable accessibility violations once loaded', async () => {
    const { container } = render(<DockerSettingsPanel />);
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalled());
    expect(await axe(container)).toHaveNoViolations();
  });
});
