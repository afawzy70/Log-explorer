# Legacy Remediation Slice 9 — Packaging, Portability, Windows Desktop Distribution & Cross-Platform Developer Experience

Base: `fd72eac00e6567b2b3862bccd5a2b0807d370b1e` (post-Slice-8 `main` HEAD,
after PR #28 and its corrective follow-up PR #29). Branch:
`phase/legacy-slice9-packaging-portability-desktop`. This is a packaging/
distribution/documentation slice, not a feature redesign — no query
semantics, pagination, redaction, or Docker security behavior changed.

Companion reports: **[`SLICE_9_PACKAGING_REPORT.md`](./SLICE_9_PACKAGING_REPORT.md)**
(bundle/image/installer sizes, real numbers), **[`SLICE_9_WINDOWS_DESKTOP_REPORT.md`](./SLICE_9_WINDOWS_DESKTOP_REPORT.md)**
(the desktop app itself, real CI evidence, issues found and fixed),
**[`SLICE_9_CROSS_PLATFORM_DEVELOPER_EXPERIENCE_REPORT.md`](./SLICE_9_CROSS_PLATFORM_DEVELOPER_EXPERIENCE_REPORT.md)**
(script inventory, CI validation, documentation quality gate).

## 1. Port model migration (§B/§K)

Formalized 3434 (backend) / 3435 (frontend dev) as the project's ports,
replacing the prior implicit 8080/5173 defaults, across every
environment:

| File | Change |
|---|---|
| `backend/src/main/resources/application.yml` | `server.port: ${SERVER_PORT:3434}`, `server.address: ${SERVER_ADDRESS:127.0.0.1}` (new — previously unset, defaulting to all interfaces) |
| `Dockerfile` | `EXPOSE 3434`, `ENV SERVER_PORT=3434`, `ENV SERVER_ADDRESS=0.0.0.0` |
| `docker-compose.yml` | Host publish scoped to `127.0.0.1:${APP_PORT:-3434}:3434`; `SERVER_ADDRESS=0.0.0.0` set explicitly (container-internal bind, not the host-reachable boundary) |
| `deploy/openshift/{configmap,deployment,service}.yaml` | `SERVER_ADDRESS: "0.0.0.0"` added to the ConfigMap; `containerPort`/`Service.port` both changed to 3434 |
| `.env.example`, `scripts/smoke.sh` | `APP_PORT` default 3434 |
| `frontend/vite.config.ts` | Dev server port 3435, proxy target `127.0.0.1:3434` |
| `frontend/playwright.config.ts` | `baseURL`/`webServer.url` → `localhost:3435` |
| `.github/workflows/ci.yml` | Health-check poll URL → `127.0.0.1:3434` |

**The `127.0.0.1`-only vs. Docker/OpenShift tension, resolved explicitly**:
the mission's own §B says production binding must be `127.0.0.1` only,
while §L requires the existing Docker/OpenShift distribution to keep
working — a container/pod runs in its own network namespace, where
binding only to loopback would make it unreachable even from its own
published port/Service. Resolved by making the bind address
configurable (`SERVER_ADDRESS`), defaulting to `127.0.0.1` (correct for
the desktop launcher and any bare-metal run), while Docker Compose and
OpenShift both explicitly override it to `0.0.0.0` for their own
container-internal bind and instead enforce "never reachable beyond the
intended boundary" one layer out — Compose's host-side port publish
scoped to `127.0.0.1`, OpenShift's Service/NetworkPolicy. Documented
inline in every file above.

**Verified**: real backend startup confirmed listening on `127.0.0.1:3434`
only (`ss -tlnp` showing `[::ffff:127.0.0.1]:3434`, not `0.0.0.0`/`*`);
full backend (595/595), frontend (604/604), and E2E (171/171) suites all
green against the new ports, both in hosted CI and locally in this
session; a real Docker Compose smoke test (build → health → source
discovery → search → UI load → SPA-fallback scoping) passed against the
rebuilt image on port 3434; the OpenShift manifests still pass real
`kubeconform` schema validation after the port edits (6/6 valid).

## 2. Windows standalone desktop application (§A, §C–§J)

Full detail: **[`SLICE_9_WINDOWS_DESKTOP_REPORT.md`](./SLICE_9_WINDOWS_DESKTOP_REPORT.md)**.
Summary: a WinForms + WebView2 launcher (`desktop/launcher`) with
single-instance handling (named Mutex, not a port-based check), port
selection (3434 preferred, OS-assigned fallback, never a range scan),
bounded health-gated startup, WebView2 navigation/devtools restrictions,
and a shutdown path with both a graceful handler and a Windows Job
Object as defense in depth against orphaned processes. Packaged via a
jlink custom runtime (module list detected via `jdeps` against the
*extracted* jar, not the repackaged fat jar directly — a real, fixed bug)
and an Inno Setup installer, both built and smoke-tested for real on a
`windows-latest` GitHub Actions runner
(`.github/workflows/windows-desktop.yml`). Final CI run: **PASS**
(`34458449693`).

Three real bugs were found and fixed during this work (path resolution
in the installer script, two rounds of missing jlink modules from
incomplete `jdeps` visibility, and an orphan-process gap on force-kill)
— all documented with full detail, including the exact CI failures that
caught each one, in the Windows desktop report. None were predicted in
advance; each was caught by a real failing hosted CI run.

## 3. Portable Docker/Compose distribution (§L)

Retained and re-validated, not re-architected — the existing "one
deployable image" (`Dockerfile`, multi-stage, frontend embedded as
Spring Boot static resources), non-root runtime, and doubly-gated
`docker-socket` profile were all already correct from prior phases and
needed no structural change, only the port-model update above. Added
this slice: offline export/import (`scripts/export-image.{sh,ps1}`/
`import-image.{sh,ps1}`, capability matrix `PKG-03`), verified with a
real round trip in this sandbox.

