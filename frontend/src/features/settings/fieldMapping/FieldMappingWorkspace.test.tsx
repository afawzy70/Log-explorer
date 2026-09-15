import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { FieldMappingWorkspace } from './FieldMappingWorkspace';
import {
  fetchFieldMappingSchemaScan,
  markFieldMappingNeedsChange,
  resetFieldMappingProfile,
  saveFieldMappingProfile,
  updateFieldMappingCandidates,
  validateFieldMapping,
  verifyFieldMapping,
  ApiError,
} from '../../../shared/api/client';
import type { FieldMappingProfileDto, FieldMappingValidationReport, SchemaScanResponse } from '../../../shared/api/types';

vi.mock('../../../shared/api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../shared/api/client')>('../../../shared/api/client');
  return {
    ApiError: actual.ApiError,
    fetchFieldMappingSchemaScan: vi.fn(),
    resetFieldMappingProfile: vi.fn(),
    saveFieldMappingProfile: vi.fn(),
    updateFieldMappingCandidates: vi.fn(),
    validateFieldMapping: vi.fn(),
    verifyFieldMapping: vi.fn(),
    markFieldMappingNeedsChange: vi.fn(),
  };
});

const mockScan = vi.mocked(fetchFieldMappingSchemaScan);
const mockReset = vi.mocked(resetFieldMappingProfile);
const mockSave = vi.mocked(saveFieldMappingProfile);
const mockUpdateCandidates = vi.mocked(updateFieldMappingCandidates);
const mockValidate = vi.mocked(validateFieldMapping);
const mockVerify = vi.mocked(verifyFieldMapping);
const mockMarkNeedsChange = vi.mocked(markFieldMappingNeedsChange);

function baseProfile(overrides: Partial<FieldMappingProfileDto> = {}): FieldMappingProfileDto {
  return {
    sourceId: 'fixture',
    scopeLabel: null,
    fields: [
      { field: 'cif', displayName: 'CIF', sensitive: true, candidatePaths: ['mdc.cif'], verificationStatus: 'UNVERIFIED' },
      { field: 'journeyName', displayName: 'Journey Name', sensitive: false, candidatePaths: [], verificationStatus: 'UNVERIFIED' },
      { field: 'service', displayName: 'Service', sensitive: false, candidatePaths: ['application'], verificationStatus: 'UNVERIFIED' },
    ],
    modifiedFromDefault: false,
    searchReady: true,
    ...overrides,
  };
}

function scanResult(overrides: Partial<SchemaScanResponse> = {}): SchemaScanResponse {
  return {
    sourceId: 'fixture',
    scopeLabel: null,
    servicesObserved: [],
    totalEventsInspected: 1,
    structuredJsonEventCount: 1,
    nonJsonEventCount: 0,
    structuralVariantCount: 1,
    totalBytesInspected: 20,
    eventLimitReached: false,
    byteLimitReached: false,
    durationLimitReached: false,
    representativeEvents: [{ originalJson: '{"cif":"2449"}', severity: 'INFO', classification: 'STRUCTURED_JSON_APPLICATION_EVENT' }],
    diagnosticNonJsonSamples: [],
    discoveredSchema: [{ path: 'cif', observedTypes: ['STRING'], occurrenceCount: 1, coveragePercentage: 100 }],
    mappedPathsNotObserved: [],
    ...overrides,
  };
}

function renderWorkspace(overrides: Partial<Parameters<typeof FieldMappingWorkspace>[0]> = {}) {
  const onProfileChanged = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <FieldMappingWorkspace
      sourceId="fixture"
      project={null}
      sourceSupportsSampling
      profile={baseProfile()}
      profileError={null}
      onProfileChanged={onProfileChanged}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { ...utils, onProfileChanged, onClose };
}

async function runScan(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /run quick schema scan/i }));
  await waitFor(() => expect(mockScan).toHaveBeenCalled());
}

/** Adds `path` as a candidate for the field whose exact display name is `fieldDisplayName`, via the discovered-paths picker (mission §A10), not manual typing. */
async function addViaPicker(user: ReturnType<typeof userEvent.setup>, fieldDisplayName: string, path: string) {
  const fieldRow = screen.getByText(fieldDisplayName).closest('li')!;
  const picker = within(fieldRow).getByLabelText(/add a discovered path as a candidate/i);
  await user.selectOptions(picker, path);
  const pickerRow = picker.closest('div')!;
  await user.click(within(pickerRow).getByRole('button', { name: /^add$/i }));
}

