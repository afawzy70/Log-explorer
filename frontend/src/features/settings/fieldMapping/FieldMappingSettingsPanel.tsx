import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../../../shared/ui/Button';
import { useDismissableLayer } from '../../../shared/ui/useDismissableLayer';
import { usePopoverTrigger } from '../../../shared/ui/usePopoverTrigger';
import {
  fetchFieldMappingSchemaScan,
  resetFieldMappingProfile,
  saveFieldMappingProfile,
  validateFieldMapping,
} from '../../../shared/api/client';
import type {
  CanonicalFieldKey,
  CanonicalFieldMapping,
  FieldMappingProfileDto,
  FieldMappingValidationReport,
  SchemaScanResponse,
} from '../../../shared/api/types';
import styles from './FieldMappingSettingsPanel.module.css';

export interface FieldMappingSettingsPanelProps {
  /** The currently selected source's id, or `null` when none is selected yet. */
  sourceId: string | null;
  /**
   * Owner mission "Project-Scoped Schema Scan" §1/§7/§8 — the currently
   * selected Compose project (Docker) or resolved OpenShift project/
   * namespace, or `null` for a source with no sub-project concept or none
   * selected yet. Threaded onto every scan/settings call so the scan and
   * the mapping profile it edits are always the SAME scope — never an
   * indiscriminate whole-source scan, never a silently-reused mapping
   * from a different project.
   */
  project: string | null;
  /** `SourceCapabilities.originalSchemaSampling` for the currently selected source — never inferred from id/name. */
  sourceSupportsSampling: boolean;
  /** The already-loaded field-mapping profile for this exact scope (fetched app-wide — see `useSearchState`'s `fieldMappingProfile`). */
  profile: FieldMappingProfileDto | null;
  profileError: string | null;
  /** Re-fetches the app-wide profile/readiness state for the current scope — called after any edit/save/reset here so `Toolbar`'s Search gate reflects it immediately, without a page reload. */
  onProfileChanged: () => void;
}

const DEFAULT_SCAN_MAX_EVENTS = 200;

/**
 * "Log Schema & Field Mapping" settings (owner mission "Field Mapping
 * Schema Scan + Masking Policy Extension" §A/§C) — a source-independent
 * settings surface, in the same top-right group as {@link
 * PrivacyMaskingSettingsPanel}/{@link DockerSettingsPanel}, but operating
 * on whichever source is currently selected (a mapping profile is
 * source-neutral today — mission §13 scope note, unchanged).
 *
 * <p><b>Security (mission §4/§20):</b> the scan's Original Event Samples
 * and the validation report's real example values live ONLY in this
 * component's own `useState` — never `localStorage`/`sessionStorage`/a
 * URL, never logged, discarded the moment this panel closes or the page
 * reloads. There is no caching layer here by design.
 *
 * <p><b>Workflow (mission §C):</b> Connect Source → Quick Schema Scan →
 * Review Original Event Samples → Review Discovered Source Schema → Map
 * Fields → Validate → Save → Search. Rescan never overwrites a saved
 * mapping (mission §A9) — it only re-runs the scan and highlights newly
 * discovered / disappeared / mapped-but-absent paths; saving remains a
 * fully separate, explicit action.
 *
 * <p><b>Terminology (mission §A5):</b> "Original Event Samples" are real,
 * unmodified source events; "Discovered Source Schema" is the generated
 * path union built from the whole scan — never called "Original JSON."
 * The schema is always presented as <i>Observed</i>, never
 * <i>Complete/Guaranteed</i> (mission §A11).
 */
