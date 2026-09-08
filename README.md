# Log Explorer

Log Explorer is a Seq-like investigation UI for structured Spring Boot JSON
logs, over two logical sources — a local Docker Compose stack (via the
Docker Engine API) and an OpenShift Loki gateway — served from a single
deployable image with no application database.

Built for developers and support engineers who need to answer ordinary
questions ("what failed in the last 30 minutes", "what happened for this
user", "follow this request across services") without hand-inspecting
`docker logs`, writing raw LogQL, or manually correlating trace/correlation
IDs by eye — and without ever exposing a raw sensitive value (CIF, username,
customer ID, device ID, device IP) while doing it.

> Neutral identity only — "Log Explorer" / "Multi-Source Log Explorer". No
> production-readiness claim: this is a project built out phase by phase, see
> [Project status](#project-status) below for exactly what's real today.

## Features

- **Bounded historical search** across a selected source, with service
  multi-select, severity filter, universal search (with confirmable ID
  detection), advanced filters grouped by question, and precise time-range
  handling (presets, a custom-range popover, exact interval + zone display).
- **A truthful, exactly-seven-column results table** — Time, Level, Service,
  What happened, User/Customer, Correlation/Trace, Actions — newest first,
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
- **Security by construction**: five sensitive fields (`cif`, `UserName`,
  `CustomerId`, `deviceId`, `deviceIp`) are masked server-side at a single
  boundary before any response leaves the backend; raw values, search
  terms, and tokens are never logged, never put in a URL, and never
  persisted client-side. Docker and OpenShift access are both strictly
  read-only (list / inspect / read logs / follow logs — never
  start/stop/create/remove/exec). TLS verification is always on, with no
  trust-all option anywhere in the codebase.
- **Explicit, honest source capabilities** — the backend reports what each
  source can actually do (live tail, raw LogQL, service discovery, …); the
  frontend never infers or fakes a capability a source doesn't really have.

## Architecture

- **Backend**: Java 21, Spring Boot 3 (WebFlux, reactive end to end), Maven.
  `backend/src/main/java/com/logexplorer/`.
- **Frontend**: React 19 + TypeScript (strict) + Vite. `frontend/src/`.
- **One deployable image**: the frontend's production build is embedded as
  the backend's own static resources (see `Dockerfile`) and served with an
  SPA fallback that never swallows `/api/**` or `/actuator/**` — no
  separate frontend server, no reverse proxy required in production.
- **No application database.** Sources are queried live; nothing is
  persisted server-side.

```
backend/    Spring Boot backend (parsing, masking, guardrails, source adapters, API)
frontend/   React + TypeScript UI
tools/      Standalone verification-harness components (demo log generator, mock Loki)
docs/       Requirements handover, run guide, per-phase verification reports
scripts/    smoke.sh — deterministic build/start/health/search/UI smoke test
```

## Quick start — Docker (recommended)

Requires Docker Engine with Compose v2 (the `docker compose` subcommand).
No local Java or Node install needed — the whole build happens inside the
`Dockerfile`.

```bash
git clone <this repository>
cd Log-explorer
cp .env.example .env
docker compose --profile demo up --build
```

Open <http://localhost:8080>. This starts the app (with the in-process
**Fixture** source enabled — deterministic fake data, zero external
dependency) plus a deterministic demo log generator container.

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
- Ports, health checks, troubleshooting.

Run the deterministic smoke test (build → start → health → source
discovery → search → UI load → stop → cleanup, limited to this stack only):

```bash
./scripts/smoke.sh
```

## Run locally (without Docker)

Requires **Java 21** and **Node.js 20+**. Two terminals — the frontend dev
server proxies `/api` and `/actuator` to the backend on port 8080, so both
need to be running together.

**Backend** (starts on `:8080`; `SPRING_PROFILES_ACTIVE=dev` enables the
in-process Fixture source, the same zero-dependency demo data the Docker
quick start uses):

```bash
cd backend
SPRING_PROFILES_ACTIVE=dev ./mvnw spring-boot:run
```

**Frontend** (starts on `:5173`):

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. Configuration is the same set of
`LOGEXPLORER_*` environment variables documented in `.env.example` — export
them in your shell before starting the backend to point it at a real Docker
socket or Loki gateway instead of the Fixture source.

## Testing

```bash
# Backend — 362 tests: parser, masking, guardrails, source adapters,
# query engine, API integration, ArchUnit boundary, log/serialization leak
# checks.
cd backend && ./mvnw test

# Frontend — 288 unit/component tests (Vitest + Testing Library + jest-axe).
cd frontend && npm run test

# Frontend strict type-check and production build.
cd frontend && npm run typecheck && npm run build

# Real-browser end-to-end (Playwright) — 63 tests across every phase,
# against a real running backend + frontend dev server.
cd frontend && npm run test:e2e
```

## Project status

Built phase by phase against `IMPLEMENTATION_PLAN.md`, one branch and one
pull request per phase, with a real, honestly-reported verification pass
before each phase is considered done (never "compilation is evidence" —
see `CLAUDE.md`). Current state:

| Phase | Scope | Status |
|---|---|---|
| A / A2a / A2b | Repository audit, verification harness, fixture source | Done |
| B | Canonical model, parser, masking, source contract, guardrails | Done |
| C | Docker source (local + optional remote) | Done |
| D | OpenShift Loki source | Done |
| E | Query engine | Done |
| F | Historical search UX (shell, toolbar, time range) | Done |
| G | Results table correctness and truthful states | Done |
| H | Event inspector | Done |
| I | Trace / correlation / journey investigation | Done |
| J | Live tail | Done |
| K | Portable Docker Compose delivery | Done |
| L | OpenShift deployment assets | Not started |
| M | Final acceptance | Not started |

Full per-requirement coverage: **[REQUIREMENTS_TRACEABILITY.md](REQUIREMENTS_TRACEABILITY.md)**.
Per-phase verification reports (real commands, real output, honest
PASS/FAIL/BLOCKED/DEFERRED — never fabricated): **`docs/verification/PHASE_<X>_REPORT.md`**.

## Documentation map

| Document | What it's for |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Non-negotiable operating rules (security, verification honesty, behavioral invariants) — read before touching this repo |
| [`HANDOVER.md`](HANDOVER.md) | Full requirements handover — product intent, architecture, UX decisions, constraints |
| [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) | The phase-by-phase build plan this project follows |
| [`REQUIREMENTS_TRACEABILITY.md`](REQUIREMENTS_TRACEABILITY.md) | Every requirement mapped to its owning phase and evidence |
| [`docs/RUN_GUIDE.md`](docs/RUN_GUIDE.md) | Full run guide — Docker Compose profiles, ports, env vars, troubleshooting |
| [`.env.example`](.env.example) | Every configuration variable, with names and harmless defaults only |
| `docs/verification/PHASE_<X>_REPORT.md` | Per-phase verification report |

## Out of scope

SSO / per-user OAuth, long-term log storage, SIEM, alerting, full APM, log
mutation, a cross-source single query, an application database,
cluster-wide permissions, saved/team queries, retention/DR, tracing-backend
integration, multi-cluster queries, AI root-cause diagnosis, analytics, and
production identity features are all explicitly out of scope — see
`CLAUDE.md` §8 for the full list and why.
