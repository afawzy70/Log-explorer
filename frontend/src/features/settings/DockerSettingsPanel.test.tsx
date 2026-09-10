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
    ...overrides,
  };
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /docker settings/i }));
}

describe('DockerSettingsPanel', () => {
  beforeEach(() => {
    mockFetchSummary.mockReset();
    mockTestConnection.mockReset();
    mockFetchSummary.mockResolvedValue(localSummary());
  });

  it('shows the trigger without fetching anything until opened', () => {
    render(<DockerSettingsPanel />);
    expect(screen.getByRole('button', { name: /docker settings/i })).toBeInTheDocument();
    expect(mockFetchSummary).not.toHaveBeenCalled();
  });

  it('fetches and displays the current connection summary for LOCAL mode', async () => {
    const user = userEvent.setup();
    const { container } = render(<DockerSettingsPanel />);
    await open(user);

    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledTimes(1));
    const summary = within(container.querySelector('dl')!);
    expect(summary.getByText('Local')).toBeInTheDocument();
    expect(summary.getByText('Disabled')).toBeInTheDocument();
    expect(summary.getByText(/none configured/i)).toBeInTheDocument();
    expect(screen.getByText(/permanent connection changes require deployment/i)).toBeInTheDocument();
  });

  it('shows host and port for REMOTE mode', async () => {
    mockFetchSummary.mockResolvedValue(
      localSummary({ mode: 'REMOTE', host: '203.0.113.5', port: 2375, tlsEnabled: true }),
    );
    const user = userEvent.setup();
    const { container } = render(<DockerSettingsPanel />);
    await open(user);

    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalled());
    const summary = within(container.querySelector('dl')!);
    expect(summary.getByText('Remote')).toBeInTheDocument();
    expect(summary.getByText('203.0.113.5')).toBeInTheDocument();
    expect(summary.getByText('2375')).toBeInTheDocument();
    expect(summary.getByText('Enabled')).toBeInTheDocument();
  });

  it('displays a configured Compose project filter value', async () => {
    mockFetchSummary.mockResolvedValue(localSummary({ composeProjectFilter: 'project-a' }));
    const user = userEvent.setup();
    render(<DockerSettingsPanel />);
    await open(user);

    await waitFor(() => expect(screen.getByText('project-a')).toBeInTheDocument());
  });

  it('shows a sanitized error if the summary fetch fails', async () => {
    mockFetchSummary.mockRejectedValue(new Error('Failed to load Docker connection settings'));
    const user = userEvent.setup();
    render(<DockerSettingsPanel />);
    await open(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to load/i);
  });

  it('the Test Connection form defaults to LOCAL mode and reveals REMOTE fields only when selected', async () => {
    const user = userEvent.setup();
    render(<DockerSettingsPanel />);
    await open(user);
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
    await open(user);
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
    await open(user);
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
    await open(user);
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

  it('never writes anything to localStorage or sessionStorage across open/fill/test/close', async () => {
    const localSet = vi.spyOn(Storage.prototype, 'setItem');
    const sessionSet = vi.spyOn(window.sessionStorage, 'setItem');
    mockTestConnection.mockResolvedValue({ status: 'UP', message: 'ok', checkedAt: '2026-01-01T00:00:00Z', warnings: [] });

    const user = userEvent.setup();
    render(<DockerSettingsPanel />);
    await open(user);
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalled());
    await user.selectOptions(screen.getByLabelText('Mode'), 'REMOTE');
    await user.type(screen.getByLabelText('Host'), 'sensitive-host.example');
    await user.click(screen.getByRole('button', { name: /^test connection$/i }));
    await waitFor(() => expect(mockTestConnection).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: /^close$/i }));

    expect(localSet).not.toHaveBeenCalled();
    expect(sessionSet).not.toHaveBeenCalled();
    localSet.mockRestore();
    sessionSet.mockRestore();
  });

  it('reopening after close re-fetches a fresh summary rather than reusing a stale candidate draft', async () => {
    const user = userEvent.setup();
    render(<DockerSettingsPanel />);
    await open(user);
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledTimes(1));
    await user.selectOptions(screen.getByLabelText('Mode'), 'REMOTE');
    await user.type(screen.getByLabelText('Host'), 'discarded-value');
    await user.click(screen.getByRole('button', { name: /^close$/i }));

    await open(user);
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('Mode')).toHaveValue('LOCAL');
  });

  it('Escape closes the panel without disrupting anything else on the page', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button type="button">outside-marker</button>
        <DockerSettingsPanel />
      </div>,
    );
    await open(user);
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalled());
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'outside-marker' })).toBeInTheDocument();
  });

  it('has no detectable accessibility violations, closed or open', async () => {
    const user = userEvent.setup();
    const { container } = render(<DockerSettingsPanel />);
    expect(await axe(container)).toHaveNoViolations();

    await open(user);
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalled());
    expect(await axe(container)).toHaveNoViolations();
  });
});
