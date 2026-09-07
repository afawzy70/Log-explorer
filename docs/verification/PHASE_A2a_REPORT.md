# Phase A2a — Deterministic verification harness (standalone components) — Verification Report

Branch: `phase/a2a-harness`
Commit: `c0e6a78` (plan-amendment commit; this report lands on top)
Date: 2026-09-07

## Scope delivered

Per `IMPLEMENTATION_PLAN.md` "Phase A2a" (split from the original single "Phase A2" — see that section and §2 "Verification harness sequencing" for why):

- **H1 — demo log generator** (`tools/demo-log-generator/`): a zero-dependency Node.js script emitting canonical Spring Boot JSON log lines across four fake services, deterministic given a seed, guaranteeing every required edge case at a fixed position in each 40-record cycle (not left to chance). Runs bounded (`--count`) or continuously (live mode). Packaged as a Docker image.
- **H2 — mock Loki server** (`tools/mock-loki/`): a zero-dependency standalone HTTP server serving the `{gatewayPrefix}/{tenant}/loki/api/v1/query_range` route with fully configurable prefix, tenant, and stream label keys, plus 401/403/429/5xx/timeout scenarios via a request header. Packaged as a Docker image.
- **H4a — app-agnostic Playwright helper library** (`tools/playwright-harness/`): `setViewport`, `setZoom`, `assertTableGeometry` (checks every body row against the header, not just the first — so an omitted cell in a later row is caught), `assertNoHorizontalOverflow`, `captureScreenshot`. Validated against two committed static HTML fixtures (one correct, one deliberately broken) proving the assertions actually catch the regressions they exist to catch, in both directions.
- Root `Makefile` wiring one command per component plus a combined `make a2a-selftest`.
- `.gitignore` added (none existed before this phase).

## Explicitly not delivered

- **H3 (fixture `LogSource`)** and **H4b (Playwright wired to the real app)** — deferred to **Phase A2b**, which runs immediately after Phase B (not "sometime after B"), because both need `backend/`/`frontend/` to exist first. This is the split amendment recorded in `IMPLEMENTATION_PLAN.md` §2 and `docs/AUDIT.md`'s addendum, not a silent gap.
- `docker compose --profile demo up` (the plan's stated manual check) — no `docker-compose.yml` exists yet (that's Phase K). Substituted with direct `docker run` against each built image, which exercises the same images Compose will later orchestrate; recorded as such below, not claimed as the Compose check itself.

## Automated tests

| Check | Command | Result | Notes |
|---|---|---|---|
| H1 generator self-test | `node tools/demo-log-generator/generate.js --selftest` | PASS | `SELF-TEST PASS — 78 well-formed events, 2 malformed line(s), seed=42, count=80`. Verifies all 10 canonical top-level fields, all 18 canonical MDC fields, both correlation-precedence variants independently, multiline exception, empty message, malformed line, unknown MDC field, stderr line, burst, multi-service/multi-trace journey, fake-value sensitivity, determinism (same seed+count ⇒ identical output), and seed-sensitivity (different seed ⇒ different filler). |
| H1 generator self-test (containerized) | `docker run --rm --entrypoint node demo-log-generator:phase-a2a generate.js --selftest` | PASS | Same result inside the built image — proves the Docker packaging, not just the source. |
| H2 mock-loki contract test | `node tools/mock-loki/contract-test.js` | PASS | `MOCK-LOKI CONTRACT TEST PASS — all checks green`. Starts two real HTTP servers on ephemeral ports (default config + a differently-configured one) and issues real HTTP requests proving: success shape, wrong-tenant 404, `limit` enforcement, `direction` ordering (forward ascending / backward descending, and that they actually differ), nanosecond `start`/`end` range filtering, all four error-status scenarios plus `Retry-After` on 429, the `timeout` scenario causing a genuine client-side timeout, and — critically — that a *different* gateway prefix/tenant/label-key configuration produces different behavior and that neither config's route resolves against the other's server (proves configurability is real, not cosmetic). |
| H4a geometry helper meta-test | `npx playwright test` (in `tools/playwright-harness/`) | PASS | `5 passed`. Two tests prove `assertTableGeometry`/`assertNoHorizontalOverflow` **pass** against a correct static fixture (including at 200% zoom); three tests prove they **throw** against a deliberately broken fixture — mismatched header/body layout systems, an omitted body cell in a later row, and forced page-level horizontal overflow — each assertion's error message checked for the expected content, not just "it threw something." |
| H4a strict TypeScript check | `npx tsc --noEmit` (in `tools/playwright-harness/`) | PASS | No output, exit 0. |
| Combined one-command run | `make a2a-selftest` | PASS | All three components run from the single command specified in the Makefile; full output captured above. |

## Manual and browser checks

