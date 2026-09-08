import type { SourceHealth } from '../shared/api/types';
import { Button } from '../shared/ui/Button';
import styles from './SourceHealthBadge.module.css';

export interface SourceHealthBadgeProps {
  health: SourceHealth | null;
  loading: boolean;
  onRetry: () => void;
}

/** Compact health state + retry for an unhealthy source (IMPLEMENTATION_PLAN.md "Phase F" scope item 1). */
export function SourceHealthBadge({ health, loading, onRetry }: SourceHealthBadgeProps) {
  if (loading) {
    return (
      <span className={styles.badge}>
        <span className={`${styles.dot} ${styles.unknown}`} aria-hidden="true" />
        Checking…
      </span>
    );
  }

  if (!health) {
    return (
      <span className={styles.badge}>
        <span className={`${styles.dot} ${styles.unknown}`} aria-hidden="true" />
        Unknown
      </span>
    );
  }

  const statusClass =
    health.status === 'UP' ? styles.up : health.status === 'DOWN' ? styles.down : styles.degraded;

  return (
    <span className={styles.badge} role="status">
      <span className={`${styles.dot} ${statusClass}`} aria-hidden="true" />
      {health.status === 'UP' ? 'Healthy' : health.status === 'DOWN' ? 'Unhealthy' : 'Degraded'}
      {health.status !== 'UP' ? (
        <Button variant="ghost" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </span>
  );
}
