import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button } from '../../../shared/ui/Button';
import { VisuallyHidden } from '../../../shared/ui/VisuallyHidden';
import { useDismissableLayer } from '../../../shared/ui/useDismissableLayer';
import {
  deleteClassificationRule,
  downloadClassificationRulesExport,
  fetchClassificationRules,
  isRulesRevisionConflict,
  previewClassificationImport,
  updateClassificationRule,
} from '../../../shared/api/client';
import type {
  ClassificationRule,
  ClassificationRulesState,
  ClassificationSampleScope,
  ImportApplyResult,
  ImportPreviewResult,
  LogEvent,
  RuleMatchDto,
} from '../../../shared/api/types';
import type { ClassificationWorkspaceIntent } from '../../../app/useSearchState';
import { TagChip } from '../../../shared/ui/TagChip';
import { RuleEditor } from './RuleEditor';
import type { EditorMode, StepId } from './RuleEditor';
import { ImportPanel } from './ImportPanel';
import {
  REVISION_CONFLICT_MESSAGE,
  SAVED_MESSAGE,
  conditionSummary,
  duplicateRule,
  emptyRule,
  errorMessage,
  formatBytes,
  readFileText,
  toWritableRule,
} from './ruleDraft';
import styles from './ClassificationRulesWorkspace.module.css';

export interface ClassificationRulesWorkspaceProps {
  /** Set when opened from the inspector's "Create tag rule from this event" - held only in React state. */
  sourceEvent: LogEvent | null;
  /** The committed search scope a detect/test call samples; `null` when no source is selected. */
  /**
   * The committed search scope a sample is read from. The selected event is passed so the server can guarantee it
   * takes part in detection even when the bounded page stops short of it.
   */
  buildScope: (anchor?: LogEvent | null) => ClassificationSampleScope | null;
  /**
   * Why the workspace was opened: `createRule` authors a new rule from `sourceEvent`, `addExtraction` extends a
   * rule that already matched it (owner mission §"Inspector action semantics"). Omitted for the Settings entry.
   */
  intent?: ClassificationWorkspaceIntent;
  /** Called after any successful write so app-wide tag lists can refresh. */
  onRulesChanged?: () => void;
  onClose: () => void;
}

type View =
  | { kind: 'list' }
  | { kind: 'editor'; mode: EditorMode; initialRule: ClassificationRule; initialStep?: StepId }
  /** "Add extraction from this event" when more than one saved rule matched it - the user picks which to extend. */
  | { kind: 'chooseRule'; candidates: RuleMatchDto[] }
  | { kind: 'import'; fileName: string; packText: string; preview: ImportPreviewResult };

const STATUS_LABELS: Record<ClassificationRulesState['status'], string> = {
  OK: 'OK',
  RECOVERED_FROM_BACKUP: 'Rules were recovered from a backup file.',
  INVALID: 'The saved rules file is invalid.',
};

/**
 * Event Classification & Extraction Rules - a takeover workspace (the same
 * slot `FieldMappingWorkspace` uses). Lists the saved rules and hosts the
 * rule wizard and the import flow. Every write carries the revision this
 * client last read, so a concurrent change surfaces as a conflict instead
 * of being overwritten.
 */
