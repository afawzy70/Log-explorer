import { useId, useState } from 'react';
import { Button } from '../../../shared/ui/Button';
import { TagChip } from '../../../shared/ui/TagChip';
import {
  applyClassificationImport,
  isRulesRevisionConflict,
  previewClassificationImport,
  ruleValidationErrors,
} from '../../../shared/api/client';
import type {
  ImportApplyResult,
  ImportConflictResolution,
  ImportItemStatus,
  ImportMode,
  ImportPreviewResult,
  RuleValidationError,
} from '../../../shared/api/types';
import { REVISION_CONFLICT_MESSAGE, errorMessage } from './ruleDraft';
import styles from './ClassificationRulesWorkspace.module.css';

export interface ImportPanelProps {
  fileName: string;
  /** The raw pack file text - held only in component state, sent back verbatim on Apply. */
  packText: string;
  initialPreview: ImportPreviewResult;
  onReloadRules: () => Promise<void>;
  onApplied: (result: ImportApplyResult) => void;
  /** Closes without ever calling apply. */
  onCancel: () => void;
}

const STATUS_TEXT: Record<ImportItemStatus, string> = {
  NEW: 'New',
  IDENTICAL: 'Identical',
  CONFLICT: 'Conflict',
  INVALID: 'Invalid',
};

