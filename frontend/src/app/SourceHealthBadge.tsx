import { useRef } from 'react';
import type { SourceHealthDetail } from '../shared/api/types';
import { Button } from '../shared/ui/Button';
import { usePopoverTrigger } from '../shared/ui/usePopoverTrigger';
import { useDismissableLayer } from '../shared/ui/useDismissableLayer';
import { formatUtcTimestamp } from '../features/inspector/timestampFormat';
import styles from './SourceHealthBadge.module.css';

const CAPABILITY_LABELS: Array<{ key: keyof NonNullable<SourceHealthDetail['capabilities']>; label: string }> = [
  { key: 'historicalSearch', label: 'Historical search' },
  { key: 'liveTail', label: 'Live' },
  { key: 'serviceDiscovery', label: 'Service discovery' },
  { key: 'rawLogQL', label: 'Raw query' },
  { key: 'contextView', label: 'Context' },
  { key: 'queryStatistics', label: 'Stats' },
];

export interface SourceHealthBadgeProps {
  health: SourceHealthDetail | null;
  loading: boolean;
  onRetry: () => void;
}

/**
 * Compact health state + retry for an unhealthy source
 * (IMPLEMENTATION_PLAN.md "Phase F" scope item 1). Legacy Remediation
 * Slice 6 adds progressive disclosure - a details popover with the
 * message, measured latency, sanitized degradation warnings, checked-at
 * time, and real capability availability - without opening a large
 * settings screen (mission's own "SOURCE HEALTH UX" requirement).
 *
 * <p>Opening the disclosure never re-checks health - it only reveals the
 * `health` prop already in memory, so it can never be "a search request
 * caused by opening health details" (this mission's own explicit test
 * requirement). A fresh check only ever happens via `onRetry` (explicit)
 * or a source switch (`useSearchState.ts#checkHealth`'s own effect) -
 * deliberately no periodic polling, so health checks can never become
 * "noisy repeated backend requests" (the mission's own explicit
 * prohibition) - zero interval-based network calls is the simplest way to
 * guarantee that.
 */
export function SourceHealthBadge({ health, loading, onRetry }: SourceHealthBadgeProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const popover = usePopoverTrigger();
  useDismissableLayer(wrapperRef, popover.isOpen, popover.close);

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
  // Text is the actual signal (never color alone, CLAUDE.md §7) - "Healthy"/"Degraded"/"Unhealthy" are visually and textually distinct from one another.
  const statusText = health.status === 'UP' ? 'Healthy' : health.status === 'DOWN' ? 'Unhealthy' : 'Degraded';

  return (
    <div ref={wrapperRef} className={styles.wrapper}>
      <span className={styles.badge} role="status">
        <span className={`${styles.dot} ${statusClass}`} aria-hidden="true" />
        {statusText}
        <button
          ref={popover.triggerRef}
          type="button"
          className={styles.detailsTrigger}
          aria-haspopup="true"
          aria-expanded={popover.isOpen}
          aria-label="Source health details"
          onClick={() => (popover.isOpen ? popover.close() : popover.open())}
        >
          ⓘ
        </button>
        {health.status !== 'UP' ? (
          <Button variant="ghost" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </span>

      {popover.isOpen ? (
        <div className={styles.details} role="dialog" aria-label="Source health details">
          <dl className={styles.detailsList}>
            <div className={styles.detailsRow}>
              <dt>Status</dt>
              <dd>{statusText}</dd>
            </div>
            <div className={styles.detailsRow}>
              <dt>Message</dt>
              <dd>{health.message ?? '—'}</dd>
            </div>
            <div className={styles.detailsRow}>
              <dt>Checked</dt>
              <dd>{formatUtcTimestamp(health.checkedAt)}</dd>
            </div>
            <div className={styles.detailsRow}>
              <dt>Latency</dt>
              <dd>{health.latencyMs != null ? `${health.latencyMs} ms` : 'Not measured'}</dd>
            </div>
          </dl>

          {health.warnings.length > 0 ? (
            <div className={styles.warnings}>
              <p className={styles.warningsTitle}>Warnings</p>
              <ul className={styles.warningsList}>
                {health.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {health.capabilities ? (
            <div className={styles.capabilities}>
              <p className={styles.capabilitiesTitle}>Capabilities</p>
              <ul className={styles.capabilitiesList}>
                {CAPABILITY_LABELS.map(({ key, label }) => (
                  <li key={key} className={health.capabilities![key] ? styles.capabilityAvailable : styles.capabilityUnavailable}>
                    {health.capabilities![key] ? '✓' : '✗'} {label}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className={styles.detailsActions}>
            <Button variant="ghost" onClick={popover.close}>
              Close
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
