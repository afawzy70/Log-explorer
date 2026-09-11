import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../../shared/ui/Button';
import { useDismissableLayer } from '../../shared/ui/useDismissableLayer';
import { usePopoverTrigger } from '../../shared/ui/usePopoverTrigger';
import {
  connectOpenShift,
  disconnectOpenShift,
  fetchOpenShiftConnection,
  fetchOpenShiftIntakeAllowed,
  openShiftFailureReason,
  selectOpenShiftProject,
} from '../../shared/api/client';
import type { OpenShiftConnectionSummary, OpenShiftFailureReason } from '../../shared/api/types';
import styles from './OpenShiftSettingsPanel.module.css';

/**
 * OpenShift connection workspace (OS-1A §18).
 *
 * <p><b>Deliberately not a clone of `DockerSettingsPanel`.</b> That panel
 * is read-only by design - it shows the effective configuration and offers
 * an ephemeral Test Connection, because Docker's connection is owned by
 * deployment configuration and there is no authenticated admin boundary to
 * justify a Save. OpenShift is the opposite case: the connection *is* the
 * user's own credential, supplied at runtime, and the panel's whole job is
 * to commit it. Same visual language, different interaction model, because
 * the domain genuinely differs (OS-A §24 explicitly allows this).
 *
 * <h2>The token never lives in this component</h2>
 *
 * <p>The pasted command sits in one piece of local state while the user is
 * typing, is submitted once, and is cleared immediately afterwards -
 * whether the attempt succeeded or failed. It is never written to
 * `localStorage`, `sessionStorage` or the URL (CLAUDE.md §2 rule 4), and
 * there is no code path that reads it back from the server, because the
 * server has no endpoint that returns it.
 *
 * <h2>Failures are specific, never "connection failed"</h2>
 *
 * <p>Every error carries a machine-readable `reason` from the backend, and
 * {@link describeFailure} turns it into copy that names the actual
 * problem. OS-1A §18 forbids the generic message wherever a safe precise
 * one exists - and in particular a `FORBIDDEN` project discovery must
 * never be shown as "no accessible projects", which is a different truth
 * entirely (§15).
 */
