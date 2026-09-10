# Log Explorer

Log Explorer is a Seq-like investigation UI for structured Spring Boot JSON
logs, over three logical sources — a local Docker Compose stack (via the
Docker Engine API), an OpenShift Loki gateway, and an in-process synthetic
Fixture source for development/demo — served from a single deployable image
with no application database.

Built for developers and support engineers who need to answer ordinary
questions ("what failed in the last 30 minutes", "what happened for this
user", "follow this request across services") without hand-inspecting
`docker logs`, writing raw LogQL, or manually correlating trace/correlation
IDs by eye — and without ever exposing a raw sensitive value (CIF, username,
customer ID, device ID, device IP, and a conservative set of free-text
patterns like card numbers, tokens, and passwords) while doing it.

> Neutral identity only — "Log Explorer" / "Multi-Source Log Explorer". No
> production-readiness claim: this is a project built out incrementally
> (phases, then a series of "Legacy Remediation" slices), each with a real,
> honestly-reported verification pass. See [Project status](#project-status).

## Use cases

- **"What failed recently?"** — pick a service, a time window, Errors-only
  severity, and get a scannable table of failures, no raw JSON required.
- **"What happened for this customer/session?"** — search by a pasted
  identifier (auto-detected, never silently trusted) and see every matching
  event with `User/Customer` shown safely masked.
- **"Follow this request across services."** — open the event inspector on
  any row, click its trace/correlation/journey ID, and get an ascending,
  cross-service timeline — with an explicit "this does not indicate
  causality" disclaimer, since ordering isn't proof of a call graph.
- **"What else happened around this exact moment?"** — a bounded `±30s`
  context view around any single event, scoped to the same service/
  container/pod.
- **"Watch it happen live."** — a real-time, Server-Sent-Events tail for
  sources that support it, bounded and clearly distinct from historical
  search.

## Architecture

```mermaid
flowchart LR
    User(("Investigator")) --> React["React + TypeScript UI\n(frontend/)"]
    React <-->|"REST + SSE\n/api/v1/**, /actuator/**"| Spring["Spring Boot (WebFlux)\n(backend/)"]
    Spring --> LogSource{{"LogSource abstraction"}}
    LogSource --> Docker["Docker adapter\n(Docker Engine API, read-only)"]
    LogSource --> Loki["Loki adapter\n(OpenShift gateway, read-only)"]
    LogSource --> Fixture["Fixture adapter\n(synthetic, dev/test only)"]
```

Every response crosses exactly one masking boundary before it ever reaches
`React` — see [Security & redaction](#security--redaction) below and
**[`docs/development/ARCHITECTURE.md`](docs/development/ARCHITECTURE.md)**
for the full component map and every deployment shape (Docker Compose,
OpenShift, Windows desktop) with diagrams. For the exact request/response
flow through every layer (historical search, Live, context/journey), see
**[`docs/development/BACKEND_FRONTEND_INTEGRATION.md`](docs/development/BACKEND_FRONTEND_INTEGRATION.md)**.

- **Backend**: Java 21, Spring Boot 3 (WebFlux, reactive end to end), Maven.
  `backend/src/main/java/com/logexplorer/` — see
  **[`backend/README.md`](backend/README.md)** for the backend developer guide.
- **Frontend**: React 19 + TypeScript (strict) + Vite. `frontend/src/` — see
  **[`frontend/README.md`](frontend/README.md)** for the frontend developer guide.
- **One deployable image**: the frontend's production build is embedded as
  the backend's own static resources (see `Dockerfile`) and served with an
  SPA fallback that never swallows `/api/**` or `/actuator/**` — no
  separate frontend server, no reverse proxy required in production. The
  Windows desktop app (below) embeds the exact same backend, launched
  locally instead of in a container.
- **No application database.** Sources are queried live; nothing is
  persisted server-side. The only thing the browser ever persists is a
  small set of safe, non-sensitive UI preferences (table column order/
  density) — see [Security & redaction](#security--redaction).

## Features

- **Bounded historical search** across a selected source, with service
  multi-select, severity filter, universal search (with confirmable ID
  detection), advanced filters grouped by question, and precise time-range
  handling (presets, a custom-range popover, exact interval + zone display).
- **A truthful, exactly-seven-column results table** — Time, Level, Service,
  What happened, User/Customer, Correlation/Trace, Actions — newest first,
  reorderable/hideable/density-adjustable (persisted safely, see below),
  with honest, non-contradictory counts (total/returned/visible/truncated).
- **An event inspector** — full detail on any event (overview, actor/client,
  request flow, business/error, all fields with raw JSON behind a
  disclosure), a bounded `±30s` context view, and safe copy/find-related
  actions on non-sensitive IDs only.
- **Trace / correlation / journey investigation** — click a non-sensitive ID
  to open an ascending, cross-service timeline, with an explicit "this does
  not indicate causality" disclaimer.
- **Live tail** — start/pause/resume/stop a real-time stream (Server-Sent
  Events) for sources that support it, with a bounded 1,000-event display
  cap and honest dropped/buffered counts, visually distinct from historical
  search.
- **A centralized keyboard-shortcut registry** and a shortcuts-help popover
  that always reflects the real, currently-registered bindings — never a
  hand-maintained list that can drift out of sync.
- **Security by construction**: five structured sensitive fields (`cif`,
  `UserName`, `CustomerId`, `deviceId`, `deviceIp`) are masked server-side
  at a single boundary before any response leaves the backend; a
  conservative, server-side free-text redaction pass additionally catches
  high-confidence patterns (Luhn-valid card numbers, bearer tokens,
  password key=value pairs) inside message/exception text. Raw values,
  search terms, and tokens are never logged, never put in a URL, and never
  persisted client-side. Docker and OpenShift access are both strictly
  read-only (list / inspect / read logs / follow logs — never
  start/stop/create/remove/exec). TLS verification is always on, with no
  trust-all option anywhere in the codebase.
- **Explicit, honest source capabilities** — the backend reports what each
  source can actually do (live tail, raw LogQL, service discovery, …); the
  frontend never infers or fakes a capability a source doesn't really have.

## Repository structure

```
backend/    Spring Boot backend (parsing, masking, guardrails, source adapters, API) - see backend/README.md
frontend/   React + TypeScript UI - see frontend/README.md
desktop/    Windows standalone desktop app (WebView2 launcher + packaging) - see "Windows desktop distribution" below
tools/      Standalone verification-harness components (demo log generator, mock Loki)
docs/       Requirements handover, run guide, security notes, architecture/integration docs, per-slice verification reports
deploy/     OpenShift deployment manifests (Deployment, Service, ConfigMap, ServiceAccount)
scripts/    Deterministic verification scripts (smoke test, offline image export/import) - Bash (.sh) and PowerShell (.ps1) versions of each
```

## Quick start — Docker (recommended)

Requires Docker Engine with Compose v2 (the `docker compose` subcommand).
No local Java or Node install needed — the whole build happens inside the
`Dockerfile`. Works identically on Linux, macOS, and Windows (Docker
Desktop) — nothing below needs WSL2, Git Bash, or Cygwin.

Windows PowerShell:

```powershell
git clone <this repository>
cd Log-explorer
Copy-Item .env.example .env
docker compose --profile demo up --build
```

Linux / macOS:

```bash
git clone <this repository>
cd Log-explorer
cp .env.example .env
docker compose --profile demo up --build
```

Open <http://localhost:3434>. This starts the app (with the in-process
**Fixture** source enabled — deterministic fake data, zero external
dependency) plus a deterministic demo log generator container. The app
itself only ever listens on `127.0.0.1` (see
[Production vs. development](#production-vs-development)).

Full guide — every command below was actually run against this repository,
including real Docker container discovery and an offline OpenShift Loki
demo: **[docs/RUN_GUIDE.md](docs/RUN_GUIDE.md)**. Covers:

- The `docker-socket` profile (real, read-only Docker container discovery
  and log search/live-tail — mounted read-only, behind an explicit,
  doubly-gated opt-in, never silently).
- The `loki-mock` profile (an offline OpenShift Loki gateway stand-in).
- Pointing the same image at a real OpenShift Loki gateway or a remote
  Docker host.
- Every `LOGEXPLORER_*` / `SPRING_PROFILES_ACTIVE` environment variable —
  full reference in **[.env.example](.env.example)**.
- Offline image export/import for a machine with no registry access.
- Ports, health checks, troubleshooting.

Deterministic smoke test (build → start → health → source discovery →
search → UI load → stop → cleanup, limited to this stack only):

Windows PowerShell: `.\scripts\smoke.ps1` · Linux / macOS: `./scripts/smoke.sh`

## Windows desktop distribution

A standalone Windows application - `LogExplorer.exe` - for someone who just
wants to run Log Explorer locally without Docker or a browser tab:

```
LogExplorer.exe
  -> WinForms launcher (desktop/launcher)
  -> bundled Java runtime (jlink, no system Java required)
  -> the same Spring Boot backend, on 127.0.0.1, preferring port 3434
  -> an embedded WebView2 window (Microsoft Edge's engine, not a bundled
     browser) - never a plain "open Chrome to localhost" experience
```

Single-instance safe (a second launch activates the existing window rather
than starting a second backend), picks a free port automatically if 3434 is
taken by something else, and shuts the backend down cleanly - no orphaned
background process - when the window closes. See
**[`docs/development/ARCHITECTURE.md`](docs/development/ARCHITECTURE.md#windows-desktop-architecture)**
for the full startup/shutdown lifecycle and
**[`docs/verification/SLICE_9_WINDOWS_DESKTOP_REPORT.md`](docs/verification/SLICE_9_WINDOWS_DESKTOP_REPORT.md)**
for real build/packaging/smoke-test evidence from the `Windows Desktop` CI
workflow (`.github/workflows/windows-desktop.yml`), which builds and
verifies it on a real Windows runner on every relevant change - this
project has no local Windows machine of its own, so that hosted workflow
is the actual source of truth for whether the installer works, not a
claim taken on faith.

An installable `LogExplorer-<version>-windows-x64.exe` (Start Menu entry,
optional desktop shortcut, clean uninstall, per-user install - no admin
rights required) is produced by that same workflow; see the Windows
desktop report for where to get one from a given commit/tag.

## Production vs. development

|  | Development | Production (Docker / OpenShift / Windows desktop) |
|---|---|---|
| Backend | `mvnw spring-boot:run` on **3434** | Same app, same port, embedded in the deployable artifact |
| Frontend | `npm run dev` (Vite) on **3435**, proxying `/api`/`/actuator` to 3434 | **No separate frontend server at all** - Spring Boot serves the built static assets directly |
| Backend bind address | `127.0.0.1` (the application's own default) | `127.0.0.1` for the Windows desktop app; `0.0.0.0` *inside* the container for Docker/OpenShift, with the host-side/Service boundary (not the process itself) scoping actual reachability - see `docker-compose.yml`'s own comment |

## Run locally (without Docker)

Requires **Java 21** ([Temurin](https://adoptium.net/) works well on all
three platforms) and **Node.js 20+**. Two terminals — the frontend dev
server proxies `/api` and `/actuator` to the backend on port **3434**, so
both need to be running together.

**Important — set `SPRING_PROFILES_ACTIVE=dev` unless you specifically
want to query a real source.** Without it, the backend registers only the
real `local-docker` (via your local Docker Desktop/Engine) and
`openshift-loki` sources — no Fixture source, no demo data. This is a
common source of confusion when running locally for the first time: if
you start the backend with no active profile and search against
`local-docker`, it will genuinely try to read logs from whatever real
containers happen to be running on your machine.

**Backend** (starts on `:3434`; `SPRING_PROFILES_ACTIVE=dev` enables the
in-process Fixture source, the same zero-dependency demo data the Docker
quick start uses):

Windows PowerShell:

```powershell
cd backend
$env:SPRING_PROFILES_ACTIVE = "dev"
.\mvnw.cmd spring-boot:run
```

Linux / macOS:

```bash
cd backend
SPRING_PROFILES_ACTIVE=dev ./mvnw spring-boot:run
```

**Frontend** (starts on `:3435`; identical on every platform):

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:3435>. Configuration is the same set of
`LOGEXPLORER_*` environment variables documented in `.env.example` — set
them in your shell (`$env:VAR = "value"` in PowerShell,
`export VAR=value` on macOS/Linux) before starting the backend to point it
at a real Docker socket or Loki gateway instead of the Fixture source.

## Testing

Windows PowerShell and Linux/macOS use the identical `npm` commands below;
the only platform-specific piece is the Maven wrapper (`mvnw.cmd` vs.
`./mvnw`) — a globally-installed Maven is never required either way.

```powershell
# Backend — 595 tests: parser, masking (structured + free-text redaction),
# guardrails, source adapters, query engine, cursor pagination, API
# integration, ArchUnit boundary, log/query-plan/token/cursor leak checks.
cd backend
.\mvnw.cmd test
```

```bash
# Backend — Linux/macOS
cd backend && ./mvnw test
```

```bash
# Frontend — 604 unit/component tests (Vitest + Testing Library + jest-axe).
# Identical on every platform.
cd frontend && npm run test

# Frontend strict type-check and production build.
cd frontend && npm run typecheck && npm run build

# Real-browser end-to-end (Playwright) — 171 tests across every slice,
# against a real running backend + frontend dev server.
cd frontend && npm run test:e2e
```

## Security & redaction

Sensitive values are removed **server-side, once, at a single boundary**
before a response ever reaches the browser — the frontend never sees a raw
value to accidentally leak, and never performs redaction itself. Two
layers:

1. **Structured masking** — five known sensitive fields (`cif`, `UserName`,
   `CustomerId`, `deviceId`, `deviceIp`) are always masked in the response
   DTO, regardless of source.
2. **Conservative free-text redaction** — a small set of high-confidence
   patterns (Luhn-valid card numbers, bearer/JWT tokens, `password=`-style
   key/value pairs) inside message/exception text, deliberately narrow so
   it never mangles an ordinary stack trace or log line.

Full detail (exact rules, what's deliberately *not* redacted and why,
performance bounds): **[docs/SECURITY_NOTES.md](docs/SECURITY_NOTES.md)**.
Client-side, the only thing ever written to `localStorage` is a small,
versioned, schema-validated table-preference object (column order/
visibility/density) — never a search value, a filter value, or a log
event; malformed stored preferences always fail safely back to defaults.
See `frontend/README.md`'s own "Safe preferences" section.

## Performance boundaries

A short list of invariants that are load-bearing product requirements, not
incidental behavior — see `backend/README.md`/`frontend/README.md` for the
code-level detail behind each:

- Live tail: a bounded 1,000-event display cap, bounded server-side buffer,
  batched (never one state update per event) frontend rendering, bounded/
  cancellable reconnect.
- Historical search: bounded page size/limits, HMAC-signed opaque cursors
  (no raw offset/query leaked into a cursor), a bounded max time range.
- Frontend delivery: `JourneyView`/`LiveTailPanel` are code-split
  (`React.lazy`) since they're genuinely conditional secondary views; the
  primary Search → scan → inspect path is never lazy-loaded. See
  `docs/verification/SLICE_8_FRONTEND_PERFORMANCE_REPORT.md` for real
  bundle-size evidence.
- Docker/Loki adapters: bounded container/result counts, bounded request
  timeouts, no unbounded scans.

## Project status

Built incrementally against `IMPLEMENTATION_PLAN.md` (Phases A–L) and then
a series of "Legacy Remediation" slices restoring/upgrading capability
against the prior application it replaces, one branch and one pull request
each, with a real, honestly-reported verification pass before anything is
considered done (never "compilation is evidence" — see `CLAUDE.md`).

| Stage | Scope | Status |
|---|---|---|
| Phases A–L | Sources, parsing/masking, query engine, full search/inspector/journey/live UI, Docker Compose + OpenShift delivery | Done |
| Legacy Remediation Slices 1–6 | Pagination, query transparency, Docker settings UX, table configurability, Live resilience, investigation depth & source health | Done |
| Legacy Remediation Slice 7 | Conservative free-text sensitive-data redaction | Done |
| Legacy Remediation Slice 8 | Keyboard-shortcut registry, safe preference persistence, frontend delivery performance (code splitting) | Done |
| Legacy Remediation Slice 9 | Packaging, portability, Windows desktop distribution, cross-platform developer experience | This slice |
| Phase M | Final stakeholder acceptance | Not started |

Full per-requirement coverage: **[REQUIREMENTS_TRACEABILITY.md](REQUIREMENTS_TRACEABILITY.md)**.
Per-phase/per-slice verification reports (real commands, real output, honest
PASS/FAIL/BLOCKED/DEFERRED — never fabricated):
**`docs/verification/PHASE_<X>_REPORT.md`** /
**`docs/verification/LEGACY_REMEDIATION_SLICE_<N>_REPORT.md`**.

## Documentation map

| Document | What it's for |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Non-negotiable operating rules (security, verification honesty, behavioral invariants) — read before touching this repo |
| [`HANDOVER.md`](HANDOVER.md) | Full requirements handover — product intent, architecture, UX decisions, constraints |
| [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) | The phase-by-phase build plan this project followed through Phase L |
| [`REQUIREMENTS_TRACEABILITY.md`](REQUIREMENTS_TRACEABILITY.md) | Every requirement mapped to its owning phase and evidence |
| [`docs/LEGACY_TO_NEW_VERIFIED_CAPABILITY_MATRIX.md`](docs/LEGACY_TO_NEW_VERIFIED_CAPABILITY_MATRIX.md) | Every capability the prior application had, reconciled against real evidence in this codebase |
| [`backend/README.md`](backend/README.md) | Backend developer guide — structure, "where do I change X", every major component's purpose/location/invariants |
| [`frontend/README.md`](frontend/README.md) | Frontend developer guide — structure, "where do I change X", state ownership, safe preferences, shortcuts |
| [`docs/development/ARCHITECTURE.md`](docs/development/ARCHITECTURE.md) | System overview, component maps, deployment architecture (Docker/OpenShift/Windows desktop), with diagrams |
| [`docs/development/BACKEND_FRONTEND_INTEGRATION.md`](docs/development/BACKEND_FRONTEND_INTEGRATION.md) | The exact request/response flow for historical search, Live, and context/journey, end to end |
| [`docs/RUN_GUIDE.md`](docs/RUN_GUIDE.md) | Full run guide — Docker Compose profiles, ports, env vars, offline export/import, troubleshooting |
| [`docs/SECURITY_NOTES.md`](docs/SECURITY_NOTES.md) | Full security posture across every deployment shape |
| [`.env.example`](.env.example) | Every configuration variable, with names and harmless defaults only |
| [`deploy/openshift/`](deploy/openshift/) | OpenShift manifests |
| `docs/verification/PHASE_<X>_REPORT.md`, `LEGACY_REMEDIATION_SLICE_<N>_REPORT.md` | Per-phase/per-slice verification reports |

## Out of scope

SSO / per-user OAuth, long-term log storage, SIEM, alerting, full APM, log
mutation, a cross-source single query, an application database,
cluster-wide permissions, saved/team queries, retention/DR, tracing-backend
integration, multi-cluster queries, AI root-cause diagnosis, analytics, and
production identity features are all explicitly out of scope — see
`CLAUDE.md` §8 for the full list and why.
