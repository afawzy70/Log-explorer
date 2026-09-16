import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../../../shared/ui/Button';
import { FieldList } from '../../../shared/ui/FieldList';
import { EMPTY_VALUE } from '../../../shared/ui/table/emptyValue';
import {
  createClassificationRule,
  detectClassificationPattern,
  isRulesRevisionConflict,
  ruleValidationErrors,
  suggestClassificationExtractions,
  testClassificationRule,
  updateClassificationRule,
} from '../../../shared/api/client';
import type {
  ClassificationRule,
  ClassificationRulesState,
  ClassificationSampleScope,
  ExtractionDefinition,
  ExtractionSuggestionResult,
  ExtractionType,
  ExtractionValueType,
  LogEvent,
  PatternDetectionResult,
  RuleCondition,
  RuleMatcher,
  RulePreviewEvent,
  RuleTestResult,
  RuleValidationError,
  SuggestedExtraction,
  TagColor,
} from '../../../shared/api/types';
import { TAG_COLORS } from '../../../shared/api/types';
import { TagChip } from '../../../shared/ui/TagChip';
import { extractedFieldItem } from '../../inspector/ClassificationSection';
import { formatUtcTimestamp } from '../../inspector/timestampFormat';
import { resolveService } from '../../results/columnMapping';
import {
  MATCHER_LABELS,
  REVISION_CONFLICT_MESSAGE,
  errorMessage,
  errorsAt,
  eventFieldOptions,
  eventFieldValue,
  normalizeTags,
  stringifyFieldValue,
  toWritableRule,
} from './ruleDraft';
import type { FieldOption } from './ruleDraft';
import styles from './ClassificationRulesWorkspace.module.css';

export type EditorMode = 'new' | 'edit' | 'duplicate' | 'fromEvent';
export type StepId = 'source' | 'detect' | 'classification' | 'extraction' | 'test' | 'save';

const STEP_LABELS: Record<StepId, string> = {
  source: 'Source',
  detect: 'Detect',
  classification: 'Classification',
  extraction: 'Extraction',
  test: 'Test',
  save: 'Save',
};

const EDITOR_TITLES: Record<EditorMode, string> = {
  new: 'New rule',
  edit: 'Edit rule',
  duplicate: 'Duplicate rule',
  fromEvent: 'Create tag rule from event',
};

/** Plain words for the palette, so the choice is never colour-only (CLAUDE.md §7). */
const COLOR_LABELS: Record<TagColor, string> = {
  GRAY: 'Grey',
  BLUE: 'Blue',
  CYAN: 'Cyan',
  GREEN: 'Green',
  AMBER: 'Amber',
  ORANGE: 'Orange',
  RED: 'Red',
  PURPLE: 'Purple',
};

/** One row of the suggestion list: whether it is ticked, the output name the user may rename, and sensitivity. */
interface SuggestionChoice {
  selected: boolean;
  name: string;
  sensitive: boolean;
}

const MATCHERS: RuleMatcher[] = ['EXACT', 'CONTAINS', 'STARTS_WITH', 'REGEX'];
const EXTRACTION_TYPES: { value: ExtractionType; label: string }[] = [
  { value: 'REGEX', label: 'Regular expression (RE2)' },
  { value: 'JSON_POINTER', label: 'JSON pointer' },
];
const VALUE_TYPES: { value: ExtractionValueType; label: string }[] = [
  { value: 'STRING', label: 'Text' },
  { value: 'INTEGER', label: 'Integer' },
  { value: 'DECIMAL', label: 'Decimal' },
  { value: 'BOOLEAN', label: 'Boolean' },
];

export interface RuleEditorProps {
  mode: EditorMode;
  initialRule: ClassificationRule;
  initialStep?: StepId;
  /** Only in `fromEvent` mode. */
  sourceEvent: LogEvent | null;
  rulesState: ClassificationRulesState;
  /**
   * The committed search scope a sample is read from. The selected event is passed so the server can guarantee it
   * takes part in detection even when the bounded page stops short of it.
   */
  buildScope: (anchor?: LogEvent | null) => ClassificationSampleScope | null;
  onReloadRules: () => Promise<void>;
  onSaved: (state: ClassificationRulesState) => void;
  onCancel: () => void;
}

function FieldErrors({ errors }: { errors: RuleValidationError[] }) {
  if (errors.length === 0) {
    return null;
  }
  return (
    <>
      {errors.map((e, i) => (
        <p key={i} className={styles.fieldError}>
          {e.message}
        </p>
      ))}
    </>
  );
}

