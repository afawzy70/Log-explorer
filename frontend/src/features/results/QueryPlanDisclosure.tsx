import type { ReactNode } from 'react';
import { Icon } from '../../shared/ui/Icon';
import type { QueryPlan } from '../../shared/api/types';
import styles from './QueryPlanDisclosure.module.css';

export interface QueryPlanDisclosureProps {
  queryPlan: QueryPlan;
}

/**
 * "Query plan UI: render as compact progressive disclosure ... collapsed
 * by default" (Legacy Remediation Slice 2,
 * `docs/LEGACY_TO_NEW_REMEDIATION_PLAN.md` §"Slice 2"). A native
 * `<details>` - no extra JS state, no auto-expand, keyboard-operable by
 * default. Every value here already arrived pre-redacted from the backend
 * (`core.query.QueryPlanBuilder`/`QueryPlanDto`) - this component performs
 * no masking itself, it only renders already-safe strings, exactly the
 * "server-side redaction, never frontend masking" posture the mission
 * requires.
 *
 * <p>B2 (Session 4) RECOMPOSE - "opens from Query details in the scope
 * strip instead of an inline disclosure" (`COMPONENT_INVENTORY.md`).
 * Deliberately keeps the exact same `<details>`/`<summary>` mechanism
 * (still collapsed by default, still keyboard-operable, no extra JS
 * state) rather than rebuilding it as a `usePopoverTrigger`/
 * `useDismissableLayer` popover - only `.details`/`.body`'s own CSS
 * changes, to sit as a compact dropdown anchored under the "Query
 * details" trigger inside the strip's right-hand control group instead
 * of an inline block above the table.
 */
export function QueryPlanDisclosure({ queryPlan }: QueryPlanDisclosureProps) {
  return (
    <details className={styles.details}>
      <summary className={styles.summary}>
        <Icon name="braces" size="sm" />
        Query details
      </summary>
      <div className={styles.body}>
        <Row label="Executed query">
          <code className={styles.code}>{queryPlan.resolvedQuery}</code>
          {queryPlan.rawLogQlMode ? <span className={styles.rawBadge}>Raw LogQL</span> : null}
        </Row>
        <Row label="Pushed to source">
          {queryPlan.pushedDownConditions.length === 0 ? (
            <span className={styles.muted}>None — every condition was applied after retrieval</span>
          ) : (
            <ul className={styles.list}>
              {queryPlan.pushedDownConditions.map((condition) => (
                <li key={condition}>{condition}</li>
              ))}
            </ul>
          )}
        </Row>
        <Row label="Applied after retrieval">
          {queryPlan.postFilterConditions.length === 0 ? (
            <span className={styles.muted}>None — no structured filters or query conditions are active</span>
          ) : (
            <ul className={styles.list}>
              {queryPlan.postFilterConditions.map((condition) => (
                <li key={condition}>{condition}</li>
              ))}
            </ul>
          )}
        </Row>
        {queryPlan.notes.length > 0 ? (
          <Row label="Notes">
            <ul className={styles.list}>
              {queryPlan.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </Row>
        ) : null}
      </div>
    </details>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <div className={styles.rowContent}>{children}</div>
    </div>
  );
}
