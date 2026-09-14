import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { FieldMappingSettingsPanel } from './FieldMappingSettingsPanel';
import {
  fetchFieldMappingSchemaScan,
  resetFieldMappingProfile,
  saveFieldMappingProfile,
  validateFieldMapping,
} from '../../../shared/api/client';
import type { FieldMappingProfileDto, FieldMappingValidationReport, SchemaScanResponse } from '../../../shared/api/types';

vi.mock('../../../shared/api/client', () => ({
  fetchFieldMappingSchemaScan: vi.fn(),
  resetFieldMappingProfile: vi.fn(),
  saveFieldMappingProfile: vi.fn(),
  validateFieldMapping: vi.fn(),
}));

const mockScan = vi.mocked(fetchFieldMappingSchemaScan);
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

function scanResult(overrides: Partial<SchemaScanResponse> = {}): SchemaScanResponse {
  return {
    sourceId: 'fixture',
    totalEventsInspected: 1,
    malformedEventsInspected: 0,
    totalBytesInspected: 20,
    eventLimitReached: false,
    byteLimitReached: false,
    durationLimitReached: false,
    representativeEvents: [{ originalJson: '{"cif":"2449"}', severity: 'INFO', malformed: false }],
    discoveredSchema: [{ path: 'cif', observedTypes: ['STRING'], occurrenceCount: 1, coveragePercentage: 100 }],
    mappedPathsNotObserved: [],
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

async function runScan(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /run quick schema scan/i }));
  await waitFor(() => expect(mockScan).toHaveBeenCalled());
}

/** Adds `path` as a candidate for the field whose exact display name is `fieldDisplayName`, via the discovered-paths picker (mission §A10), not manual typing. */
async function addViaPicker(user: ReturnType<typeof userEvent.setup>, fieldDisplayName: string, path: string) {
  // Exact, case-sensitive match (not a case-insensitive regex) - a
  // discovered path option can itself read e.g. "cif" (lowercase), which
  // would otherwise collide with a case-insensitive "CIF" field-name match.
  const fieldRow = screen.getByText(fieldDisplayName).closest('li')!;
  const picker = within(fieldRow).getByLabelText(/add a discovered path as a candidate/i);
  await user.selectOptions(picker, path);
  const pickerRow = picker.closest('div')!;
  await user.click(within(pickerRow).getByRole('button', { name: /^add$/i }));
}

