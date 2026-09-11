# OS-1A — OpenShift Connection, Safe Credential Intake & Project Discovery

Mission: `OS_1A_OPENSHIFT_CONNECTION_PROJECT_DISCOVERY`.
Base: `9d3b41aee22ff4fad008649f45f00dad522cf098` (post-PR #38 `main`).
Branch: `os/1a-openshift-connect-project-discovery`.

OS-1A implements **connection, credential intake and project discovery
only**. There is no log retrieval, no search, no workload/pod/container
discovery, no context, no correlation and no Live — and the source's
declared capabilities say exactly that.

---

## 1. PR #38 merge gate

| Gate | Result |
|---|---|
| HEAD equals accepted `1aefb3a59b9a756575294eff5e783914c4b1a1d5` | PASS |
| OPEN / MERGEABLE / CLEAN | PASS |
| CI green | PASS (Backend, Frontend, E2E) |
| Windows Desktop correctly NOT_APPLICABLE | PASS — the workflow is path-filtered to `desktop/**`, `backend/**`, `frontend/**`; a docs-only PR touches none, which is itself evidence OS-A changed no code |
| Squash-merge | PASS — `9d3b41aee22ff4fad008649f45f00dad522cf098` |
| Post-main CI | PASS |

---

## 2. Architecture

```
OpenShiftLogSource            id "openshift", one Spring bean
   ├── OpenShiftSession       in-memory connection + RawToken + generation counter
   ├── OpenShiftApiClient     WebClient; TLS/CA; scoped proxy; GET only
   ├── OcLoginCommandParser   strict whitelist parser (never executes)
   ├── ProxyRoute             HTTP(S)_PROXY / NO_PROXY resolution
   └── LoopbackBindingGuard   credential-intake precondition
```

One bean, one active connection. `LogSourceRegistry` builds
`Map.copyOf(...)` from constructor-injected beans, so sources are fixed at
startup; combined with `CLAUDE.md` §8's standing multi-cluster exclusion
and `PageCursorCodec` binding `sourceId` into the cursor HMAC, "Add
Source → OpenShift" is implemented as *configure and connect this
source*, not *create a new one*.

### API-client decision (§13)

**WebClient, not a Kubernetes client library.** Evaluated against
fabric8/official clients and rejected on evidence: OS-1A needs exactly two
endpoints; a full client brings a large transitive tree and its own HTTP
stack into a jlink-bundled desktop app; this repo already has a proven
private-CA mechanism to reuse; §12 requires scoped, non-global proxy
control that is direct here and indirect through a library; and the future
Live slice wants a reactive stream. Trade-off accepted: two hand-rolled
JSON reads, which is a smaller reviewable surface than a general client.

`CompositeX509TrustManager` moved from `source.loki` to `core.tls` and
made public so both adapters share one auditable TLS path. Behaviour
unchanged; Loki's own tests still pass.

---

## 3. The `oc login` parser (§7/§8)

**Parse only. Nothing is ever executed** — no `ProcessBuilder`, no
`Runtime.exec`, no shell, and `oc` is not a runtime dependency.

Accepted grammar is deliberately narrow: `oc login`, then only
`--server=<https URL>`, `--token=<bearer>`, optional
`--certificate-authority=<path>`, each at most once, all in `--flag=value`
form.

**It rejects rather than sanitizes.** If the text contains shell syntax,
the user's mental model and ours have already diverged — they pasted
something that in a terminal would have done more than log in. Stripping
it and proceeding would connect them to something they did not ask for.

### Hostile-input matrix — all covered by tests

| Input | Result |
|---|---|
| `… ; rm -rf /` | `SHELL_SYNTAX_PRESENT` |
| `--token=$(cat /etc/passwd)` | `SHELL_SYNTAX_PRESENT` |
| `… && curl evil` | `SHELL_SYNTAX_PRESENT` |
| `… > /tmp/x`, `… < /tmp/x`, `… \| sh` | `SHELL_SYNTAX_PRESENT` |
| backticks, `${VAR}`, `$`, backslash, newline, CR | `SHELL_SYNTAX_PRESENT` |
| single/double quotes | `SHELL_SYNTAX_PRESENT` (quoting is not supported rather than re-tokenized) |
| `--server=http://…` | `SERVER_NOT_HTTPS` |
| `--server=file:///tmp/x`, `ftp://` | `SERVER_NOT_HTTPS` / `MALFORMED_SERVER_URL` |
| `--server=notaurl`, `https://`, `:::::` | `MALFORMED_SERVER_URL` |
| `--unknown=x`, `--namespace=`, `--kubeconfig=`, `--loglevel=` | **`UNKNOWN_FLAG`** |
| bare positional, `--token T` (space form) | `UNKNOWN_FLAG` |
| duplicate `--token` / `--server` | `DUPLICATE_FLAG` |
| `--insecure-skip-tls-verify[=true]` | **`INSECURE_TLS_REFUSED`** (own reason, not "unknown flag") |
| `curl …`, `oc get pods`, `kubectl login`, empty | `NOT_AN_OC_LOGIN_COMMAND` |
| token too short / non-ASCII / 20 000 chars | `MALFORMED_TOKEN` / length refusal |

**Unknown flags are rejected, not ignored** (owner decision 5, a reviewer
correction). Ignoring one would quietly discard stated intent — and the
unfamiliar flags in this command are exactly the ones that change security
posture.

**No rejection message ever echoes the input.** A dedicated test feeds six
hostile inputs carrying a marker string and asserts no message contains
it; the real-browser E2E asserts the same for the rendered alert.

---

## 4. Loopback guard (§10)

Credential intake is refused unless the app is bound to loopback, and the
check runs **before the pasted command is even parsed**.

This is enforcement of a stated assumption, not ceremony: the app has no
authentication of its own — `DockerSettingsController`'s own javadoc says
there is "no authenticated admin boundary… nothing gating any endpoint by
identity". Loopback binding *is* the boundary.

| Bind address | Intake |
|---|---|
| `127.0.0.1`, `127.0.0.53`, `localhost`, `::1` | **allowed** |
| `0.0.0.0`, `::`, `*`, `10.1.2.3`, `192.168.1.50` | **refused** |
| blank / unset | **refused** — Spring binds all interfaces when `server.address` is unset, which is the case this guard exists to stop |
| unresolvable | **refused** — cannot prove loopback |

The refusal names no credential, and the UI asks
`/connection/intake-allowed` up front so it can explain *why* the form is
unavailable rather than failing on submit.

---

## 5. Token lifecycle (§9)

| Property | How it is guaranteed |
|---|---|
| In memory only | `OpenShiftSession`, a single `AtomicReference` snapshot |
| Never logged | Wrapped in `RawToken` (redact-by-type `toString`); `OpenShiftSession`, `OcLoginCommand` and `OpenShiftConnectRequestDto` all have redacted `toString` |
| No read path | `OpenShiftConnectionSummaryDto` has **no field** capable of carrying it; `OpenShiftSession#token()` is package-private |
| Not in URL | Sent as a POST body; `Authorization` header only; asserted |
| Not in browser storage | Cleared from React state on submit, on failure and on panel close; asserted against `localStorage`, `sessionStorage`, the URL and the DOM in a real browser |
| Dropped on rejection | A 401 calls `markExpired()`, which clears the token — keeping a credential the cluster already refused only widens exposure |
| Replaced on reconnect | `connect()` overwrites the snapshot, discarding the previous token |

---

## 6. TLS / CA (§11)

Verification is always on; there is no insecure mode and none was added.
Private CAs are supported by adding **one** extra trust anchor on top of
the JVM defaults via `CompositeX509TrustManager` — never replacing them,
never disabling hostname verification.

An unreadable/invalid CA file surfaces as `Kind.TLS` with a message that
does not echo the supplied path.

---

## 7. Enterprise proxy — the OS-A assumption, resolved (§12)

```
PROXY_NATIVE_SUPPORT = NO   (for HTTP_PROXY / HTTPS_PROXY / NO_PROXY)
```

**Evidence, not assumption.** Inspecting the shipped
`reactor-netty-core-1.2.18` classes shows `ProxyProvider` reads only JVM
**system properties**:

```
http.proxyHost / http.proxyPort / http.proxyUser / http.proxyPassword
https.proxyHost / https.proxyPort / https.proxyUser / https.proxyPassword
http.nonProxyHosts   (default "localhost|127.*|[::1]")
socksProxyHost / socksProxyPort / …
```

There is **no** `HTTP_PROXY`, `HTTPS_PROXY` or `NO_PROXY` constant
anywhere in it, and `proxyWithSystemProperties()` is an explicit opt-in
that the existing Loki client does not call.

That matters because enterprise developer machines overwhelmingly set the
*environment variables* — that is what `oc` and `curl` read. Without
explicit support, "it works in my terminal but not in Log Explorer" would
have been common and baffling.

So `ProxyRoute` implements them explicitly:

- `HTTPS_PROXY` preferred (the API server is always https), `HTTP_PROXY`
  as fallback; lowercase spellings honoured.
- `NO_PROXY` matched on **label boundaries**: `example.com` matches
  `api.example.com` but **not** `notexample.com`. Getting this wrong would
  either route excluded traffic through a proxy or — worse, because it is
  undiagnosable — bypass a mandatory corporate one.
- `*` bypasses everything; ports and leading dots are handled; CIDR
  entries are not interpreted and deliberately do **not** match (erring
  toward using the proxy, which fails loudly rather than silently).
- A malformed proxy variable yields a direct connection rather than
  blocking the user entirely.
- **Scoped to this client. Never `System.setProperty`** — a JVM-global
  change would silently alter Docker and Loki networking too.

24 deterministic tests, including every `NO_PROXY` boundary case. Proxy
credentials are parsed but never appear in `display()` or `toString()`.

---

## 8. Project discovery and the three truths (§14/§15/§16)

Discovery uses `/apis/project.openshift.io/v1/projects` — already
RBAC-filtered to what the user may see, so no cluster-admin is assumed and
no inaccessible namespace is enumerated.

**401, 403 and an empty list are three different truths, and are modelled
as different *types* so they cannot be accidentally collapsed:**

| Condition | Representation | UI copy |
|---|---|---|
| `401` | `OpenShiftApiException(UNAUTHORIZED)` → HTTP 401 | "The cluster rejected this token. It may have expired…" + session marked `EXPIRED`, token cleared |
| `403` | `OpenShiftApiException(FORBIDDEN)` → HTTP 403 | "Signed in, but this account is not permitted to list projects." |
| `200` + `items: []` | `ProjectDiscovery` with an empty list — **not** an exception | "This account can sign in, but has no projects." |

A dedicated test asserts the 403 copy never contains "no projects".

**Namespaces fallback** runs only when the Projects API is genuinely
absent (a vanilla Kubernetes API server answers 404 → `MALFORMED_RESPONSE`).
A **403 is never retried** as namespaces — that would convert a permission
truth into an availability guess. When the fallback answers, the UI labels
the list "Namespaces", never "Projects".

---

## 9. Stale-connection protection (§27)

The session carries a generation counter, incremented on connect,
disconnect and expiry. Every async result re-checks it before applying —
the same protection UX-R6 added after a stale Docker response overwrote
Fixture's service list, generalised to a credentialled connection where
the stakes are higher.

Covered: a project selection from a replaced connection is rejected; a
project refresh from a replaced connection is discarded; a new connection
never inherits the previous selection; a selection that disappears from a
refreshed list is cleared truthfully.

---

## 10. UX (LERUX-1 → LERDESIGN-1 → implement → LERUX-1)

**LERUX-1 diagnosis.** `DockerSettingsPanel` is read-only by design: it
shows effective configuration and offers an ephemeral Test Connection, and
there is no endpoint that commits a connection. There is no "Add Source"
concept; `SourceSelect` is a flat 34-line `<select>`. So OpenShift needed
a surface the product did not have: one that **commits a credential**.

**LERDESIGN-1 proposal, implemented.** Same popover geometry and tokens as
Docker settings so Settings reads as one family, but a different
interaction model because the domain differs (OS-A §24 allows this):
connection name → pasted command (monospace, secret-like) → **Connect**;
then identity / server / TLS / proxy / project count, a Project selector,
and Disconnect.

**LERUX-1 verification (real browser, real backend).** 17 E2E tests:
every hostile input refused with a specific message that never echoes the
input and leaves the field cleared; the token absent from storage, URL and
DOM after submit; the OpenShift source present with all capabilities
false while `openshift-loki` remains intact; keyboard operation; Escape
closing and clearing; and 1440 / 1024 / 768 / 390 with no page overflow.

Failure copy is specific per category — authentication, TLS, network,
proxy, project-discovery forbidden, and each parser refusal. §18's "no
generic 'Connection failed' when a safe precise category is available" is
enforced by `describeFailure` and asserted by test.

Accessibility: real `<label>`s, `role="dialog"` with `aria-labelledby`,
`role="alert"` errors, visible focus, state conveyed in words (the dot is
decoration), `autocomplete="off"`/`spellcheck="false"` on the secret
field, and `jest-axe` clean.

---

## 11. Capability truthfulness (§21)

All seven capability booleans are `false`. `search()` **refuses loudly**
rather than returning an empty `Flux`, because an empty result would
render as "no results for this range" — a factual claim about the
cluster's logs this slice cannot make. Health reports `DEGRADED` (not
`DOWN`) when disconnected: nothing is broken, the user simply has not
signed in.

