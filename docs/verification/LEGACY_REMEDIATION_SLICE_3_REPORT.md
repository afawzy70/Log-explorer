# Legacy Remediation Slice 3 — Docker Connection, Settings, Security & Compose Project Boundary

Verification report for `docs/LEGACY_TO_NEW_REMEDIATION_PLAN.md` §"Slice 3". Base
SHA `3fdc6d1` / `3fdc6d16d74cf6795439b4574f9f241d2e4c2991` (`main`, PR #20 merged —
Legacy Remediation Slice 2). Branch `phase/legacy-slice-3-docker-connection-security`.

This slice restores OLD's Docker connection inspection/testing capabilities,
adds real SSRF/DNS-rebinding protection for remote Docker, strengthens and
exhaustively proves the Docker Compose project hard boundary, and adds a
self-exclusion mechanism so Log Explorer never reads its own logs. It does
**not** constitute completion of the full legacy remediation effort — Slices 4+
remain.

---

## 1. Settings security model — the owner decision

Before writing any settings-mutation code, this application's authentication
posture was inspected directly:

```
grep -rln "SecurityFilterChain|@PreAuthorize|spring-boot-starter-security|Authentication\b" backend/src backend/pom.xml
→ 0 real matches (no Spring Security dependency, no auth annotation anywhere)
```

**There is no authenticated admin boundary in this application.** Per the
mission's own explicit instruction, this means: *do not create an
unauthenticated global configuration mutation endpoint that any user could use
to redirect the backend to arbitrary Docker hosts.*

`api.DockerSettingsController` therefore implements exactly the "otherwise"
branch of the owner decision:

- `GET /api/v1/sources/docker/connection` — the current effective connection,
  sanitized, **read-only**.
- `POST /api/v1/sources/docker/test-connection` — an **ephemeral** candidate
  connection, checked with the real security path, **never persisted, never
  applied** to the running application's actual `DockerProperties` bean.
- **No endpoint mutates `DockerProperties`.** Committed runtime configuration
  remains entirely environment/config-file driven, applied only through a real
  deployment change and an application restart.

This is a deliberate security boundary, not a missing feature — it is
documented in the controller's own javadoc, in `DockerConnectionSummaryDto`'s
`settingsNote` field (surfaced verbatim in the UI, so the two can never drift),
and in the capability matrix (SRC-04, `DEFERRED` — not `NEW_MISSING`, since
building it unsafely would be worse than not building it).

No weak pseudo-auth (a hidden header, a client-supplied "admin" flag, ...) was
invented to work around this — the mission explicitly forbids that, and this
implementation follows it.

---

## 2. Test Connection architecture

`DockerSettingsController#testConnection`:

1. Candidate shape validation (`mode` valid, `host` required for REMOTE,
   `tlsCertPath` required when TLS is on) happens **synchronously, before**
   entering the reactive pipeline — a malformed candidate is a genuine client
   error (400 via the existing `GlobalExceptionHandler`), never silently
   reclassified as a fabricated "connection failure."
2. The validated candidate becomes an **ephemeral** `DockerProperties`
   instance — never the singleton bean the running application actually uses.
3. `DockerClientFactory#create(ephemeral)` — **the exact same
   connection-building/security path** real runtime Docker construction uses
   (for REMOTE mode, this runs the candidate's host through
   `RemoteHostGuard` first). No separate "test-only" relaxed code path exists.
4. The **minimum** read-only operation needed to prove connectivity:
   `ReadOnlyDockerClient#ping()` only — no listing, no log reads.
5. A **strict timeout**: the ephemeral client's own connect/response timeout
   is set ~1.5s below a 2-second outer `Mono#timeout()` backstop, so a UI
   action is always bounded regardless of what the candidate specifies.
6. The client is closed (`try`-with-resources) immediately after — nothing is
   kept running.
7. Failure is classified by the same `DockerDiagnostics` every other Docker
   health check uses — sanitized, fixed-string, never a raw exception message
   or stack trace — and returned as `SourceHealth{status: DOWN, message}`,
   HTTP 200 (a connectivity result is data, not a request error), exactly the
   shape `GET .../health` already uses for every source.

`DockerSettingsControllerTest#testConnectionNeverMutatesTheRunningApplicationsActualDockerConfiguration`
proves step 2/3 hold: the real `DockerProperties` bean is asserted unchanged
(mode/host/port/TLS) both directly and via a follow-up `GET .../connection`
call, after a Test Connection request that would have looked like a
configuration change if it were applied.