## 4. Packaging performance (§M) / Frontend delivery preservation (§N)

Full numeric evidence: **[`SLICE_9_PACKAGING_REPORT.md`](./SLICE_9_PACKAGING_REPORT.md)**.
Summary: Docker image 156.0 MB; backend jar 48 MB; bundled JRE 49.9 MB;
Windows installer 120 MB. Frontend production build verified
byte-identical in shape to Slice 8's own numbers (283.90 kB initial
critical JS, 85.49 kB gzip; `JourneyView`/`LiveTailPanel` still
code-split) — no packaging step in this slice restored dev-only code,
added source maps, bundled test dependencies, or duplicated React.

## 5. Export/import/portability capability reconciliation (§O)

Audited the full capability matrix for Slice-9-relevant rows:

| Row | Capability | Disposition |
|---|---|---|
| `PKG-03` | Offline export/import (save/load image as a tarball) | **IMPLEMENT** — done, see above |
| `PROD-07` | Search-result/timeline export (CSV/JSON) | **DEFER** — data export, not "portable configuration"; not part of this slice's named scope |
| `PROD-08` | Saved/custom query presets | **DEFER** — a saved-query feature, not "portable configuration"; not part of this slice's named scope |

No pre-existing capability-matrix row exists for a Windows standalone
desktop app or a centralized shortcut/preference registry — those are
genuinely new capabilities this project's own remediation work has added
beyond the legacy application, not legacy-to-new gaps to reconcile.

## 6. Developer documentation (§P–§V)

Created/substantially rewrote: root `README.md` (use cases, architecture
flow diagram, Windows desktop section, production-vs-development table,
updated ports/counts/project status), `backend/README.md`,
`frontend/README.md` (both new, full developer guides with "where do I
change X" sections), `docs/development/ARCHITECTURE.md` (system/
component/data-flow Mermaid diagrams, security boundaries, all three
deployment shapes), `docs/development/BACKEND_FRONTEND_INTEGRATION.md`
(exact request/response flow for search/Live/context/journey,
pagination, error model, capability flow).

**Code-level documentation (§U)**: audited the mission's own named
topics (cursor HMAC/canonicalization, source-native pagination, free-text
redaction, reconnect/backpressure, bounded Live buffering, gap semantics,
shortcut registry, safe preference schema) and found all already
thoroughly documented from prior slices (`PageCursorCodec.java`,
`TextRedactor.java`, `useLiveTail.ts`, `gapDetection.ts`,
`ShortcutRegistry.tsx`, `tablePreferences.ts` — each carries an extensive
doc comment explaining its own non-obvious design decisions). No
redundant re-documentation was added; this slice's own new code (desktop
launcher lifecycle, port selection/single-instance logic, the Job Object
fix, the jdeps extraction fix) is documented inline to the same standard
— see the doc comments in `desktop/launcher/*.cs` and
`desktop/packaging/build-runtime.ps1`.

## 7. Cross-platform developer experience (§W–§AD)

Full detail: **[`SLICE_9_CROSS_PLATFORM_DEVELOPER_EXPERIENCE_REPORT.md`](./SLICE_9_CROSS_PLATFORM_DEVELOPER_EXPERIENCE_REPORT.md)**.
Summary: every script central to the documented workflow now has a real
PowerShell twin (`smoke.ps1`, `validate-openshift-manifests.ps1`,
`export-image.ps1`, `import-image.ps1` — the latter two new this slice
alongside their `.sh` originals); Maven Wrapper was already canonical
everywhere; environment-variable examples give correct PowerShell/Bash
syntax side by side; a new Windows CI job validates the Windows-specific
packaging pipeline for real, without duplicating the full Linux E2E
matrix.

## 8. Final regression (§AI)

Re-verified every prior-slice invariant, not just this slice's own new
work:

| Invariant | Status | Evidence |
|---|---|---|
| Historical pagination/cursors | No regression | Backend suite includes `SearchServicePaginationTest`/`CursorLeakTest`, 595/595 pass; `PageCursorCodec.java` untouched |
| Query security | No regression | `QueryPlanLeakTest`/`QueryLeakTest` pass; query engine untouched |
| Docker project boundary | No regression | `DockerLogSource`/`ComposeLabels` untouched; existing tests pass |
| Live bounded buffering | No regression | `useLiveTail.performance.test.ts`/`ResultsTable.performance.test.tsx` re-run, all pass; `useLiveTail.ts`/`LiveTailService.java` untouched |
| Reconnect boundedness | No regression | Same test suite as above; reconnect logic untouched |
| Source health/gap semantics | No regression | Untouched; `SourceHealthBadge`/`gapDetection.ts` untouched |
| Server-side sensitive redaction | No regression | `TextRedactor.java`/masking untouched; full backend suite (including leak tests) green |
| Safe preferences (Slice 8) | No regression | `tablePreferences.test.ts`, `persistence.test.tsx`, `startupNetwork.test.tsx` all re-run, pass |
| Frontend bundle behavior (Slice 8) | No regression | See §4 above — byte-identical to Slice 8's own numbers |

## 9. Scope adherence

No changes to: query DSL semantics, pagination behavior, Docker security
posture, redaction logic, authentication/RBAC. Electron was not used.
WSL was never made mandatory for any documented Windows workflow. No
secret/credential/token was baked into the installer or the Docker
image. Phase M was not started. No auto-merge was performed.