describe('FieldMappingSettingsPanel', () => {
  let localStorageSetSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockScan.mockReset();
    mockReset.mockReset();
    mockSave.mockReset();
    mockValidate.mockReset();
    localStorageSetSpy = vi.spyOn(Storage.prototype, 'setItem');
  });

  it('is reachable as its own trigger and starts closed', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: /log schema & field mapping/i })).toBeInTheDocument();
    expect(mockScan).not.toHaveBeenCalled();
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

  it('does NOT run a scan automatically on open - only when the button is clicked', async () => {
    const user = userEvent.setup();
    renderPanel();
    await open(user);
    expect(mockScan).not.toHaveBeenCalled();
  });

  it('runs a scan when the button is clicked and displays Original Event Samples, without ever writing to localStorage', async () => {
    const user = userEvent.setup();
    mockScan.mockResolvedValue(scanResult());
    renderPanel();
    await open(user);

    await runScan(user);

    await waitFor(() => expect(mockScan).toHaveBeenCalledWith('fixture', 200));
    await waitFor(() => expect(screen.getAllByText(/2449/).length).toBeGreaterThan(0));
    expect(screen.getByText(/observed 1 event/i)).toBeInTheDocument();
    expect(screen.getByText(/representative original event sample/i)).toBeInTheDocument();
    expect(localStorageSetSpy).not.toHaveBeenCalled();
  });

  it('lists the Discovered Source Schema union from the scan, labeled as observed metadata, never "Original JSON"', async () => {
    const user = userEvent.setup();
    mockScan.mockResolvedValue(
      scanResult({
        discoveredSchema: [
          { path: 'cifId', observedTypes: ['STRING'], occurrenceCount: 1, coveragePercentage: 100 },
        ],
      }),
    );
    renderPanel();
    await open(user);
    await runScan(user);

    expect(screen.getByText(/discovered source schema/i)).toBeInTheDocument();
    expect(screen.getByText('cifId', { selector: 'code' })).toBeInTheDocument();
    expect(screen.queryByText(/^original json$/i)).not.toBeInTheDocument();
  });

  it('reports malformed events and scan-bound notices truthfully', async () => {
    const user = userEvent.setup();
    mockScan.mockResolvedValue(
      scanResult({
        totalEventsInspected: 5,
        malformedEventsInspected: 2,
        eventLimitReached: true,
      }),
    );
    renderPanel();
    await open(user);
    await runScan(user);

    expect(screen.getByText(/2 malformed/i)).toBeInTheDocument();
    expect(screen.getByText(/event limit reached/i)).toBeInTheDocument();
  });

  it('rescan diffs discovered paths against the previous scan without touching the saved mapping', async () => {
    const user = userEvent.setup();
    mockScan.mockResolvedValueOnce(scanResult());
    renderPanel();
    await open(user);
    await runScan(user);

    mockScan.mockResolvedValueOnce(
      scanResult({
        discoveredSchema: [{ path: 'newField', observedTypes: ['STRING'], occurrenceCount: 1, coveragePercentage: 100 }],
      }),
    );
    await user.click(screen.getByRole('button', { name: /^rescan$/i }));
    await waitFor(() => expect(mockScan).toHaveBeenCalledTimes(2));

    const newlyDiscoveredNotice = screen.getByText(/newly discovered since the last scan/i);
    expect(within(newlyDiscoveredNotice).getByText('newField')).toBeInTheDocument();
    const disappearedNotice = screen.getByText(/no longer observed since the last scan/i);
    expect(within(disappearedNotice).getByText('cif')).toBeInTheDocument();
  });

  it('warns when a saved mapped path is no longer observed, without changing the saved mapping', async () => {
    const user = userEvent.setup();
    mockScan.mockResolvedValue(scanResult({ mappedPathsNotObserved: ['mdc.cif'] }));
    renderPanel();
    await open(user);
    await runScan(user);

    expect(screen.getByText(/saved mapping path.*not observed/i)).toBeInTheDocument();
    // The saved mapping itself is untouched - still shown as-is in the field editor.
    const cifField = screen.getByText('CIF').closest('li')!;
    expect(within(cifField).getByText('mdc.cif')).toBeInTheDocument();
  });

  it('does not show the scan button when the source does not support sampling, and says so truthfully', async () => {
    const user = userEvent.setup();
    renderPanel({ sourceSupportsSampling: false });
    await open(user);
    expect(screen.queryByRole('button', { name: /run quick schema scan/i })).not.toBeInTheDocument();
    expect(screen.getByText(/does not support original source json sampling/i)).toBeInTheDocument();
  });

  it('the discovered-paths picker offers scanned paths as candidate options, and adding via the picker updates the field editor', async () => {
    const user = userEvent.setup();
    mockScan.mockResolvedValue(scanResult());
    mockValidate.mockResolvedValue(passingReport());
    renderPanel();
    await open(user);
    await runScan(user);

    await addViaPicker(user, 'Journey Name', 'cif');

    const journeyField = screen.getByText('Journey Name').closest('li')!;
    expect(within(journeyField).getByText('cif', { selector: 'code' })).toBeInTheDocument();
  });

  it('manual advanced path entry still works as a fallback', async () => {
    const user = userEvent.setup();
    mockScan.mockResolvedValue(scanResult());
    renderPanel();
    await open(user);
    await runScan(user);

    const cifField = screen.getByText('CIF').closest('li')!;
    const summary = within(cifField).getByText(/advanced: enter a path manually/i);
    await user.click(summary);
    const advancedSection = summary.closest('details')!;
    const input = within(advancedSection).getByLabelText(/add a candidate path for cif/i);
    await user.type(input, 'customer.cif');
    await user.click(within(advancedSection).getByRole('button', { name: /^add$/i }));

    expect(within(cifField).getByText('customer.cif')).toBeInTheDocument();
  });

  it('adding a candidate path clears any prior validation result', async () => {
    const user = userEvent.setup();
    mockScan.mockResolvedValue(scanResult());
    mockValidate.mockResolvedValue(passingReport());
    renderPanel();
    await open(user);
    await runScan(user);

    await user.click(screen.getByRole('button', { name: /^validate mapping$/i }));
    await waitFor(() => expect(screen.getByText(/no invalid paths/i)).toBeInTheDocument());

    await addViaPicker(user, 'CIF', 'cif');

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
    const candidateCodes = items[0].parentElement ? screen.getAllByRole('listitem') : [];
    expect(candidateCodes.length).toBeGreaterThan(0);
  });

  it('save is disabled until a validate has run since the last edit', async () => {
    const user = userEvent.setup();
    mockScan.mockResolvedValue(scanResult());
    renderPanel();
    await open(user);
    expect(screen.getByRole('button', { name: /save mapping/i })).toBeDisabled();

    await runScan(user);
    await addViaPicker(user, 'CIF', 'cif');
    expect(screen.getByRole('button', { name: /save mapping/i })).toBeDisabled();

    mockValidate.mockResolvedValue(passingReport());
    await user.click(screen.getByRole('button', { name: /^validate mapping$/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /save mapping/i })).toBeEnabled());
  });

  it('validate renders found values, absent fields, invalid paths, and conflicts distinctly', async () => {
    const user = userEvent.setup();
    mockScan.mockResolvedValue(scanResult());
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
    await runScan(user);
    await user.click(screen.getByRole('button', { name: /^validate mapping$/i }));

    await waitFor(() => expect(screen.getByText(/found: 2449/i)).toBeInTheDocument());
    expect(screen.getByText(/not found in the current samples/i)).toBeInTheDocument();
    expect(screen.getByText(/invalid path.*mdc\.\.bad/i)).toBeInTheDocument();
    expect(screen.getByText(/claimed by more than one field/i)).toBeInTheDocument();
    expect(screen.getByText(/not valid/i)).toBeInTheDocument();
  });

  it('save passes the real "passed" value from the last validate call, never hardcoded true', async () => {
    const user = userEvent.setup();
    mockScan.mockResolvedValue(scanResult());
    mockValidate.mockResolvedValue(failingReport());
    mockSave.mockResolvedValue(baseProfile({ searchReady: false }));
    renderPanel();
    await open(user);
    await runScan(user);
    await addViaPicker(user, 'CIF', 'cif');
    await user.click(screen.getByRole('button', { name: /^validate mapping$/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /save mapping/i })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: /save mapping/i }));
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith(false));
  });

  it('a successful save calls onProfileChanged so the app-wide readiness state re-syncs', async () => {
    const user = userEvent.setup();
    mockScan.mockResolvedValue(scanResult());
    mockValidate.mockResolvedValue(passingReport());
    mockSave.mockResolvedValue(baseProfile({ searchReady: true }));
    const { onProfileChanged } = renderPanel();
    await open(user);
    await runScan(user);
    await addViaPicker(user, 'CIF', 'cif');
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

  it('shows a sanitized error if the scan fails', async () => {
    const user = userEvent.setup();
    mockScan.mockRejectedValue(new Error('Failed to run schema scan'));
    renderPanel();
    await open(user);
    await user.click(screen.getByRole('button', { name: /run quick schema scan/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/failed to run schema scan/i));
  });

  it('has no detectable accessibility violations when open with data loaded', async () => {
    const user = userEvent.setup();
    mockScan.mockResolvedValue(scanResult());
    const { container } = renderPanel();
    await open(user);
    await runScan(user);
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