function PreviewList({ items, showConditions }: { items: RulePreviewEvent[]; showConditions: boolean }) {
  return (
    <ul className={styles.plainList} style={{ listStyle: 'none', paddingLeft: 0 }}>
      {items.map((p, i) => (
        <li key={i} className={styles.previewItem}>
          <p className={styles.previewMeta}>
            <span className={styles.mono}>{p.timestamp ? formatUtcTimestamp(p.timestamp) : EMPTY_VALUE}</span>
            {' · '}
            {p.service ?? EMPTY_VALUE}
            {' · '}
            {p.severity ?? EMPTY_VALUE}
            {showConditions ? ` · matched ${p.conditionsMatched} of ${p.conditionsTotal} conditions` : ''}
          </p>
          <p className={styles.previewMeta}>
            {p.field}
            {p.fieldValueTruncated ? ' (truncated)' : ''}
          </p>
          <code className={styles.codeBlock}>{p.fieldValue ?? EMPTY_VALUE}</code>
          {p.extracted.length > 0 ? <FieldList items={p.extracted.map(extractedFieldItem)} /> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * The rule wizard, shared by new / edit / duplicate / create-from-event.
 * Every step is reachable from the step indicator and Back/Next. The
 * default path needs no regex knowledge: Detect suggests conditions and
 * extractions, Test shows what the draft actually matches, and nothing is
 * written until the explicit "Save rule".
 */
export function RuleEditor({
  mode,
  initialRule,
  initialStep,
  sourceEvent,
  rulesState,
  buildScope,
  onReloadRules,
  onSaved,
  onCancel,
}: RuleEditorProps) {
  const id = useId();
  const fieldsListId = `${id}-fields`;
  const steps: StepId[] =
    mode === 'fromEvent' && sourceEvent
      ? ['source', 'detect', 'classification', 'extraction', 'test', 'save']
      : ['detect', 'classification', 'extraction', 'test', 'save'];
  const [step, setStep] = useState<StepId>(() => {
    if (initialStep && steps.includes(initialStep)) {
      return initialStep;
    }
    return mode === 'edit' || mode === 'duplicate' ? 'classification' : steps[0];
  });
  const stepIndex = steps.indexOf(step);
  const stepHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    stepHeadingRef.current?.focus();
  }, [step]);

  const limits = rulesState.limits;
  const sampleSize = limits.defaultSampleSize ?? 200;
  const maxConditions = limits.maxConditionsPerRule ?? Number.POSITIVE_INFINITY;
  const maxExtractions = limits.maxExtractionsPerRule ?? Number.POSITIVE_INFINITY;
  const previewCount = limits.previewCount ?? 5;

  const [draft, setDraft] = useState<ClassificationRule>(() => ({
    ...initialRule,
    conditions: initialRule.conditions ?? [],
    extractions: initialRule.extractions ?? [],
  }));
  const [tagsText, setTagsText] = useState(() => (initialRule.tags ?? []).join(', '));
  const tags = normalizeTags(tagsText);
  const conditions = draft.conditions;
  const extractions = draft.extractions ?? [];

  // ---- Source / anchor ----
  const anchorOptions: FieldOption[] = sourceEvent
    ? eventFieldOptions(sourceEvent, rulesState.fields)
    : rulesState.fields.map((f) => ({ key: f.key, label: `${f.label} (${f.key})` }));
  const [anchorField, setAnchorField] = useState<string>(() => {
    if (sourceEvent) {
      const options = eventFieldOptions(sourceEvent, rulesState.fields);
      return options.some((o) => o.key === 'message') ? 'message' : (options[0]?.key ?? 'message');
    }
    return initialRule.conditions?.[0]?.field ?? 'message';
  });
  const [pastedSample, setPastedSample] = useState('');
  const anchorValue = sourceEvent ? stringifyFieldValue(eventFieldValue(sourceEvent, anchorField)) : pastedSample;
  const datalistKeys = Array.from(
    new Set([
      ...rulesState.fields.map((f) => f.key),
      ...(sourceEvent ? Object.keys(sourceEvent.unknownTopLevelFields ?? {}).map((k) => `extra.${k}`) : []),
      ...(sourceEvent ? Object.keys(sourceEvent.unknownMdcFields ?? {}).map((k) => `mdc.${k}`) : []),
    ]),
  );

  // ---- Detect ----
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [detection, setDetection] = useState<PatternDetectionResult | null>(null);
  const [suggestionApplied, setSuggestionApplied] = useState(false);

  // ---- Assisted extraction ----
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<ExtractionSuggestionResult | null>(null);
  const [suggestionChoices, setSuggestionChoices] = useState<Record<string, SuggestionChoice>>({});
  const [extractionSkipped, setExtractionSkipped] = useState(false);
  const [openExtractionDetails, setOpenExtractionDetails] = useState<Record<number, boolean>>({});
  const suggestedOnceRef = useRef(false);

  // ---- Classification ----
  const [advancedOpen, setAdvancedOpen] = useState(mode === 'edit' || mode === 'duplicate');

  // ---- Test / validation / save ----
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<RuleTestResult | null>(null);
  const [validationErrors, setValidationErrors] = useState<RuleValidationError[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveIssues, setSaveIssues] = useState<string[]>([]);
  const [conflict, setConflict] = useState(false);
  const [reloadNotice, setReloadNotice] = useState<string | null>(null);

  useEffect(() => {
    if (step !== 'extraction' || suggestedOnceRef.current || conditions.length === 0) {
      return;
    }
    suggestedOnceRef.current = true;
    runSuggestExtractions();
    // Runs once, the first time the user reaches the extraction step with conditions to match on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  function ruleForSubmit(): ClassificationRule {
    return toWritableRule({ ...draft, tags }, mode === 'edit');
  }

  function updateDraft(patch: Partial<ClassificationRule>) {
    setDraft((prev) => ({ ...prev, ...patch }));
    setTestResult(null);
  }

  function updateCondition(index: number, patch: Partial<RuleCondition>) {
    updateDraft({ conditions: conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)) });
  }

  function updateExtraction(index: number, patch: Partial<ExtractionDefinition>) {
    updateDraft({ extractions: extractions.map((x, i) => (i === index ? { ...x, ...patch } : x)) });
  }

  function runDetect() {
    const scope = buildScope(sourceEvent);
    if (!scope) {
      setDetectError('Select a source before detecting a pattern.');
      return;
    }
    if (!anchorValue) {
      return;
    }
    setDetecting(true);
    setDetectError(null);
    setDetection(null);
    setSuggestionApplied(false);
    detectClassificationPattern({ field: anchorField, anchorValue, scope, sampleSize })
      .then(setDetection)
      .catch((error: unknown) => setDetectError(errorMessage(error, 'Pattern detection failed')))
      .finally(() => setDetecting(false));
  }

  function applySuggestion() {
    if (!detection) {
      return;
    }
    updateDraft({
      matchMode: detection.suggestedMatchMode ?? 'ALL',
      conditions: detection.suggestedConditions.map((c) => ({ ...c })),
      extractions: detection.suggestedExtractions.map((s) => ({ ...s.definition })),
    });
    setSuggestionApplied(true);
  }

  function skipToManual() {
    if (conditions.length === 0) {
      updateDraft({ conditions: [{ field: anchorField, matcher: 'CONTAINS', value: '', ignoreCase: false }] });
    }
    setAdvancedOpen(true);
    setStep('classification');
  }

  function handleRuleError(error: unknown, fallback: string, setMessage: (m: string) => void) {
    const errors = ruleValidationErrors(error);
    setValidationErrors(errors);
    setMessage(errorMessage(error, fallback));
  }

  /**
   * Asks the server which values can be pulled out of the events this rule actually matches, inside the same
   * committed search scope. Deterministic and server-side - the same detector Detect pattern uses - and a
   * suggestion only: nothing is saved until the user adds a value and saves the rule.
   */
  function runSuggestExtractions() {
    const scope = buildScope(sourceEvent);
    if (!scope) {
      setSuggestError('Select a source before suggesting extractions.');
      return;
    }
    setSuggesting(true);
    setSuggestError(null);
    setExtractionSkipped(false);
    suggestClassificationExtractions({
      rule: ruleForSubmit(),
      field: anchorField,
      anchorValue: anchorValue || undefined,
      scope,
      sampleSize,
    })
      .then((result) => {
        setSuggestion(result);
        setSuggestionChoices(
          Object.fromEntries(
            result.suggestions.map((s) => [
              s.definition.name,
              { selected: true, name: s.definition.name, sensitive: s.definition.sensitive ?? false },
            ]),
          ),
        );
      })
      .catch((error: unknown) => setSuggestError(errorMessage(error, 'Suggesting extractions failed')))
      .finally(() => setSuggesting(false));
  }

  function updateSuggestionChoice(key: string, patch: Partial<SuggestionChoice>) {
    setSuggestionChoices((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  /** Moves the ticked suggestions into the rule as confirmed extractions. Still not saved - Save rule does that. */
  function addSelectedSuggestions() {
    const chosen = (suggestion?.suggestions ?? []).filter((s) => suggestionChoices[s.definition.name]?.selected);
    if (chosen.length === 0) {
      return;
    }
    const existing = new Set(extractions.map((x) => x.name));
    const additions: ExtractionDefinition[] = [];
    for (const s of chosen) {
      const choice = suggestionChoices[s.definition.name];
      const name = (choice?.name ?? s.definition.name).trim() || s.definition.name;
      if (existing.has(name) || extractions.length + additions.length >= maxExtractions) {
        continue;
      }
      existing.add(name);
      // The output name is the user's to choose, but the capture group is part of the expression the detector
      // built - renaming the value must never repoint it at a group that does not exist.
      additions.push({ ...s.definition, name, sensitive: choice?.sensitive ?? false });
    }
    updateDraft({ extractions: [...extractions, ...additions] });
    const adoptedKeys = new Set(chosen.map((s) => s.definition.name));
    setSuggestion((prev) =>
      prev
        ? {
            ...prev,
            suggestions: prev.suggestions.filter((s) => !adoptedKeys.has(s.definition.name)),
            alreadyDefined: [...prev.alreadyDefined, ...additions.map((x) => x.name)],
          }
        : prev,
    );
  }

  function addManualExtraction() {
    setExtractionSkipped(false);
    updateDraft({
      extractions: [
        ...extractions,
        { name: '', sourceField: anchorField, type: 'REGEX', expression: '', valueType: 'STRING', sensitive: false },
      ],
    });
    setOpenExtractionDetails((prev) => ({ ...prev, [extractions.length]: true }));
  }

  function runTest() {
    const scope = buildScope(sourceEvent);
    if (!scope) {
      setTestError('Select a source before testing a rule.');
      return;
    }
    setTesting(true);
    setTestError(null);
    setValidationErrors([]);
    setTestResult(null);
    testClassificationRule({ rule: ruleForSubmit(), scope, sampleSize })
      .then(setTestResult)
      .catch((error: unknown) => handleRuleError(error, 'Rule test failed', setTestError))
      .finally(() => setTesting(false));
  }

  function save() {
    const issues: string[] = [];
    if (!draft.name.trim()) {
      issues.push('Enter a rule name (Classification step).');
    }
    if (tags.length === 0) {
      issues.push('Add at least one tag (Classification step).');
    }
    setSaveIssues(issues);
    if (issues.length > 0) {
      return;
    }
    const rule = ruleForSubmit();
    setSaving(true);
    setSaveError(null);
    setValidationErrors([]);
    setConflict(false);
    setReloadNotice(null);
    const request =
      mode === 'edit' && rule.id
        ? updateClassificationRule(rule.id, rulesState.revision, rule)
        : createClassificationRule(rulesState.revision, rule);
    request
      .then(onSaved)
      .catch((error: unknown) => {
        if (isRulesRevisionConflict(error)) {
          setConflict(true);
          return;
        }
        handleRuleError(error, 'Saving the rule failed', setSaveError);
      })
      .finally(() => setSaving(false));
  }

  function reloadRules() {
    onReloadRules()
      .then(() => {
        setConflict(false);
        setReloadNotice('Latest rules loaded. Your draft is kept - save again when ready.');
      })
      .catch((error: unknown) => setSaveError(errorMessage(error, 'Reloading rules failed')));
  }

  const validationSummary =
    validationErrors.length > 0 ? (
      <div role="alert" className={styles.error}>
        <p>This rule is not valid yet:</p>
        <ul className={styles.errorList}>
          {validationErrors.map((e, i) => (
            <li key={i}>
              <span className={styles.mono}>{e.path}</span>: {e.message}
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  const conditionsOverview =
    conditions.length === 0 ? (
      <p className={styles.hint}>No conditions yet. Use Detect for a suggestion, or add them under Advanced.</p>
    ) : (
      <>
        <p className={styles.hint}>
          Matches when {(draft.matchMode ?? 'ALL') === 'ALL' ? 'all' : 'any'} of these conditions hold:
        </p>
        <ul className={styles.plainList}>
          {conditions.map((c, i) => (
            <li key={i}>
              <span className={styles.mono}>{c.field || EMPTY_VALUE}</span> {MATCHER_LABELS[c.matcher].toLowerCase()}{' '}
              <span className={styles.mono}>"{c.value}"</span>
              {c.ignoreCase ? ' (ignore case)' : ''}
            </li>
          ))}
        </ul>
      </>
    );

  let content: React.ReactNode = null;

  if (step === 'source' && sourceEvent) {
    content = (
      <>
        <dl className={styles.summaryList}>
          <div className={styles.summaryRow}>
            <dt>Time</dt>
            <dd className={styles.mono}>{sourceEvent.timestamp ? formatUtcTimestamp(sourceEvent.timestamp) : EMPTY_VALUE}</dd>
          </div>
          <div className={styles.summaryRow}>
            <dt>Service</dt>
            <dd>{resolveService(sourceEvent)}</dd>
          </div>
          <div className={styles.summaryRow}>
            <dt>Severity</dt>
            <dd>{sourceEvent.severity ?? EMPTY_VALUE}</dd>
          </div>
        </dl>
        <div className={styles.field} style={{ marginTop: 'var(--space-3)' }}>
          <label htmlFor={`${id}-anchor-field`}>Field</label>
          {anchorOptions.length > 0 ? (
            <select
              id={`${id}-anchor-field`}
              value={anchorField}
              onChange={(e) => {
                setAnchorField(e.target.value);
                setDetection(null);
              }}
            >
              {anchorOptions.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <p className={styles.hint}>This event has no non-empty fields that can anchor a rule.</p>
          )}
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-sample`}>Sample value</label>
          <textarea id={`${id}-sample`} readOnly rows={4} value={anchorValue} />
        </div>
      </>
    );
  } else if (step === 'detect') {
    const detectDisabled = detecting || !anchorValue;
    content = (
      <>
        {sourceEvent ? (
          <p className={styles.hint}>
            Detecting from field <span className={styles.mono}>{anchorField}</span> of the selected event.
          </p>
        ) : (
          <>
            <div className={styles.field}>
              <label htmlFor={`${id}-anchor-field`}>Field</label>
              <select id={`${id}-anchor-field`} value={anchorField} onChange={(e) => setAnchorField(e.target.value)}>
                {!anchorOptions.some((o) => o.key === anchorField) ? <option value={anchorField}>{anchorField}</option> : null}
                {anchorOptions.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor={`${id}-sample`}>Sample value</label>
              <textarea
                id={`${id}-sample`}
                rows={3}
                value={pastedSample}
                onChange={(e) => setPastedSample(e.target.value)}
              />
            </div>
          </>
        )}
        <p className={styles.hint}>
          Detect samples up to {sampleSize} events from the current search scope (source, project, services, severity and
          time range) and suggests conditions. It is a suggestion only; nothing is saved.
        </p>
        {!anchorValue ? (
          <p className={styles.hint} id={`${id}-detect-why`}>
            {sourceEvent
              ? 'The selected field is empty on this event, so there is nothing to detect from.'
              : 'Detect needs a sample value. Paste one above, or write conditions manually.'}
          </p>
        ) : null}
        <div className={styles.buttonRow}>
          <Button
            variant="primary"
            onClick={runDetect}
            disabled={detectDisabled}
            aria-describedby={!anchorValue ? `${id}-detect-why` : undefined}
          >
            {detecting ? 'Detecting…' : 'Detect pattern'}
          </Button>
          <Button onClick={skipToManual}>Skip / write conditions manually</Button>
        </div>
        {detecting ? (
          <p role="status" className={styles.hint}>
            Detecting…
          </p>
        ) : null}
        {detectError ? (
          <p role="alert" className={styles.error}>
            {detectError}
          </p>
        ) : null}
        {detection && detection.status === 'NO_SAFE_PATTERN_SUGGESTION' ? (
          <div role="status" className={styles.notice}>
            {detection.reason ? <p>{detection.reason}</p> : null}
            <p>No safe pattern could be suggested. You can still create the rule manually (Advanced).</p>
            {detection.warnings.length > 0 ? (
              <ul className={styles.plainList}>
                {detection.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {detection && detection.status === 'SUGGESTED' ? (
          <section aria-label="Detected pattern" className={styles.section}>
            <ul className={styles.inlineStats}>
              <li>Sampled: {detection.sampledEvents}</li>
              <li>With this field: {detection.valuesWithField}</li>
              <li>Similar: {detection.similarEvents}</li>
            </ul>
            {detection.stableSegments.length > 0 ? (
              <>
                <h4 className={styles.minorHeading}>Stable structure</h4>
                <ul className={styles.plainList}>
                  {detection.stableSegments.map((s, i) => (
                    <li key={i} className={styles.mono}>
                      "{s}"
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {detection.variableSegments.length > 0 ? (
              <>
                <h4 className={styles.minorHeading}>Variable parts</h4>
                <ul className={styles.plainList}>
                  {detection.variableSegments.map((v, i) => (
                    <li key={i}>
                      <span className={styles.mono}>{v.name}</span> ({v.kind}), e.g.{' '}
                      <span className={styles.mono}>{v.example}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {detection.suggestedPattern ? (
              <>
                <h4 className={styles.minorHeading}>Suggested pattern</h4>
                <code className={styles.codeBlock}>{detection.suggestedPattern}</code>
              </>
            ) : null}
            {detection.coverage ? (
              <p className={styles.hint}>
                Matches {detection.coverage.matchedSimilar} of {detection.coverage.similar} similar events; also matches{' '}
                {detection.coverage.matchedOther} other sampled events.
              </p>
            ) : null}
            {detection.suggestedExtractions.length > 0 ? (
              <>
                <h4 className={styles.minorHeading}>Suggested extractions</h4>
                <ul className={styles.plainList}>
                  {detection.suggestedExtractions.map((s, i) => (
                    <li key={i}>
                      {s.definition.label || s.definition.name}: extracted from {s.extracted} of {s.of} similar events
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {detection.warnings.length > 0 ? (
              <>
                <h4 className={styles.minorHeading}>Warnings</h4>
                <ul className={styles.plainList}>
                  {detection.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </>
            ) : null}
            <div className={styles.buttonRow}>
              <Button variant="primary" onClick={applySuggestion}>
                Use this suggestion
              </Button>
            </div>
            {suggestionApplied ? (
              <p role="status" className={styles.notice}>
                Suggestion copied into the draft. Nothing is saved yet - review it in the next steps.
              </p>
            ) : null}
          </section>
        ) : null}
      </>
    );
  } else if (step === 'classification') {
    content = (
      <>
        {validationSummary}
        <div className={styles.field}>
          <label htmlFor={`${id}-name`}>Rule name</label>
          <input
            id={`${id}-name`}
            type="text"
            value={draft.name}
            maxLength={limits.maxNameLength}
            onChange={(e) => updateDraft({ name: e.target.value })}
            aria-required="true"
          />
          <FieldErrors errors={errorsAt(validationErrors, 'name')} />
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-tags`}>Tags (comma-separated, required)</label>
          <input
            id={`${id}-tags`}
            type="text"
            value={tagsText}
            onChange={(e) => {
              setTagsText(e.target.value);
              setTestResult(null);
            }}
            aria-required="true"
            aria-describedby={`${id}-tags-help`}
            autoComplete="off"
          />
          <span id={`${id}-tags-help`} className={styles.hint}>
            Tags are stored in lowercase.
          </span>
          {tags.length > 0 ? (
            <ul className={styles.chips} aria-label="Tags to save">
              {tags.map((t) => (
                <li key={t} className={styles.chip}>
                  {t}
                </li>
              ))}
            </ul>
          ) : null}
          <FieldErrors errors={errorsAt(validationErrors, 'tags')} />
        </div>
        <fieldset className={styles.field}>
          <legend>Tag colour</legend>
          <span id={`${id}-color-help`} className={styles.hint}>
            How these tags are shown in search results and the inspector. Colour is a label, not a severity, and
            every tag always shows its name. A tag already used by another rule keeps that rule's colour.
          </span>
          <div className={styles.colorChoices} role="radiogroup" aria-describedby={`${id}-color-help`}>
            {TAG_COLORS.map((color) => (
              <label key={color} className={styles.colorChoice}>
                <input
                  type="radio"
                  name={`${id}-color`}
                  value={color}
                  checked={(draft.displayColor ?? 'GRAY') === color}
                  onChange={() => updateDraft({ displayColor: color })}
                />
                <TagChip tag={color.toLowerCase()} color={color} label={COLOR_LABELS[color]} />
              </label>
            ))}
          </div>
          <p className={styles.previewRow}>
            <span className={styles.hint}>Preview:</span>{' '}
            <TagChip tag={tags[0] ?? 'tag'} color={draft.displayColor ?? 'GRAY'} />
          </p>
          <FieldErrors errors={errorsAt(validationErrors, 'displayColor')} />
        </fieldset>
        <div className={styles.field}>
          <label htmlFor={`${id}-description`}>Description</label>
          <textarea
            id={`${id}-description`}
            rows={2}
            value={draft.description ?? ''}
            maxLength={limits.maxDescriptionLength}
            onChange={(e) => updateDraft({ description: e.target.value })}
            style={{ fontFamily: 'inherit' }}
          />
          <FieldErrors errors={errorsAt(validationErrors, 'description')} />
        </div>
        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={draft.enabled ?? true}
            onChange={(e) => updateDraft({ enabled: e.target.checked })}
          />
          Enabled
        </label>

        <h4 className={styles.minorHeading}>Conditions</h4>
        {conditionsOverview}
        <FieldErrors errors={errorsAt(validationErrors, 'conditions')} />

        <div className={styles.buttonRow}>
          <Button aria-expanded={advancedOpen} aria-controls={`${id}-advanced`} onClick={() => setAdvancedOpen((o) => !o)}>
            {advancedOpen ? '▾' : '▸'} Advanced
          </Button>
        </div>
        {advancedOpen ? (
          <div id={`${id}-advanced`}>
            <fieldset className={styles.fieldset}>
              <legend className={styles.legend}>Match mode</legend>
              <label className={styles.checkboxRow}>
                <input
                  type="radio"
                  name={`${id}-match-mode`}
                  checked={(draft.matchMode ?? 'ALL') === 'ALL'}
                  onChange={() => updateDraft({ matchMode: 'ALL' })}
                />
                All conditions must match (ALL)
              </label>
              <label className={styles.checkboxRow}>
                <input
                  type="radio"
                  name={`${id}-match-mode`}
                  checked={draft.matchMode === 'ANY'}
                  onChange={() => updateDraft({ matchMode: 'ANY' })}
                />
                Any condition may match (ANY)
              </label>
            </fieldset>
            {conditions.map((c, i) => (
              <fieldset key={i} className={styles.fieldset}>
                <legend className={styles.legend}>Condition {i + 1}</legend>
                <div className={styles.rowGrid}>
                  <div className={styles.field}>
                    <label htmlFor={`${id}-c${i}-field`}>Field</label>
                    <input
                      id={`${id}-c${i}-field`}
                      type="text"
                      list={fieldsListId}
                      value={c.field}
                      onChange={(e) => updateCondition(i, { field: e.target.value })}
                      autoComplete="off"
                    />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor={`${id}-c${i}-matcher`}>Matcher</label>
                    <select
                      id={`${id}-c${i}-matcher`}
                      value={c.matcher}
                      onChange={(e) => updateCondition(i, { matcher: e.target.value as RuleMatcher })}
                    >
                      {MATCHERS.map((m) => (
                        <option key={m} value={m}>
                          {MATCHER_LABELS[m]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className={styles.field}>
                  <label htmlFor={`${id}-c${i}-value`}>{c.matcher === 'REGEX' ? 'Regular expression' : 'Value'}</label>
                  <input
                    id={`${id}-c${i}-value`}
                    type="text"
                    className={c.matcher === 'REGEX' ? styles.mono : undefined}
                    value={c.value}
                    maxLength={c.matcher === 'REGEX' ? limits.maxPatternLength : limits.maxConditionValueLength}
                    onChange={(e) => updateCondition(i, { value: e.target.value })}
                    autoComplete="off"
                  />
                  {c.matcher === 'REGEX' ? (
                    <span className={styles.hint}>RE2 syntax: no lookaround or backreferences.</span>
                  ) : null}
                </div>
                <label className={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    checked={c.ignoreCase ?? false}
                    onChange={(e) => updateCondition(i, { ignoreCase: e.target.checked })}
                  />
                  Ignore case
                </label>
                <FieldErrors errors={errorsAt(validationErrors, 'conditions', i)} />
                <Button
                  variant="ghost"
                  aria-label={`Remove condition ${i + 1}`}
                  onClick={() => updateDraft({ conditions: conditions.filter((_, j) => j !== i) })}
                >
                  Remove
                </Button>
              </fieldset>
            ))}
            <div className={styles.buttonRow}>
              <Button
                onClick={() =>
                  updateDraft({
                    conditions: [...conditions, { field: anchorField, matcher: 'CONTAINS', value: '', ignoreCase: false }],
                  })
                }
                disabled={conditions.length >= maxConditions}
              >
                Add condition
              </Button>
              {Number.isFinite(maxConditions) ? (
                <span className={styles.hint}>Up to {maxConditions} conditions.</span>
              ) : null}
            </div>
          </div>
        ) : null}
      </>
    );
  } else if (step === 'extraction') {
    const suggestions = suggestion?.suggestions ?? [];
    const selectedCount = suggestions.filter((s) => suggestionChoices[s.definition.name]?.selected).length;
    // The "nothing could be suggested" block already offers the manual route, so the step's action row does not
    // repeat it - one control, one name.
    const noSuggestionActionsShown = suggestion?.status === 'NO_SUGGESTION' && !suggesting;
    content = (
      <>
        {validationSummary}
        <p className={styles.hint}>
          Extraction pulls named values out of matching events - a URL, a status, a duration, a request path - so
          you can read them in the inspector without hunting through the message. It is optional, and values marked
          "Never show this value" are redacted by the server before they ever reach this window.
        </p>

        <section className={styles.subsection} aria-labelledby={`${id}-suggested`}>
          <h4 className={styles.minorHeading} id={`${id}-suggested`}>
            Suggested values
          </h4>
          {suggesting ? (
            <p role="status" className={styles.hint}>
              Looking for values in the events this rule matches…
            </p>
          ) : null}
          {suggestError ? (
            <p role="alert" className={styles.error}>
              {suggestError}
            </p>
          ) : null}
          {suggestion && !suggesting ? (
            <p className={styles.hint}>
              Read from {suggestion.matchedEvents} matching event{suggestion.matchedEvents === 1 ? '' : 's'} in the
              current search, out of {suggestion.sampledEvents} sampled. Counts describe this bounded sample only.
            </p>
          ) : null}
          {suggestion?.status === 'NO_SUGGESTION' && !suggesting ? (
            <div className={styles.emptyState}>
              <p>{suggestion.reason ?? 'No extraction could be suggested safely from the sampled events.'}</p>
              <div className={styles.buttonRow}>
                <Button onClick={runSuggestExtractions}>Detect extractable values again</Button>
                <Button onClick={addManualExtraction} disabled={extractions.length >= maxExtractions}>
                  Add extraction manually
                </Button>
                <Button variant="ghost" onClick={() => { setExtractionSkipped(true); setStep('test'); }}>
                  Skip extraction
                </Button>
              </div>
            </div>
          ) : null}
          {suggestions.length > 0 && !suggesting ? (
            <>
              <ul className={styles.suggestionList} aria-label="Suggested extractions">
                {suggestions.map((s: SuggestedExtraction) => {
                  const key = s.definition.name;
                  const choice = suggestionChoices[key] ?? { selected: false, name: key, sensitive: false };
                  return (
                    <li key={key} className={styles.suggestionRow}>
                      <label className={styles.checkboxRow}>
                        <input
                          type="checkbox"
                          checked={choice.selected}
                          onChange={(e) => updateSuggestionChoice(key, { selected: e.target.checked })}
                        />
                        <span className={styles.suggestionName}>{s.definition.label ?? key}</span>
                      </label>
                      <span className={styles.suggestionCoverage}>
                        Found in {s.extracted} / {s.of}
                      </span>
                      <div className={styles.field}>
                        <label htmlFor={`${id}-sg-${key}`}>Output name</label>
                        <input
                          id={`${id}-sg-${key}`}
                          type="text"
                          value={choice.name}
                          maxLength={limits.maxExtractionNameLength}
                          onChange={(e) => updateSuggestionChoice(key, { name: e.target.value })}
                          autoComplete="off"
                        />
                      </div>
                      <label className={styles.checkboxRow}>
                        <input
                          type="checkbox"
                          checked={choice.sensitive}
                          onChange={(e) => updateSuggestionChoice(key, { sensitive: e.target.checked })}
                        />
                        Never show this value
                      </label>
                      <Button
                        variant="ghost"
                        aria-label={`Remove suggestion ${choice.name || key}`}
                        onClick={() =>
                          setSuggestion((prev) =>
                            prev ? { ...prev, suggestions: prev.suggestions.filter((o) => o.definition.name !== key) } : prev,
                          )
                        }
                      >
                        Remove
                      </Button>
                    </li>
                  );
                })}
              </ul>
              <div className={styles.buttonRow}>
                <Button variant="primary" onClick={addSelectedSuggestions} disabled={selectedCount === 0}>
                  Add {selectedCount} selected value{selectedCount === 1 ? '' : 's'}
                </Button>
                <Button onClick={runSuggestExtractions}>Detect extractable values again</Button>
              </div>
            </>
          ) : null}
          {!suggestion && !suggesting && !suggestError ? (
            <div className={styles.buttonRow}>
              <Button onClick={runSuggestExtractions}>Detect extractable values</Button>
            </div>
          ) : null}
          {suggestion && suggestion.alreadyDefined.length > 0 ? (
            <p className={styles.hint}>Already extracted by this rule: {suggestion.alreadyDefined.join(', ')}.</p>
          ) : null}
        </section>

        <h4 className={styles.minorHeading}>Values this rule will extract</h4>
        {extractionSkipped && extractions.length === 0 ? (
          <p className={styles.hint}>Extraction skipped. The rule will still tag matching events.</p>
        ) : null}
        {extractions.length === 0 && !extractionSkipped ? (
          <p className={styles.hint}>None yet. Add a suggested value above, or add one yourself.</p>
        ) : null}
        {extractions.map((x, i) => (
          <fieldset key={i} className={styles.fieldset}>
            <legend className={styles.legend}>
              {x.name ? `${x.label ?? x.name} (confirmed)` : `Extraction ${i + 1}`}
            </legend>
            <div className={styles.rowGrid}>
              <div className={styles.field}>
                <label htmlFor={`${id}-x${i}-name`}>Name</label>
                <input
                  id={`${id}-x${i}-name`}
                  type="text"
                  value={x.name}
                  maxLength={limits.maxExtractionNameLength}
                  onChange={(e) => updateExtraction(i, { name: e.target.value })}
                  autoComplete="off"
                />
              </div>
              <div className={styles.field}>
                <label htmlFor={`${id}-x${i}-label`}>Label</label>
                <input
                  id={`${id}-x${i}-label`}
                  type="text"
                  value={x.label ?? ''}
                  maxLength={limits.maxLabelLength}
                  onChange={(e) => updateExtraction(i, { label: e.target.value })}
                  autoComplete="off"
                />
              </div>
              <div className={styles.field}>
                <label htmlFor={`${id}-x${i}-source`}>Source field</label>
                <input
                  id={`${id}-x${i}-source`}
                  type="text"
                  list={fieldsListId}
                  value={x.sourceField}
                  onChange={(e) => updateExtraction(i, { sourceField: e.target.value })}
                  autoComplete="off"
                />
              </div>
              <div className={styles.field}>
                <label htmlFor={`${id}-x${i}-value-type`}>Value type</label>
                <select
                  id={`${id}-x${i}-value-type`}
                  value={x.valueType ?? 'STRING'}
                  onChange={(e) => updateExtraction(i, { valueType: e.target.value as ExtractionValueType })}
                >
                  {VALUE_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className={styles.buttonRow}>
              <Button
                aria-expanded={openExtractionDetails[i] ?? false}
                aria-controls={`${id}-x${i}-advanced`}
                onClick={() => setOpenExtractionDetails((prev) => ({ ...prev, [i]: !prev[i] }))}
              >
                {(openExtractionDetails[i] ?? false) ? '▾' : '▸'} Advanced: how this value is read
              </Button>
            </div>
            {(openExtractionDetails[i] ?? false) ? (
              <div id={`${id}-x${i}-advanced`}>
                <div className={styles.rowGrid}>
                  <div className={styles.field}>
                    <label htmlFor={`${id}-x${i}-type`}>Method</label>
                    <select
                      id={`${id}-x${i}-type`}
                      value={x.type}
                      onChange={(e) => updateExtraction(i, { type: e.target.value as ExtractionType })}
                    >
                      {EXTRACTION_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.field}>
                    <label htmlFor={`${id}-x${i}-group`}>Group (optional)</label>
                    <input
                      id={`${id}-x${i}-group`}
                      type="text"
                      value={x.group ?? ''}
                      onChange={(e) => updateExtraction(i, { group: e.target.value })}
                      autoComplete="off"
                    />
                  </div>
                </div>
                <div className={styles.field}>
                  <label htmlFor={`${id}-x${i}-expression`}>Expression</label>
                  <input
                    id={`${id}-x${i}-expression`}
                    type="text"
                    className={styles.mono}
                    value={x.expression}
                    maxLength={limits.maxPatternLength}
                    onChange={(e) => updateExtraction(i, { expression: e.target.value })}
                    autoComplete="off"
                  />
                  <span className={styles.hint}>
                    {x.type === 'JSON_POINTER'
                      ? 'A JSON pointer starting with "/".'
                      : 'RE2 syntax with a named group, e.g. (?P<name>...).'}
                  </span>
                </div>
              </div>
            ) : null}
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={x.sensitive ?? false}
                onChange={(e) => updateExtraction(i, { sensitive: e.target.checked })}
              />
              Never show this value
            </label>
            <FieldErrors errors={errorsAt(validationErrors, 'extractions', i)} />
            <Button
              variant="ghost"
              aria-label={`Remove extraction ${x.name || i + 1}`}
              onClick={() => updateDraft({ extractions: extractions.filter((_, j) => j !== i) })}
            >
              Remove
            </Button>
          </fieldset>
        ))}
        <div className={styles.buttonRow}>
          {noSuggestionActionsShown ? null : (
            <Button onClick={addManualExtraction} disabled={extractions.length >= maxExtractions}>
              Add extraction manually
            </Button>
          )}
          <Button
            onClick={() => {
              setStep('test');
              runTest();
            }}
          >
            Preview values
          </Button>
        </div>
      </>
    );
  } else if (step === 'test') {
    content = (
      <>
        <p className={styles.hint}>
          Runs the draft rule against up to {sampleSize} events from the current search scope. Nothing is saved.
        </p>
        <div className={styles.buttonRow}>
          <Button variant="primary" onClick={runTest} disabled={testing}>
            {testing ? 'Testing…' : 'Test rule'}
          </Button>
        </div>
        {testing ? (
          <p role="status" className={styles.hint}>
            Testing…
          </p>
        ) : null}
        {testError ? (
          <p role="alert" className={styles.error}>
            {testError}
          </p>
        ) : null}
        {validationSummary}
        {testResult ? (
          <section aria-label="Test results" className={styles.section}>
            <ul className={styles.inlineStats}>
              <li>Sampled events: {testResult.sampledEvents}</li>
              <li>Matched: {testResult.matched}</li>
              <li>Not matched: {testResult.notMatched}</li>
            </ul>
            {testResult.sampleLimitReached ? (
              <p className={styles.hint}>
                Sample limit reached: only the first {testResult.sampledEvents} events in the scope were evaluated.
              </p>
            ) : null}
            {testResult.extractionCoverage.length > 0 ? (
              <>
                <h4 className={styles.minorHeading}>Extraction coverage</h4>
                <ul className={styles.plainList}>
                  {testResult.extractionCoverage.map((c) => (
                    <li key={c.name}>
                      {c.label || c.name} — {c.extracted} / {c.of}
                      {c.invalid > 0 ? ` (${c.invalid} could not be read)` : ''}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            <h4 className={styles.minorHeading}>Matched examples</h4>
            {testResult.matchedPreview.length > 0 ? (
              <PreviewList items={testResult.matchedPreview.slice(0, previewCount)} showConditions={false} />
            ) : (
              <p className={styles.hint}>No sampled event matched this rule.</p>
            )}
            {testResult.nearMissPreview.length > 0 ? (
              <>
                <h4 className={styles.minorHeading}>Borderline (matched some conditions)</h4>
                <PreviewList items={testResult.nearMissPreview.slice(0, previewCount)} showConditions />
              </>
            ) : null}
            <p className={styles.reviewNote}>{testResult.reviewNote}</p>
          </section>
        ) : null}
      </>
    );
  } else if (step === 'save') {
    content = (
      <>
        {validationSummary}
        <dl className={styles.summaryList}>
          <div className={styles.summaryRow}>
            <dt>Name</dt>
            <dd>{draft.name.trim() || EMPTY_VALUE}</dd>
          </div>
          <div className={styles.summaryRow}>
            <dt>Tags</dt>
            <dd>{tags.length > 0 ? tags.join(', ') : EMPTY_VALUE}</dd>
          </div>
          <div className={styles.summaryRow}>
            <dt>Enabled</dt>
            <dd>{(draft.enabled ?? true) ? 'Yes' : 'No'}</dd>
          </div>
          <div className={styles.summaryRow}>
            <dt>Conditions</dt>
            <dd>
              {conditions.length === 0
                ? 'None'
                : `${conditions.length} (${(draft.matchMode ?? 'ALL') === 'ALL' ? 'all must match' : 'any may match'})`}
            </dd>
          </div>
          <div className={styles.summaryRow}>
            <dt>Extractions</dt>
            <dd>{extractions.length > 0 ? extractions.map((x) => x.label || x.name || EMPTY_VALUE).join(', ') : 'None'}</dd>
          </div>
        </dl>
        {!testResult ? (
          <p className={styles.hint}>This draft has not been tested. Testing first is recommended.</p>
        ) : null}
        {saveIssues.length > 0 ? (
          <ul role="alert" className={styles.errorList}>
            {saveIssues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        ) : null}
        {saveError ? (
          <p role="alert" className={styles.error}>
            {saveError}
          </p>
        ) : null}
        {conflict ? (
          <div role="alert" className={styles.error}>
            <p>{REVISION_CONFLICT_MESSAGE}</p>
            <Button onClick={reloadRules}>Reload rules</Button>
          </div>
        ) : null}
        {reloadNotice ? (
          <p role="status" className={styles.notice}>
            {reloadNotice}
          </p>
        ) : null}
        <div className={styles.buttonRow}>
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save rule'}
          </Button>
        </div>
      </>
    );
  }

  return (
    <section aria-labelledby={`${id}-title`} className={styles.section}>
      <h2 id={`${id}-title`} className={styles.subheading}>
        {EDITOR_TITLES[mode]}
        {mode === 'edit' && initialRule.name ? `: ${initialRule.name}` : ''}
      </h2>
      <nav aria-label="Rule steps">
        <ol className={styles.steps}>
          {steps.map((s, i) => (
            <li key={s}>
              <button
                type="button"
                className={styles.stepButton}
                aria-current={s === step ? 'step' : undefined}
                onClick={() => setStep(s)}
              >
                {i + 1}. {STEP_LABELS[s]}
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <h3 ref={stepHeadingRef} tabIndex={-1} className={styles.stepHeading}>
        Step {stepIndex + 1} of {steps.length}: {STEP_LABELS[step]}
      </h3>
      <datalist id={fieldsListId}>
        {datalistKeys.map((k) => (
          <option key={k} value={k} />
        ))}
      </datalist>
      {content}
      <div className={styles.navRow}>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <div className={styles.buttonRow} style={{ margin: 0 }}>
          <Button onClick={() => setStep(steps[stepIndex - 1])} disabled={stepIndex <= 0}>
            Back
          </Button>
          {stepIndex < steps.length - 1 ? (
            <Button variant="primary" onClick={() => setStep(steps[stepIndex + 1])}>
              Next
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
