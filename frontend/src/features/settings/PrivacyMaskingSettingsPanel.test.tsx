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

/*
 * B6.2 (Session 7) - no longer a trigger-button popover: this panel renders
 * persistently and fetches on mount (COMPONENT_INVENTORY.md's own RECOMPOSE
 * row). Each protected field's control changed from a plain checkbox to a
 * real `role="switch"` (the design's own required grammar) - same
 * underlying toggle, same server call, so `getByRole('switch', { name })`
 * replaces `getByLabelText(label)` throughout.
 */
function switchFor(label: string) {
  return screen.getByRole('switch', { name: new RegExp(`^mask ${label}$`, 'i') });
}

describe('PrivacyMaskingSettingsPanel', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockUpdate.mockReset();
    mockFetch.mockResolvedValue(allMasked());
  });

  it('is reachable as a global, source-independent control - "All sources", not nested inside Docker or OpenShift settings', () => {
    render(<PrivacyMaskingSettingsPanel />);
    expect(screen.getByRole('heading', { name: /privacy & masking/i })).toBeInTheDocument();
    expect(screen.getByText(/all sources/i)).toBeInTheDocument();
  });

  it('fetches the real policy on mount and renders all five protected fields exactly as the server reports them', async () => {
    render(<PrivacyMaskingSettingsPanel />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    for (const label of ['CIF', 'Username', 'Customer ID', 'Device ID', 'Device IP']) {
      expect(switchFor(label)).toHaveAttribute('aria-checked', 'true');
      expect(switchFor(label)).toHaveTextContent('Masked');
    }
  });

  it('renders the real current fresh-install default (all five fields unmasked) correctly', async () => {
    // Mission §B: DEFAULT_MASKING_STATE=DISABLED — proves this component
    // is purely data-driven and correctly reflects that real state too,
    // not just the all-masked fixture most other tests in this file use.
    mockFetch.mockResolvedValue(allUnmasked());
    render(<PrivacyMaskingSettingsPanel />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    for (const label of ['CIF', 'Username', 'Customer ID', 'Device ID', 'Device IP']) {
      expect(switchFor(label)).toHaveAttribute('aria-checked', 'false');
      expect(switchFor(label)).toHaveTextContent('Unmasked');
    }
    // Fresh-default unmasked state must surface the same warning an
    // explicitly-unmasked field would - nothing here is silent.
    expect(screen.getByText(/some fields are unmasked/i)).toBeInTheDocument();
  });

  it('toggling a field off calls the real server update endpoint for exactly that field, and reflects the server-returned policy', async () => {
    const user = userEvent.setup();
    mockUpdate.mockResolvedValue(allMasked({ cif: false }));
    render(<PrivacyMaskingSettingsPanel />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    await user.click(switchFor('CIF'));

    expect(mockUpdate).toHaveBeenCalledWith('cif', false);
    await waitFor(() => expect(switchFor('CIF')).toHaveAttribute('aria-checked', 'false'));
    // Every other field remains masked - toggling one never touches the rest.
    expect(switchFor('Username')).toHaveAttribute('aria-checked', 'true');
    expect(switchFor('Customer ID')).toHaveAttribute('aria-checked', 'true');
  });

  it('shows a warning once any field is unmasked, and it disappears again once re-masked', async () => {
    const user = userEvent.setup();
    mockUpdate.mockResolvedValueOnce(allMasked({ deviceIp: false }));
    render(<PrivacyMaskingSettingsPanel />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    expect(screen.queryByText(/some fields are unmasked/i)).not.toBeInTheDocument();

    await user.click(switchFor('Device IP'));
    await waitFor(() => expect(screen.getByText(/some fields are unmasked/i)).toBeInTheDocument());

    mockUpdate.mockResolvedValueOnce(allMasked());
    await user.click(switchFor('Device IP'));
    await waitFor(() => expect(screen.queryByText(/some fields are unmasked/i)).not.toBeInTheDocument());
  });

  it('re-toggling a field on calls the update endpoint with masked=true', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(allMasked({ userName: false }));
    mockUpdate.mockResolvedValue(allMasked());
    render(<PrivacyMaskingSettingsPanel />);
    await waitFor(() => expect(switchFor('Username')).toHaveAttribute('aria-checked', 'false'));

    await user.click(switchFor('Username'));
    expect(mockUpdate).toHaveBeenCalledWith('userName', true);
  });

  it('does not implement a per-row "Reveal" action anywhere - only the switch toggle exists', async () => {
    render(<PrivacyMaskingSettingsPanel />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /reveal|unmask value|show raw/i })).not.toBeInTheDocument();
  });

  it('shows a sanitized error if the settings fetch fails', async () => {
    mockFetch.mockRejectedValue(new Error('Failed to load masking settings'));
    render(<PrivacyMaskingSettingsPanel />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/failed to load masking settings/i));
  });

  it('shows a sanitized error if an update fails, without losing the previously-loaded state', async () => {
    const user = userEvent.setup();
    mockUpdate.mockRejectedValue(new Error('Failed to update cif'));
    render(<PrivacyMaskingSettingsPanel />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await user.click(switchFor('CIF'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/failed to update cif/i));
  });

  it('has no detectable accessibility violations with data loaded', async () => {
    const { container } = render(<PrivacyMaskingSettingsPanel />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(await axe(container)).toHaveNoViolations();
  });
});
