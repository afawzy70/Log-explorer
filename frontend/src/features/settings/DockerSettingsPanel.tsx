import { useEffect, useId, useState } from 'react';
import { Button } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import { fetchDockerConnectionSummary, testDockerConnection } from '../../shared/api/client';
import type { DockerConnectionCandidate, DockerConnectionSummary, SourceHealth } from '../../shared/api/types';
import styles from './DockerSettingsPanel.module.css';

function emptyCandidate(): DockerConnectionCandidate {
  return { mode: 'LOCAL', host: '', port: undefined, tls: false, tlsCertPath: '' };
}

/**
 * Docker connection settings (Legacy Remediation Slice 3,
 * `docs/LEGACY_TO_NEW_REMEDIATION_PLAN.md` §"Slice 3"; B6.2 (Session 7)
 * recomposed this from a trigger-button popover into a persistent inline
 * section of the Settings workspace - COMPONENT_INVENTORY.md's own
 * `features/settings/DockerSettingsPanel.tsx` RECOMPOSE row: "Popover
 * dialog content moves into the Settings workspace... with a 'Docker
 * source only' scope tag and a read-only marker on configured values."
 * The summary now fetches on mount instead of on trigger-click - `Settings
 * WorkspacePanel` mounts fresh every time Settings itself is opened
 * (`App.tsx`'s own takeover ternary), which is what gives this the same
 * "always a fresh fetch, never a stale one" guarantee the old open/close
 * cycle used to provide explicitly.
 *
 * <p><b>Read-only by design.</b> This deployment has no authenticated
 * admin boundary, so there is deliberately no "Save"/"Apply" action here -
 * only the current effective (sanitized) connection summary and an
 * ephemeral Test Connection, exactly mirroring the backend's own
 * `api.DockerSettingsController` javadoc. `settingsNote` (from the
 * backend, never hardcoded here so the two can never drift) explains that
 * permanent changes require deployment/runtime configuration and a
 * restart.
 *
 * <p>The Test Connection candidate form is local component state only -
 * never written to `localStorage`/`sessionStorage`/the URL (CLAUDE.md §2
 * rule 4), and discarded whenever this component unmounts (Settings
 * closes) or the page reloads.
 */
