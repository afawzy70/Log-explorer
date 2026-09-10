# Slice 9 — Cross-Platform Developer Experience Report

Evidence for §K, §W–§AD of Legacy Remediation Slice 9.

## Development ports (§K)

Formalized and verified (see `LEGACY_REMEDIATION_SLICE_9_REPORT.md` for
the full migration writeup and regression evidence):

- Spring Boot: **3434** (`backend/src/main/resources/application.yml`)
- Vite: **3435** (`frontend/vite.config.ts`), proxying `/api`/`/actuator`
  to 3434
- Production: no separate Vite port at all — Spring Boot serves the
  built static assets directly.

## Script inventory and cross-platform status

| Script | `.sh` | `.ps1` | Notes |
|---|---|---|---|
| `scripts/smoke.sh` / `.ps1` | ✅ | ✅ (new this slice) | Docker Compose smoke test |
| `scripts/validate-openshift-manifests.sh` / `.ps1` | ✅ | ✅ (new this slice) | OpenShift manifest lint/schema/secret-shape validation |
| `scripts/export-image.sh` / `.ps1` | ✅ (new this slice) | ✅ (new this slice) | Offline Docker image export |
| `scripts/import-image.sh` / `.ps1` | ✅ (new this slice) | ✅ (new this slice) | Offline Docker image import |
| `desktop/packaging/build-runtime.ps1` | N/A | ✅ | jlink is inherently platform-specific output (produces a Windows runtime) — no Bash twin is meaningful; this script only ever runs on the Windows CI runner that builds the Windows artifact |
| `desktop/packaging/packaged-smoke-test.ps1` | N/A | ✅ | Same reasoning — tests a Windows-only installed artifact |
| `Makefile` (`demo-log-generator-*`, `mock-loki-*`, `playwright-harness-*`) | N/A (Make targets) | Not ported | Reviewed: every target is a thin one-line wrapper around an already-cross-platform `node ...`/`npm ...` command (`tools/demo-log-generator/generate.js`, `tools/mock-loki/*.js`, `tools/playwright-harness`) — a Windows developer can run the underlying `node`/`npm` command directly without needing `make` at all (which isn't installed by default on Windows). Not central to the primary documented workflow (not referenced from the root README), so left as-is rather than adding a `.ps1`/`Invoke-Build` wrapper nobody was going to use. |

Every script central to the documented developer workflow (Quick Start,
testing, offline distribution) now has a genuine PowerShell twin with
identical steps and PASS criteria — verified by direct comparison against
the `.sh` original, not just "looks similar."

## Maven Wrapper (§AA)

Canonical everywhere already (pre-existing, re-verified this slice, no
change needed): `./mvnw` (Linux/macOS) / `.\mvnw.cmd` (Windows) in every
documented backend command (`README.md`, `backend/README.md`,
`docs/RUN_GUIDE.md`, CI workflows). No globally-installed Maven is
required or assumed anywhere in the repository.

## Environment variables (§Y)

Root `README.md` and `docs/RUN_GUIDE.md` both give the correct
platform-specific syntax side by side wherever an environment variable is
set outside of `.env`/Compose (`$env:VAR = "value"` for PowerShell,
`export VAR=value` for Bash) — never Unix `export` presented as universal.

## Docker cross-platform notes (§AB)

`docker compose` (not the legacy standalone `docker-compose` binary) is
used consistently throughout every doc and script. No script assumes a
Unix-only Docker socket path — the one place a socket path matters
(`docker-compose.docker-socket.yml`'s bind mount) is an opt-in profile
for real container log discovery, documented as such in
`docs/RUN_GUIDE.md`, and is inherently a Linux/Docker-Engine-only
capability regardless of host OS (Docker Desktop on Windows/macOS runs
containers inside its own Linux VM, so the same bind-mount syntax works
identically through Docker Desktop's own path translation — no
Windows-specific instruction was needed beyond what already existed).

## Windows/Linux CI validation (§AC)

- **Linux** (`ci.yml`, pre-existing, unchanged in shape): Backend
  (`./mvnw verify`), Frontend (`npm ci && typecheck && test && build`),
  E2E (full Playwright suite against a real dev-profile backend) — all
  still green after this slice's port-model migration (verified in PR
  #30: Backend/Frontend/E2E all `pass`).
- **Windows** (`.github/workflows/windows-desktop.yml`, new this slice):
  builds the real frontend, embeds it into the real backend jar, builds
  a real jlink runtime, publishes the real launcher, builds the real
  installer, and runs the real packaged smoke test — on a genuine
  `windows-latest` runner. This is deliberately **not** a duplicate of
  the full Linux E2E matrix (the mission's own "do not duplicate the
  entire expensive E2E matrix on every OS unless justified" instruction)
  — it validates the Windows-specific packaging/launcher pipeline that
  has no Linux equivalent to duplicate, plus a full backend+frontend
  build as a byproduct.
- Both workflows are scoped with path filters so routine changes outside
  their concern don't trigger unnecessary runs.

## Documentation cross-platform coverage (§X)

Every place `README.md`/`docs/RUN_GUIDE.md`/`backend/README.md`/
`frontend/README.md` give a shell command, Windows PowerShell and Linux/
macOS Bash are either (a) shown side by side when they differ (Maven
wrapper, env var syntax, script invocation), or (b) explicitly noted as
identical when they are (`npm` commands, `docker compose` commands).

## Documented commands verified

Commands actually re-run this slice, for real, against the current repo
state (not assumed from having been true once):

- `docker compose --profile demo up --build` → real build + start (via
  `scripts/smoke.sh`, which wraps the same compose invocation) — PASS.
- `./scripts/smoke.sh` → PASS (full transcript in
  `SLICE_9_PACKAGING_REPORT.md`).
- `./scripts/export-image.sh` / `./scripts/import-image.sh` → PASS, real
  round trip (transcript in `SLICE_9_PACKAGING_REPORT.md`).
- `./scripts/validate-openshift-manifests.sh` → PASS (real kubeconform
  run against the port-migrated manifests: 6/6 valid).
- `./mvnw --batch-mode verify` (backend) → PASS, 595/595.
- `npm run typecheck && npm run test -- --run && npm run build`
  (frontend) → PASS, 604/604, clean build.
- `npx playwright test` (E2E) → PASS, 171/171.
- The Windows-only commands (`dotnet publish`, `jlink`, `ISCC.exe`, the
  packaged smoke test) → PASS, on the real `windows-latest` CI runner
  (this sandbox has no Windows/.NET toolchain to re-run them locally).

The `.ps1` scripts themselves (`smoke.ps1`, `export-image.ps1`,
`import-image.ps1`, `validate-openshift-manifests.ps1`) are **not**
directly executed in this session (no PowerShell runtime in this Linux
sandbox) — their logic was written to mirror the `.sh` originals
step-for-step and was reviewed carefully, but this is disclosed as
`BLOCKED` (environment limitation), not claimed as run. The Windows CI
job does exercise real PowerShell (`packaged-smoke-test.ps1`,
`build-runtime.ps1`, and every `pwsh`-shelled step in
`windows-desktop.yml`), which is real evidence that PowerShell scripting
in this repository works correctly on the actual target platform, even
though these four specific developer-facing scripts aren't wired into
that CI job.

## Documentation quality gate (§AE) — self-check

Can a new developer answer these from the docs alone?

| Question | Answered in |
|---|---|
| Where does a log enter the system? | `backend/README.md` ("Parsing / normalization") |
| How does it become a canonical event? | `backend/README.md`, `docs/development/BACKEND_FRONTEND_INTEGRATION.md` |
| Where is sensitive information removed? | `backend/README.md` ("Masking / redaction"), `docs/SECURITY_NOTES.md` |
| How does search reach Docker/Loki? | `backend/README.md` ("The LogSource abstraction"), `docs/development/ARCHITECTURE.md` |
| How does Live work? | `backend/README.md` ("Live / SSE"), `frontend/README.md` ("Live state machine"), `docs/development/BACKEND_FRONTEND_INTEGRATION.md` |
| How do Backend and Frontend connect? | `docs/development/BACKEND_FRONTEND_INTEGRATION.md` (the whole document) |
| Where do I add a source? | `backend/README.md` ("Where do I change X?") |
| Where do I add a filter? | Both READMEs' "Where do I change X?" |
| Where do I add a table column? | `frontend/README.md` ("Where do I change X?") |
| How do I run/debug/test on Windows? | Root `README.md` (every command block gives the PowerShell form) |
| How do I run/debug/test on Linux? | Root `README.md` (every command block gives the Bash form) |
| How is the Windows EXE generated? | `docs/development/ARCHITECTURE.md` ("Windows desktop architecture"), `SLICE_9_WINDOWS_DESKTOP_REPORT.md` |
| How does production differ from development? | Root `README.md` ("Production vs. development" table) |

## Developer change-safety guide (§AF)

Captured in the two developer READMEs directly (not a separate
checklist file, to keep it next to the code it governs):

- **Backend**: `backend/README.md`'s "Security boundaries" and
  "Performance invariants" sections, plus the "Where do I change X?"
  table's own framing (extend the `LogSource` abstraction, keep masking
  unconditional, keep bounds explicit).
- **Frontend**: `frontend/README.md`'s "Persistence rules" (never persist
  protected/query values), "Accessibility & responsive behavior", "Lazy
  loading" (evidence-driven, not decorative), and "Server-owned vs.
  frontend-owned" sections.
- **Before a PR**: the existing per-slice verification-report convention
  (`docs/verification/LEGACY_REMEDIATION_SLICE_<N>_REPORT.md`) already
  is this project's PR checklist in practice — backend verify, frontend
  typecheck/test/build, E2E as relevant, documentation updated - carried
  forward unchanged by this slice.
