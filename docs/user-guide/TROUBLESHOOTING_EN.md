# Log Explorer — Troubleshooting

Format: **Symptom → Likely cause → What to do.**

---

### No search results

**Likely cause:** your time range, service, or filter combination
genuinely has nothing matching, or the range is too narrow.

**What to do:** click the **"Search last 1 day"** shortcut Log Explorer
offers on an empty result, or widen your time range. Double-check any
"exact match" filter (§9 of the User Guide) — a small typo in an exact
field returns zero results rather than a partial match.

---

### Search results look truncated / a warning about counts

**Likely cause:** your search matched more events than Log Explorer will
load in one go (a safety bound, not a bug).

**What to do:** narrow your time range or filters, or use **Load More**
to fetch the next page. Log Explorer always tells you the true total
versus how many are currently shown — it never hides the fact that more
exist.

---

### Docker unreachable

**Likely cause:** the Docker engine isn't running, or (for local mode)
Log Explorer's backend can't reach the local Docker socket.

**What to do:** confirm Docker is running on the machine Log Explorer's
backend is on. If you're using **local** mode, remote settings are
irrelevant — check the Docker settings panel shows "Local."

---

### Remote Docker port blocked

**Likely cause:** the configured host/port isn't reachable from the
machine running Log Explorer's backend (firewall, wrong port, wrong
host).

**What to do:** verify the port (default `2375`) is correct for your
Docker daemon's configuration, and that nothing blocks it between the
two machines. Use **Test Connection** in Docker settings to confirm
before relying on it.

---

### Remote Docker TLS failure

**Likely cause:** TLS is enabled but the certificate directory path is
wrong, missing, or the certificates don't match what the remote daemon
presents.

**What to do:** double-check the **Certificate directory path** points
to a valid set of client certificates on the machine running Log
Explorer's backend. Log Explorer never offers a way to bypass TLS
verification — if verification fails, the connection is refused, by
design.

---

### OpenShift connection timeout

**Likely cause:** the cluster is unreachable from this network, VPN
isn't connected, or the server URL is wrong.

**What to do:** confirm you can reach the same server URL from a
terminal (e.g. `oc login` with the same command works). If your network
requires a proxy, see the next item.

---

### OpenShift proxy failure

**Likely cause:** your proxy mode is set to **Custom** with an
incorrect host/port, or **System** but your environment's proxy
variables don't actually reach a working proxy.

**What to do:** in the OpenShift settings panel's **Proxy** section,
confirm the selected mode is correct for your situation. For **Custom**,
re-check the host and port exactly. For **System**, confirm
`HTTPS_PROXY`/`HTTP_PROXY` are set correctly in the environment Log
Explorer was started from. Try **Direct connection** briefly to isolate
whether the proxy itself is the problem.

---

### Proxy authentication issue

**Likely cause:** your proxy requires a username/password. Log Explorer
does not currently have a UI for proxy credentials — only host and port.

**What to do:** if your proxy is reachable but rejects the connection
specifically at the proxy layer, this is the most likely reason. This is
a known, current limitation — see the [Capability Matrix](CAPABILITY_MATRIX.md).

---

### TLS / certificate error

**Likely cause:** the server presents a certificate Log Explorer doesn't
already trust (commonly, an internal/private certificate authority).

**What to do:** for OpenShift, supply the cluster's CA certificate where
the connection form allows it. Log Explorer never disables certificate
verification to work around this — the fix is always to supply the
correct trusted certificate, never to bypass the check.

---

### OpenShift token expired

**Likely cause:** your session token from `oc login` has a limited
lifetime and has run out.

**What to do:** get a fresh `oc login` command (log in again with `oc`,
or however your cluster issues tokens) and paste the new one into the
OpenShift connection panel. The old token is discarded automatically the
moment the cluster rejects it — Log Explorer never keeps trying a token
it knows is invalid.

---

### 403 / permission denied

**Likely cause:** your account genuinely isn't permitted to do what was
requested (list projects, read a namespace, etc.) — this is a real
permissions answer, not a connectivity problem.

**What to do:** ask a cluster administrator for the access you need. Log
Explorer never shows "no results" for this case, specifically so you
don't mistake "not permitted" for "genuinely nothing there."

---

### Project (or namespace) not visible

**Likely cause:** either you don't have access to it, or your cluster
only exposes Kubernetes namespaces rather than OpenShift Projects (Log
Explorer falls back automatically and labels the list "Namespaces"
instead of "Projects" when that happens — check which label you're
actually seeing).

**What to do:** if you expected to see a specific project and don't,
confirm with your cluster administrator that your account has access to
it.

---

### No workload / pod visible

**Likely cause:** the project genuinely has none matching your current
Workload/Pod filters, or your account lacks permission to list them in
this project (shown distinctly, not as an empty list).

**What to do:** try "All workloads"/"All matching pods" to broaden the
scope, and confirm with your cluster administrator if you suspect a
permissions gap.

---

### Live disconnected

**Likely cause:** a network interruption, the pod/container restarted,
or the connection's own timeout was reached.

**What to do:** Log Explorer attempts to reconnect automatically where
that's possible. If it can't, the panel tells you plainly rather than
silently going quiet — check the status message shown in the Live
panel for the specific reason.

---

### Partial Live results

**Likely cause:** for a multi-replica OpenShift workload, only some
replicas are currently reachable (e.g. a rolling update in progress).

**What to do:** this is shown honestly (e.g. "LIVE (2/4 active)")
rather than hidden — no action is usually needed; it typically resolves
once the rollout finishes. If it doesn't, check the affected pods
directly in OpenShift.

---

### Surrounding logs incomplete

**Likely cause:** you selected an event very near the start or end of
the available log stream, so the full ±30-second window isn't all
present.

**What to do:** this is expected and Log Explorer tells you plainly when
the context is partial — it is never hidden or silently filled in with
something else.

---

### Loki unavailable

**Likely cause:** the OpenShift Loki source's gateway isn't reachable —
this could be a genuine outage, or (in a development/test environment)
that no real Loki gateway exists to connect to at all.

**What to do:** confirm with your cluster administrator that the LokiStack
is deployed and reachable. If you're evaluating Log Explorer in a
non-production environment, this may simply mean no real Loki instance
is available there — see the [Capability Matrix](CAPABILITY_MATRIX.md)
for what's implemented versus what has been verified against a real
gateway.

---

### Desktop app does not start

**Likely cause:** a port conflict, another instance already running, or
(rarely) a corrupted install.

**What to do:** close any other running copy of Log Explorer first. If
it still won't start, reinstall. If the problem persists, check the
application's own log output for a specific error.

---

### Unsigned Windows warning {#desktop}

**What you'll see:** "Windows protected your PC" / a SmartScreen prompt,
because this build is not code-signed.

**What to do:** this is expected for the current release, not a sign of
a compromised download. Click **"More info"**, then **"Run anyway"** —
but always verify you downloaded the installer from the project's own
official GitHub Releases page first.

---

### Unsigned macOS Gatekeeper warning {#desktop-mac}

**What you'll see:** "Log Explorer cannot be opened because the
developer cannot be verified," because this build is not notarized.

**What to do:** this is expected for the current release. Right-click
(or Control-click) the app and choose **Open**, then confirm **Open**
in the dialog that follows — this only needs to be done once. Always
verify you downloaded the app from the project's own official GitHub
Releases page first.