| Check | How run | Result | Evidence |
|---|---|---|---|
| H1 image builds and runs | `docker build -t demo-log-generator:phase-a2a tools/demo-log-generator && docker run --rm demo-log-generator:phase-a2a --seed 42 --count 5` | PASS | Real JSON log lines produced, inspected manually — canonical shape confirmed (see report body above for a sample line). |
| H2 image builds and runs | `docker build -t mock-loki:phase-a2a tools/mock-loki && docker run --rm -d -p 3102:3100 mock-loki:phase-a2a` then `curl` | PASS | `curl -s -o /dev/null -w "%{http_code}" .../query_range` → `200`; container logs show `mock-loki listening on :3100, route: GET /api/logs/v1/application/loki/api/v1/query_range`. Container stopped after the check (`docker stop`), no lingering resources. |
| H1 EPIPE robustness | `node tools/demo-log-generator/generate.js --seed 42 --count 200 \| head -3` | PASS (after one fix) | First attempt crashed with an unhandled `EPIPE` stack trace when `head` closed the pipe early — a real robustness gap for a CLI tool meant to be piped. Fixed by handling `EPIPE` on `process.stdout`/`process.stderr` and exiting quietly (exit 0). Re-verified clean after the fix; self-test re-run to confirm the fix didn't regress anything. |
| H1/H2 images run as non-root | `docker run --rm --entrypoint id demo-log-generator:phase-a2a` / same for `mock-loki:phase-a2a` | PASS (after one fix) | First build had no `USER` directive — both images ran as `uid=0(root)`. Added `USER node` (the official `node:20-alpine` image's built-in non-privileged user) to both Dockerfiles, rebuilt, and re-confirmed: `uid=1000(node) gid=1000(node)` for both. Re-ran the self-test and a live `curl` against each rebuilt image to confirm the fix didn't break anything. |
| H1 continuous/live mode | `timeout 2 node tools/demo-log-generator/generate.js --seed 7 --interval 100` | PASS | 23 stdout + 2 stderr lines produced in 2 seconds at the configured pace; process terminated cleanly on `timeout`'s `SIGTERM`. |
| `npx playwright test --list` resolves | `cd tools/playwright-harness && npx playwright test --list` | PASS | Lists all 5 tests by name (plan's stated manual check, satisfied — see full output in session). |
| Playwright OS deps / browser binaries | `npx playwright install-deps --dry-run chromium` (re-checked this phase) | PASS | "All system dependencies are installed." Chromium 1243 + headless shell + ffmpeg already cached in `~/.cache/ms-playwright` — installed between Phase A and this phase per the project owner. |

Screenshots: none captured this phase — `captureScreenshot` exists and is implemented but nothing in A2a's scope calls for a screenshot yet (no real UI exists). It will be exercised starting Phase F/G.

## Results

- **PASS:** H1 (source + Docker image + self-test + EPIPE robustness + continuous mode + non-root), H2 (source + Docker image + contract test + non-root), H4a (helper library + meta-tests + strict typecheck), combined `make a2a-selftest` entry point.
- **FAIL:** none.
- **BLOCKED:** none. (Playwright OS deps, previously the one open item from Phase A's `docs/AUDIT.md`, are now installed — re-confirmed this phase, not assumed.)
- **DEFERRED:** H3 (fixture `LogSource`) and H4b (Playwright wired to the real app) — not a failure, a deliberate scope split to Phase A2b per the amendment recorded in `IMPLEMENTATION_PLAN.md` §2. Phase C may not start before Phase A2b passes.

## Regression

No prior phase built any code (Phase A was audit-only). N/A beyond confirming this phase's own components are internally consistent — done via the automated tests above.

## Security check for this phase

- Sensitive values in responses: N/A (no backend/API exists yet). The demo generator's `cif`/`UserName`/`CustomerId`/`deviceId`/`deviceIp` values are all synthetic, prefixed `FAKE-`/`DEMO-`/`demo.`, and the self-test explicitly asserts this (`sensitive field values are obviously fake`).
- Sensitive values in logs or errors: none — no real identifiers exist anywhere in this codebase to leak.
- Sensitive values in URL or localStorage: N/A — no frontend exists yet.
- New TLS, Docker, or OpenShift privileges introduced: none. Both Docker images explicitly run as non-root (`USER node`, verified with `id -u` — see Manual and browser checks above). No privileged flags, no socket mounts, no new host access of any kind.

## Traceability updated

No `REQUIREMENTS_TRACEABILITY.md` rows are owned by Phase A2a itself (the harness is additive infrastructure, not a handover §34 item). The 8 rows whose owning phase includes Phase C (rows 2, 4, 5, 6, 7, 31, 32, 33) were annotated `C (after A2b)` in the prior commit (plan-amendment commit `c0e6a78`) to record the new sequencing dependency.

## Known gaps carried forward

- H3 (fixture `LogSource`) and H4b (Playwright/real-app wiring) — owned by Phase A2b, which must run immediately after Phase B and before Phase C.