export function ClassificationRulesWorkspace({
  sourceEvent,
  intent,
  buildScope,
  onRulesChanged,
  onClose,
}: ClassificationRulesWorkspaceProps) {
  const headingId = useId();
  const fileInputId = useId();
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const confirmRef = useRef<HTMLDivElement | null>(null);
  const confirmCancelRef = useRef<HTMLButtonElement | null>(null);

  const [rulesState, setRulesState] = useState<ClassificationRulesState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<View>(() =>
    sourceEvent && intent !== 'addExtraction'
      ? { kind: 'editor', mode: 'fromEvent', initialRule: emptyRule() }
      : { kind: 'list' },
  );
  /** Resolved once the rules are loaded, because extending a rule needs the saved rule itself. */
  const extensionResolvedRef = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [listConflict, setListConflict] = useState(false);
  const [busyRuleId, setBusyRuleId] = useState<string | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [pendingDelete, setPendingDelete] = useState<ClassificationRule | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importBusy, setImportBusy] = useState(false);

  const loadRules = useCallback(async () => {
    try {
      const next = await fetchClassificationRules();
      setRulesState(next);
      setLoadError(null);
      setSelection((prev) => prev.filter((id) => next.rules.some((r) => r.id === id)));
    } catch (error) {
      setLoadError(errorMessage(error, 'Failed to load classification rules'));
      throw error;
    }
  }, []);

  useEffect(() => {
    loadRules().catch(() => undefined);
  }, [loadRules]);

  /**
   * "Add extraction from this event" needs the saved rule, so it resolves once the rules have loaded: one
   * matching rule opens straight on its extraction step, several ask which to extend, and a rule that has since
   * been deleted says so instead of silently authoring something else. Nothing is mutated without an explicit
   * Save either way.
   */
  useEffect(() => {
    if (intent !== 'addExtraction' || !rulesState || !sourceEvent || extensionResolvedRef.current) {
      return;
    }
    extensionResolvedRef.current = true;
    const matched = sourceEvent.classifications.filter((c) => rulesState.rules.some((r) => r.id === c.ruleId));
    if (matched.length === 1) {
      openExtractionEditor(matched[0].ruleId);
    } else if (matched.length > 1) {
      setView({ kind: 'chooseRule', candidates: matched });
    } else {
      setNotice(
        sourceEvent.classifications.length > 0
          ? 'The rules that classified this event are no longer saved. Choose a rule to edit, or create a new one.'
          : 'This event is not classified yet, so there is no rule to extend. Create a tag rule first.',
      );
    }
  }, [intent, rulesState, sourceEvent]);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    if (pendingDelete) {
      confirmCancelRef.current?.focus();
    }
  }, [pendingDelete]);

  useDismissableLayer(confirmRef, pendingDelete != null, () => setPendingDelete(null));

  /** Opens a saved rule on its extraction step, with the selected event as the anchor for suggestions. */
  function openExtractionEditor(ruleId: string) {
    const rule = rulesState?.rules.find((r) => r.id === ruleId);
    if (!rule) {
      setListError('That rule no longer exists. Reload the rules and try again.');
      setView({ kind: 'list' });
      return;
    }
    setView({ kind: 'editor', mode: 'edit', initialRule: rule, initialStep: 'extraction' });
  }

  function clearListMessages() {
    setListError(null);
    setListConflict(false);
    setNotice(null);
  }

  function handleWriteError(error: unknown, fallback: string) {
    if (isRulesRevisionConflict(error)) {
      setListConflict(true);
    } else {
      setListError(errorMessage(error, fallback));
    }
  }

  function applyNewState(next: ClassificationRulesState) {
    setRulesState(next);
    setSelection((prev) => prev.filter((id) => next.rules.some((r) => r.id === id)));
    onRulesChanged?.();
  }

  function toggleEnabled(rule: ClassificationRule) {
    if (!rulesState || !rule.id) {
      return;
    }
    clearListMessages();
    setBusyRuleId(rule.id);
    const enabled = rule.enabled ?? true;
    updateClassificationRule(rule.id, rulesState.revision, toWritableRule({ ...rule, enabled: !enabled }))
      .then(applyNewState)
      .catch((error: unknown) => handleWriteError(error, 'Updating the rule failed'))
      .finally(() => setBusyRuleId(null));
  }

  function confirmDelete() {
    const rule = pendingDelete;
    if (!rulesState || !rule?.id) {
      return;
    }
    clearListMessages();
    setPendingDelete(null);
    setBusyRuleId(rule.id);
    deleteClassificationRule(rule.id, rulesState.revision)
      .then((next) => {
        applyNewState(next);
        setNotice(`Rule "${rule.name}" deleted.`);
      })
      .catch((error: unknown) => handleWriteError(error, 'Deleting the rule failed'))
      .finally(() => setBusyRuleId(null));
  }

  function runExport(ids?: string[]) {
    clearListMessages();
    setExporting(true);
    downloadClassificationRulesExport(ids)
      .catch((error: unknown) => setListError(`Export failed: ${errorMessage(error, 'unknown error')}`))
      .finally(() => setExporting(false));
  }

  function reloadAfterConflict() {
    loadRules()
      .then(() => setListConflict(false))
      .catch(() => undefined);
  }

  function handleImportFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !rulesState) {
      return;
    }
    clearListMessages();
    const maxBytes = rulesState.limits.maxImportBytes;
    if (maxBytes != null && file.size > maxBytes) {
      setListError(`"${file.name}" is ${formatBytes(file.size)}, larger than the ${formatBytes(maxBytes)} import limit.`);
      return;
    }
    setImportBusy(true);
    readFileText(file)
      .then((text) =>
        previewClassificationImport(text).then((preview) =>
          setView({ kind: 'import', fileName: file.name, packText: text, preview }),
        ),
      )
      .catch((error: unknown) => setListError(`Import preview failed: ${errorMessage(error, 'unknown error')}`))
      .finally(() => setImportBusy(false));
  }

  function handleSaved(next: ClassificationRulesState) {
    applyNewState(next);
    setListError(null);
    setListConflict(false);
    setNotice(SAVED_MESSAGE);
    setView({ kind: 'list' });
  }

  function handleImported(result: ImportApplyResult) {
    applyNewState(result.state);
    setListError(null);
    setListConflict(false);
    setNotice(
      `Import applied. Added ${result.added}, replaced ${result.replaced}, unchanged ${result.unchanged}, kept existing ${result.keptExisting}, removed ${result.removed}.`,
    );
    setView({ kind: 'list' });
  }

  const rules = rulesState?.rules ?? [];
  const trimmedFilter = filter.trim().toLowerCase();
  const visibleRules = trimmedFilter
    ? rules.filter(
        (r) => r.name.toLowerCase().includes(trimmedFilter) || r.tags.some((t) => t.toLowerCase().includes(trimmedFilter)),
      )
    : rules;

  let body: React.ReactNode;
  if (!rulesState) {
    body = loadError ? (
      <div role="alert" className={styles.error}>
        <p>Could not load classification rules: {loadError}</p>
        <Button onClick={() => loadRules().catch(() => undefined)}>Retry</Button>
      </div>
    ) : (
      <p role="status" className={styles.hint}>
        Loading classification rules…
      </p>
    );
  } else if (view.kind === 'chooseRule') {
    body = (
      <section aria-labelledby={`${headingId}-choose`}>
        <h2 id={`${headingId}-choose`}>Which rule should this value be added to?</h2>
        <p className={styles.hint}>
          {view.candidates.length} saved rules classified this event. Extraction is added to one rule at a time, and
          nothing changes until you save.
        </p>
        <ul className={styles.chooserList} aria-label="Rules that classified this event">
          {view.candidates.map((candidate) => (
            <li key={candidate.ruleId} className={styles.chooserRow}>
              <span className={styles.chooserName}>{candidate.ruleName}</span>
              <span className={styles.chooserTags}>
                {candidate.tags.map((tag) => (
                  <TagChip key={tag} tag={tag} color={candidate.displayColor} />
                ))}
              </span>
              <Button variant="primary" onClick={() => openExtractionEditor(candidate.ruleId)}>
                Add extraction to {candidate.ruleName}
              </Button>
            </li>
          ))}
        </ul>
        <Button onClick={() => setView({ kind: 'list' })}>Cancel</Button>
      </section>
    );
  } else if (view.kind === 'editor') {
    body = (
      <RuleEditor
        mode={view.mode}
        initialRule={view.initialRule}
        initialStep={view.initialStep}
        sourceEvent={view.mode === 'fromEvent' || intent === 'addExtraction' ? sourceEvent : null}
        rulesState={rulesState}
        buildScope={buildScope}
        onReloadRules={loadRules}
        onSaved={handleSaved}
        onCancel={() => setView({ kind: 'list' })}
      />
    );
  } else if (view.kind === 'import') {
    body = (
      <ImportPanel
        fileName={view.fileName}
        packText={view.packText}
        initialPreview={view.preview}
        onReloadRules={loadRules}
        onApplied={handleImported}
        onCancel={() => setView({ kind: 'list' })}
      />
    );
  } else {
    body = (
      <>
        {rulesState.status !== 'OK' ? (
          <div role="status" className={styles.banner}>
            <strong>{STATUS_LABELS[rulesState.status]}</strong>
            {rulesState.statusMessage ? <span> {rulesState.statusMessage}</span> : null}
          </div>
        ) : null}
        <p className={styles.meta}>
          Revision {rulesState.revision} · Stored in <span className={styles.mono}>{rulesState.storageFile}</span>
        </p>
        <p className={styles.meta}>
          Runtime: {rulesState.runtime.eventsEvaluated} events evaluated · {rulesState.runtime.ruleMatches} rule matches ·{' '}
          {rulesState.runtime.evaluationFailures} evaluation failures
        </p>

        <div className={styles.buttonRow}>
          <Button variant="primary" onClick={() => { clearListMessages(); setView({ kind: 'editor', mode: 'new', initialRule: emptyRule() }); }}>
            New rule
          </Button>
          <Button onClick={() => fileInputRef.current?.click()} disabled={importBusy}>
            {importBusy ? 'Reading file…' : 'Import…'}
          </Button>
          <input
            id={fileInputId}
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className={styles.fileInput}
            aria-label="Import rules file"
            tabIndex={-1}
            onChange={handleImportFile}
          />
          <Button onClick={() => runExport()} disabled={exporting || rules.length === 0}>
            Export all
          </Button>
          <Button onClick={() => runExport(selection)} disabled={exporting || selection.length === 0}>
            Export selected{selection.length > 0 ? ` (${selection.length})` : ''}
          </Button>
        </div>

        {notice ? (
          <p role="status" className={styles.notice}>
            {notice}
          </p>
        ) : null}
        {listError ? (
          <p role="alert" className={styles.error}>
            {listError}
          </p>
        ) : null}
        {listConflict ? (
          <div role="alert" className={styles.error}>
            <p>{REVISION_CONFLICT_MESSAGE}</p>
            <Button onClick={reloadAfterConflict}>Reload rules</Button>
          </div>
        ) : null}

        {rules.length === 0 ? (
          <div className={styles.emptyState}>
            <p>No classification rules yet.</p>
            <p className={styles.hint}>
              To create one from a real log line, run a search, open an event, and choose "Create tag rule from this event" in
              the event inspector. You can also choose "New rule" to write one yourself.
            </p>
          </div>
        ) : (
          <>
            <div className={styles.field}>
              <label htmlFor={`${headingId}-filter`}>Filter rules by name or tag</label>
              <input
                id={`${headingId}-filter`}
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                autoComplete="off"
              />
            </div>
            {visibleRules.length === 0 ? (
              <p className={styles.hint}>No rules match "{filter}".</p>
            ) : (
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <caption className={styles.srOnly}>Classification rules</caption>
                  <thead>
                    <tr>
                      <th scope="col">
                        <VisuallyHidden>Select for export</VisuallyHidden>
                      </th>
                      <th scope="col">Name</th>
                      <th scope="col">Tags</th>
                      <th scope="col">Matches on</th>
                      <th scope="col">Enabled</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRules.map((rule) => {
                      const id = rule.id ?? rule.name;
                      const enabled = rule.enabled ?? true;
                      return (
                        <tr key={id}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Select ${rule.name} for export`}
                              checked={selection.includes(id)}
                              onChange={(e) =>
                                setSelection((prev) =>
                                  e.target.checked ? [...prev.filter((s) => s !== id), id] : prev.filter((s) => s !== id),
                                )
                              }
                            />
                          </td>
                          <td>
                            <span className={styles.ruleName}>{rule.name}</span>
                            {rule.description ? <span className={styles.hint}>{rule.description}</span> : null}
                          </td>
                          <td>
                            {rule.tags.length > 0 ? (
                              <span className={styles.chooserTags}>
                                {rule.tags.map((tag) => (
                                  <TagChip key={tag} tag={tag} color={rule.displayColor} />
                                ))}
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className={styles.mono}>{conditionSummary(rule)}</td>
                          <td>
                            <label className={styles.checkboxRow}>
                              <input
                                type="checkbox"
                                role="switch"
                                aria-label={`Enabled: ${rule.name}`}
                                checked={enabled}
                                disabled={busyRuleId === rule.id}
                                onChange={() => toggleEnabled(rule)}
                              />
                              <span aria-hidden="true">{enabled ? 'On' : 'Off'}</span>
                            </label>
                          </td>
                          <td>
                            <div className={styles.rowActions}>
                              <Button
                                variant="ghost"
                                aria-label={`Edit ${rule.name}`}
                                onClick={() => { clearListMessages(); setView({ kind: 'editor', mode: 'edit', initialRule: rule }); }}
                              >
                                Edit
                              </Button>
                              <Button
                                variant="ghost"
                                aria-label={`Duplicate ${rule.name}`}
                                onClick={() => { clearListMessages(); setView({ kind: 'editor', mode: 'duplicate', initialRule: duplicateRule(rule) }); }}
                              >
                                Duplicate
                              </Button>
                              <Button
                                variant="ghost"
                                aria-label={`Test ${rule.name}`}
                                onClick={() => { clearListMessages(); setView({ kind: 'editor', mode: 'edit', initialRule: rule, initialStep: 'test' }); }}
                              >
                                Test
                              </Button>
                              <Button
                                variant="ghost"
                                aria-label={`Delete ${rule.name}`}
                                disabled={busyRuleId === rule.id}
                                onClick={() => setPendingDelete(rule)}
                              >
                                Delete
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {pendingDelete ? (
          <div
            ref={confirmRef}
            role="alertdialog"
            aria-labelledby={`${headingId}-delete-title`}
            aria-describedby={`${headingId}-delete-body`}
            className={styles.confirm}
          >
            <h2 id={`${headingId}-delete-title`} className={styles.subheading}>
              Delete rule?
            </h2>
            <p id={`${headingId}-delete-body`}>
              Delete the rule "{pendingDelete.name}"? This cannot be undone.
            </p>
            <div className={styles.buttonRow}>
              <Button variant="primary" onClick={confirmDelete}>
                Delete rule
              </Button>
              <Button ref={confirmCancelRef} onClick={() => setPendingDelete(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div className={styles.wrapper} data-testid="classification-rules-workspace">
      <div className={styles.header}>
        <Button variant="ghost" onClick={onClose}>
          ← Back to search results
        </Button>
        <h1 id={headingId} ref={headingRef} tabIndex={-1} className={styles.title}>
          Classification rules
        </h1>
      </div>
      <p className={styles.hint}>
        Rules tag matching events and extract named values from them. They are applied by the server to the events each
        search retrieves.
      </p>
      {body}
    </div>
  );
}
