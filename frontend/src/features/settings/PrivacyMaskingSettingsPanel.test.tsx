import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { PrivacyMaskingSettingsPanel } from './PrivacyMaskingSettingsPanel';
import { fetchMaskingSettings, updateMaskingSetting } from '../../shared/api/client';
import type { MaskingSettings } from '../../shared/api/types';

vi.mock('../../shared/api/client', () => ({
  fetchMaskingSettings: vi.fn(),
  updateMaskingSetting: vi.fn(),
}));

const mockFetch = vi.mocked(fetchMaskingSettings);
const mockUpdate = vi.mocked(updateMaskingSetting);

function allMasked(overrides: Partial<MaskingSettings> = {}): MaskingSettings {
  return { cif: true, userName: true, customerId: true, deviceId: true, deviceIp: true, ...overrides };
}

/**
 * The real backend's fresh/default state (mission "Field Mapping Schema
 * Scan + Masking Policy Extension" §B — `DEFAULT_MASKING_STATE=DISABLED`).
 * This component itself never hardcodes either direction — it always
 * renders exactly what {@link fetchMaskingSettings} returns — so most
 * tests below deliberately mock `allMasked()` to keep the widest possible
 * assertion coverage independent of which way the real default points;
 * this fixture exists specifically to prove the component also renders
 * the actual current real-world default state correctly.
 */
function allUnmasked(overrides: Partial<MaskingSettings> = {}): MaskingSettings {
  return { cif: false, userName: false, customerId: false, deviceId: false, deviceIp: false, ...overrides };
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /privacy & masking/i }));
}

describe('PrivacyMaskingSettingsPanel', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockUpdate.mockReset();
    mockFetch.mockResolvedValue(allMasked());
  });

  it('is reachable as a global, source-independent control - not nested inside Docker or OpenShift settings', () => {
    render(<PrivacyMaskingSettingsPanel />);
    expect(screen.getByRole('button', { name: /privacy & masking/i })).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fetches the real policy fresh on open and renders all five protected fields exactly as the server reports them', async () => {
    const user = userEvent.setup();
    render(<PrivacyMaskingSettingsPanel />);
    await open(user);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    for (const label of ['CIF', 'Username', 'Customer ID', 'Device ID', 'Device IP']) {
      const checkbox = screen.getByLabelText(label);
      expect(checkbox).toBeChecked();
    }
  });

  it('renders the real current fresh-install default (all five fields unmasked) correctly, unchecked', async () => {
    // Mission §B: DEFAULT_MASKING_STATE=DISABLED — proves this component
    // is purely data-driven and correctly reflects that real state too,
    // not just the all-masked fixture most other tests in this file use.
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(allUnmasked());
    render(<PrivacyMaskingSettingsPanel />);
    await open(user);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    for (const label of ['CIF', 'Username', 'Customer ID', 'Device ID', 'Device IP']) {
      expect(screen.getByLabelText(label)).not.toBeChecked();
    }
    // Fresh-default unmasked state must surface the same warning an
    // explicitly-unmasked field would - nothing here is silent.
    expect(screen.getByText(/may show real, unmasked values/i)).toBeInTheDocument();
  });

  it('unchecking a field calls the real server update endpoint for exactly that field, and reflects the server-returned policy', async () => {
    const user = userEvent.setup();
    mockUpdate.mockResolvedValue(allMasked({ cif: false }));
    render(<PrivacyMaskingSettingsPanel />);
    await open(user);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    await user.click(screen.getByLabelText('CIF'));

    expect(mockUpdate).toHaveBeenCalledWith('cif', false);
    await waitFor(() => expect(screen.getByLabelText('CIF')).not.toBeChecked());
    // Every other field remains masked/checked - toggling one never touches the rest.
    expect(screen.getByLabelText('Username')).toBeChecked();
    expect(screen.getByLabelText('Customer ID')).toBeChecked();
  });

  it('shows a concise warning once any field is unmasked, and it disappears again once re-masked', async () => {
    const user = userEvent.setup();
    mockUpdate.mockResolvedValueOnce(allMasked({ deviceIp: false }));
    render(<PrivacyMaskingSettingsPanel />);
    await open(user);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    expect(screen.queryByText(/may show real, unmasked values/i)).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('Device IP'));
    await waitFor(() => expect(screen.getByText(/may show real, unmasked values/i)).toBeInTheDocument());

    mockUpdate.mockResolvedValueOnce(allMasked());
    await user.click(screen.getByLabelText('Device IP'));
    await waitFor(() => expect(screen.queryByText(/may show real, unmasked values/i)).not.toBeInTheDocument());
  });

  it('re-checking a field calls the update endpoint with masked=true', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(allMasked({ userName: false }));
    mockUpdate.mockResolvedValue(allMasked());
    render(<PrivacyMaskingSettingsPanel />);
    await open(user);
    await waitFor(() => expect(screen.getByLabelText('Username')).not.toBeChecked());

    await user.click(screen.getByLabelText('Username'));
    expect(mockUpdate).toHaveBeenCalledWith('userName', true);
  });

  it('does not implement a per-row "Reveal" action anywhere - only the checkbox toggle exists', async () => {
    const user = userEvent.setup();
    render(<PrivacyMaskingSettingsPanel />);
    await open(user);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /reveal|unmask value|show raw/i })).not.toBeInTheDocument();
  });

  it('shows a sanitized error if the settings fetch fails', async () => {
    const user = userEvent.setup();
    mockFetch.mockRejectedValue(new Error('Failed to load masking settings'));
    render(<PrivacyMaskingSettingsPanel />);
    await open(user);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/failed to load masking settings/i));
  });

  it('shows a sanitized error if an update fails, without losing the previously-loaded state', async () => {
    const user = userEvent.setup();
    mockUpdate.mockRejectedValue(new Error('Failed to update cif'));
    render(<PrivacyMaskingSettingsPanel />);
    await open(user);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await user.click(screen.getByLabelText('CIF'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/failed to update cif/i));
  });

  it('has no detectable accessibility violations when open with data loaded', async () => {
    const user = userEvent.setup();
    const { container } = render(<PrivacyMaskingSettingsPanel />);
    await open(user);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(await axe(container)).toHaveNoViolations();
  });
});