---

## 3. SSRF / DNS-rebinding policy

`source.docker.security.RemoteHostGuard` (new), backed by
`config.DockerRemoteAllowlistProperties` (`logexplorer.docker.remote-allowlist.cidrs`/`.hostnames`,
both empty by default):

**Default-deny** (no allowlist entry needed to reject these):

| Range | Mechanism |
|---|---|
| Loopback (127.0.0.0/8, ::1) | `InetAddress#isLoopbackAddress()` |
| Link-local (169.254.0.0/16, fe80::/10) — covers the well-known cloud metadata endpoint `169.254.169.254` | `InetAddress#isLinkLocalAddress()` |
| RFC1918 private LAN (10/8, 172.16/12, 192.168/16) | `InetAddress#isSiteLocalAddress()` |
| Multicast | `InetAddress#isMulticastAddress()` |
| "Any"/unspecified (0.0.0.0, ::) | `InetAddress#isAnyLocalAddress()` |
| CGNAT (100.64.0.0/10) | explicit built-in CIDR check |
| IPv6 unique-local (fc00::/7 — not covered by the deprecated `isSiteLocalAddress`) | explicit built-in CIDR check |
| "This network" (0.0.0.0/8) | explicit built-in CIDR check |

**Explicit allowlist bypass** (admin-configured, empty by default):

- A resolved address matching an allowlisted CIDR is accepted regardless of
  the default-deny table above.
- A hostname exactly matching an allowlisted hostname (case-insensitive) is
  trusted entirely — address classification is skipped for it, since an admin
  who named it already made the trust decision.

**Mixed resolution**: if a hostname resolves to multiple addresses and *any
one* is forbidden, the whole check is rejected (`RemoteHostGuardTest#mixedDnsResolutionWhereOneAddressIsForbiddenIsRejectedEvenThoughAnotherIsAllowed`)
— never "any allowed address is enough."

**DNS-rebinding defense**: `RemoteHostGuard#checkOrThrow` performs a fresh,
uncached resolution on *every* call (`HostResolver`, production-wired to
`InetAddress::getAllByName` via `config.DockerSecurityConfig`). It is invoked:

- Once in `DockerClientFactory#buildConfig`, before building the connection
  config — covers both real runtime construction (`DockerLogSource`'s
  constructor, at app boot) and Test Connection (which calls this same
  method).
- Fresh again, immediately before **every** real Docker operation
  `DockerLogSource` performs (`health()`, `discoverServices()`, `search()`,
  `follow()`) via `checkRemoteHostIfNeeded()`, so a rebound DNS answer between
  the app-boot check and a later real operation is never trusted.
  `RemoteHostGuardTest#hostnameReResolutionMeansEachCallInvokesTheResolverFreshNeverCached`
  proves the guard itself never caches; `DockerLogSourceTest`'s four
  `remoteMode*ViaTheSharedGuard` tests prove each real operation actually
  calls it.

**Never validated only in the frontend** — the frontend has no host
classification logic at all; every check happens server-side, and the exact
same `RemoteHostGuard` instance backs both Test Connection and runtime
construction (`RemoteHostGuardTest#testConnectionAndRuntimeDockerConstructionShareTheExactSamePolicyInstance`).

Scope: the guard applies to `DockerProperties.Mode.REMOTE` only. `LOCAL` mode
(and its `DOCKER_HOST` env var, if set) is deployment-time configuration set
by whoever deploys the app — the same trust level as any other environment
variable, not the mission's "server-side network access from
user-influenced input" SSRF concern, which is specifically about REMOTE mode's
host being reachable from a settings-adjacent surface.

---

## 4. TLS

Unchanged behavior from the pre-Slice-3 baseline (`DockerClientFactory`,
already correct): TLS is optional, never forced; when enabled, certificate
verification is mandatory (`withDockerTlsVerify(true)`) and a valid certificate
directory is required — there is no trust-all code path anywhere in this
codebase (`grep -rn "trustAll\|TrustAll\|X509TrustManager.*return true" backend/src/main/java/com/logexplorer/source/docker` → 0 matches for Docker; the
one `CompositeX509TrustManager` in the codebase belongs to `source.loki`, an
unrelated, already-verified TLS path).

The Docker settings UI never returns certificate/key **contents** — only the
certificate **directory path** (a plain filesystem string, not secret
material) is shown/editable in the Test Connection form, and only ever sent
in a POST body, never logged, never placed in `localStorage`/`sessionStorage`/
the URL. TLS profile configuration itself remains deployment-time only
(`LOGEXPLORER_DOCKER_TLS_CERT_PATH`) — stated plainly in this report and in
the UI's own `settingsNote`.