---

## 12. Existing Loki source (§22)

Unchanged. No behaviour, id, settings or test was modified; the only edit
in that package is an import line following the shared trust-manager move.
Both sources are present in the live `/api/v1/sources`, asserted in a real
browser.

---

## 13. Tests

| Layer | Result |
|---|---|
| L1 unit/contract | Parser 46 · Proxy 24 · Security boundaries 25 |
| L2 fake OpenShift API | `OpenShiftApiClientTest` 15 (401/403/empty/404-fallback/malformed/unreachable/bad-CA/identity) |
| Backend total | **720 pass, 0 failures** |
| Frontend | **741 pass** (+15 OpenShift panel) |
| E2E OS-1A | **17/17** |
| Typecheck / production build | PASS |
| L3 real sandbox | `OpenShiftRealSandboxIT` — **skips cleanly** without credentials (verified: 5 skipped, build success) |

### Real-environment status

```
REAL_OPENSHIFT_1A = BLOCKED_CREDENTIALS
```

The Layer 3 test exists and is ready. To run it the owner sets
`OPENSHIFT_API_SERVER` and `OPENSHIFT_TOKEN` locally and runs
`./mvnw test -Dtest=OpenShiftRealSandboxIT`. It never shells out to `oc`,
never writes to the cluster, and prints only sanitized evidence (host,
counts, whether a proxy route applies) — never the token.

**OS-1A is not real-environment VERIFIED until that runs.** Everything
else is verified.

### Secret scan (§26)

Changed files scanned for token-shaped values
(`sha256~…`, `eyJ…`, `Bearer …`). One match: a deliberately synthetic E2E
fixture (`sha256~e2e-secret-token-value-01234567`). No real credential
material is in git, in evidence screenshots, or in any report.

---

## 14. OS-1B prerequisites

Ready to build on: an authenticated session with a validated server, CA
and proxy route; a selected project; the generation counter for stale
protection; and the failure taxonomy.

Still needed for OS-1B: `SourceCapabilities` will need additive fields
(`projectDiscovery`, `workloadDiscovery`, `podDiscovery`) — OS-1A
deliberately did not extend the record, because nothing it implements
could be expressed truthfully by a new boolean yet. `CanonicalLogEvent`
will need `cluster` and `workload`; `namespace`, `pod` and
`containerName` already exist from Loki's Phase D enrichment.
