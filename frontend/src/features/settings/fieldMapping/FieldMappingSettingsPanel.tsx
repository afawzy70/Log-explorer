import { useId, useRef, useState } from 'react';
import { Button } from '../../../shared/ui/Button';
import { useDismissableLayer } from '../../../shared/ui/useDismissableLayer';
import { usePopoverTrigger } from '../../../shared/ui/usePopoverTrigger';
import {
  fetchFieldMappingSamples,
  resetFieldMappingProfile,
  saveFieldMappingProfile,
  validateFieldMapping,
} from '../../../shared/api/client';
import type {
  CanonicalFieldKey,
  CanonicalFieldMapping,
  FieldMappingProfileDto,
  FieldMappingValidationReport,
} from '../../../shared/api/types';
import { discoverPaths } from './discoverPaths';
import type { DiscoveredPath } from './discoverPaths';
import styles from './FieldMappingSettingsPanel.module.css';

export interface FieldMappingSettingsPanelProps {
  /** The currently selected source's id, or `null` when none is selected yet. */
  sourceId: string | null;
  /** `SourceCapabilities.originalSchemaSampling` for the currently selected source — never inferred from id/name. */
  sourceSupportsSampling: boolean;
  /** The already-loaded field-mapping profile (fetched once, app-wide — see `useSearchState`'s `fieldMappingProfile`). */
  profile: FieldMappingProfileDto | null;
  profileError: string | null;
  /** Re-fetches the app-wide profile/readiness state — called after any edit/save/reset here so `Toolbar`'s Search gate reflects it immediately, without a page reload. */
  onProfileChanged: () => void;
}

const DEFAULT_SAMPLE_LIMIT = 20;

/**
 * "Log Schema & Field Mapping" settings (mission "Configurable Log Field
 * Mapping + Original JSON Sampling" §14) — a source-independent settings
 * surface, in the same top-right group as {@link
 * PrivacyMaskingSettingsPanel}/{@link DockerSettingsPanel}, but operating
 * on whichever source is currently selected (a mapping profile is
 * source-neutral today — mission §13 scope note).
 *
 * <p><b>Security (mission §4/§20):</b> fetched Original Source JSON
 * samples and the validation report's real example values live ONLY in
 * this component's own `useState` — never `localStorage`/`sessionStorage`/
 * a URL, never logged, discarded the moment this panel closes or the page
 * reloads. There is no caching layer here by design.
 *
 * <p>Workflow (mission §14): fetch samples → inspect Original Source JSON
 * → inspect discovered paths → edit candidate paths per canonical field →
 * validate → review the report (found/absent/invalid/conflicting) → save
 * (only once a validate call has run since the last edit) → Search
 * re-enables automatically via {@link onProfileChanged} once
 * `searchReady` flips true.
 */