---

## 5. Compose project hard boundary — proof

`DockerLogSource#relevantContainers` is the single filter point every caller
(`discoverServices`, `search`, `follow`) already routed through before this
slice; this slice adds exhaustive test coverage (unit + real-Docker) rather
than changing its logic, plus the new self-exclusion filter applied *before*
the project filter.

### Unit-level (deterministic, mocked Docker client) — `DockerLogSourceTest`

A genuine two-project matrix with **overlapping service names**
(`project-a/payments`, `project-b/payments`), per the mission's own example:

- `selectingProjectAReturnsZeroProjectBContainersInDiscoverServices`
- `selectingProjectAReturnsZeroProjectBEventsInSearch`
- `selectingProjectAReturnsZeroProjectBEventsInFollow`
- `selectingProjectBIsTheExactReverseAndReturnsZeroProjectAResults`
- `sameServiceNameInTwoDifferentProjectsNeverMergesIdentityWhenNoProjectFilterIsConfigured`
- `aBlankComposeProjectFilterBehavesIdenticallyToNoFilterAcrossBothProjects`
- `aTargetProjectWithNoRunningContainersYieldsEmptyResultsNeverAnError`
- `stoppedContainersRemainReadableWithinAProjectFilterTheSameAsWithoutOne`

### Real Docker verification (this environment has a genuine Docker daemon —
`/var/run/docker.sock`, current user in the `docker` group)

Two real, independently-labeled containers were created (never using
`docker compose` CLI itself — the labels are what the adapter actually reads,
so attaching them directly via `docker run --label` is equally real):

```
docker run -d --name slice3-a-payments \
  --label com.docker.compose.project=slice3-project-a \
  --label com.docker.compose.service=payments \
  busybox:latest sh -c 'echo "{...\"message\":\"project-a payments event\"}"; sleep 3600'

docker run -d --name slice3-b-payments \
  --label com.docker.compose.project=slice3-project-b \
  --label com.docker.compose.service=payments \
  busybox:latest sh -c 'echo "{...\"message\":\"project-b payments event\"}"; sleep 3600'
```

Plus two long-running loop emitters (`slice3-a-loop`/`slice3-b-loop`, same
projects/service, emitting a new JSON line every 2s) for the live-tail check,
and a self-excluded container (§6 below). This host also had three genuinely
**unrelated**, pre-existing Compose-managed containers running the whole time
(`sofra-web-1`/`sofra-caddy-1`/`sofra-db-1`, from an unrelated project on this
shared dev machine) — real evidence that project filtering doesn't accidentally
sweep in unrelated real infrastructure either.

**Baseline — no project filter** (`LOGEXPLORER_DOCKER_MODE=LOCAL`, no
`LOGEXPLORER_DOCKER_COMPOSE_PROJECT_FILTER`):

```
GET /api/v1/sources/local-docker/services
→ caddy(1/1), db(1/1), payments(2/2), web(1/1)
  ("payments" total=2 - both projects legitimately aggregated when no filter is set)
```

**Filtered to `slice3-project-a`** (restarted with
`LOGEXPLORER_DOCKER_COMPOSE_PROJECT_FILTER=slice3-project-a`):

```
GET /api/v1/sources/local-docker/services
→ [{"name":"payments","runningCount":1,"totalCount":1}]

POST /api/v1/logs/search  {services:["payments"], start/end: last 5 min}
→ 1 event: "project-a payments event" | composeProject=slice3-project-a | composeService=payments
  (project-b's event: ABSENT)

Live tail (GET /api/v1/logs/live?sourceId=local-docker, 8s capture,
both a-loop and b-loop emitting the whole time):
→ only "LIVE project-a event N" lines (N=6..9 in the capture window)
  ("LIVE project-b event *": ABSENT, despite b-loop actively emitting)
```

**Filtered to `slice3-project-b`** (restarted the reverse way — proving
isolation is not an artifact of alphabetical/first-registered ordering):

```
GET /api/v1/sources/local-docker/services
→ [{"name":"payments","runningCount":2,"totalCount":2}]  (slice3-b-payments + slice3-b-loop)

POST /api/v1/logs/search {services:["payments"]}
→ 27 events, every one composeProject=slice3-project-b
  (project-a's event: ABSENT)

Live tail (8s capture): only "LIVE project-b event N" lines (project-a: ABSENT)

POST /api/v1/logs/context {service:"payments", timestamp:now}
→ 15 events, distinct composeProject values present: {"slice3-project-b"} only
```