export function OpenShiftSettingsPanel() {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const popover = usePopoverTrigger();
  const headingId = useId();
  const commandId = useId();
  const nameId = useId();
  const projectId = useId();

  const [summary, setSummary] = useState<OpenShiftConnectionSummary | null>(null);
  const [intakeAllowed, setIntakeAllowed] = useState(true);
  const [loginCommand, setLoginCommand] = useState('');
  const [connectionName, setConnectionName] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ message: string; reason: OpenShiftFailureReason | null } | null>(null);

  useDismissableLayer(wrapperRef, popover.isOpen, close);

  // Belt and braces: if this component ever unmounts while a command is
  // still in state, drop it rather than leaving it for the GC to decide.
  useEffect(() => () => setLoginCommand(''), []);

  function close() {
    popover.close();
    // The pasted command must not survive the panel closing.
    setLoginCommand('');
    setFailure(null);
  }

  function open() {
    popover.open();
    setFailure(null);
    void fetchOpenShiftConnection().then(setSummary).catch(() => setSummary(null));
    void fetchOpenShiftIntakeAllowed().then(setIntakeAllowed).catch(() => setIntakeAllowed(true));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    const submitted = loginCommand;
    // Cleared before the await resolves: the value has left the component
    // the moment it is handed to the client.
    setLoginCommand('');
    try {
      setSummary(await connectOpenShift(submitted, connectionName.trim() || undefined));
    } catch (error) {
      setFailure(describeFailure(error));
      void fetchOpenShiftConnection().then(setSummary).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function run(action: () => Promise<OpenShiftConnectionSummary>) {
    setBusy(true);
    setFailure(null);
    try {
      setSummary(await action());
    } catch (error) {
      setFailure(describeFailure(error));
    } finally {
      setBusy(false);
    }
  }

  const connected = summary?.state === 'CONNECTED';
  // OS-1A review recovery #2 - the scope word itself must stay truthful to
  // which API answered discovery. Namespaces are never presented as native
  // Projects (§5 of the recovery mission), and this is the one place that
  // decision is made so every label below agrees with the summary `<dt>`.
  const isNamespaceMode = summary?.projectApi === 'NAMESPACES';
  const scopeLabelPlural = isNamespaceMode ? 'Namespaces' : 'Projects';
  const scopeLabelSingular = isNamespaceMode ? 'Namespace' : 'Project';

  return (
    <div ref={wrapperRef} className={styles.wrapper}>
      <Button
        ref={popover.triggerRef}
        variant="secondary"
        aria-haspopup="dialog"
        aria-expanded={popover.isOpen}
        onClick={() => (popover.isOpen ? close() : open())}
      >
        OpenShift
      </Button>

      {popover.isOpen ? (
        <div className={styles.panel} role="dialog" aria-labelledby={headingId}>
          <div className={styles.header}>
            <h2 id={headingId} className={styles.heading}>
              OpenShift connection
            </h2>
            {/*
              State is never colour-only: the word itself is the signal, and
              the dot is decoration (CLAUDE.md §7).
            */}
            <span className={`${styles.state} ${stateClass(summary?.state, styles)}`}>
              <span className={styles.stateDot} aria-hidden="true" />
              {stateLabel(summary?.state)}
            </span>
          </div>

          {!intakeAllowed ? (
            <p className={styles.blocked} role="alert">
              Sign-in is disabled because Log Explorer is reachable from the network. OpenShift credentials can only
              be entered when it is bound to a local address.
            </p>
          ) : null}

          {connected ? (
            <>
              <dl className={styles.summaryList}>
                <div className={styles.summaryRow}>
                  <dt>Server</dt>
                  <dd className={styles.mono}>{summary?.server ?? '—'}</dd>
                </div>
                <div className={styles.summaryRow}>
                  <dt>User</dt>
                  <dd>{summary?.username ?? 'Not reported by this cluster'}</dd>
                </div>
                <div className={styles.summaryRow}>
                  <dt>TLS</dt>
                  <dd>
                    Verified{summary?.usingPrivateCa ? ' (private certificate authority)' : ''}
                  </dd>
                </div>
                {summary?.proxy ? (
                  <div className={styles.summaryRow}>
                    <dt>Proxy</dt>
                    <dd className={styles.mono}>{summary.proxy}</dd>
                  </div>
                ) : null}
                <div className={styles.summaryRow}>
                  <dt>{scopeLabelPlural}</dt>
                  <dd>{summary?.projectCount ?? 0}</dd>
                </div>
              </dl>

              {summary && summary.projectCount === 0 ? (
                <p className={styles.empty}>
                  This account can sign in, but has no {scopeLabelPlural.toLowerCase()}. Ask a cluster administrator
                  for access to one.
                </p>
              ) : (
                <div className={styles.field}>
                  <label className={styles.label} htmlFor={projectId}>
                    {scopeLabelSingular}
                  </label>
                  <select
                    id={projectId}
                    className={styles.select}
                    value={summary?.selectedProject ?? ''}
                    disabled={busy}
                    onChange={(e) => void run(() => selectOpenShiftProject(e.target.value || null))}
                  >
                    <option value="">All {scopeLabelPlural.toLowerCase()} (none selected)</option>
                    {summary?.projects.map((project) => (
                      <option key={project} value={project}>
                        {project}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className={styles.actions}>
                <Button variant="ghost" disabled={busy} onClick={() => void run(disconnectOpenShift)}>
                  Disconnect
                </Button>
              </div>
            </>
          ) : (
            <form onSubmit={submit}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor={nameId}>
                  Connection name <span className={styles.optional}>(optional)</span>
                </label>
                <input
                  id={nameId}
                  className={styles.input}
                  type="text"
                  value={connectionName}
                  disabled={busy || !intakeAllowed}
                  placeholder="Production OpenShift"
                  onChange={(e) => setConnectionName(e.target.value)}
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor={commandId}>
                  Paste your <code>oc login</code> command
                </label>
                <textarea
                  id={commandId}
                  className={styles.command}
                  value={loginCommand}
                  disabled={busy || !intakeAllowed}
                  rows={3}
                  spellCheck={false}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  /* Treated as a secret: never offered to autofill, never
                     spell-checked, and cleared as soon as it is submitted. */
                  aria-describedby={`${commandId}-hint`}
                  placeholder="oc login --token=… --server=https://api.example.com:6443"
                  onChange={(e) => setLoginCommand(e.target.value)}
                />
                <p id={`${commandId}-hint`} className={styles.hint}>
                  The command is read, never run. Your token is held in memory for this session only — it is never
                  saved to disk and never shown again.
                </p>
              </div>

              {failure ? (
                <p className={styles.error} role="alert">
                  {failure.message}
                </p>
              ) : null}

              <div className={styles.actions}>
                <Button type="submit" variant="primary" disabled={busy || !intakeAllowed || !loginCommand.trim()}>
                  {busy ? 'Connecting…' : 'Connect'}
                </Button>
              </div>
            </form>
          )}

          {connected && failure ? (
            <p className={styles.error} role="alert">
              {failure.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function stateLabel(state: OpenShiftConnectionSummary['state'] | undefined): string {
  switch (state) {
    case 'CONNECTED':
      return 'Connected';
    case 'EXPIRED':
      return 'Session expired';
    case 'FAILED':
      return 'Connection failed';
    default:
      return 'Not connected';
  }
}

function stateClass(
  state: OpenShiftConnectionSummary['state'] | undefined,
  css: Record<string, string>,
): string {
  switch (state) {
    case 'CONNECTED':
      return css.stateConnected;
    case 'EXPIRED':
    case 'FAILED':
      return css.stateProblem;
    default:
      return css.stateIdle;
  }
}

/**
 * Turns a backend failure into copy that names the real problem.
 *
 * <p>The backend already refuses to echo the pasted command or the token
 * in any message, so these strings are safe to render as-is; where a
 * `reason` is present we say something more specific than the generic
 * detail, because "connection failed" sends the user looking in the wrong
 * place.
 */
export function describeFailure(error: unknown): { message: string; reason: OpenShiftFailureReason | null } {
  const reason = openShiftFailureReason(error);
  const fallback = error instanceof Error ? error.message : 'The connection attempt failed.';
  switch (reason) {
    case 'UNAUTHORIZED':
      return { reason, message: 'The cluster rejected this token. It may have expired — paste a fresh login command.' };
    case 'FORBIDDEN':
      // Never "no accessible projects" - that is a different truth (§15).
      return {
        reason,
        message: 'Signed in, but this account is not permitted to list projects. Ask a cluster administrator.',
      };
    case 'NOT_FOUND':
      // Reaches the UI only if the namespaces fallback ALSO failed - the
      // Projects API is genuinely absent and this cluster's namespaces API
      // could not be used either.
      return {
        reason,
        message: 'This cluster does not expose a project or namespace listing that Log Explorer can use.',
      };
    case 'TLS':
      return {
        reason,
        message: 'TLS verification failed. If this cluster uses a private certificate authority, supply its CA certificate.',
      };
    case 'NETWORK':
      return { reason, message: 'Could not reach the cluster. Check VPN, DNS and the server URL.' };
    case 'PROXY':
      return { reason, message: 'The configured proxy could not be used to reach the cluster.' };
    case 'SERVER_NOT_HTTPS':
      return { reason, message: 'The API server must be an https:// URL. Log Explorer will not send a token unencrypted.' };
    case 'INSECURE_TLS_REFUSED':
      return {
        reason,
        message: 'Log Explorer will not disable TLS verification. Remove --insecure-skip-tls-verify and supply the cluster CA instead.',
      };
    case 'SHELL_SYNTAX_PRESENT':
      return { reason, message: 'That command contains shell syntax. Paste only a plain oc login command.' };
    case 'UNKNOWN_FLAG':
      return { reason, message: 'That command contains an option Log Explorer does not support. Use --server, --token and --certificate-authority only.' };
    case 'DUPLICATE_FLAG':
      return { reason, message: 'That command sets the same option twice.' };
    case 'MISSING_SERVER':
      return { reason, message: 'The command is missing --server.' };
    case 'MISSING_TOKEN':
      return { reason, message: 'The command is missing --token.' };
    case 'MALFORMED_SERVER_URL':
      return { reason, message: 'The --server value is not a valid URL.' };
    case 'MALFORMED_TOKEN':
      return { reason, message: 'The --token value is not a valid bearer token.' };
    case 'NOT_AN_OC_LOGIN_COMMAND':
      return { reason, message: 'That does not look like an oc login command.' };
    case 'NON_LOOPBACK_BINDING':
      return {
        reason,
        message: 'Sign-in is disabled because Log Explorer is reachable from the network.',
      };
    case 'STALE_CONNECTION':
      return { reason, message: 'The connection changed while that request was in flight. Try again.' };
    default:
      return { reason, message: fallback };
  }
}
