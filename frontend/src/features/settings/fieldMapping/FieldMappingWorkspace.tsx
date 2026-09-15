import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../../../shared/ui/Button';
import {
  fetchFieldMappingSchemaScan,
  markFieldMappingNeedsChange,
  resetFieldMappingProfile,
  saveFieldMappingProfile,
  updateFieldMappingCandidates,
  validateFieldMapping,
  verifyFieldMapping,
} from '../../../shared/api/client';
import type {
  CanonicalFieldKey,
  CanonicalFieldMapping,
  FieldMappingProfileDto,
  FieldMappingValidationReport,
  FieldVerificationStatus,
  SchemaScanResponse,
} from '../../../shared/api/types';
import styles from './FieldMappingWorkspace.module.css';

export interface FieldMappingWorkspaceProps {
  /** The currently selected source's id, or `null` when none is selected yet. */
  sourceId: string | null;
  /**
   * Owner mission "Project-Scoped Schema Scan" §1/§7/§8 — the currently
   * selected Compose project (Docker) or resolved OpenShift project/
   * namespace, or `null` for a source with no sub-project concept or none
   * selected yet. Threaded onto every scan/settings/verification call so
   * they always operate on the SAME scope — never an indiscriminate
   * whole-source scan, never a silently-reused mapping or verification
   * status from a different project (owner mission "Mapping Verification
   * and Investigation Workspace" - `PROJECT_SCOPED_VERIFICATION`).
   */
  project: string | null;
  /** `SourceCapabilities.originalSchemaSampling` for the currently selected source — never inferred from id/name. */
  sourceSupportsSampling: boolean;
  /** The already-loaded field-mapping profile for this exact scope (fetched app-wide — see `useSearchState`'s `fieldMappingProfile`). */
  profile: FieldMappingProfileDto | null;
  profileError: string | null;
  /** Re-fetches the app-wide profile/readiness/verification-status state for the current scope — called after any edit/save/reset/verify/needs-change here so `Toolbar`'s Search gate and this workspace's own badges reflect it immediately, without a page reload. */
  onProfileChanged: () => void;
  /** Owner mission "Mapping Verification and Investigation Workspace" - returns to whatever was on screen before this workspace was opened, mirroring `JourneyView`'s "← Back to search results" pattern. */
  onClose: () => void;
}

const DEFAULT_SCAN_MAX_EVENTS = 200;

/**
 * The Mapping Verification workspace (owner mission "Mapping Verification
 * and Investigation Workspace" - Part A). A real, dedicated full-page
 * workspace — NOT a hidden popover/implementation detail (the mission's own
 * explicit requirement) — replacing `ResultsPanel`/`JourneyView` in
 * `App.tsx`'s mutually-exclusive overlay slot exactly the way `JourneyView`
 * already does, rather than living tucked inside `Shell`'s settings row.
 *
 * <p>Builds directly on the prior "Configurable Log Field Mapping" +
 * "Project-Scoped Schema Scan" missions' scan/candidate-editor/validate/
 * save/reset mechanics (unchanged below) — this mission adds ONLY the
 * verification layer on top: a status badge per field (`UNVERIFIED` /
 * `VERIFIED` / `NEEDS_CHANGE`), "observed in latest schema scan" per
 * candidate path, and the Verify / Mark needs-change actions.
 * `DEFAULT_MAPPING != VERIFIED_MAPPING`: every field starts `UNVERIFIED`
 * even when it carries the built-in default candidate — Verify is
 * evidence-gated server-side (re-validates the CURRENT candidates against
 * real samples; rejects with 400 if not found in any), never a client-only
 * checkbox, and is never triggered automatically by a save.
 *
 * <p><b>Security (mission §4/§20, carried forward):</b> the scan's Original
 * Event Samples and the validation report's real example values live ONLY
 * in this component's own `useState` — never `localStorage`/`sessionStorage`/
 * a URL, never logged, discarded the moment this workspace closes or the
 * page reloads. There is no caching layer here by design.
 */