export function FieldMappingSettingsPanel({
  sourceId,
  project,
  sourceSupportsSampling,
  profile,
  profileError,
  onProfileChanged,
}: FieldMappingSettingsPanelProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const popover = usePopoverTrigger();
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

  // Mission §8: changing the selected project/namespace means every
  // scan/draft/validation result belongs to a scope that no longer
  // applies - never silently carry a scan or an in-progress edit from one
  // project's context into another's.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId, project]);

  useDismissableLayer(wrapperRef, popover.isOpen, close);

  function close() {
    popover.close();
    setActionError(null);
  }

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

  function runSave() {
    if (!validationReport) {
      return; // Save stays disabled until this exists — defensive no-op
    }
    setSaving(true);
    setActionError(null);
    saveFieldMappingProfile(validationReport.passed, sourceId ?? undefined, project)
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
        onProfileChanged();
      })
      .catch((error: unknown) => setActionError(error instanceof Error ? error.message : 'Reset failed'))
      .finally(() => setResetting(false));
  }

  const hasUnsavedEdits = Object.keys(drafts).length > 0;
  const canSave = hasUnsavedEdits && validationReport != null && !saving;

  function reportFor(field: CanonicalFieldKey) {
    return validationReport?.fields.find((f) => f.field === field) ?? null;
  }

  return (
    <div ref={wrapperRef} className={styles.wrapper}>
      <button
        ref={popover.triggerRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="true"
        aria-expanded={popover.isOpen}
        onClick={() => (popover.isOpen ? close() : popover.open())}
      >
        Log schema &amp; field mapping
      </button>

      {popover.isOpen ? (
        <div className={styles.panel} role="dialog" aria-labelledby={headingId}>
          <h2 id={headingId} className={styles.heading}>
            Log Schema &amp; Field Mapping
          </h2>
          <p className={styles.hint}>
            Map each canonical field to the real JSON path(s) your source uses. Search is blocked until an edited
            mapping is validated and saved — the built-in default mapping always stays search-ready.
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

              <section className={styles.section}>
                <h3 className={styles.subheading}>1. Quick Schema Scan</h3>
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
                  <h3 className={styles.subheading}>2. Discovered Source Schema</h3>
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
                <h3 className={styles.subheading}>3. Map canonical fields</h3>
                <ul className={styles.fieldEditorList}>
                  {profile.fields.map((field) => (
                    <FieldEditorRow
                      key={field.field}
                      field={field}
                      candidates={candidatesFor(field.field, field.candidatePaths)}
                      newCandidateText={newCandidateText[field.field] ?? ''}
                      pickerOptions={discoveredPathStrings.filter(
                        (p) => !candidatesFor(field.field, field.candidatePaths).includes(p),
                      )}
                      pickerSelection={pickerSelection[field.field] ?? ''}
                      datalistId={datalistId}
                      validation={reportFor(field.field)}
                      onNewCandidateTextChange={(value) =>
                        setNewCandidateText((prev) => ({ ...prev, [field.field]: value }))
                      }
                      onPickerSelectionChange={(value) => setPickerSelection((prev) => ({ ...prev, [field.field]: value }))}
                      onAdd={() => addCandidate(field.field, field.candidatePaths)}
                      onAddPicked={() => addPickedCandidate(field.field, field.candidatePaths)}
                      onRemove={(index) => removeCandidate(field.field, field.candidatePaths, index)}
                      onMove={(index, direction) => moveCandidate(field.field, field.candidatePaths, index, direction)}
                    />
                  ))}
                </ul>
              </section>

              <section className={styles.section}>
                <h3 className={styles.subheading}>4. Validate &amp; preview</h3>
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

                {validationReport ? (
                  <ValidationSummary report={validationReport} />
                ) : null}
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
                <Button variant="ghost" onClick={close}>
                  Close
                </Button>
              </div>
            </>
          ) : (
            <p role="status">Loading…</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function FieldEditorRow({
  field,
  candidates,
  newCandidateText,
  pickerOptions,
  pickerSelection,
  datalistId,
  validation,
  onNewCandidateTextChange,
  onPickerSelectionChange,
  onAdd,
  onAddPicked,
  onRemove,
  onMove,
}: {
  field: CanonicalFieldMapping;
  candidates: string[];
  newCandidateText: string;
  /** Mission §A10 — discovered paths not already mapped for this field, offered as a picker (e.g. `[cif] [mdc.cif] [customer.cif]`). */
  pickerOptions: string[];
  pickerSelection: string;
  datalistId: string;
  validation: FieldMappingValidationReport['fields'][number] | null;
  onNewCandidateTextChange: (value: string) => void;
  onPickerSelectionChange: (value: string) => void;
  onAdd: () => void;
  onAddPicked: () => void;
  onRemove: (index: number) => void;
  onMove: (index: number, direction: -1 | 1) => void;
}) {
  return (
    <li className={styles.fieldRow}>
      <div className={styles.fieldHeader}>
        <span className={styles.fieldName}>{field.displayName}</span>
        {field.sensitive ? <span className={styles.sensitiveBadge}>Protected</span> : null}
      </div>

      {candidates.length === 0 ? <p className={styles.hint}>Not mapped yet.</p> : null}

      <ol className={styles.candidateList}>
        {candidates.map((path, index) => (
          <li key={`${path}-${index}`} className={styles.candidateItem}>
            <code>{path}</code>
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
