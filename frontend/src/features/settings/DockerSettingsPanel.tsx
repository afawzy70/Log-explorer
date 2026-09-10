import { useId, useRef, useState } from 'react';
import { Button } from '../../shared/ui/Button';
import { useDismissableLayer } from '../../shared/ui/useDismissableLayer';
import { usePopoverTrigger } from '../../shared/ui/usePopoverTrigger';
import { fetchDockerConnectionSummary, testDockerConnection } from '../../shared/api/client';
import type { DockerConnectionCandidate, DockerConnectionSummary, SourceHealth } from '../../shared/api/types';
import styles from './DockerSettingsPanel.module.css';

function emptyCandidate(): DockerConnectionCandidate {
  return { mode: 'LOCAL', host: '', port: undefined, tls: false, tlsCertPath: '' };
}

/**
 * Docker connection/settings workspace (Legacy Remediation Slice 3,
 * `docs/LEGACY_TO_NEW_REMEDIATION_PLAN.md` §"Slice 3"). A compact
 * progressive-disclosure popover - never a full-page settings screen, and
 * opening/closing it never touches the current search/results (it has no
 * dependency on `SearchState` at all).
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
 * rule 4), and discarded the moment the panel closes.
 */
export function DockerSettingsPanel() {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const popover = usePopoverTrigger();
  const headingId = useId();

  const [summary, setSummary] = useState<DockerConnectionSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [candidate, setCandidate] = useState<DockerConnectionCandidate>(emptyCandidate());
  const [testResult, setTestResult] = useState<SourceHealth | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  useDismissableLayer(wrapperRef, popover.isOpen, close);

  function open() {
    popover.open();
    setSummaryLoading(true);
    setSummaryError(null);
    fetchDockerConnectionSummary()
      .then((result) => {
        setSummary(result);
        // Prefill the Test Connection candidate from the current
        // effective config, purely as a starting point for editing - it
        // is still never submitted/persisted until the user explicitly
        // clicks Test Connection, and is discarded on close either way.
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
  }

  function close() {
    popover.close();
    setTestResult(null);
    setTestError(null);
  }

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
    <div ref={wrapperRef} className={styles.wrapper}>
      <button
        ref={popover.triggerRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="true"
        aria-expanded={popover.isOpen}
        onClick={() => (popover.isOpen ? close() : open())}
      >
        Docker settings
      </button>

      {popover.isOpen ? (
        <div className={styles.panel} role="dialog" aria-labelledby={headingId}>
          <h2 id={headingId} className={styles.heading}>
            Docker connection
          </h2>

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

          {summary ? (
            <p className={styles.note}>{summary.settingsNote}</p>
          ) : null}

          {/*
           * UX-R3 §14 - informational only, never a "Reveal"/"Unmask"/"Copy
           * raw value" action (CLAUDE.md §2 rule 5). This explains a
           * server-side guarantee that already holds for every response
           * this application ever sends - it does not toggle or configure
           * anything.
           */}
          <div className={styles.maskingSection}>
            <h3 className={styles.subheading}>Protected field masking</h3>
            <p className={styles.hint}>
              These fields are masked on the server before any response reaches the browser. Log Explorer never sends
              or stores the raw values, and there is no way to reveal them here.
            </p>
            <ul className={styles.maskingList}>
              <li>CIF</li>
              <li>Username</li>
              <li>Customer ID</li>
              <li>Device ID</li>
              <li>Device IP</li>
            </ul>
          </div>

          <div className={styles.testSection}>
            <h3 className={styles.subheading}>Test connection</h3>
            <p className={styles.hint}>
              This checks connectivity only — it never changes the running application's actual Docker connection.
            </p>

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

          <div className={styles.actions}>
            <Button variant="ghost" onClick={close}>
              Close
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