export function FieldMappingWorkspace({
  sourceId,
  project,
  sourceSupportsSampling,
  profile,
  profileError,
  onProfileChanged,
  onClose,
}: FieldMappingWorkspaceProps) {
  const headingId = useId();
  const datalistId = useId();

  // Ephemeral only — never persisted (mission §4/§20).
  const [scanResult, setScanResult] = useState<SchemaScanResponse | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [selectedSampleIndex, setSelectedSampleIndex] = useState(0);

  // Mission §A9 rescan-safety: diffed against the PREVIOUS scan's own
  // discovered paths (never against the saved mapping) - held only in a
  // ref, since it must survive a rescan overwriting `scanResult` without
  // itself ever being written back to any server state.
  const previousScanPathsRef = useRef<Set<string> | null>(null);
  const [newlyDiscoveredPaths, setNewlyDiscoveredPaths] = useState<string[]>([]);
  const [disappearedPaths, setDisappearedPaths] = useState<string[]>([]);

  const discovered = scanResult?.discoveredSchema ?? [];
  const discoveredPathStrings = discovered.map((d) => d.path);

  // Only fields the user has actually edited this session — every other
  // field falls back to `profile`'s own last-saved candidates, both for
  // display and for what gets sent to /validate (mission's own API
  // contract: omitted fields validate against their current candidates).
  const [drafts, setDrafts] = useState<Partial<Record<CanonicalFieldKey, string[]>>>({});
  const [newCandidateText, setNewCandidateText] = useState<Partial<Record<CanonicalFieldKey, string>>>({});
  // Mission §A10: a picker over discovered paths is the normal way to add
  // a candidate; manual typing (`newCandidateText` above) remains as an
  // advanced fallback.
  const [pickerSelection, setPickerSelection] = useState<Partial<Record<CanonicalFieldKey, string>>>({});

  const [validationReport, setValidationReport] = useState<FieldMappingValidationReport | null>(null);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Owner mission "Mapping Verification and Investigation Workspace" -
  // per-field in-flight/error state for Verify / Mark needs-change, kept
  // separate from `actionError` (a scan/save/reset-wide error) since a
  // rejected verify ("not found in any sample") is specific to one field
  // and must not be misread as blocking the whole workspace.
  const [verifyingField, setVerifyingField] = useState<CanonicalFieldKey | null>(null);
  const [markingNeedsChangeField, setMarkingNeedsChangeField] = useState<CanonicalFieldKey | null>(null);
  const [verifyErrors, setVerifyErrors] = useState<Partial<Record<CanonicalFieldKey, string>>>({});

  // Mission §8 (carried forward): changing the selected project/namespace
  // means every scan/draft/validation result belongs to a scope that no
  // longer applies - never silently carry a scan or an in-progress edit
  // from one project's context into another's.
  useEffect(() => {
    setScanResult(null);
    setScanError(null);
    setSelectedSampleIndex(0);
    previousScanPathsRef.current = null;
    setNewlyDiscoveredPaths([]);
    setDisappearedPaths([]);
    setDrafts({});
    setNewCandidateText({});
    setPickerSelection({});
    setValidationReport(null);
    setActionError(null);
    setVerifyErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId, project]);

  function candidatesFor(field: CanonicalFieldKey, savedCandidates: string[]): string[] {
    return drafts[field] ?? savedCandidates;
  }

  function editField(field: CanonicalFieldKey, next: string[]) {
    setDrafts((prev) => ({ ...prev, [field]: next }));
    setValidationReport(null); // any edit invalidates the last validate result (mission §15)
  }

  function addCandidate(field: CanonicalFieldKey, savedCandidates: string[]) {
    const text = (newCandidateText[field] ?? '').trim();
    if (!text) {
      return;
    }
    editField(field, [...candidatesFor(field, savedCandidates), text]);
    setNewCandidateText((prev) => ({ ...prev, [field]: '' }));
  }

  /** Mission §A10: adds the path currently selected in the discovered-paths picker for this field. */
  function addPickedCandidate(field: CanonicalFieldKey, savedCandidates: string[]) {
    const picked = (pickerSelection[field] ?? '').trim();
    if (!picked) {
      return;
    }
    editField(field, [...candidatesFor(field, savedCandidates), picked]);
    setPickerSelection((prev) => ({ ...prev, [field]: '' }));
  }

  function removeCandidate(field: CanonicalFieldKey, savedCandidates: string[], index: number) {
    const current = candidatesFor(field, savedCandidates);
    editField(field, current.filter((_, i) => i !== index));
  }

  function moveCandidate(field: CanonicalFieldKey, savedCandidates: string[], index: number, direction: -1 | 1) {
    const current = [...candidatesFor(field, savedCandidates)];
    const target = index + direction;
    if (target < 0 || target >= current.length) {
      return;
    }
    [current[index], current[target]] = [current[target], current[index]];
    editField(field, current);
  }

  /**
   * Runs a Quick Schema Scan (mission §A). Safe to call repeatedly as
   * "Rescan" — it only ever reads; it never touches the saved mapping
   * (mission §A9). On each call, the newly-discovered/disappeared path
   * diff is computed against the PREVIOUS scan's own discovered paths
   * (never against the saved mapping profile, which is a separate,
   * server-computed cross-reference already carried on the result as
   * `mappedPathsNotObserved`).
   */
  function runScan() {
    if (!sourceId) {
      return;
    }
    setScanning(true);
    setScanError(null);
    fetchFieldMappingSchemaScan(sourceId, project, DEFAULT_SCAN_MAX_EVENTS)
      .then((result) => {
        const previousPaths = previousScanPathsRef.current;
        const currentPaths = new Set(result.discoveredSchema.map((d) => d.path));
        if (previousPaths) {
          setNewlyDiscoveredPaths([...currentPaths].filter((p) => !previousPaths.has(p)));
          setDisappearedPaths([...previousPaths].filter((p) => !currentPaths.has(p)));
        } else {
          setNewlyDiscoveredPaths([]);
          setDisappearedPaths([]);
        }
        previousScanPathsRef.current = currentPaths;
        setScanResult(result);
        setSelectedSampleIndex(0);
        setValidationReport(null); // last validation ran against a now-stale sample set
      })
      .catch((error: unknown) => setScanError(error instanceof Error ? error.message : 'Failed to run schema scan'))
      .finally(() => setScanning(false));
  }

  function runValidate() {
    setValidating(true);
    setActionError(null);
    const rawSamples = (scanResult?.representativeEvents ?? []).map((s) => s.originalJson);
    validateFieldMapping(drafts, rawSamples, sourceId ?? undefined, project)
      .then(setValidationReport)
      .catch((error: unknown) => setActionError(error instanceof Error ? error.message : 'Validation failed'))
      .finally(() => setValidating(false));
  }

  /**
   * Owner-reported recovery mission "Field Mapping Verification Workflow
   * Recovery" - ROOT CAUSE FIX. `/validate` is stateless (it only ever
   * checks `drafts` against real samples and returns a report - it never
   * mutates the backend's active profile) and `/save` only flips the
   * "validated and saved" readiness flag - it never touches candidate
   * paths either. The ONLY endpoint that actually mutates the active
   * profile's candidates is `PUT /fields/{field}`
   * (`updateFieldMappingCandidates`). Before this fix, clicking "Save"
   * called `/save` directly and never called that endpoint at all, so the
   * owner's newly-picked discovered path was validated and shown as
   * "Found: <value>" but NEVER actually persisted - the backend's saved
   * profile silently kept its old candidate. Verify (which reads the
   * saved/active profile, by design - see `runVerify`'s own doc comment)
   * then correctly rejected the STILL-OLD candidate, producing the exact
   * "not found in any of the given samples" contradiction the owner saw
   * even though the UI had just shown that same path as observed with a
   * real sample value.
   *
   * <p>The fix: push every edited field's current draft to the backend via
   * `PUT /fields/{field}` FIRST - the same draft that was just validated,
   * unchanged, so what gets persisted is exactly what the owner reviewed -
   * and only then confirm the save. If any field's push fails, nothing is
   * cleared and the owner can retry; drafts are only cleared once the
   * whole sequence (persist every edited field, then confirm) succeeds.
   * This closes the circular dependency the mission describes: Edit -&gt;
   * Validate (checks the draft) -&gt; Save (now genuinely persists that same
   * draft) -&gt; Verify (now genuinely checks what was just saved).
   */
  function runSave() {
    if (!validationReport || !validationReport.passed) {
      return; // Save stays disabled until a PASSING validation exists — defensive no-op
    }
    setSaving(true);
    setActionError(null);
    const editedFields = Object.entries(drafts) as [CanonicalFieldKey, string[]][];
    Promise.all(
      editedFields.map(([field, candidatePaths]) =>
        updateFieldMappingCandidates(field, candidatePaths, sourceId ?? undefined, project),
      ),
    )
      .then(() => saveFieldMappingProfile(validationReport.passed, sourceId ?? undefined, project))
      .then(() => {
        setDrafts({});
        setValidationReport(null);
        onProfileChanged();
      })
      .catch((error: unknown) => setActionError(error instanceof Error ? error.message : 'Save failed'))
      .finally(() => setSaving(false));
  }

  function runReset() {
    setResetting(true);
    setActionError(null);
    resetFieldMappingProfile(sourceId ?? undefined, project)
      .then(() => {
        setDrafts({});
        setValidationReport(null);
        setVerifyErrors({});
        onProfileChanged();
      })
      .catch((error: unknown) => setActionError(error instanceof Error ? error.message : 'Reset failed'))
      .finally(() => setResetting(false));
  }

  /**
   * Owner mission "Mapping Verification and Investigation Workspace" -
   * evidence-based Verify: sends the real Original Event Samples from the
   * latest scan and lets the backend re-check the field's CURRENT (saved,
   * active) candidate against them — never trusts a client-side claim.
   * Deliberately uses `field.candidatePaths` (the saved value), not any
   * pending unsaved draft: the button itself is disabled while a draft is
   * pending for this field (see `FieldEditorRow` below) so this is never
   * reachable in that state. Since the recovery-mission fix to `runSave`
   * (its own doc comment has the full root-cause explanation), the saved
   * value Verify checks here is now genuinely what the owner most recently
   * reviewed and saved — not a stale, never-actually-persisted candidate.
   */
  function runVerify(field: CanonicalFieldKey) {
    setVerifyingField(field);
    setVerifyErrors((prev) => ({ ...prev, [field]: undefined }));
    const rawSamples = (scanResult?.representativeEvents ?? []).map((s) => s.originalJson);
    verifyFieldMapping(field, rawSamples, sourceId ?? undefined, project)
      .then(() => onProfileChanged())
      .catch((error: unknown) => {
        // `ApiError`'s own message is the backend's specific evidence-gate
        // rejection reason (e.g. "not found in any of the given samples") -
        // exactly what the owner needs to see to fix the candidate, never a
        // generic "verification failed".
        const message = error instanceof Error ? error.message : 'Verification failed';
        setVerifyErrors((prev) => ({ ...prev, [field]: message }));
      })
      .finally(() => setVerifyingField(null));
  }

  /** Owner mission "Mapping Verification and Investigation Workspace" - an explicit, no-evidence-required owner flag; never auto-inferred. */
  function runMarkNeedsChange(field: CanonicalFieldKey) {
    setMarkingNeedsChangeField(field);
    markFieldMappingNeedsChange(field, sourceId ?? undefined, project)
      .then(() => onProfileChanged())
      .catch((error: unknown) => setActionError(error instanceof Error ? error.message : 'Marking as needs-change failed'))
      .finally(() => setMarkingNeedsChangeField(null));
  }

  const hasUnsavedEdits = Object.keys(drafts).length > 0;
  /**
   * Recovery mission requirement: "Save must be enabled when: there are
   * unsaved edits AND current draft validation passes." Previously this
   * only checked that a validation report EXISTED, not that it PASSED —
   * a failed validation (an invalid path) could still be "saved," which
   * only ever meant confirmSave persisted `validationPassed: false` (still
   * blocking search), silently, with no clear signal to the owner about
   * why nothing actually became ready.
   */
  const canSave = hasUnsavedEdits && validationReport != null && validationReport.passed && !saving;

  function reportFor(field: CanonicalFieldKey) {
    return validationReport?.fields.find((f) => f.field === field) ?? null;
  }

  return (
    <div className={styles.wrapper} data-testid="field-mapping-workspace">
      <div className={styles.header}>
        <Button variant="ghost" onClick={onClose}>
          ← Back to search results
        </Button>
        <h1 id={headingId} className={styles.title}>
          Log Schema &amp; Field Mapping Verification
        </h1>
      </div>
      <p className={styles.hint}>
        Map each canonical field to the real JSON path(s) your source uses, then verify it against real evidence.
        Search is blocked until an edited mapping is validated and saved — the built-in default mapping always stays
        search-ready. A saved mapping being search-ready is not the same as it being <strong>verified</strong>: an
        inherited default candidate starts <strong>Unverified</strong> until you confirm it against real evidence.
      </p>

      {profileError ? (
        <p role="alert" className={styles.error}>
          {profileError}
        </p>
      ) : null}

      {profile ? (
        <>
          <p role="status" className={profile.searchReady ? styles.readyStatus : styles.notReadyStatus}>
            {profile.searchReady
              ? 'Search ready.'
              : 'Search is disabled — configure and validate log field mapping before searching this source.'}
          </p>
          {profile.scopeLabel ? (
            <p className={styles.hint}>
              Showing the mapping and verification status for <strong>{profile.scopeLabel}</strong> only — never
              implied verified for any other project or namespace.
            </p>
          ) : null}

          <section className={styles.section}>
            <h2 className={styles.subheading}>1. Quick Schema Scan</h2>
            {sourceSupportsSampling ? (
              <>
                <Button variant="secondary" onClick={runScan} disabled={scanning || !sourceId}>
                  {scanning ? 'Scanning…' : scanResult ? 'Rescan' : `Run Quick Schema Scan (up to ${DEFAULT_SCAN_MAX_EVENTS} events)`}
                </Button>
                {scanError ? (
                  <p role="alert" className={styles.error}>
                    {scanError}
                  </p>
                ) : null}

                {scanResult ? (
                  <>
                    <p className={styles.scanStats}>
                      Selected scope: <strong>{scanResult.scopeLabel ?? 'All (no project selected)'}</strong>.
                      {scanResult.servicesObserved.length > 0
                        ? ` Services observed: ${scanResult.servicesObserved.join(', ')}.`
                        : ''}
                    </p>
                    <p className={styles.scanStats}>
                      Observed {scanResult.totalEventsInspected} event
                      {scanResult.totalEventsInspected === 1 ? '' : 's'} ({scanResult.structuredJsonEventCount}{' '}
                      structured JSON
                      {scanResult.nonJsonEventCount > 0
                        ? `, ${scanResult.nonJsonEventCount} non-JSON/malformed excluded from the schema below`
                        : ''}
                      , {scanResult.structuralVariantCount} structural variant
                      {scanResult.structuralVariantCount === 1 ? '' : 's'}). This is the{' '}
                      <strong>observed</strong> schema from this scan, not a guaranteed-complete one — a source may
                      still emit shapes this scan didn't happen to see.
                    </p>
                    {scanResult.eventLimitReached || scanResult.byteLimitReached || scanResult.durationLimitReached ? (
                      <p className={styles.scanBoundNotice}>
                        Scan stopped early:{' '}
                        {[
                          scanResult.eventLimitReached ? 'event limit reached' : null,
                          scanResult.byteLimitReached ? 'byte limit reached' : null,
                          scanResult.durationLimitReached ? 'time limit reached' : null,
                        ]
                          .filter(Boolean)
                          .join(', ')}
                        .
                      </p>
                    ) : null}

                    {newlyDiscoveredPaths.length > 0 || disappearedPaths.length > 0 ? (
                      <div role="status" className={styles.warningBanner}>
                        {newlyDiscoveredPaths.length > 0 ? (
                          <p>Newly discovered since the last scan: {newlyDiscoveredPaths.map((p) => <code key={p}>{p}</code>)}</p>
                        ) : null}
                        {disappearedPaths.length > 0 ? (
                          <p>No longer observed since the last scan: {disappearedPaths.map((p) => <code key={p}>{p}</code>)}</p>
                        ) : null}
                      </div>
                    ) : null}

                    {scanResult.mappedPathsNotObserved.length > 0 ? (
                      <div role="alert" className={styles.warningBanner}>
                        <p>
                          Saved mapping path{scanResult.mappedPathsNotObserved.length === 1 ? '' : 's'} not observed in
                          this scan: {scanResult.mappedPathsNotObserved.map((p) => <code key={p}>{p}</code>)}. The
                          saved mapping is unchanged — review and re-save only if you want to update it.
                        </p>
                      </div>
                    ) : null}

                    {scanResult.representativeEvents.length > 0 ? (
                      <div className={styles.samplesArea}>
                        <label htmlFor={`${headingId}-sample-select`}>
                          {scanResult.representativeEvents.length} representative Original Event Sample
                          {scanResult.representativeEvents.length === 1 ? '' : 's'} (real, unmasked — never
                          persisted)
                        </label>
                        <select
                          id={`${headingId}-sample-select`}
                          value={selectedSampleIndex}
                          onChange={(event) => setSelectedSampleIndex(Number(event.target.value))}
                        >
                          {scanResult.representativeEvents.map((sample, index) => (
                            <option key={index} value={index}>
                              Sample {index + 1} — {sample.severity}
                            </option>
                          ))}
                        </select>
                        <pre className={styles.samplePreview}>
                          {formatJson(scanResult.representativeEvents[selectedSampleIndex]?.originalJson ?? '')}
                        </pre>
                      </div>
                    ) : null}

                    {scanResult.diagnosticNonJsonSamples.length > 0 ? (
                      <details className={styles.advancedEntry}>
                        <summary>
                          {scanResult.diagnosticNonJsonSamples.length} non-JSON/malformed line
                          {scanResult.diagnosticNonJsonSamples.length === 1 ? '' : 's'} (diagnostics only — never
                          used for field mapping)
                        </summary>
                        <ul className={styles.discoveredList}>
                          {scanResult.diagnosticNonJsonSamples.map((sample, index) => (
                            <li key={index} className={styles.discoveredRow}>
                              <code>{sample.originalJson}</code>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </>
                ) : (
                  <p className={styles.hint}>Run a scan to review real Original Event Samples and the Discovered Source Schema.</p>
                )}
              </>
            ) : (
              <p className={styles.hint}>
                This source does not support Original Source JSON sampling — capability not advertised.
              </p>
            )}
          </section>

          {discovered.length > 0 ? (
            <section className={styles.section}>
              <h2 className={styles.subheading}>2. Discovered Source Schema</h2>
              <p className={styles.hint}>
                The observed union of JSON paths seen across this scan — not the original event content.
              </p>
              <datalist id={datalistId}>
                {discovered.map((d) => (
                  <option key={d.path} value={d.path} />
                ))}
              </datalist>
              <div className={styles.schemaTableWrapper}>
                <table className={styles.schemaTable}>
                  <thead>
                    <tr>
                      <th scope="col">Path</th>
                      <th scope="col">Type(s)</th>
                      <th scope="col">Seen</th>
                      <th scope="col">Coverage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {discovered.map((d) => (
                      <tr key={d.path}>
                        <td>
                          <code>{d.path}</code>
                        </td>
                        <td>{d.observedTypes.join(', ').toLowerCase()}</td>
                        <td>{d.occurrenceCount}</td>
                        <td>{d.coveragePercentage.toFixed(0)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <section className={styles.section}>
            <h2 className={styles.subheading}>3. Map &amp; verify canonical fields</h2>
            <ul className={styles.fieldEditorList}>
              {profile.fields.map((field) => (
                <FieldEditorRow
                  key={field.field}
                  field={field}
                  candidates={candidatesFor(field.field, field.candidatePaths)}
                  hasDraft={drafts[field.field] != null}
                  newCandidateText={newCandidateText[field.field] ?? ''}
                  pickerOptions={discoveredPathStrings.filter(
                    (p) => !candidatesFor(field.field, field.candidatePaths).includes(p),
                  )}
                  observedPaths={discoveredPathStrings}
                  hasScanEvidence={(scanResult?.representativeEvents.length ?? 0) > 0}
                  pickerSelection={pickerSelection[field.field] ?? ''}
                  datalistId={datalistId}
                  validation={reportFor(field.field)}
                  verifying={verifyingField === field.field}
                  markingNeedsChange={markingNeedsChangeField === field.field}
                  verifyError={verifyErrors[field.field] ?? null}
                  onNewCandidateTextChange={(value) =>
                    setNewCandidateText((prev) => ({ ...prev, [field.field]: value }))
                  }
                  onPickerSelectionChange={(value) => setPickerSelection((prev) => ({ ...prev, [field.field]: value }))}
                  onAdd={() => addCandidate(field.field, field.candidatePaths)}
                  onAddPicked={() => addPickedCandidate(field.field, field.candidatePaths)}
                  onRemove={(index) => removeCandidate(field.field, field.candidatePaths, index)}
                  onMove={(index, direction) => moveCandidate(field.field, field.candidatePaths, index, direction)}
                  onVerify={() => runVerify(field.field)}
                  onMarkNeedsChange={() => runMarkNeedsChange(field.field)}
                />
              ))}
            </ul>
          </section>

          <section className={styles.section}>
            <h2 className={styles.subheading}>4. Validate &amp; preview</h2>
            <Button
              variant="secondary"
              onClick={runValidate}
              disabled={validating || (scanResult?.representativeEvents.length ?? 0) === 0}
            >
              {validating ? 'Validating…' : 'Validate mapping'}
            </Button>
            {(scanResult?.representativeEvents.length ?? 0) === 0 ? (
              <p className={styles.hint}>Run a Quick Schema Scan first — validation needs real samples to check against.</p>
            ) : null}

            {validationReport ? <ValidationSummary report={validationReport} /> : null}
          </section>

          {actionError ? (
            <p role="alert" className={styles.error}>
              {actionError}
            </p>
          ) : null}

          <div className={styles.actions}>
            <Button variant="secondary" onClick={runReset} disabled={resetting}>
              {resetting ? 'Resetting…' : '5. Reset to defaults'}
            </Button>
            <Button variant="primary" onClick={runSave} disabled={!canSave}>
              {saving ? 'Saving…' : '6. Save mapping'}
            </Button>
          </div>
        </>
      ) : (
        <p role="status">Loading…</p>
      )}
    </div>
  );
}

/**
 * Owner mission "Mapping Verification and Investigation Workspace" -
 * exactly three statuses, rendered with both a distinct visual treatment
 * AND text (never color alone, CLAUDE.md §7). `UNVERIFIED` deliberately
 * reads as neutral/inherited, never implying "the system knows this
 * mapping is correct."
 */
function VerificationBadge({ status }: { status: FieldVerificationStatus }) {
  const className =
    status === 'VERIFIED' ? styles.verifiedBadge : status === 'NEEDS_CHANGE' ? styles.needsChangeBadge : styles.unverifiedBadge;
  const label = status === 'VERIFIED' ? 'Verified' : status === 'NEEDS_CHANGE' ? 'Needs change' : 'Unverified';
  return <span className={className}>{label}</span>;
}

function FieldEditorRow({
  field,
  candidates,
  hasDraft,
  newCandidateText,
  pickerOptions,
  observedPaths,
  hasScanEvidence,
  pickerSelection,
  datalistId,
  validation,
  verifying,
  markingNeedsChange,
  verifyError,
  onNewCandidateTextChange,
  onPickerSelectionChange,
  onAdd,
  onAddPicked,
  onRemove,
  onMove,
  onVerify,
  onMarkNeedsChange,
}: {
  field: CanonicalFieldMapping;
  candidates: string[];
  /** Owner mission "Mapping Verification and Investigation Workspace" - true while this field has a pending unsaved draft; Verify is disabled then, since it would otherwise check stale (saved) candidates while the screen shows different (draft) ones. */
  hasDraft: boolean;
  newCandidateText: string;
  /** Mission §A10 — discovered paths not already mapped for this field, offered as a picker (e.g. `[cif] [mdc.cif] [customer.cif]`). */
  pickerOptions: string[];
  /** Owner mission "Mapping Verification and Investigation Workspace" - the full set of paths observed in the latest schema scan, to mark each candidate as observed or not. */
  observedPaths: string[];
  hasScanEvidence: boolean;
  pickerSelection: string;
  datalistId: string;
  validation: FieldMappingValidationReport['fields'][number] | null;
  verifying: boolean;
  markingNeedsChange: boolean;
  verifyError: string | null;
  onNewCandidateTextChange: (value: string) => void;
  onPickerSelectionChange: (value: string) => void;
  onAdd: () => void;
  onAddPicked: () => void;
  onRemove: (index: number) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onVerify: () => void;
  onMarkNeedsChange: () => void;
}) {
  const canVerify = candidates.length > 0 && !hasDraft && hasScanEvidence && !verifying;
  return (
    <li className={styles.fieldRow}>
      <div className={styles.fieldHeader}>
        <span className={styles.fieldName}>{field.displayName}</span>
        {field.sensitive ? <span className={styles.sensitiveBadge}>Protected</span> : null}
        <VerificationBadge status={field.verificationStatus} />
        {/*
         * Recovery mission "Field Mapping Verification Workflow Recovery" -
         * "The owner should never have to guess which version is being
         * checked." A visible, textual (never color-alone) marker right
         * next to the verification badge itself - the exact place the
         * owner is already looking when wondering why a field won't
         * verify - rather than only a hint sentence further down the row.
         */}
        {hasDraft ? <span className={styles.unsavedBadge}>Unsaved changes</span> : null}
      </div>

      {candidates.length === 0 ? <p className={styles.hint}>Not mapped yet.</p> : null}

      <ol className={styles.candidateList}>
        {candidates.map((path, index) => (
          <li key={`${path}-${index}`} className={styles.candidateItem}>
            <code>{path}</code>
            {observedPaths.includes(path) ? (
              <span className={styles.observedNote}>(observed in latest scan)</span>
            ) : observedPaths.length > 0 ? (
              <span className={styles.notObservedNote}>(not observed in latest scan)</span>
            ) : null}
            <div className={styles.candidateActions}>
              <button type="button" aria-label={`Move ${path} up`} disabled={index === 0} onClick={() => onMove(index, -1)}>
                ↑
              </button>
              <button
                type="button"
                aria-label={`Move ${path} down`}
                disabled={index === candidates.length - 1}
                onClick={() => onMove(index, 1)}
              >
                ↓
              </button>
              <button type="button" aria-label={`Remove ${path}`} onClick={() => onRemove(index)}>
                ×
              </button>
            </div>
          </li>
        ))}
      </ol>

      {pickerOptions.length > 0 ? (
        <div className={styles.pickerRow}>
          <label htmlFor={`candidate-picker-${field.field}`} className={styles.srOnly}>
            Add a discovered path as a candidate for {field.displayName}
          </label>
          <select
            id={`candidate-picker-${field.field}`}
            value={pickerSelection}
            onChange={(event) => onPickerSelectionChange(event.target.value)}
          >
            <option value="">Select a discovered path…</option>
            {pickerOptions.map((path) => (
              <option key={path} value={path}>
                {path}
              </option>
            ))}
          </select>
          <Button variant="secondary" onClick={onAddPicked} disabled={!pickerSelection}>
            Add
          </Button>
        </div>
      ) : null}

      <details className={styles.advancedEntry}>
        <summary>Advanced: enter a path manually</summary>
        <div className={styles.addCandidateRow}>
          <label htmlFor={`candidate-input-${field.field}`} className={styles.srOnly}>
            Add a candidate path for {field.displayName}
          </label>
          <input
            id={`candidate-input-${field.field}`}
            type="text"
            list={datalistId}
            placeholder="e.g. mdc.cif or cif"
            value={newCandidateText}
            onChange={(event) => onNewCandidateTextChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onAdd();
              }
            }}
          />
          <Button variant="secondary" onClick={onAdd}>
            Add
          </Button>
        </div>
      </details>

      {validation ? <FieldValidationBadge validation={validation} /> : null}

      <div className={styles.verificationActions}>
        <Button variant="secondary" onClick={onVerify} disabled={!canVerify}>
          {verifying ? 'Verifying…' : 'Verify'}
        </Button>
        {field.verificationStatus !== 'NEEDS_CHANGE' ? (
          <Button variant="ghost" onClick={onMarkNeedsChange} disabled={markingNeedsChange}>
            {markingNeedsChange ? 'Marking…' : 'Mark needs change'}
          </Button>
        ) : null}
      </div>
      {hasDraft ? (
        <p className={styles.hint}>
          This field has unsaved changes — click <strong>6. Save mapping</strong> below first. Verify always checks
          exactly what was last saved, so it stays disabled until this edit is saved.
        </p>
      ) : null}
      {!hasScanEvidence ? <p className={styles.hint}>Run a Quick Schema Scan first — verification needs real samples as evidence.</p> : null}
      {verifyError ? (
        <p role="alert" className={styles.error}>
          {verifyError}
        </p>
      ) : null}
    </li>
  );
}

function FieldValidationBadge({ validation }: { validation: FieldMappingValidationReport['fields'][number] }) {
  if (validation.invalidPaths.length > 0) {
    return (
      <p role="alert" className={styles.invalidBadge}>
        Invalid path{validation.invalidPaths.length === 1 ? '' : 's'}: {validation.invalidPaths.join(', ')}
      </p>
    );
  }
  if (validation.foundInAnySample) {
    return (
      <p className={styles.foundBadge}>
        Found: {validation.exampleValues.join(', ')}
        {validation.structuredValueWarning ? ' (resolves to a nested object/array in at least one sample)' : ''}
      </p>
    );
  }
  if (validation.mappedButAbsent) {
    return <p className={styles.absentBadge}>Mapped, but not found in the current samples.</p>;
  }
  return null;
}

function ValidationSummary({ report }: { report: FieldMappingValidationReport }) {
  return (
    <div className={styles.validationSummary} role="status">
      <p>
        {report.passed ? '✓ Valid — no invalid paths.' : '✗ Not valid — fix the invalid path(s) listed below before saving.'}
        {' '}Checked against {report.sampleCount} sample{report.sampleCount === 1 ? '' : 's'}
        {report.malformedSampleCount > 0 ? ` (${report.malformedSampleCount} malformed sample(s) skipped)` : ''}.
      </p>
      {report.conflicts.length > 0 ? (
        <ul className={styles.conflictList}>
          {report.conflicts.map((conflict) => (
            <li key={conflict.pathRaw} role="alert">
              Path <code>{conflict.pathRaw}</code> is claimed by more than one field: {conflict.fields.join(', ')}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function formatJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