One real-browser screenshot
(`docs/verification/legacy-slice3/real-docker-project-b-filtered-results.png`,
captured against this exact `slice3-project-b`-filtered backend + a real local
Vite dev server): every visible row is `payments` / project-b — confirming the
frontend renders this correctly too, not just the raw JSON.

This real-Docker verification was performed manually (documented here,
reproducible) rather than committed as a permanent Playwright spec — CI's own
Docker daemon (GitHub Actions) has no `slice3-project-a`/`-b` containers, and
creating them there was out of this slice's scope (no CI workflow changes).

**Cleanup**: all `slice3-*` containers were removed after verification; the
pre-existing `sofra-*` containers were left completely untouched throughout
(confirmed via `docker ps` before/after).

---

## 6. Self-exclusion mechanism

`source.docker.ComposeLabels.EXCLUDED` = `"logexplorer.excluded"` (a fixed
label key, case-insensitive `"true"` value) — checked in
`DockerLogSource#relevantContainers`, **before** the Compose project filter,
so an excluded container is invisible regardless of which project is active.
`docker-compose.yml`'s own `app` service now carries `logexplorer.excluded: "true"`,
documented inline.

Never a container-name heuristic — the label is the only signal checked.

**Unit tests**: `selfExcludedContainerIsAbsentFromDiscoverServices`,
`...FromSearch`, `...FromLiveTail`, `selfExclusionAppliesRegardlessOfAnyConfiguredProjectFilter`.

**Real-Docker evidence**: a container labeled
`com.docker.compose.project=slice3-project-a`, `com.docker.compose.service=app`,
`logexplorer.excluded=true` was created alongside the two payments containers.
It never appeared in `GET .../services` (with or without a project filter
active), and an explicit `POST /api/v1/logs/search {services:["app"]}` always
returned zero events — even when the active project filter matched its own
project (`slice3-project-a`). Unrelated real services (`caddy`/`db`/`web`,
`payments` in both projects) were unaffected throughout.

---

## 7. Diagnostics

