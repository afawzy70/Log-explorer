import { useId } from 'react';
import styles from './ComposeProjectSelect.module.css';

export interface ComposeProjectSelectProps {
  projects: string[];
  selected: string | null;
  loading: boolean;
  error: string | null;
  onChange: (project: string | null) => void;
}

/**
 * UX-R3 §5/§6/§9 — runtime Docker Compose project discovery/selection.
 * Rendered in the toolbar only when the active source's own capabilities
 * report `composeProjectScoping` (never inferred, never shown for a source
 * that has no real Compose-project concept). "All projects" (`value=""`,
 * mapped to `null`) is the explicit unscoped choice - it preserves today's
 * pre-UX-R3 behavior (whatever the deployment's own static
 * `composeProjectFilter`, if any, already does) rather than silently
 * forcing every existing deployment into a newly-required single-project
 * scope. The empty-state message is the truthful one the backend's own
 * discovery endpoint is documented to justify (§9) - never a fabricated
 * project list.
 */
export function ComposeProjectSelect({ projects, selected, loading, error, onChange }: ComposeProjectSelectProps) {
  const id = useId();
  const empty = !loading && !error && projects.length === 0;

  return (
    <div className={styles.wrapper}>
      <label htmlFor={id} className={styles.label}>
        Compose project
      </label>
      <select
        id={id}
        className={styles.select}
        value={selected ?? ''}
        disabled={loading || empty}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
      >
        <option value="">All projects</option>
        {projects.map((project) => (
          <option key={project} value={project}>
            {project}
          </option>
        ))}
      </select>
      {error ? (
        <span role="alert" className={styles.error}>
          Could not list Compose projects: {error}
        </span>
      ) : empty ? (
        <span className={styles.empty}>No Docker Compose projects detected on this Docker engine</span>
      ) : null}
    </div>
  );
}
