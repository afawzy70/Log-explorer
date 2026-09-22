import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button } from '../../../shared/ui/Button';
import { Icon } from '../../../shared/ui/Icon';
import { VisuallyHidden } from '../../../shared/ui/VisuallyHidden';
import { WorkspaceBackButton } from '../../../shared/ui/WorkspaceBackButton';
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
import type { ClassificationWorkspaceIntent, SettingsSectionId, WorkspaceOrigin } from '../../../app/useSearchState';
import { TagChip, TagCountBadge } from '../../../shared/ui/TagChip';
import { SettingsNav } from '../SettingsNav';
import { EDITOR_TITLES, RuleEditor } from './RuleEditor';
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
import listStyles from './ClassificationRulesList.module.css';
import editorStyles from './RuleEditor.module.css';

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
  /**
   * PR61_OWNER_NAVIGATION_RECOVERY_2 - where this workspace was opened from, so its own Back button and
   * breadcrumb can be truthful instead of always assuming Settings (owner-observed defect: "Back" always
   * returned to Search even when the workspace was entered from Settings, and vice versa). `App.tsx` sets
   * this from `state.classificationWorkspaceOrigin`, which every `open...` call site already threads through.
   */
  origin: WorkspaceOrigin;
  /**
   * DRIFT-016 remediation - the shared Settings nav rendered here needs to navigate to the other two
   * top-level takeover workspaces it lists (Field mapping directly; Sources & connections/Privacy &
   * masking/Keyboard shortcuts all live inside Settings itself). Both are the exact same
   * `state.openMappingWorkspace`/`state.openSettingsWorkspace` functions `App.tsx` already owns, passed
   * through rather than the whole `SearchState` object, matching this component's existing narrow-props
   * convention.
   *
   * <p>PR61_OWNER_NAVIGATION_RECOVERY_2 - `onOpenSettings` now takes the target section (owner-observed
   * defect: every jump from this workspace's own `SettingsNav` sidebar landed on Settings' default "Sources"
   * section regardless of which one was actually clicked).
   */
  onOpenMapping: () => void;
  onOpenSettings: (section?: SettingsSectionId) => void;
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
 *
 * <p>B6.3 (Session 8) recomposed the rules-management list (`view.kind ===
 * 'list'`, plus the loading/error state shown before any view is chosen) to
 * full v2 tokens (`listStyles`, {@link ClassificationRulesList.module.css}),
 * matching `COMPONENT_INVENTORY.md`'s own RECOMPOSE row for this file.
 * B6.4/B6.5 (Session 9) recomposed `RuleEditor.tsx` itself (its own new
 * {@link RuleEditor.module.css}) and this file's own `chooseRule` view
 * (styled with that same module, since it is simple markup owned here, not
 * inside `RuleEditor.tsx`). B6.6 (Session 9) recomposed `ImportPanel.tsx`
 * (its own new {@link ImportPanel.module.css}). All four views now render
 * full v2 tokens, so the old shared `ClassificationRulesWorkspace.module.css`
 * has no remaining importer anywhere and was deleted rather than left as
 * dead code. Production mapping/matching/priority/tag-colour semantics are
 * completely unchanged throughout every one of these recomposes - this is
 * presentation only.
 */
