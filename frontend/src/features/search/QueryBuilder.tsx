import { useId, useRef, useState } from 'react';
import { Button } from '../../shared/ui/Button';
import { VisuallyHidden } from '../../shared/ui/VisuallyHidden';
import { useDismissableLayer } from '../../shared/ui/useDismissableLayer';
import { usePopoverTrigger } from '../../shared/ui/usePopoverTrigger';
import {
  addCondition,
  addGroup,
  emptyGroup,
  hasAnyCondition,
  MAX_GUIDED_DEPTH,
  operatorsFor,
  QUERY_FIELDS,
  removeNode,
  serializeQueryTree,
  setGroupCombinator,
  updateCondition,
} from './queryAuthoring';
import type { QueryCondition, QueryGroup, QueryOperator } from './queryAuthoring';
import styles from './QueryBuilder.module.css';

export type QueryMode = 'guided' | 'text' | 'rawLogQl';

/**
 * The canonical query-authoring state (Legacy Remediation Slice 2) -
 * "Define one canonical authoring state and explicit conversion behavior."
 * `mode` selects which of `tree`/`text`/`rawLogQl` is currently the active
 * source of truth for what gets sent to the backend; the other two are
 * simply preserved (never silently discarded) so switching modes back and
 * forth never loses work, except the one explicitly-warned destructive
 * case documented on `QueryBuilder` itself (typed text that no longer
 * matches what the guided tree would generate).
 */
export interface QueryAuthoringState {
  mode: QueryMode;
  tree: QueryGroup;
  text: string;
  rawLogQl: string;
}

export function emptyQueryAuthoringState(): QueryAuthoringState {
  return { mode: 'guided', tree: emptyGroup(), text: '', rawLogQl: '' };
}

/** Whether `state` would actually add anything to a request - drives the toolbar's active-query indicator. */
export function isQueryActive(state: QueryAuthoringState): boolean {
  if (state.mode === 'rawLogQl') {
    return state.rawLogQl.trim() !== '';
  }
  if (state.mode === 'text') {
    return state.text.trim() !== '';
  }
  return hasAnyCondition(state.tree);
}

/** The exact string this authoring state resolves to for `SearchRequestBody.query` (`undefined` when there is none). */
export function resolveQueryText(state: QueryAuthoringState): string | undefined {
  if (state.mode === 'rawLogQl') {
    return undefined;
  }
  const text = state.mode === 'guided' ? serializeQueryTree(state.tree) : state.text;
  return text.trim() === '' ? undefined : text;
}

export function resolveRawLogQl(state: QueryAuthoringState): string | undefined {
  if (state.mode !== 'rawLogQl') {
    return undefined;
  }
  return state.rawLogQl.trim() === '' ? undefined : state.rawLogQl;
}

export interface QueryBuilderProps {
  value: QueryAuthoringState;
  onApply: (next: QueryAuthoringState) => void;
  /** Mirrors `SourceCapabilities.rawLogQL` for the currently-selected source (CLAUDE.md §4: "the frontend never infers what a source can do"). */
  rawLogQlSupported: boolean;
}

/**
 * The compact "Query" affordance (Legacy Remediation Slice 2,
 * `docs/LEGACY_TO_NEW_REMEDIATION_PLAN.md` §"Slice 2"). Draft/apply/cancel,
 * the same interaction shape `AdvancedFilters` already established: edits
 * only ever exist in local draft state until Apply - opening, typing, and
 * even Cancel/Escape/outside-click never fire a search or mutate the
 * committed query (`onApply` is the only path that reaches the parent, and
 * applying still only updates state - the toolbar's own Search button is
 * what actually runs a query).
 *
 * <p>Guided -> Text is always a safe, lossless conversion (pure
 * serialization, `serializeQueryTree`). Text -> Guided is the one
 * genuinely destructive direction: there is deliberately no DSL parser on
 * the frontend (see `queryAuthoring.ts`'s own doc comment - building one
 * would duplicate the backend grammar, which the mission explicitly
 * forbids), so arbitrary typed text can only safely become "guided mode,
 * unchanged" when it still matches what the tree would itself generate;
 * any other edit switching to guided requires an explicit confirmation
 * that starts a fresh guided query, never a silently fabricated tree.
 */
