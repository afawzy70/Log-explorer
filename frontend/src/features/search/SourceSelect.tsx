import { useId } from 'react';
import type { SourceInfo } from '../../shared/api/types';
import { VisuallyHidden } from '../../shared/ui/VisuallyHidden';
import { isSourceSelectableInUi, orderSourcesForSelector, sourceOptionLabel } from './sourcePolicy';
import styles from './SourceSelect.module.css';

export interface SourceSelectProps {
  sources: SourceInfo[];
  selectedId: string | null;
  onChange: (sourceId: string) => void;
}

/**
 * First control in the default toolbar order (IMPLEMENTATION_PLAN.md "Phase F" scope item 2).
 *
 * Sources are listed in the explicit selector policy order (`sourcePolicy.ts`).
 * A source that is not selectable in the UI (currently OpenShift Loki) stays
 * visible as a native disabled option, so neither mouse nor keyboard can
 * choose it and assistive technology announces it as unavailable; `onChange`
 * is additionally guarded so it can never report such a source.
 */
export function SourceSelect({ sources, selectedId, onChange }: SourceSelectProps) {
  const id = useId();
  const ordered = orderSourcesForSelector(sources);
  const hasSelectableSource = ordered.some((source) => isSourceSelectableInUi(source.id));
  return (
    <div>
      <label htmlFor={id}>
        <VisuallyHidden>Source</VisuallyHidden>
      </label>
      <select
        id={id}
        className={styles.select}
        value={selectedId ?? ''}
        onChange={(event) => {
          const next = event.target.value;
          if (next && isSourceSelectableInUi(next)) {
            onChange(next);
          }
        }}
      >
        {ordered.length > 0 && !hasSelectableSource ? (
          <option value="" disabled>
            No available source
          </option>
        ) : null}
        {ordered.map((source) => (
          <option key={source.id} value={source.id} disabled={!isSourceSelectableInUi(source.id)}>
            {sourceOptionLabel(source)}
          </option>
        ))}
      </select>
    </div>
  );
}