export function FieldMappingSettingsPanel({
  sourceId,
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
  const [samples, setSamples] = useState<string[]>([]);
  const [samplesLoading, setSamplesLoading] = useState(false);
  const [samplesError, setSamplesError] = useState<string | null>(null);
  const [selectedSampleIndex, setSelectedSampleIndex] = useState(0);

  const discovered: DiscoveredPath[] = discoverPaths(samples);

  // Only fields the user has actually edited this session — every other
  // field falls back to `profile`'s own last-saved candidates, both for
  // display and for what gets sent to /validate (mission's own API
  // contract: omitted fields validate against their current candidates).
  const [drafts, setDrafts] = useState<Partial<Record<CanonicalFieldKey, string[]>>>({});
  const [newCandidateText, setNewCandidateText] = useState<Partial<Record<CanonicalFieldKey, string>>>({});

  const [validationReport, setValidationReport] = useState<FieldMappingValidationReport | null>(null);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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

  function fetchSamples() {
    if (!sourceId) {
      return;
    }
    setSamplesLoading(true);
    setSamplesError(null);
    fetchFieldMappingSamples(sourceId, DEFAULT_SAMPLE_LIMIT)
      .then((result) => {
        setSamples(result.samples);
        setSelectedSampleIndex(0);
      })
      .catch((error: unknown) => setSamplesError(error instanceof Error ? error.message : 'Failed to fetch sample events'))
      .finally(() => setSamplesLoading(false));
  }

  function runValidate() {
    setValidating(true);
    setActionError(null);
    validateFieldMapping(drafts, samples)
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
    saveFieldMappingProfile(validationReport.passed)
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
    resetFieldMappingProfile()
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
                <h3 className={styles.subheading}>1–3. Fetch and inspect Original Source JSON</h3>
                {sourceSupportsSampling ? (
                  <>
                    <Button variant="secondary" onClick={fetchSamples} disabled={samplesLoading || !sourceId}>
                      {samplesLoading ? 'Fetching…' : `Fetch sample events (up to ${DEFAULT_SAMPLE_LIMIT})`}
                    </Button>
                    {samplesError ? (
                      <p role="alert" className={styles.error}>
                        {samplesError}
                      </p>
                    ) : null}
                    {samples.length > 0 ? (
                      <div className={styles.samplesArea}>
                        <label htmlFor={`${headingId}-sample-select`}>
                          {samples.length} sample{samples.length === 1 ? '' : 's'} fetched — Original Source JSON
                          (real, unmasked — never persisted)
                        </label>
                        <select
                          id={`${headingId}-sample-select`}
                          value={selectedSampleIndex}
                          onChange={(event) => setSelectedSampleIndex(Number(event.target.value))}
                        >
                          {samples.map((_, index) => (
                            <option key={index} value={index}>
                              Sample {index + 1}
                            </option>
                          ))}
                        </select>
                        <pre className={styles.samplePreview}>{formatJson(samples[selectedSampleIndex])}</pre>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className={styles.hint}>
                    This source does not support Original Source JSON sampling — capability not advertised.
                  </p>
                )}
              </section>

              {discovered.length > 0 ? (
                <section className={styles.section}>
                  <h3 className={styles.subheading}>4. Discovered JSON paths</h3>
                  <datalist id={datalistId}>
                    {discovered.map((d) => (
                      <option key={d.path} value={d.path} />
                    ))}
                  </datalist>
                  <ul className={styles.discoveredList}>
                    {discovered.map((d) => (
                      <li key={d.path} className={styles.discoveredRow}>
                        <code>{d.path}</code>
                        <span className={styles.discoveredPreview}>
                          {d.valueKind !== 'string' && d.valueKind !== 'number' && d.valueKind !== 'boolean'
                            ? `(${d.valueKind}) `
                            : ''}
                          {d.valuePreview}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section className={styles.section}>
                <h3 className={styles.subheading}>5. Map canonical fields</h3>
                <ul className={styles.fieldEditorList}>
                  {profile.fields.map((field) => (
                    <FieldEditorRow
                      key={field.field}
                      field={field}
                      candidates={candidatesFor(field.field, field.candidatePaths)}
                      newCandidateText={newCandidateText[field.field] ?? ''}
                      datalistId={datalistId}
                      validation={reportFor(field.field)}
                      onNewCandidateTextChange={(value) =>
                        setNewCandidateText((prev) => ({ ...prev, [field.field]: value }))
                      }
                      onAdd={() => addCandidate(field.field, field.candidatePaths)}
                      onRemove={(index) => removeCandidate(field.field, field.candidatePaths, index)}
                      onMove={(index, direction) => moveCandidate(field.field, field.candidatePaths, index, direction)}
                    />
                  ))}
                </ul>
              </section>

              <section className={styles.section}>
                <h3 className={styles.subheading}>6–7. Validate &amp; preview</h3>
                <Button variant="secondary" onClick={runValidate} disabled={validating || samples.length === 0}>
                  {validating ? 'Validating…' : 'Validate mapping'}
                </Button>
                {samples.length === 0 ? (
                  <p className={styles.hint}>Fetch sample events first — validation needs real samples to check against.</p>
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
                  {resetting ? 'Resetting…' : '8. Reset to defaults'}
                </Button>
                <Button variant="primary" onClick={runSave} disabled={!canSave}>
                  {saving ? 'Saving…' : '9. Save mapping'}
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
  datalistId,
  validation,
  onNewCandidateTextChange,
  onAdd,
  onRemove,
  onMove,
}: {
  field: CanonicalFieldMapping;
  candidates: string[];
  newCandidateText: string;
  datalistId: string;
  validation: FieldMappingValidationReport['fields'][number] | null;
  onNewCandidateTextChange: (value: string) => void;
  onAdd: () => void;
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