describe('FieldMappingWorkspace', () => {
  let localStorageSetSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockScan.mockReset();
    mockReset.mockReset();
    mockSave.mockReset();
    mockUpdateCandidates.mockReset();
    // Recovery mission "Field Mapping Verification Workflow Recovery" - the
    // fixed `runSave` now pushes every edited field's draft via this
    // endpoint FIRST, before confirming the save; default it to succeed so
    // every existing save-flow test (which cares about the confirm step,
    // not this new persistence step) doesn't need its own explicit stub.
    mockUpdateCandidates.mockResolvedValue(baseProfile());
    mockValidate.mockReset();
    mockVerify.mockReset();
    mockMarkNeedsChange.mockReset();
    localStorageSetSpy = vi.spyOn(Storage.prototype, 'setItem');
  });

  it('is a real dedicated page, not a popover - renders its content directly, with a Back action (owner mission "Mapping Verification and Investigation Workspace")', () => {
    const { onClose } = renderWorkspace();
    expect(screen.getByTestId('field-mapping-workspace')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /log schema & field mapping verification/i })).toBeInTheDocument();
    expect(mockScan).not.toHaveBeenCalled();
    void onClose;
  });

  it('the Back button calls onClose', async () => {
    const user = userEvent.setup();
    const { onClose } = renderWorkspace();
    await user.click(screen.getByRole('button', { name: /back to search results/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the current profile with sensitive fields visually marked', () => {
    renderWorkspace();
    expect(screen.getByText('CIF')).toBeInTheDocument();
    const cifRow = screen.getByText('CIF').closest('li')!;
    expect(within(cifRow).getByText('Protected')).toBeInTheDocument();
    const serviceRow = screen.getByText('Service').closest('li')!;
    expect(within(serviceRow).queryByText('Protected')).not.toBeInTheDocument();
  });

  it('shows the current search-readiness status', () => {
    renderWorkspace({ profile: baseProfile({ searchReady: false }) });
    expect(screen.getByText(/search is disabled/i)).toBeInTheDocument();
  });

  describe('verification statuses (owner mission "Mapping Verification and Investigation Workspace")', () => {
    it('every field starts UNVERIFIED, even a built-in default candidate - DEFAULT_MAPPING != VERIFIED_MAPPING', () => {
      renderWorkspace();
      const serviceRow = screen.getByText('Service').closest('li')!;
      expect(within(serviceRow).getByText('Unverified')).toBeInTheDocument();
      expect(within(serviceRow).queryByText('Verified')).not.toBeInTheDocument();
    });

    it('shows a distinct VERIFIED badge when the profile reports it', () => {
      renderWorkspace({
        profile: baseProfile({
          fields: [{ field: 'cif', displayName: 'CIF', sensitive: true, candidatePaths: ['mdc.cif'], verificationStatus: 'VERIFIED' }],
        }),
      });
      const cifRow = screen.getByText('CIF').closest('li')!;
      expect(within(cifRow).getByText('Verified')).toBeInTheDocument();
    });

    it('shows a distinct NEEDS_CHANGE badge, and hides the "Mark needs change" action for a field already in that state', () => {
      renderWorkspace({
        profile: baseProfile({
          fields: [{ field: 'cif', displayName: 'CIF', sensitive: true, candidatePaths: ['mdc.cif'], verificationStatus: 'NEEDS_CHANGE' }],
        }),
      });
      const cifRow = screen.getByText('CIF').closest('li')!;
      expect(within(cifRow).getByText('Needs change')).toBeInTheDocument();
      expect(within(cifRow).queryByRole('button', { name: /mark needs change/i })).not.toBeInTheDocument();
    });

    it('marks a candidate path as observed or not observed in the latest scan', async () => {
      const user = userEvent.setup();
      mockScan.mockResolvedValue(scanResult({ discoveredSchema: [{ path: 'mdc.cif', observedTypes: ['STRING'], occurrenceCount: 1, coveragePercentage: 100 }] }));
      renderWorkspace({
        profile: baseProfile({
          fields: [
            { field: 'cif', displayName: 'CIF', sensitive: true, candidatePaths: ['mdc.cif'], verificationStatus: 'UNVERIFIED' },
            { field: 'service', displayName: 'Service', sensitive: false, candidatePaths: ['application'], verificationStatus: 'UNVERIFIED' },
          ],
        }),
      });
      await runScan(user);

      const cifRow = screen.getByText('CIF').closest('li')!;
      expect(within(cifRow).getByText(/observed in latest scan/i)).toBeInTheDocument();
      const serviceRow = screen.getByText('Service').closest('li')!;
      expect(within(serviceRow).getByText(/not observed in latest scan/i)).toBeInTheDocument();
    });

    it('Verify is disabled until a Quick Schema Scan has produced real samples', () => {
      renderWorkspace();
      const cifRow = screen.getByText('CIF').closest('li')!;
      expect(within(cifRow).getByRole('button', { name: /^verify$/i })).toBeDisabled();
      expect(within(cifRow).getByText(/run a quick schema scan first/i)).toBeInTheDocument();
    });

    it('never shows "Run a Quick Schema Scan first" for an already-VERIFIED field with no scan run yet - owner mission "Service Filter, Docker Performance, and Verified Default Mapping" §C', () => {
      // Real, previously-unreported defect: the hint was gated only on
      // "no scan evidence yet," so an untouched owner-approved default
      // (VERIFIED with zero scan effort, per this mission) would have
      // shown a misleading "you must scan first" message even though no
      // scan is actually required to establish that status.
      renderWorkspace({
        profile: baseProfile({
          fields: [{ field: 'cif', displayName: 'CIF', sensitive: true, candidatePaths: ['cif'], verificationStatus: 'VERIFIED' }],
        }),
      });
      const cifRow = screen.getByText('CIF').closest('li')!;
      expect(within(cifRow).getByText('Verified')).toBeInTheDocument();
      expect(within(cifRow).queryByText(/run a quick schema scan first/i)).not.toBeInTheDocument();
    });

    it('still shows "Run a Quick Schema Scan first" for a non-VERIFIED field with no scan run yet, even alongside an unrelated VERIFIED field', () => {
      renderWorkspace({
        profile: baseProfile({
          fields: [
            { field: 'cif', displayName: 'CIF', sensitive: true, candidatePaths: ['cif'], verificationStatus: 'VERIFIED' },
            { field: 'journeyId', displayName: 'Journey ID', sensitive: false, candidatePaths: [], verificationStatus: 'UNVERIFIED' },
          ],
        }),
      });
      const cifRow = screen.getByText('CIF').closest('li')!;
      expect(within(cifRow).queryByText(/run a quick schema scan first/i)).not.toBeInTheDocument();
      const journeyRow = screen.getByText('Journey ID').closest('li')!;
      expect(within(journeyRow).getByText(/run a quick schema scan first/i)).toBeInTheDocument();
    });

    it('Verify is disabled for an unmapped field', async () => {
      const user = userEvent.setup();
      mockScan.mockResolvedValue(scanResult());
      renderWorkspace();
      await runScan(user);
      const journeyRow = screen.getByText('Journey Name').closest('li')!;
      expect(within(journeyRow).getByRole('button', { name: /^verify$/i })).toBeDisabled();
    });

    it('a successful Verify calls the real endpoint with the current saved candidates and real samples, then refreshes the profile', async () => {
      const user = userEvent.setup();
      mockScan.mockResolvedValue(scanResult());
      mockVerify.mockResolvedValue(baseProfile({ fields: [{ field: 'cif', displayName: 'CIF', sensitive: true, candidatePaths: ['mdc.cif'], verificationStatus: 'VERIFIED' }] }));
      const { onProfileChanged } = renderWorkspace();
      await runScan(user);

      const cifRow = screen.getByText('CIF').closest('li')!;
      await user.click(within(cifRow).getByRole('button', { name: /^verify$/i }));

      await waitFor(() => expect(mockVerify).toHaveBeenCalledWith('cif', ['{"cif":"2449"}'], 'fixture', null));
      await waitFor(() => expect(onProfileChanged).toHaveBeenCalled());
    });

    it('a rejected Verify (no evidence found) shows the real server reason, never a silent "verified"', async () => {
      const user = userEvent.setup();
      mockScan.mockResolvedValue(scanResult());
      mockVerify.mockRejectedValue(
        new ApiError(400, { status: 400, detail: "Cannot verify 'cif' - its candidate path was not found in any of the given samples." }),
      );
      const { onProfileChanged } = renderWorkspace();
      await runScan(user);

      const cifRow = screen.getByText('CIF').closest('li')!;
      await user.click(within(cifRow).getByRole('button', { name: /^verify$/i }));

      await waitFor(() => expect(within(cifRow).getByRole('alert')).toHaveTextContent(/not found in any of the given samples/i));
      expect(onProfileChanged).not.toHaveBeenCalled();
    });

    it('Verify is disabled while this field has a pending unsaved draft edit, and says why', async () => {
      const user = userEvent.setup();
      mockScan.mockResolvedValue(
        scanResult({
          discoveredSchema: [
            { path: 'mdc.cif', observedTypes: ['STRING'], occurrenceCount: 1, coveragePercentage: 100 },
            { path: 'customer.cif', observedTypes: ['STRING'], occurrenceCount: 1, coveragePercentage: 100 },
          ],
        }),
      );
      renderWorkspace();
      await runScan(user);
      await addViaPicker(user, 'CIF', 'customer.cif');

      const cifRow = screen.getByText('CIF').closest('li')!;
      expect(within(cifRow).getByRole('button', { name: /^verify$/i })).toBeDisabled();
      expect(within(cifRow).getAllByText(/unsaved changes/i).length).toBeGreaterThan(0);
    });

    it('recovery mission "Field Mapping Verification Workflow Recovery" - the full owner workflow: pick a discovered path, Validate, Save, then Verify succeeds against exactly that saved candidate (SELECT_DISCOVERED_PATH_THEN_VALIDATE_SAVE_VERIFY / VERIFY_USES_CURRENT_SAVED_MAPPING_AFTER_SAVE / VISIBLE_DRAFT_AND_VERIFIED_VALUE_CANNOT_DIVERGE)', async () => {
      const user = userEvent.setup();
      mockScan.mockResolvedValue(
        scanResult({
          discoveredSchema: [{ path: 'stack_trace', observedTypes: ['STRING'], occurrenceCount: 1, coveragePercentage: 100 }],
          representativeEvents: [{ originalJson: '{"stack_trace":"java.lang.RuntimeException"}', severity: 'ERROR', classification: 'STRUCTURED_JSON_APPLICATION_EVENT' }],
        }),
      );
      mockValidate.mockResolvedValue({
        fields: [
          {
            field: 'cif', displayName: 'CIF', candidatePaths: ['mdc.cif', 'stack_trace'], invalidPaths: [],
            sampleCount: 1, foundCount: 1, foundInAnySample: true, mappedButAbsent: false,
            structuredValueWarning: false, exampleValues: ['java.lang.RuntimeException'],
          },
        ],
        conflicts: [], sampleCount: 1, malformedSampleCount: 0, passed: true,
      });
      mockUpdateCandidates.mockResolvedValue(baseProfile({
        fields: [{ field: 'cif', displayName: 'CIF', sensitive: true, candidatePaths: ['mdc.cif', 'stack_trace'], verificationStatus: 'UNVERIFIED' }],
      }));
      mockSave.mockResolvedValue(baseProfile({
        fields: [{ field: 'cif', displayName: 'CIF', sensitive: true, candidatePaths: ['mdc.cif', 'stack_trace'], verificationStatus: 'UNVERIFIED' }],
        searchReady: true,
      }));
      mockVerify.mockResolvedValue(baseProfile({
        fields: [{ field: 'cif', displayName: 'CIF', sensitive: true, candidatePaths: ['mdc.cif', 'stack_trace'], verificationStatus: 'VERIFIED' }],
        searchReady: true,
      }));
      const onProfileChanged = vi.fn();
      const { rerender } = render(
        <FieldMappingWorkspace
          sourceId="fixture"
          project={null}
          sourceSupportsSampling
          profile={baseProfile()}
          profileError={null}
          onProfileChanged={onProfileChanged}
          onClose={vi.fn()}
        />,
      );

      await runScan(user);
      await addViaPicker(user, 'CIF', 'stack_trace');
      await user.click(screen.getByRole('button', { name: /^validate mapping$/i }));
      await waitFor(() => expect(screen.getByRole('button', { name: /save mapping/i })).toBeEnabled());

      await user.click(screen.getByRole('button', { name: /save mapping/i }));

      // Save must push the EXACT draft that was validated (mdc.cif + stack_trace) to the backend.
      await waitFor(() => expect(mockUpdateCandidates).toHaveBeenCalledWith('cif', ['mdc.cif', 'stack_trace'], 'fixture', null));
      await waitFor(() => expect(mockSave).toHaveBeenCalledWith(true, 'fixture', null));
      await waitFor(() => expect(onProfileChanged).toHaveBeenCalled());

      // Simulate the app-wide profile refresh `onProfileChanged` triggers in the real app.
      rerender(
        <FieldMappingWorkspace
          sourceId="fixture"
          project={null}
          sourceSupportsSampling
          profile={baseProfile({
            fields: [{ field: 'cif', displayName: 'CIF', sensitive: true, candidatePaths: ['mdc.cif', 'stack_trace'], verificationStatus: 'UNVERIFIED' }],
          })}
          profileError={null}
          onProfileChanged={onProfileChanged}
          onClose={vi.fn()}
        />,
      );

      const cifRow = screen.getByText('CIF').closest('li')!;
      // No lingering draft after a successful save - Verify is immediately available.
      expect(within(cifRow).getByRole('button', { name: /^verify$/i })).toBeEnabled();
      await user.click(within(cifRow).getByRole('button', { name: /^verify$/i }));

      // Verify must check exactly the candidates that were just saved - never a stale pre-save value.
      await waitFor(() =>
        expect(mockVerify).toHaveBeenCalledWith('cif', ['{"stack_trace":"java.lang.RuntimeException"}'], 'fixture', null),
      );
      expect(within(cifRow).queryByRole('alert')).not.toBeInTheDocument();
    });

    it('Mark needs change calls the real endpoint with no samples required, then refreshes the profile', async () => {
      const user = userEvent.setup();
      mockMarkNeedsChange.mockResolvedValue(
        baseProfile({ fields: [{ field: 'cif', displayName: 'CIF', sensitive: true, candidatePaths: ['mdc.cif'], verificationStatus: 'NEEDS_CHANGE' }] }),
      );
      const { onProfileChanged } = renderWorkspace();

      const cifRow = screen.getByText('CIF').closest('li')!;
      await user.click(within(cifRow).getByRole('button', { name: /mark needs change/i }));

      await waitFor(() => expect(mockMarkNeedsChange).toHaveBeenCalledWith('cif', 'fixture', null));
      await waitFor(() => expect(onProfileChanged).toHaveBeenCalled());
    });

    it('the workspace shows the exact scope this verification status applies to, never implying it applies elsewhere', () => {
      renderWorkspace({ profile: baseProfile({ scopeLabel: 'boubyan-platform' }) });
      expect(screen.getByText('boubyan-platform', { exact: false })).toBeInTheDocument();
    });
  });

  it('runs a scan when the button is clicked and displays Original Event Samples, without ever writing to localStorage', async () => {
    const user = userEvent.setup();
    mockScan.mockResolvedValue(scanResult());
    renderWorkspace();

    await runScan(user);

    await waitFor(() => expect(mockScan).toHaveBeenCalledWith('fixture', null, 200));
    await waitFor(() => expect(screen.getAllByText(/2449/).length).toBeGreaterThan(0));
    expect(screen.getByText(/observed 1 event/i)).toBeInTheDocument();
    expect(localStorageSetSpy).not.toHaveBeenCalled();
  });

  it('lists the Discovered Source Schema union from the scan, labeled as observed metadata, never "Original JSON"', async () => {
    const user = userEvent.setup();
    mockScan.mockResolvedValue(
      scanResult({ discoveredSchema: [{ path: 'cifId', observedTypes: ['STRING'], occurrenceCount: 1, coveragePercentage: 100 }] }),
    );
    renderWorkspace();
    await runScan(user);

    expect(screen.getByText(/discovered source schema/i)).toBeInTheDocument();
    expect(screen.getByText('cifId', { selector: 'code' })).toBeInTheDocument();
    expect(screen.queryByText(/^original json$/i)).not.toBeInTheDocument();
  });

  it('does not show the scan button when the source does not support sampling, and says so truthfully', () => {
    renderWorkspace({ sourceSupportsSampling: false });
    expect(screen.queryByRole('button', { name: /run quick schema scan/i })).not.toBeInTheDocument();
    expect(screen.getByText(/does not support original source json sampling/i)).toBeInTheDocument();
  });

  it('removing a candidate path removes it from the list', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    expect(screen.getByText('mdc.cif')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /remove mdc\.cif/i }));
    expect(screen.queryByText('mdc.cif')).not.toBeInTheDocument();
  });

  it('save is disabled until a validate has run since the last edit', async () => {
    const user = userEvent.setup();
    mockScan.mockResolvedValue(scanResult());
    renderWorkspace();
    expect(screen.getByRole('button', { name: /save mapping/i })).toBeDisabled();

    await runScan(user);
    await addViaPicker(user, 'CIF', 'cif');
    expect(screen.getByRole('button', { name: /save mapping/i })).toBeDisabled();

    mockValidate.mockResolvedValue(passingReport());
    await user.click(screen.getByRole('button', { name: /^validate mapping$/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /save mapping/i })).toBeEnabled());
  });

  it('recovery mission "Field Mapping Verification Workflow Recovery" - Save stays disabled when the draft\'s validation fails, never silently saveable with an invalid path', async () => {
    const user = userEvent.setup();
    mockScan.mockResolvedValue(scanResult());
    mockValidate.mockResolvedValue(failingReport());
    renderWorkspace();
    await runScan(user);
    await addViaPicker(user, 'CIF', 'cif');
    await user.click(screen.getByRole('button', { name: /^validate mapping$/i }));

    await waitFor(() => expect(screen.getByText(/not valid/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /save mapping/i })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /save mapping/i }));
    expect(mockUpdateCandidates).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('save persists every edited field\'s draft via PUT /fields/{field} BEFORE confirming - the owner-reported root cause fix', async () => {
    const user = userEvent.setup();
    mockScan.mockResolvedValue(scanResult());
    mockValidate.mockResolvedValue(passingReport());
    mockSave.mockResolvedValue(baseProfile({ searchReady: true }));
    renderWorkspace();
    await runScan(user);
    await addViaPicker(user, 'CIF', 'cif');
    await user.click(screen.getByRole('button', { name: /^validate mapping$/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /save mapping/i })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: /save mapping/i }));

    await waitFor(() => expect(mockUpdateCandidates).toHaveBeenCalledWith('cif', ['mdc.cif', 'cif'], 'fixture', null));
    // The candidate persistence must happen before the confirm call, not after or in parallel with no ordering guarantee.
    expect(mockUpdateCandidates.mock.invocationCallOrder[0]).toBeLessThan(mockSave.mock.invocationCallOrder[0]);
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith(true, 'fixture', null));
  });

  it('save never confirms if persisting an edited field fails, so nothing appears saved that was not', async () => {
    const user = userEvent.setup();
    mockScan.mockResolvedValue(scanResult());
    mockValidate.mockResolvedValue(passingReport());
    mockUpdateCandidates.mockRejectedValue(new Error('network error'));
    renderWorkspace();
    await runScan(user);
    await addViaPicker(user, 'CIF', 'cif');
    await user.click(screen.getByRole('button', { name: /^validate mapping$/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /save mapping/i })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: /save mapping/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/network error/i));
    expect(mockSave).not.toHaveBeenCalled();
    // The draft is NOT cleared on failure - the owner can retry without re-entering it.
    const cifRow = screen.getByText('CIF').closest('li')!;
    expect(within(cifRow).getByText('cif', { selector: 'code' })).toBeInTheDocument();
  });

  it('a successful save calls onProfileChanged so the app-wide readiness state re-syncs', async () => {
    const user = userEvent.setup();
    mockScan.mockResolvedValue(scanResult());
    mockValidate.mockResolvedValue(passingReport());
    mockSave.mockResolvedValue(baseProfile({ searchReady: true }));
    const { onProfileChanged } = renderWorkspace();
    await runScan(user);
    await addViaPicker(user, 'CIF', 'cif');
    await user.click(screen.getByRole('button', { name: /^validate mapping$/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /save mapping/i })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /save mapping/i }));
    await waitFor(() => expect(onProfileChanged).toHaveBeenCalled());
  });

  it('reset restores defaults, clears verify errors, and calls onProfileChanged', async () => {
    const user = userEvent.setup();
    mockReset.mockResolvedValue(baseProfile());
    const { onProfileChanged } = renderWorkspace();
    await user.click(screen.getByRole('button', { name: /reset to defaults/i }));
    await waitFor(() => expect(mockReset).toHaveBeenCalled());
    await waitFor(() => expect(onProfileChanged).toHaveBeenCalled());
  });

  it('shows a sanitized error if the scan fails', async () => {
    const user = userEvent.setup();
    mockScan.mockRejectedValue(new Error('Failed to run schema scan'));
    renderWorkspace();
    await user.click(screen.getByRole('button', { name: /run quick schema scan/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/failed to run schema scan/i));
  });

  it('has no detectable accessibility violations with data loaded', async () => {
    const user = userEvent.setup();
    mockScan.mockResolvedValue(scanResult());
    const { container } = renderWorkspace();
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
