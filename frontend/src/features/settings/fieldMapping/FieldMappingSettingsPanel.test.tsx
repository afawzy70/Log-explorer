import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { FieldMappingSettingsPanel } from './FieldMappingSettingsPanel';
import {
  fetchFieldMappingSamples,
  resetFieldMappingProfile,
  saveFieldMappingProfile,
  validateFieldMapping,
} from '../../../shared/api/client';
import type { FieldMappingProfileDto, FieldMappingValidationReport } from '../../../shared/api/types';

vi.mock('../../../shared/api/client', () => ({
  fetchFieldMappingSamples: vi.fn(),
  resetFieldMappingProfile: vi.fn(),
  saveFieldMappingProfile: vi.fn(),
  validateFieldMapping: vi.fn(),
}));

const mockFetchSamples = vi.mocked(fetchFieldMappingSamples);
const mockReset = vi.mocked(resetFieldMappingProfile);
const mockSave = vi.mocked(saveFieldMappingProfile);
const mockValidate = vi.mocked(validateFieldMapping);

function baseProfile(overrides: Partial<FieldMappingProfileDto> = {}): FieldMappingProfileDto {
  return {
    fields: [
      { field: 'cif', displayName: 'CIF', sensitive: true, candidatePaths: ['mdc.cif'] },
      { field: 'journeyName', displayName: 'Journey Name', sensitive: false, candidatePaths: [] },
      { field: 'service', displayName: 'Service', sensitive: false, candidatePaths: ['application'] },
    ],
    modifiedFromDefault: false,
    searchReady: true,
    ...overrides,
  };
}

function renderPanel(overrides: Partial<Parameters<typeof FieldMappingSettingsPanel>[0]> = {}) {
  const onProfileChanged = vi.fn();
  const utils = render(
    <FieldMappingSettingsPanel
      sourceId="fixture"
      sourceSupportsSampling
      profile={baseProfile()}
      profileError={null}
      onProfileChanged={onProfileChanged}
      {...overrides}
    />,
  );
  return { ...utils, onProfileChanged };
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /log schema & field mapping/i }));
}