export function QueryBuilder({ value, onApply, rawLogQlSupported }: QueryBuilderProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const popover = usePopoverTrigger();
  const [draft, setDraft] = useState<QueryAuthoringState>(value);
  const [confirmingTextToGuidedReset, setConfirmingTextToGuidedReset] = useState(false);
  const headingId = useId();

  useDismissableLayer(wrapperRef, popover.isOpen, closeWithoutApplying);

  function openPanel() {
    setDraft(value);
    setConfirmingTextToGuidedReset(false);
    popover.open();
  }

  function closeWithoutApplying() {
    setConfirmingTextToGuidedReset(false);
    popover.close();
  }

  function handleApply() {
    onApply(draft);
    popover.close();
  }

  function handleClear() {
    setDraft(emptyQueryAuthoringState());
    setConfirmingTextToGuidedReset(false);
  }

  function switchToTextMode() {
    setDraft((prev) => ({ ...prev, mode: 'text', text: serializeQueryTree(prev.tree) }));
  }

  function switchToGuidedMode() {
    setDraft((prev) => {
      if (prev.text.trim() === serializeQueryTree(prev.tree).trim()) {
        return { ...prev, mode: 'guided' };
      }
      setConfirmingTextToGuidedReset(true);
      return prev;
    });
  }

  function confirmDiscardTextAndSwitchToGuided() {
    setDraft((prev) => ({ ...prev, mode: 'guided', tree: emptyGroup(), text: '' }));
    setConfirmingTextToGuidedReset(false);
  }

  const generatedDsl = serializeQueryTree(draft.tree);
  const active = isQueryActive(value);

  return (
    <div ref={wrapperRef} className={styles.wrapper}>
      <button
        ref={popover.triggerRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="true"
        aria-expanded={popover.isOpen}
        onClick={() => (popover.isOpen ? closeWithoutApplying() : openPanel())}
      >
        <span>Query</span>
        {active ? (
          <span className={styles.badge}>
            <VisuallyHidden>Query active</VisuallyHidden>
            <span aria-hidden="true">●</span>
          </span>
        ) : null}
      </button>

      {popover.isOpen ? (
        <div className={styles.panel} role="dialog" aria-labelledby={headingId}>
          <h2 id={headingId} className={styles.heading}>
            Query
          </h2>

          <div className={styles.modeTabs} role="tablist" aria-label="Query mode">
            <button
              type="button"
              role="tab"
              aria-selected={draft.mode === 'guided'}
              className={draft.mode === 'guided' ? styles.modeTabActive : styles.modeTab}
              onClick={switchToGuidedMode}
            >
              Guided
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={draft.mode === 'text'}
              className={draft.mode === 'text' ? styles.modeTabActive : styles.modeTab}
              onClick={switchToTextMode}
            >
              Text
            </button>
            {rawLogQlSupported ? (
              <button
                type="button"
                role="tab"
                aria-selected={draft.mode === 'rawLogQl'}
                className={draft.mode === 'rawLogQl' ? styles.modeTabActive : styles.modeTab}
                onClick={() => setDraft((prev) => ({ ...prev, mode: 'rawLogQl' }))}
              >
                Raw LogQL
              </button>
            ) : null}
          </div>

          {draft.mode === 'guided' ? (
            <div className={styles.guidedBody}>
              <GroupEditor
                group={draft.tree}
                depth={0}
                onChange={(next) => setDraft((prev) => ({ ...prev, tree: next }))}
              />
              <div className={styles.generatedPreview}>
                <span className={styles.generatedLabel}>Generated query</span>
                <code className={styles.generatedCode}>{generatedDsl === '' ? '(no query)' : generatedDsl}</code>
              </div>
            </div>
          ) : null}

          {draft.mode === 'text' ? (
            <div className={styles.textBody}>
              <label htmlFor={`${headingId}-text`} className={styles.textLabel}>
                Query text
              </label>
              <textarea
                id={`${headingId}-text`}
                className={styles.textarea}
                rows={4}
                spellCheck={false}
                value={draft.text}
                onChange={(event) => setDraft((prev) => ({ ...prev, text: event.target.value }))}
                placeholder='service = "gateway" and level = "ERROR"'
              />
              {confirmingTextToGuidedReset ? (
                <div className={styles.confirmBanner} role="alertdialog" aria-label="Confirm switch to guided mode">
                  <p>Switching to guided mode will discard this typed query text and start a new guided query.</p>
                  <div className={styles.confirmActions}>
                    <Button variant="ghost" onClick={() => setConfirmingTextToGuidedReset(false)}>
                      Keep editing text
                    </Button>
                    <Button variant="secondary" onClick={confirmDiscardTextAndSwitchToGuided}>
                      Discard and switch
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {draft.mode === 'rawLogQl' ? (
            <div className={styles.textBody}>
              <p className={styles.expertNote}>
                Advanced: executed directly against the source, bypassing the generated query. Off by default.
              </p>
              <label htmlFor={`${headingId}-rawlogql`} className={styles.textLabel}>
                Raw LogQL
              </label>
              <textarea
                id={`${headingId}-rawlogql`}
                className={styles.textarea}
                rows={4}
                spellCheck={false}
                value={draft.rawLogQl}
                onChange={(event) => setDraft((prev) => ({ ...prev, rawLogQl: event.target.value }))}
                placeholder='{namespace="prod",app="gateway"}'
              />
            </div>
          ) : null}

          <div className={styles.actions}>
            <Button variant="ghost" onClick={handleClear}>
              Clear
            </Button>
            <div className={styles.actionsRight}>
              <Button variant="ghost" onClick={closeWithoutApplying}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleApply}>
                Apply
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ConditionEditor({
  condition,
  onChange,
  onRemove,
}: {
  condition: QueryCondition;
  onChange: (patch: Partial<Omit<QueryCondition, 'kind' | 'id'>>) => void;
  onRemove: () => void;
}) {
  const availableOperators = operatorsFor(condition.field);
  return (
    <div className={styles.conditionRow}>
      <label className={styles.visuallyHiddenLabel} htmlFor={`${condition.id}-field`}>
        Field
      </label>
      <select
        id={`${condition.id}-field`}
        className={styles.fieldSelect}
        value={condition.field}
        onChange={(event) => {
          const field = event.target.value as QueryCondition['field'];
          const nextOperators = operatorsFor(field);
          onChange({ field, operator: nextOperators.includes(condition.operator) ? condition.operator : nextOperators[0] });
        }}
      >
        {QUERY_FIELDS.map((f) => (
          <option key={f.alias} value={f.alias}>
            {f.label}
          </option>
        ))}
      </select>

      <label className={styles.visuallyHiddenLabel} htmlFor={`${condition.id}-operator`}>
        Operator
      </label>
      <select
        id={`${condition.id}-operator`}
        className={styles.operatorSelect}
        value={condition.operator}
        onChange={(event) => onChange({ operator: event.target.value as QueryOperator })}
      >
        {availableOperators.map((op) => (
          <option key={op} value={op}>
            {op}
          </option>
        ))}
      </select>

      <label className={styles.visuallyHiddenLabel} htmlFor={`${condition.id}-value`}>
        Value
      </label>
      <input
        id={`${condition.id}-value`}
        type="text"
        className={styles.valueInput}
        value={condition.value}
        onChange={(event) => onChange({ value: event.target.value })}
        autoComplete="off"
      />

      <Button variant="ghost" aria-label="Remove condition" onClick={onRemove}>
        ✕
      </Button>
    </div>
  );
}

function GroupEditor({
  group,
  depth,
  onChange,
}: {
  group: QueryGroup;
  depth: number;
  onChange: (next: QueryGroup) => void;
}) {
  const canNest = depth < MAX_GUIDED_DEPTH;

  return (
    <fieldset className={styles.group}>
      <legend className={styles.groupLegend}>
        <VisuallyHidden>Match</VisuallyHidden>
        <span className={styles.combinatorToggle} role="group" aria-label="Match">
          <button
            type="button"
            aria-pressed={group.combinator === 'AND'}
            className={group.combinator === 'AND' ? styles.combinatorActive : styles.combinatorButton}
            onClick={() => onChange(setGroupCombinator(group, group.id, 'AND'))}
          >
            All (AND)
          </button>
          <button
            type="button"
            aria-pressed={group.combinator === 'OR'}
            className={group.combinator === 'OR' ? styles.combinatorActive : styles.combinatorButton}
            onClick={() => onChange(setGroupCombinator(group, group.id, 'OR'))}
          >
            Any (OR)
          </button>
        </span>
      </legend>

      {group.children.map((child) => (
        <div key={child.id} className={styles.childRow}>
          {child.kind === 'condition' ? (
            <ConditionEditor
              condition={child}
              onChange={(patch) => onChange(updateCondition(group, child.id, patch))}
              onRemove={() => onChange(removeNode(group, child.id))}
            />
          ) : (
            <div className={styles.nestedGroup}>
              <GroupEditor
                group={child}
                depth={depth + 1}
                onChange={(nextChild) =>
                  onChange({
                    ...group,
                    children: group.children.map((c) => (c.id === child.id ? nextChild : c)),
                  })
                }
              />
              <Button variant="ghost" aria-label="Remove group" onClick={() => onChange(removeNode(group, child.id))}>
                Remove group
              </Button>
            </div>
          )}
        </div>
      ))}

      <div className={styles.groupActions}>
        <Button variant="ghost" onClick={() => onChange(addCondition(group, group.id))}>
          + Condition
        </Button>
        {canNest ? (
          <Button variant="ghost" onClick={() => onChange(addGroup(group, group.id))}>
            + Group
          </Button>
        ) : null}
      </div>
    </fieldset>
  );
}
