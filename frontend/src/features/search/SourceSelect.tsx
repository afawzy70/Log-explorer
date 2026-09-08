import { useId } from 'react';
import type { SourceInfo } from '../../shared/api/types';
import { VisuallyHidden } from '../../shared/ui/VisuallyHidden';
import styles from './SourceSelect.module.css';

export interface SourceSelectProps {
  sources: SourceInfo[];
  selectedId: string | null;
  onChange: (sourceId: string) => void;
}

/** First control in the default toolbar order (IMPLEMENTATION_PLAN.md "Phase F" scope item 2). */
export function SourceSelect({ sources, selectedId, onChange }: SourceSelectProps) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id}>
        <VisuallyHidden>Source</VisuallyHidden>
      </label>
      <select
        id={id}
        className={styles.select}
        value={selectedId ?? ''}
        onChange={(event) => onChange(event.target.value)}
      >
        {sources.map((source) => (
          <option key={source.id} value={source.id}>
            {source.displayName}
          </option>
        ))}
      </select>
    </div>
  );
}