export function DockerSettingsPanel() {
  const headingId = useId();

  const [summary, setSummary] = useState<DockerConnectionSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [candidate, setCandidate] = useState<DockerConnectionCandidate>(emptyCandidate());
  const [testResult, setTestResult] = useState<SourceHealth | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setSummaryLoading(true);
    setSummaryError(null);
    fetchDockerConnectionSummary()
      .then((result) => {
        setSummary(result);
        // Prefill the Test Connection candidate from the current
        // effective config, purely as a starting point for editing - it
        // is still never submitted/persisted until the user explicitly
        // clicks Test Connection.
        setCandidate({
          mode: result.mode,
          host: result.host ?? '',
          port: result.port ?? undefined,
          tls: result.tlsEnabled,
          tlsCertPath: '',
        });
      })
      .catch((error: unknown) => setSummaryError(error instanceof Error ? error.message : 'Failed to load Docker connection settings'))
      .finally(() => setSummaryLoading(false));
    // Mount-once fetch, matching the old "fetch on every open" cadence -
    // this component itself only ever mounts once per Settings-workspace
    // open (see the doc comment above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function runTestConnection() {
    setTesting(true);
    setTestResult(null);
    setTestError(null);
    const body: DockerConnectionCandidate = {
      mode: candidate.mode,
      ...(candidate.mode === 'REMOTE'
        ? {
            host: candidate.host || undefined,
            port: candidate.port,
            tls: candidate.tls ?? false,
            ...(candidate.tls ? { tlsCertPath: candidate.tlsCertPath || undefined } : {}),
          }
        : {}),
    };
    testDockerConnection(body)
      .then(setTestResult)
      .catch((error: unknown) => setTestError(error instanceof Error ? error.message : 'Test Connection failed'))
      .finally(() => setTesting(false));
  }

  return (
    <section className={styles.panel} aria-labelledby={headingId} data-testid="docker-settings-panel">
      <div className={styles.panelHead}>
        <h2 id={headingId} className={styles.heading}>
          Local Docker
        </h2>
        <span className={styles.scopeTag}>
          <Icon name="box" size="sm" />
          Docker source only
        </span>
        <span className={styles.roTag}>
          <Icon name="lock" size="sm" />
          Read-only — set by deployment configuration
        </span>
      </div>

      <div className={styles.panelBody}>
        {summaryLoading ? <p role="status">Loading…</p> : null}
        {summaryError ? (
          <p role="alert" className={styles.error}>
            {summaryError}
          </p>
        ) : null}

        {summary ? (
          <dl className={styles.summaryList}>
            <dt>Mode</dt>
            <dd>{summary.mode === 'REMOTE' ? 'Remote' : 'Local'}</dd>
            {summary.mode === 'REMOTE' ? (
              <>
                {/* UX-R3 §6 - purely cosmetic label, never a security identity; the actual authorization boundary stays host/port/TLS below, unchanged. */}
                <dt>Connection name</dt>
                <dd>{summary.connectionName ?? 'Not set'}</dd>
                <dt>Host</dt>
                <dd>{summary.host}</dd>
                <dt>Port</dt>
                <dd>{summary.port}</dd>
              </>
            ) : null}
            <dt>TLS</dt>
            <dd>{summary.tlsEnabled ? 'Enabled' : 'Disabled'}</dd>
            <dt>Compose project filter</dt>
            <dd>{summary.composeProjectFilter ?? 'None configured — every Compose project is visible'}</dd>
          </dl>
        ) : null}

        {summary ? <p className={styles.note}>{summary.settingsNote}</p> : null}
      </div>

      <div className={styles.subPanel}>
        <h3 className={styles.subheading}>Test a connection</h3>
        <p className={styles.hint}>This checks connectivity only — it never changes the running application's actual Docker connection.</p>

        <div className={styles.field}>
          <label htmlFor={`${headingId}-mode`}>Mode</label>
          <select
            id={`${headingId}-mode`}
            value={candidate.mode}
            onChange={(event) => setCandidate((prev) => ({ ...prev, mode: event.target.value as 'LOCAL' | 'REMOTE' }))}
          >
            <option value="LOCAL">Local</option>
            <option value="REMOTE">Remote</option>
          </select>
        </div>

        {candidate.mode === 'REMOTE' ? (
          <>
            <div className={styles.field}>
              <label htmlFor={`${headingId}-host`}>Host</label>
              <input
                id={`${headingId}-host`}
                type="text"
                autoComplete="off"
                value={candidate.host ?? ''}
                onChange={(event) => setCandidate((prev) => ({ ...prev, host: event.target.value }))}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor={`${headingId}-port`}>Port</label>
              <input
                id={`${headingId}-port`}
                type="number"
                placeholder="2375"
                autoComplete="off"
                value={candidate.port ?? ''}
                onChange={(event) =>
                  setCandidate((prev) => ({ ...prev, port: event.target.value ? Number(event.target.value) : undefined }))
                }
              />
            </div>
            <div className={styles.checkboxField}>
              <input
                id={`${headingId}-tls`}
                type="checkbox"
                checked={candidate.tls ?? false}
                onChange={(event) => setCandidate((prev) => ({ ...prev, tls: event.target.checked }))}
              />
              <label htmlFor={`${headingId}-tls`}>Use TLS (certificate verification is always required when enabled)</label>
            </div>
            {candidate.tls ? (
              <div className={styles.field}>
                <label htmlFor={`${headingId}-cert`}>Certificate directory path (server filesystem)</label>
                <input
                  id={`${headingId}-cert`}
                  type="text"
                  autoComplete="off"
                  placeholder="/path/to/ca-cert-key-dir"
                  value={candidate.tlsCertPath ?? ''}
                  onChange={(event) => setCandidate((prev) => ({ ...prev, tlsCertPath: event.target.value }))}
                />
              </div>
            ) : null}
          </>
        ) : null}

        <div className={styles.editorRow}>
          <Button variant="secondary" onClick={runTestConnection} disabled={testing}>
            {testing ? 'Testing…' : 'Test Connection'}
          </Button>

          {testResult ? (
            <p role="status" className={testResult.status === 'UP' ? styles.testUp : styles.testDown}>
              {testResult.status === 'UP' ? 'Reachable' : testResult.status === 'DOWN' ? 'Unreachable' : 'Degraded'}
              {testResult.message ? `: ${testResult.message}` : ''}
            </p>
          ) : null}
          {testError ? (
            <p role="alert" className={styles.error}>
              {testError}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