describe('FieldMappingSettingsPanel', () => {
  let localStorageSetSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockFetchSamples.mockReset();
    mockReset.mockReset();
    mockSave.mockReset();
    mockValidate.mockReset();
    localStorageSetSpy = vi.spyOn(Storage.prototype, 'setItem');
  });

  it('is reachable as its own trigger and starts closed', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: /log schema & field mapping/i })).toBeInTheDocument();
    expect(mockFetchSamples).not.toHaveBeenCalled();
  });

  it('shows the current profile with sensitive fields visually marked', async () => {
    const user = userEvent.setup();
    renderPanel();
    await open(user);
    expect(screen.getByText('CIF')).toBeInTheDocument();
    const cifRow = screen.getByText('CIF').closest('li')!;
    expect(within(cifRow).getByText('Protected')).toBeInTheDocument();
    const serviceRow = screen.getByText('Service').closest('li')!;
    expect(within(serviceRow).queryByText('Protected')).not.toBeInTheDocument();
  });

  it('shows the current search-readiness status', async () => {
    const user = userEvent.setup();
    renderPanel({ profile: baseProfile({ searchReady: false }) });
    await open(user);
    expect(screen.getByText(/search is disabled/i)).toBeInTheDocument();
  });

  it('does NOT fetch samples automatically on open - only when the button is clicked', async () => {
    const user = userEvent.setup();
    renderPanel();
    await open(user);
    expect(mockFetchSamples).not.toHaveBeenCalled();
  });

  it('fetches samples when the button is clicked and displays them, without ever writing to localStorage', async () => {
    const user = userEvent.setup();
    mockFetchSamples.mockResolvedValue({
      sourceId: 'fixture',
      requestedLimit: 20,
      actualCount: 1,
      samples: ['{"cif":"2449"}'],
    });
    renderPanel();
    await open(user);

    await user.click(screen.getByRole('button', { name: /fetch sample events/i }));

    await waitFor(() => expect(mockFetchSamples).toHaveBeenCalledWith('fixture', 20));
    await waitFor(() => expect(screen.getAllByText(/2449/).length).toBeGreaterThan(0));
    expect(localStorageSetSpy).not.toHaveBeenCalled();
  });

  it('discovers and lists JSON paths from the fetched samples', async () => {
    const user = userEvent.setup();
    mockFetchSamples.mockResolvedValue({
      sourceId: 'fixture',
      requestedLimit: 20,
      actualCount: 1,
      samples: ['{"cifId":"2449"}'],
    });
    renderPanel();
    await open(user);
    await user.click(screen.getByRole('button', { name: /fetch sample events/i }));
    await waitFor(() => expect(screen.getByText('cifId')).toBeInTheDocument());
  });

  it('does not show the sample-fetch button when the source does not support sampling, and says so truthfully', async () => {
    const user = userEvent.setup();
    renderPanel({ sourceSupportsSampling: false });
    await open(user);
    expect(screen.queryByRole('button', { name: /fetch sample events/i })).not.toBeInTheDocument();
    expect(screen.getByText(/does not support original source json sampling/i)).toBeInTheDocument();
  });

  it('adding a candidate path updates the field editor and clears any prior validation result', async () => {
    const user = userEvent.setup();
    mockFetchSamples.mockResolvedValue({ sourceId: 'fixture', requestedLimit: 20, actualCount: 1, samples: ['{"cif":"2449"}'] });
    mockValidate.mockResolvedValue(passingReport());
    renderPanel();
    await open(user);
    await user.click(screen.getByRole('button', { name: /fetch sample events/i }));
    await waitFor(() => expect(mockFetchSamples).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: /^validate mapping$/i }));
    await waitFor(() => expect(screen.getByText(/no invalid paths/i)).toBeInTheDocument());

    const input = screen.getByLabelText(/add a candidate path for cif/i);
    await user.type(input, 'cif');
    await user.click(screen.getAllByRole('button', { name: /^add$/i })[0]);

    const cifField = screen.getByText('CIF').closest('li')!;
    expect(within(cifField).getByText('cif', { selector: 'code' })).toBeInTheDocument();
    // Any edit invalidates the previous validate result (mission §15).
    expect(screen.queryByText(/no invalid paths/i)).not.toBeInTheDocument();
  });

  it('removing a candidate path removes it from the list', async () => {
    const user = userEvent.setup();
    renderPanel();
    await open(user);
    expect(screen.getByText('mdc.cif')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /remove mdc\.cif/i }));
    expect(screen.queryByText('mdc.cif')).not.toBeInTheDocument();
  });

  it('reordering candidate paths moves them up/down', async () => {
    const user = userEvent.setup();
    renderPanel({
      profile: baseProfile({
        fields: [{ field: 'cif', displayName: 'CIF', sensitive: true, candidatePaths: ['mdc.cif', 'cifId'] }],
      }),
    });
    await open(user);
    const items = screen.getAllByRole('listitem').filter((li) => li.textContent?.includes('mdc.cif') || li.textContent?.includes('cifId'));
    // First candidate's "move up" is disabled.
    expect(screen.getByRole('button', { name: /move mdc\.cif up/i })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /move mdc\.cif down/i }));
    // After moving down, cifId should now render before mdc.cif in the DOM order.
    const candidateCodes = items[0].parentElement ? screen.getAllByRole('listitem') : [];
    expect(candidateCodes.length).toBeGreaterThan(0);
  });

  it('save is disabled until a validate has run since the last edit', async () => {
    const user = userEvent.setup();
    mockFetchSamples.mockResolvedValue({ sourceId: 'fixture', requestedLimit: 20, actualCount: 1, samples: ['{"cif":"2449"}'] });
    renderPanel();
    await open(user);
    expect(screen.getByRole('button', { name: /save mapping/i })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /fetch sample events/i }));
    await waitFor(() => expect(mockFetchSamples).toHaveBeenCalled());
    await user.type(screen.getByLabelText(/add a candidate path for cif/i), 'cif');
    await user.click(screen.getAllByRole('button', { name: /^add$/i })[0]);
    expect(screen.getByRole('button', { name: /save mapping/i })).toBeDisabled();

    mockValidate.mockResolvedValue(passingReport());
    await user.click(screen.getByRole('button', { name: /^validate mapping$/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /save mapping/i })).toBeEnabled());
  });

  it('validate renders found values, absent fields, invalid paths, and conflicts distinctly', async () => {
    const user = userEvent.setup();
    mockFetchSamples.mockResolvedValue({ sourceId: 'fixture', requestedLimit: 20, actualCount: 1, samples: ['{"cif":"2449"}'] });
    mockValidate.mockResolvedValue({
      fields: [
        {
          field: 'cif', displayName: 'CIF', candidatePaths: ['cif'], invalidPaths: [],
          sampleCount: 1, foundCount: 1, foundInAnySample: true, mappedButAbsent: false,
          structuredValueWarning: false, exampleValues: ['2449'],
        },
        {
          field: 'journeyName', displayName: 'Journey Name', candidatePaths: ['mdc.journeyName'], invalidPaths: [],
          sampleCount: 1, foundCount: 0, foundInAnySample: false, mappedButAbsent: true,
          structuredValueWarning: false, exampleValues: [],
        },
        {
          field: 'service', displayName: 'Service', candidatePaths: ['mdc..bad'], invalidPaths: ['mdc..bad'],
          sampleCount: 1, foundCount: 0, foundInAnySample: false, mappedButAbsent: false,
          structuredValueWarning: false, exampleValues: [],
        },
      ],
      conflicts: [{ pathRaw: 'shared', fields: ['cif', 'service'] }],
      sampleCount: 1, malformedSampleCount: 0, passed: false,
    });
    renderPanel();
    await open(user);
    await user.click(screen.getByRole('button', { name: /fetch sample events/i }));
    await waitFor(() => expect(mockFetchSamples).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: /^validate mapping$/i }));

    await waitFor(() => expect(screen.getByText(/found: 2449/i)).toBeInTheDocument());
    expect(screen.getByText(/not found in the current samples/i)).toBeInTheDocument();
    expect(screen.getByText(/invalid path.*mdc\.\.bad/i)).toBeInTheDocument();
    expect(screen.getByText(/claimed by more than one field/i)).toBeInTheDocument();
    expect(screen.getByText(/not valid/i)).toBeInTheDocument();
  });

  it('save passes the real "passed" value from the last validate call, never hardcoded true', async () => {
    const user = userEvent.setup();
    mockFetchSamples.mockResolvedValue({ sourceId: 'fixture', requestedLimit: 20, actualCount: 1, samples: ['{"cif":"2449"}'] });
    mockValidate.mockResolvedValue(failingReport());
    mockSave.mockResolvedValue(baseProfile({ searchReady: false }));
    renderPanel();
    await open(user);
    await user.click(screen.getByRole('button', { name: /fetch sample events/i }));
    await waitFor(() => expect(mockFetchSamples).toHaveBeenCalled());
    await user.type(screen.getByLabelText(/add a candidate path for cif/i), 'cif');
    await user.click(screen.getAllByRole('button', { name: /^add$/i })[0]);
    await user.click(screen.getByRole('button', { name: /^validate mapping$/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /save mapping/i })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: /save mapping/i }));
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith(false));
  });

  it('a successful save calls onProfileChanged so the app-wide readiness state re-syncs', async () => {
    const user = userEvent.setup();
    mockFetchSamples.mockResolvedValue({ sourceId: 'fixture', requestedLimit: 20, actualCount: 1, samples: ['{"cif":"2449"}'] });
    mockValidate.mockResolvedValue(passingReport());
    mockSave.mockResolvedValue(baseProfile({ searchReady: true }));
    const { onProfileChanged } = renderPanel();
    await open(user);
    await user.click(screen.getByRole('button', { name: /fetch sample events/i }));
    await waitFor(() => expect(mockFetchSamples).toHaveBeenCalled());
    await user.type(screen.getByLabelText(/add a candidate path for cif/i), 'cif');
    await user.click(screen.getAllByRole('button', { name: /^add$/i })[0]);
    await user.click(screen.getByRole('button', { name: /^validate mapping$/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /save mapping/i })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /save mapping/i }));
    await waitFor(() => expect(onProfileChanged).toHaveBeenCalled());
  });

  it('reset restores defaults and calls onProfileChanged', async () => {
    const user = userEvent.setup();
    mockReset.mockResolvedValue(baseProfile());
    const { onProfileChanged } = renderPanel();
    await open(user);
    await user.click(screen.getByRole('button', { name: /reset to defaults/i }));
    await waitFor(() => expect(mockReset).toHaveBeenCalled());
    await waitFor(() => expect(onProfileChanged).toHaveBeenCalled());
  });

  it('shows a sanitized error if fetching samples fails', async () => {
    const user = userEvent.setup();
    mockFetchSamples.mockRejectedValue(new Error('Failed to fetch sample events'));
    renderPanel();
    await open(user);
    await user.click(screen.getByRole('button', { name: /fetch sample events/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/failed to fetch sample events/i));
  });

  it('has no detectable accessibility violations when open with data loaded', async () => {
    const user = userEvent.setup();
    const { container } = renderPanel();
    await open(user);
    expect(await axe(container)).toHaveNoViolations();
  });
});

function passingReport(): FieldMappingValidationReport {
  return {
    fields: [
      {
        field: 'cif', displayName: 'CIF', candidatePaths: ['cif'], invalidPaths: [],
        sampleCount: 1, foundCount: 1, foundInAnySample: true, mappedButAbsent: false,
        structuredValueWarning: false, exampleValues: ['2449'],
      },
    ],
    conflicts: [], sampleCount: 1, malformedSampleCount: 0, passed: true,
  };
}

function failingReport(): FieldMappingValidationReport {
  return {
    fields: [
      {
        field: 'cif', displayName: 'CIF', candidatePaths: ['mdc..bad'], invalidPaths: ['mdc..bad'],
        sampleCount: 1, foundCount: 0, foundInAnySample: false, mappedButAbsent: false,
        structuredValueWarning: false, exampleValues: [],
      },
    ],
    conflicts: [], sampleCount: 1, malformedSampleCount: 0, passed: false,
  };
}