export function ClassificationRulesWorkspace({
  sourceEvent,
  intent,
  origin,
  buildScope,
  onRulesChanged,
  onClose,
  onOpenMapping,
  onOpenSettings,
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

  /**
   * DRIFT-016 remediation - the shared Settings nav's own section id space (SettingsNav.tsx) is wider than
   * this workspace: "mapping" leaves to the Field Mapping workspace, "sources"/"masking"/"shortcuts" leave to
   * Settings itself (opened on its own default first section, same as opening Settings from anywhere else -
   * this workspace has no way to tell Settings which of its sections to scroll to, and none is needed since
   * Settings shows all of them at once). "classification" is where we already are, so it just returns to the
   * rule list rather than leaving.
   */
  function selectSettingsSection(id: string) {
    if (id === 'mapping') {
      onOpenMapping();
    } else if (id === 'classification') {
      clearListMessages();
      setView({ kind: 'list' });
    } else {
      // PR61_OWNER_NAVIGATION_RECOVERY_2 - `id` is one of SettingsNav's own SETTINGS_NAV_SECTIONS ids
      // ('sources'/'masking'/'appearance'/'shortcuts' here), passed through so Settings lands deterministically
      // on the one the user actually clicked, not its own default "Sources" section every time.
      onOpenSettings(id as SettingsSectionId);
    }
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
      <div role="alert" className={listStyles.error}>
        <p>Could not load classification rules: {loadError}</p>
        <Button onClick={() => loadRules().catch(() => undefined)}>Retry</Button>
      </div>
    ) : (
      <p role="status" className={listStyles.hint}>
        Loading classification rules…
      </p>
    );
  } else if (view.kind === 'chooseRule') {
    body = (
      <section aria-labelledby={`${headingId}-choose`} className={editorStyles.section}>
        <h2 id={`${headingId}-choose`} className={editorStyles.subheading}>
          Which rule should this value be added to?
        </h2>
        <p className={editorStyles.hint}>
          {view.candidates.length} saved rules classified this event. Extraction is added to one rule at a time, and
          nothing changes until you save.
        </p>
        <ul className={editorStyles.chooserList} aria-label="Rules that classified this event">
          {view.candidates.map((candidate) => (
            <li key={candidate.ruleId} className={editorStyles.chooserRow}>
              <span className={editorStyles.chooserName}>{candidate.ruleName}</span>
              <span className={editorStyles.chooserTags}>
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
          <div role="status" className={rulesState.status === 'INVALID' ? listStyles.bannerDanger : listStyles.bannerWarning}>
            <Icon name={rulesState.status === 'INVALID' ? 'triangle-alert' : 'circle-alert'} size="sm" />
            <span>
              <strong>{STATUS_LABELS[rulesState.status]}</strong>
              {rulesState.statusMessage ? <span> {rulesState.statusMessage}</span> : null}
            </span>
          </div>
        ) : null}

        <div className={listStyles.metaBlock}>
          <p className={listStyles.metaLine}>
            Revision {rulesState.revision} · Stored in <span className={listStyles.mono}>{rulesState.storageFile}</span>
          </p>
          <p className={listStyles.metaLine}>
            Runtime: {rulesState.runtime.eventsEvaluated} events evaluated · {rulesState.runtime.ruleMatches} rule matches ·{' '}
            {rulesState.runtime.evaluationFailures} evaluation failures
          </p>
          {rules.length > 0 ? (
            <p className={listStyles.metaLine}>Evaluated top to bottom: priority ascending, then rule id.</p>
          ) : null}
        </div>

        <div className={listStyles.toolbar}>
          {rules.length > 0 ? (
            <div className={listStyles.filterField}>
              <label htmlFor={`${headingId}-filter`}>Filter rules by name or tag</label>
              <input
                id={`${headingId}-filter`}
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                autoComplete="off"
              />
            </div>
          ) : null}
          <div className={listStyles.toolbarActions}>
            <Button onClick={() => fileInputRef.current?.click()} disabled={importBusy}>
              {importBusy ? 'Reading file…' : 'Import…'}
            </Button>
            <input
              id={fileInputId}
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className={listStyles.fileInput}
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
            <Button
              variant="primary"
              onClick={() => { clearListMessages(); setView({ kind: 'editor', mode: 'new', initialRule: emptyRule() }); }}
            >
              New rule
            </Button>
          </div>
        </div>

        {notice ? (
          <p role="status" className={listStyles.notice}>
            {notice}
          </p>
        ) : null}
        {listError ? (
          <p role="alert" className={listStyles.error}>
            {listError}
          </p>
        ) : null}
        {listConflict ? (
          <div role="alert" className={listStyles.error}>
            <p>{REVISION_CONFLICT_MESSAGE}</p>
            <Button onClick={reloadAfterConflict}>Reload rules</Button>
          </div>
        ) : null}

        {rules.length === 0 ? (
          <div className={listStyles.emptyState}>
            <Icon name="tags" size="lg" />
            <p className={listStyles.emptyStateTitle}>No classification rules yet.</p>
            <p>
              To create one from a real log line, run a search, open an event, and choose "Create tag rule from this event" in
              the event inspector. You can also choose "New rule" to write one yourself.
            </p>
          </div>
        ) : visibleRules.length === 0 ? (
          <p className={listStyles.hint}>No rules match "{filter}".</p>
        ) : (
          <div className={listStyles.tableScroll}>
            <table className={listStyles.table}>
              <caption className={listStyles.srOnly}>Classification rules</caption>
              <colgroup>
                <col className={listStyles.colSelect} />
                <col className={listStyles.colName} />
                <col className={listStyles.colTags} />
                <col />
                <col className={listStyles.colExtracts} />
                <col className={listStyles.colEnabled} />
                <col className={listStyles.colActions} />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">
                    <VisuallyHidden>Select for export</VisuallyHidden>
                  </th>
                  <th scope="col">Name</th>
                  <th scope="col">Tags</th>
                  <th scope="col">Matches on</th>
                  <th scope="col">Extracts</th>
                  <th scope="col">Enabled</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleRules.map((rule) => {
                  const id = rule.id ?? rule.name;
                  const enabled = rule.enabled ?? true;
                  const extractionCount = rule.extractions?.length ?? 0;
                  return (
                    <tr key={id} className={enabled ? undefined : listStyles.disabledRow}>
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
                        <span className={listStyles.ruleName}>{rule.name}</span>
                        {rule.description ? <span className={listStyles.ruleDesc}>{rule.description}</span> : null}
                        <span className={listStyles.rulePriority}>Priority {rule.priority ?? 100}</span>
                      </td>
                      <td aria-label={rule.tags.length > 1 ? `Tags: ${rule.tags.join(', ')}` : undefined}>
                        {rule.tags.length > 0 ? (
                          <span className={listStyles.tagCell} title={rule.tags.length > 1 ? rule.tags.join(', ') : undefined}>
                            <TagChip tag={rule.tags[0]} color={rule.displayColor} />
                            {rule.tags.length > 1 ? <TagCountBadge count={rule.tags.length - 1} title={rule.tags.join(', ')} /> : null}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className={listStyles.matcher}>{conditionSummary(rule)}</td>
                      <td className={listStyles.numCell}>
                        {extractionCount > 0 ? (
                          `${extractionCount} value${extractionCount === 1 ? '' : 's'}`
                        ) : (
                          <span className={listStyles.emptyCell}>None</span>
                        )}
                      </td>
                      <td>
                        <label className={listStyles.enabledCell}>
                          <input
                            type="checkbox"
                            role="switch"
                            aria-label={`Enabled: ${rule.name}`}
                            checked={enabled}
                            disabled={busyRuleId === rule.id}
                            onChange={() => toggleEnabled(rule)}
                          />
                          <span className={listStyles.enabledWord} aria-hidden="true">
                            {enabled ? 'On' : 'Off'}
                          </span>
                        </label>
                      </td>
                      <td>
                        <div className={listStyles.rowActions}>
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

        {pendingDelete ? (
          <div className={listStyles.scrim}>
            <div
              ref={confirmRef}
              role="alertdialog"
              aria-labelledby={`${headingId}-delete-title`}
              aria-describedby={`${headingId}-delete-body`}
              className={listStyles.confirm}
            >
              <h2 id={`${headingId}-delete-title`} className={listStyles.confirmHeading}>
                Delete rule?
              </h2>
              <p id={`${headingId}-delete-body`} className={listStyles.confirmBody}>
                Delete the rule "{pendingDelete.name}"? This cannot be undone.
              </p>
              <div className={listStyles.confirmButtons}>
                <Button ref={confirmCancelRef} onClick={() => setPendingDelete(null)}>
                  Cancel
                </Button>
                <Button variant="danger" onClick={confirmDelete}>
                  Delete rule
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  // DRIFT-015/DRIFT-016 remediation - the workspace-trail breadcrumb extends with one more segment while the
  // rule wizard, the "which rule to extend" chooser, or Import is the active view, so it always names exactly
  // where the user is, never just "Classification rules" regardless of sub-view.
  const trailSegment =
    view.kind === 'import' ? 'Import' : view.kind === 'editor' ? EDITOR_TITLES[view.mode] : view.kind === 'chooseRule' ? 'Extend rule' : null;

  // PR61_OWNER_NAVIGATION_RECOVERY_2 - owner-observed defect: this breadcrumb and the header's own Back button
  // used to disagree (a "Settings" crumb was shown even when the workspace was reached from Search, and Back
  // always said "search results" even when it actually returned to Settings). Both are now driven by the same
  // `origin` truth, so they can never contradict each other again: a Search-origin visit shows no breadcrumb
  // at all (Back alone already names the one real ancestor truthfully), a Settings-origin visit keeps the
  // full breadcrumb, and both destinations always match what closing/backing out of this workspace actually
  // does.
  const backDestination = origin === 'settings' ? 'Settings' : 'Search results';

  return (
    <div className={listStyles.wrapper} data-testid="classification-rules-workspace">
      <div className={listStyles.header}>
        {origin === 'settings' ? (
          <nav aria-label="Breadcrumb" className={listStyles.breadcrumb}>
            <ol className={listStyles.breadcrumbList}>
              <li>
                <button
                  type="button"
                  className={listStyles.breadcrumbLink}
                  onClick={() => onOpenSettings('classification')}
                >
                  Settings
                </button>
              </li>
              <li aria-hidden="true" className={listStyles.breadcrumbSep}>
                /
              </li>
              <li>
                {trailSegment ? (
                  <button
                    type="button"
                    className={listStyles.breadcrumbLink}
                    onClick={() => { clearListMessages(); setView({ kind: 'list' }); }}
                  >
                    Classification rules
                  </button>
                ) : (
                  <span aria-current="page">Classification rules</span>
                )}
              </li>
              {trailSegment ? (
                <>
                  <li aria-hidden="true" className={listStyles.breadcrumbSep}>
                    /
                  </li>
                  <li>
                    <span aria-current="page">{trailSegment}</span>
                  </li>
                </>
              ) : null}
            </ol>
          </nav>
        ) : null}
        <div className={listStyles.headerRow}>
          <WorkspaceBackButton destination={backDestination} onClick={onClose} />
          <h1 id={headingId} ref={headingRef} tabIndex={-1} className={listStyles.title}>
            Classification rules
          </h1>
        </div>
      </div>
      <p className={listStyles.hint}>
        Rules tag matching events and extract named values from them. They are applied by the server to the events each
        search retrieves.
      </p>
      <div className={listStyles.body}>
        <SettingsNav activeId="classification" onSelect={selectSettingsSection} />
        <div className={listStyles.content}>{body}</div>
      </div>
    </div>
  );
}