/** Import preview + apply. Preview has already run (it writes nothing); Apply is the only write. */
export function ImportPanel({ fileName, packText, initialPreview, onReloadRules, onApplied, onCancel }: ImportPanelProps) {
  const id = useId();
  const [preview, setPreview] = useState(initialPreview);
  const [mode, setMode] = useState<ImportMode>('MERGE');
  const [resolution, setResolution] = useState<ImportConflictResolution | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<RuleValidationError[]>([]);
  const [conflict, setConflict] = useState(false);

  const needsResolution = mode === 'MERGE' && preview.conflicts > 0;
  const tagColorConflicts = preview.tagColorConflicts ?? [];
  const blockers: string[] = [];
  if (preview.invalid > 0) {
    blockers.push(
      `This pack contains ${preview.invalid} invalid rule${preview.invalid === 1 ? '' : 's'}. Apply is disabled; fix the file and import it again.`,
    );
  }
  if (needsResolution && !resolution) {
    blockers.push('Choose how to handle rules that conflict with existing rules.');
  }
  if (mode === 'REPLACE_ALL' && !confirmReplace) {
    blockers.push('Confirm that every existing rule not in this pack will be deleted.');
  }
  if (tagColorConflicts.length > 0) {
    // A tag keeps one colour everywhere - neither MERGE nor REPLACE_ALL may
    // silently pick a winner (owner mission §22.11 A1a). Executing a
    // resolution (A1b) is a separate, not-yet-approved server change (D39);
    // the only safe action here is to block and say what to fix.
    blockers.push(
      `${tagColorConflicts.length} tag colour conflict${tagColorConflicts.length === 1 ? '' : 's'} — resolve ${
        tagColorConflicts.length === 1 ? 'it' : 'them'
      } by editing the pack file or an existing rule's colour, then import again.`,
    );
  }
  const canApply = blockers.length === 0 && !applying;

  function apply() {
    if (!canApply) {
      return;
    }
    setApplying(true);
    setError(null);
    setErrors([]);
    setConflict(false);
    applyClassificationImport({
      packJson: packText,
      mode,
      conflictResolution: needsResolution && resolution ? resolution : undefined,
      expectedRevision: preview.currentRevision,
      confirmReplaceAll: mode === 'REPLACE_ALL' ? confirmReplace : undefined,
    })
      .then(onApplied)
      .catch((e: unknown) => {
        if (isRulesRevisionConflict(e)) {
          setConflict(true);
          return;
        }
        setErrors(ruleValidationErrors(e));
        setError(errorMessage(e, 'Import failed'));
      })
      .finally(() => setApplying(false));
  }

  function reload() {
    setError(null);
    Promise.all([onReloadRules(), previewClassificationImport(packText)])
      .then(([, nextPreview]) => {
        setPreview(nextPreview);
        setConflict(false);
      })
      .catch((e: unknown) => setError(errorMessage(e, 'Reloading rules failed')));
  }

  const pack = preview.pack;

  return (
    <section aria-labelledby={`${id}-title`} className={styles.section}>
      <h2 id={`${id}-title`} className={styles.subheading}>
        Import classification rules
      </h2>
      <p className={styles.hint}>
        File: <span className={styles.mono}>{fileName}</span>. Nothing has been imported yet.
      </p>
      {pack ? (
        <p className={styles.hint}>
          Pack: {pack.name ?? '(unnamed)'}
          {pack.version != null ? ` · version ${pack.version}` : ''}
          {pack.description ? ` · ${pack.description}` : ''}
        </p>
      ) : null}

      <ul className={styles.inlineStats}>
        <li>Rules in pack: {preview.rulesInPack}</li>
        <li>New: {preview.newRules}</li>
        <li>Identical: {preview.identical}</li>
        <li>Conflicts: {preview.conflicts}</li>
        <li>Tag colour conflicts: {tagColorConflicts.length}</li>
        <li>Invalid: {preview.invalid}</li>
      </ul>

      {tagColorConflicts.length > 0 ? (
        <div role="alert" className={styles.error}>
          <p>
            {tagColorConflicts.length === 1 ? 'One tag' : `${tagColorConflicts.length} tags`} in this pack would be
            shown in a different colour than {tagColorConflicts.length === 1 ? 'it already is' : 'they already are'}{' '}
            here. A tag keeps one colour everywhere, so this must be settled before importing — neither Merge nor
            Replace all will choose a colour for you.
          </p>
          <ul className={styles.errorList}>
            {tagColorConflicts.map((err, i) => (
              <li key={i}>
                <span className={styles.mono}>{err.path}</span>: {err.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {preview.items.length > 0 ? (
        <ul className={styles.itemList} aria-label="Rules in this pack">
          {preview.items.map((item) => (
            <li key={item.index} className={styles.item}>
              <span className={styles.ruleName}>{item.name ?? '(unnamed rule)'}</span>
              {item.id ? <span className={styles.mono}> {item.id}</span> : null}
              <span className={styles.statusText}> — {STATUS_TEXT[item.status]}</span>
              {item.status === 'CONFLICT' && item.existingName ? (
                <span className={styles.hint}> (existing rule: {item.existingName})</span>
              ) : null}
              {item.tags.length > 0 ? (
                <span className={styles.hint}>
                  {' '}
                  Tags:{' '}
                  <span className={styles.chooserTags}>
                    {item.tags.map((tag) => (
                      <TagChip key={tag} tag={tag} color={item.displayColor ?? undefined} />
                    ))}
                  </span>
                </span>
              ) : null}
              {item.errors.length > 0 ? (
                <ul className={styles.errorList}>
                  {item.errors.map((err, i) => (
                    <li key={i}>
                      <span className={styles.mono}>{err.path}</span>: {err.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Import mode</legend>
        <label className={styles.checkboxRow}>
          <input type="radio" name={`${id}-mode`} checked={mode === 'MERGE'} onChange={() => setMode('MERGE')} />
          Merge (keep existing rules)
        </label>
        <label className={styles.checkboxRow}>
          <input
            type="radio"
            name={`${id}-mode`}
            checked={mode === 'REPLACE_ALL'}
            onChange={() => setMode('REPLACE_ALL')}
          />
          Replace all rules
        </label>
      </fieldset>

      {needsResolution ? (
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Conflicting rules (required)</legend>
          <label className={styles.checkboxRow}>
            <input
              type="radio"
              name={`${id}-resolution`}
              checked={resolution === 'KEEP_EXISTING'}
              onChange={() => setResolution('KEEP_EXISTING')}
            />
            Keep existing rule
          </label>
          <label className={styles.checkboxRow}>
            <input
              type="radio"
              name={`${id}-resolution`}
              checked={resolution === 'USE_IMPORTED'}
              onChange={() => setResolution('USE_IMPORTED')}
            />
            Use imported rule
          </label>
        </fieldset>
      ) : null}

      {mode === 'REPLACE_ALL' ? (
        <label className={styles.checkboxRow}>
          <input type="checkbox" checked={confirmReplace} onChange={(e) => setConfirmReplace(e.target.checked)} />
          I understand this deletes every existing rule that is not in this pack
        </label>
      ) : null}

      {blockers.length > 0 ? (
        <ul className={styles.blockerList} id={`${id}-blockers`}>
          {blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <div role="alert" className={styles.error}>
          <p>{error}</p>
          {errors.length > 0 ? (
            <ul className={styles.errorList}>
              {errors.map((err, i) => (
                <li key={i}>
                  <span className={styles.mono}>{err.path}</span>: {err.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {conflict ? (
        <div role="alert" className={styles.error}>
          <p>{REVISION_CONFLICT_MESSAGE}</p>
          <Button onClick={reload}>Reload rules</Button>
        </div>
      ) : null}

      <div className={styles.actions}>
        <Button onClick={onCancel}>Cancel</Button>
        <Button
          variant="primary"
          onClick={apply}
          disabled={!canApply}
          aria-describedby={blockers.length > 0 ? `${id}-blockers` : undefined}
        >
          {applying ? 'Applying…' : 'Apply import'}
        </Button>
      </div>
    </section>
  );
}