`DockerDiagnostics` gains two new sanitized classifications this slice
(policy/SSRF rejection, and the guard's own DNS-failure case), alongside the
pre-existing unreachable/connection-refused/timeout/TLS-handshake/permission-denied/
socket-not-found categories. Every message remains a fixed string chosen by
classification — never a raw exception message, host, or stack trace.
`DockerDiagnosticsTest#remoteHostRejectionClassificationNeverEchoesTheGuardsOwnMessage`
and `DockerSettingsControllerTest#testConnectionResponseNeverContainsTheSubmittedHostLiteralEvenOnFailure`
both plant a sentinel value and prove it is never echoed anywhere in the
classified message.

---

## 8. Tests

### Backend — `./mvnw --batch-mode verify`

```
[INFO] Tests run: 491, Failures: 0, Errors: 0, Skipped: 0
[INFO] BUILD SUCCESS
```

51 new tests this slice: `RemoteHostGuardTest` (18, new file — loopback/
metadata/private-LAN rejection, CIDR/hostname allowlist acceptance, mixed-
resolution rejection, DNS-rebinding re-resolution, shared test/runtime
policy), `DockerClientFactoryTest` (7 → 9, +2 — guard integration, LOCAL mode
never consults the guard), `DockerDiagnosticsTest` (8 → 11, +3 —
policy/DNS-failure classification, no raw-message echo),
`DockerSettingsControllerTest` (9, new file — candidate validation, sanitized
failure diagnostics, no runtime mutation, no secret echo), `DockerLogSourceTest`
(24 → 43, +19 — `composeService` enrichment, the two-Compose-project
overlapping-service-name matrix, self-exclusion, REMOTE-mode guard
integration). Baseline (Slice 2 merge) was 440; 440 + 51 = 491.

### Frontend — `npm run typecheck && npm run test && npm run build`

```
tsc -b --noEmit             -> clean
Test Files  45 passed (45)
Tests       375 passed (375)
vite build                  -> ✓ built in 446ms
```

13 new tests this slice: `DockerSettingsPanel.test.tsx` (new file — summary
display for LOCAL/REMOTE, Compose project filter value, sanitized fetch/
test-connection errors, mode-conditional field visibility, Test Connection
success/failure rendering, submitted-field scoping, no localStorage/
sessionStorage writes, fresh re-fetch on reopen rather than a stale draft,
Escape close, jest-axe). Baseline (Slice 2 merge) was 362.

### E2E — `npx playwright test`

```
98 passed (3.2m)
```

New file `frontend/e2e/phase-legacy-slice3-docker-settings.spec.ts` (8 tests
— mission items 1-8 + 13; items 9-12 verified for real per §5/§6 above, not
duplicated as a mocked browser test). Baseline (Slice 2 merge) was 90.

---

## 9. Commands run

```
cd backend && ./mvnw --batch-mode verify           # 491 passed, BUILD SUCCESS
cd frontend && npm run typecheck                    # clean
cd frontend && npm run test -- --run                # 375 passed
cd frontend && npm run build                        # succeeded
SPRING_PROFILES_ACTIVE=dev ./mvnw spring-boot:run    # real backend for mocked E2E
cd frontend && npx playwright test                   # 98 passed

# Real Docker verification (manual, see §5/§6 for full transcript):
docker run -d --name slice3-a-payments --label com.docker.compose.project=slice3-project-a \
  --label com.docker.compose.service=payments busybox:latest sh -c '...'
docker run -d --name slice3-b-payments --label com.docker.compose.project=slice3-project-b \
  --label com.docker.compose.service=payments busybox:latest sh -c '...'
docker run -d --name slice3-a-app --label com.docker.compose.project=slice3-project-a \
  --label com.docker.compose.service=app --label logexplorer.excluded=true busybox:latest sh -c '...'
LOGEXPLORER_DOCKER_COMPOSE_PROJECT_FILTER=slice3-project-a SPRING_PROFILES_ACTIVE=dev ./mvnw spring-boot:run
curl -s http://127.0.0.1:8080/api/v1/sources/local-docker/services
curl -s -X POST http://127.0.0.1:8080/api/v1/logs/search -d '{...}'
curl -s -N http://127.0.0.1:8080/api/v1/logs/live?sourceId=local-docker
# (repeated with LOGEXPLORER_DOCKER_COMPOSE_PROJECT_FILTER=slice3-project-b)
docker rm -f slice3-a-payments slice3-b-payments slice3-a-app slice3-a-loop slice3-b-loop
```

---

## 10. Known limitations / blockers

- **Runtime settings mutation (Save/Reset)** is intentionally **not
  implemented** — this application has no authenticated admin boundary, and
  building an unauthenticated global Docker-host-mutation endpoint would be a
  real SSRF/security regression, explicitly forbidden by the mission's own
  owner decision. `RUNTIME_SETTINGS_MODEL` = read-only inspection + ephemeral
  Test Connection only; changing the committed connection requires
  editing deployment/runtime configuration (env vars/`application.yml`) and
  restarting the application — documented honestly in the UI's own
  `settingsNote`, never claimed as hot-switchable.
- **Runtime Compose-project-filter changes**: same as above — changing
  `LOGEXPLORER_DOCKER_COMPOSE_PROJECT_FILTER` requires an application restart
  (proven necessary and sufficient by the real-Docker verification in §5,
  which used exactly this restart-based workflow). `RUNTIME_PROJECT_CHANGE` =
  NOT_SUPPORTED, by the same documented reasoning as the settings model above
  — never claimed as hot-switchable.
- **CI's own Docker daemon** (GitHub Actions) has no `slice3-project-a`/`-b`
  containers, so the real-Docker Compose-isolation verification (§5/§6) is
  manual/local, not part of the committed, CI-executed Playwright suite —
  documented with full commands/output for reproducibility rather than
  fabricated as an automated check that doesn't actually run anywhere.
- A residual, inherent-to-the-feature risk: since this application has no
  authentication, **anyone who can reach the app** can also reach `POST
  .../test-connection` and cause the server to make one bounded, read-only
  `ping()` request to a public-shaped target address of their choosing (never
  a private/internal one — `RemoteHostGuard` still applies in full). This is
  the smallest residual surface achievable without inventing authentication
  (explicitly out of scope for this slice), and is far narrower than an
  unrestricted SSRF primitive would be.
- The pre-existing, deliberately-deferred `useSearchState.ts` services-fetch
  request-supersession race (Issue #19) was **not** touched.

---

## 11. Scope discipline

Not touched: Issue #19, Slice 4 (table configuration), Slice 5 (live tail
reconnect controls), Slice 7 (message redaction), authentication architecture
(no new auth was added — the absence of one is exactly why the settings model
was scoped the way it was), external Docker daemon configuration, any
unrelated refactoring.
