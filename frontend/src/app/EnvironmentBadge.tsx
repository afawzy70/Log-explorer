import { useEffect, useState } from 'react';
import { fetchEnvironmentInfo } from '../shared/api/client';
import styles from './EnvironmentBadge.module.css';

/**
 * UI Gap Closure Pass - a compact, truthful environment/profile indicator
 * (`docs/verification/UI_GAP_CLOSURE_REPORT.md`). Fetches `/actuator/info`
 * once (the active Spring profile does not change during a running
 * session - no polling needed) and renders exactly the server's own
 * verbatim label (`EnvironmentInfoContributor`, e.g. "dev", "default",
 * "dev,test") - never a hardcoded/guessed value. Renders nothing at all
 * if the fetch fails or the field is genuinely absent, rather than
 * falling back to a fabricated label (mission: "Never display a guessed
 * deployment environment").
 *
 * <p>Deliberately visually distinct from the active-source name next to
 * it in `Shell.tsx` (a plain-text span) - this is a small monospace,
 * bordered, uppercase badge, so "environment" and "source" are never
 * mistakable for one another at a glance.
 */
export function EnvironmentBadge() {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchEnvironmentInfo(controller.signal)
      .then((info) => {
        const value = info.environment?.label?.trim();
        setLabel(value ? value : null);
      })
      .catch(() => {
        // Genuinely unknown - render nothing, never a guessed fallback.
      });
    return () => controller.abort();
  }, []);

  if (!label) {
    return null;
  }

  return (
    <span className={styles.badge} title={`Active backend profile: ${label}`}>
      {label.toUpperCase()}
    </span>
  );
}
