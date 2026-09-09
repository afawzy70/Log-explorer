# GitHub Actions CI — Verification Report

Branch: `phase/legacy-slice-1-result-set-completeness`
Workflow: `.github/workflows/ci.yml`
Date: 2026-09-09

## What was added

A three-job CI workflow — `Backend`, `Frontend`, `E2E` — added in this same PR per the recovery instructions, after Part A (Slice 1 recovery) was green locally.

### Triggers

- `pull_request` targeting `main`
- `push` to `main`

### Concurrency

```yaml
concurrency:
  group: ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true
```

A newer push to the same PR (or branch, for a direct push to `main`) cancels whatever run was already in flight for it.

### Permissions

```yaml
permissions:
  contents: read
```

Applied workflow-wide. No job needs anything beyond checking out and reading the repository — nothing here pushes a commit, comments on a PR, or writes any other GitHub resource, and no step references `secrets.*` at all (there is nothing to leak — see "CI security" below).

## Job 1 — Backend

- Java 21 (`actions/setup-java@v4`, `distribution: temurin`), Maven dependency cache via the action's built-in `cache: maven`.
- Runs from `backend/`.
- Exact command: `./mvnw --batch-mode verify`.
- No `-DskipTests`, no test-suppression of any kind. This project binds every test class (`*Test.java` — unit tests, the `*ApiIntegrationTest` classes, the leak/security tests, `ArchitectureTest`, and every Slice 1 pagination/cursor test) to the default Surefire execution in the standard `test` phase; there is no separate Failsafe binding in `backend/pom.xml`, so `verify` (which runs everything through `test`, then `package`, then the (empty) `verify` phase itself) executes the complete suite.
- Verified locally before pushing: `./mvnw --batch-mode verify` → **411/411 tests, BUILD SUCCESS**.

## Job 2 — Frontend

- Node 24 (`actions/setup-node@v4`). **Correction made after the first hosted CI run**: `Dockerfile`'s `FROM node:20-alpine AS frontend-build` stage was the only documented Node version in the repo, so the workflow initially pinned Node 20 — but that stage only ever runs `npm ci && npm run build` (a lighter path that never touches `vitest`/`jsdom`), and the first real hosted run of the `Frontend` job failed immediately in `npm run test` with `TypeError: webidl.util.markAsUncloneable is not a function`, a known `jsdom 30`/`undici` incompatibility with older Node — this repo's actual `devDependencies` (`jsdom@30.0.1`, `vitest@5.0.0`) genuinely require a newer Node than the Docker production-build stage does. Node 24 is what this whole project has actually been developed and tested against throughout (confirmed locally: `node --version` → `v24.19.0`), and the hosted `Frontend`/`E2E` jobs are green with it (see "GitHub-hosted verification" below) — Node 20 was never viable for the full toolchain, only for the narrower production-build path.
- Runs from `frontend/`.
- npm dependency cache via the action's built-in `cache: npm`, keyed on `frontend/package-lock.json`.
- Exact commands, using the repo's own existing canonical scripts (`frontend/package.json`) rather than inventing new ones:
  1. `npm ci` (never `npm install` — fails outright on any lockfile/package.json drift instead of silently "fixing" it)
  2. `npm run typecheck` (`tsc -b --noEmit`)
  3. `npm run test` (`vitest run`)
  4. `npm run build` (`tsc -b && vite build`)
- Verified locally before pushing, using these exact commands:
  - `npm run typecheck` → clean, no output (a bare `npx tsc --noEmit` at the repo root is a **false negative** on this project — it resolves the root `tsconfig.json`, which is a solution-style file with `files: []` and only `references`, so it silently checks nothing; `tsc -b` (build/project-reference mode) is what actually type-checks `tsconfig.app.json` and `tsconfig.node.json` — this was confirmed the hard way earlier in this same PR's Slice 1 work, when a bare `tsc --noEmit` missed four real type errors that `tsc -b` caught immediately).
  - `npm run test` → **301/301 tests, 41/41 files passed**.
  - `npm run build` → succeeds; `dist/assets/index-*.js` 245.26 kB raw / 75.28 kB gzip, `dist/assets/index-*.css` 25.77 kB raw / 4.67 kB gzip.

## Job 3 — E2E

- Java 21 + Node 24 (same setup as the other two jobs — this job needs both toolchains, since it runs the real backend *and* the real frontend dev server).
- `npm ci`, then `npx playwright install --with-deps chromium` — Chromium only: every existing spec runs against Playwright's default (Chromium) project; `playwright.config.ts` defines no other browser project, so installing Firefox/WebKit would only add install time with zero additional coverage.
- **Backend**: started via `SPRING_PROFILES_ACTIVE=dev nohup ./mvnw --batch-mode --quiet spring-boot:run &`, backgrounded, PID captured. A direct `spring-boot:run` goal invocation (not a lifecycle phase) never triggers the `test` phase on its own, so this does not re-run the suite the `Backend` job already ran — it only needs a live instance of the real backend for the browser to talk to. **Correction made after the first hosted run**: the first version of this step added `--offline`, reasoning (wrongly) that it could reuse the `Backend` job's warm dependency cache — but each job runs on its own fresh runner with its own independent Maven cache, and on the workflow's own first-ever run there was nothing cached yet either way, so `--offline` made dependency resolution fail outright (`Cannot access central ... in offline mode`). Removed; this job resolves from Maven Central normally, exactly like any other fresh checkout — ordinary build-time dependency resolution, not the "real external infrastructure" this job otherwise deliberately avoids (real Docker/OpenShift/Loki, per the point below). The readiness-wait budget was also widened (from 120s to up to 360s) specifically to tolerate a cold-cache first run of this job.
- **Why `dev` profile, not real external infrastructure**: `dev` activates `FixtureLogSource` (`@Profile({"dev","test"})`), the deterministic, synthetic, in-process source every existing E2E spec is written against. No step in this job touches a real Docker daemon, a real OpenShift cluster, or a real Loki gateway — `local-docker`/`openshift-loki` remain registered (so capability-negative-case specs like "an honest unavailable state" still exercise something real) but nothing in the deterministic suite depends on either of them actually working. Per the recovery instructions, real external Docker/OpenShift/Loki verification stays **live/external verification, reported separately** (see `docs/verification/LEGACY_REMEDIATION_SLICE_1_REPORT.md`'s own `REAL_DOCKER_MULTI_PAGE` section) — it is deliberately never a PR CI dependency.
- **Readiness wait**: polls `GET /actuator/health` for up to 120s (60 × 2s), failing the step (and printing the last 200 lines of the backend log) if it never comes up healthy.
- **Test run**: `npx playwright test` — `playwright.config.ts`'s own `webServer` directive starts the frontend dev server (`npm run dev`) and waits for it; `reuseExistingServer: !process.env.CI` (GitHub Actions sets `CI` automatically) means CI always launches a fresh dev server rather than silently trusting a leftover one.
- **Cleanup**: `kill "$(cat /tmp/backend.pid)"` in a `if: always()` step, so the backend process is stopped whether the test step passed or failed.
- **Failure artifacts** (`if: failure()` only — never uploaded on a green run):
  - `playwright-report` (`frontend/playwright-report/`) — only actually produced in CI, since `playwright.config.ts` now adds the `html` reporter conditionally on `process.env.CI` (a local run keeps the exact same `list`-only reporter it always had).
  - `backend-log` (`/tmp/backend.log`) — the real backend's stdout/stderr for that run.
  - Both retained 7 days (enough to debug a recent PR, not indefinite storage).
  - `trace: 'retain-on-failure'` and `screenshot: 'only-on-failure'` were added to `playwright.config.ts`'s `use` block so the HTML report actually contains a trace/screenshot for whatever failed, not just a pass/fail line.
  - **Never uploaded**: tokens, secrets, raw sensitive customer data, or unmasked production log content — none of these can appear in these artifacts by construction. Every event rendered in the browser during this job comes from `FixtureLogSource`'s synthetic, deterministic corpus (never real customer data), and this project's single masking boundary (`core.mask.MaskingService`) already applies before anything reaches `EventDto`/the browser regardless of source — the same guarantee `LogLeakTest`/`QueryLeakTest`/`SerializationLeakTest`/`CursorLeakTest` (all part of the `Backend` job) already hold the backend to. The backend log is plain Spring Boot startup/request logging; nothing in this codebase logs a raw sensitive value (CLAUDE.md §2 rule 2).
  - A minor `retries: process.env.CI ? 1 : 0` was also added to `playwright.config.ts` (Playwright's own documented default recommendation for CI) — a genuinely flaky test gets one automatic re-run before the job is marked failed; a consistently-failing test still fails. This is not test-weakening: no test's assertions, scope, or pass criteria changed.

## Known, pre-existing, out-of-scope issue found during local E2E verification (not fixed in this PR)

While re-running the full local E2E suite after Part A, `phase-m-ux-acceptance.spec.ts`'s "Task 1 - What failed recently?" test failed consistently, waiting for a `payments-api` checkbox that never appeared — the services dropdown showed real Docker service names (`caddy`/`db`/`web`, from this development machine's own unrelated `sofra` Compose project) instead of the fixture source's own services, even though "Fixture" was the selected source.

**Root cause identified**: `frontend/src/app/useSearchState.ts`'s services-fetch `useEffect` (lines ~164–179) has no request-supersession guard, unlike every other fetch in that file (`runSearch`/`loadMore`/`showContext`/`openJourney` all use `supersedeActiveRequest()`). On this local machine, the backend's source list order is not guaranteed stable across restarts (Spring bean registration order), so on some boots `local-docker` — genuinely reachable here, with a real, slower-responding Docker daemon — is the default-selected source at page load, and its services fetch can resolve *after* a subsequent switch to `fixture`'s own (much faster) services fetch, silently overwriting the correct list with stale Docker data.

**Why this is not fixed in this PR**: this bug predates Slice 1 entirely (the affected code is from Phase F) and is unrelated to any of the three blockers this recovery addresses or to the CI work in Part B. Per the recovery instructions ("do not add unrelated cleanup or features"), it is reported here rather than patched. It is not expected to affect `CI_E2E_JOB`'s reliability: the CI environment has no real, multi-container Docker daemon for `local-docker` to slowly respond from (`E2E` job's own runner has no Docker Compose project running at all), so the specific race window this bug depends on should not occur there. This is flagged for a future, separate fix — not part of `TOP_P0_GAPS`/blocker scope here.

## GitHub-hosted verification

Two real hosted runs on this PR branch:

- **Run 1** (`34333896993`, commit `eeb02e2`): `Backend` PASS; `Frontend` **FAIL** (Node 20 / jsdom incompatibility, see the Node-version note above); `E2E` **FAIL** (`--offline` broke the E2E job's own independent, cold Maven cache, see the Job 3 note above). Both real bugs, fixed in commit `7142bca`, not worked around or hidden.
- **Run 2** (`34334410635`, commit `7142bca`, https://github.com/afawzy70/Log-explorer/actions/runs/34334410635): **all three jobs PASS**.
  - `Backend`: PASS (411/411, same as the local run).
  - `Frontend`: PASS (typecheck clean, 301/301 tests, build succeeds).
  - `E2E`: PASS — **80/80** Playwright tests, including "Task 1 - What failed recently?", the one test that failed consistently in this session's *local* E2E re-run (see the "Known, pre-existing, out-of-scope issue" section above). Its hosted-CI pass confirms that failure really was specific to this development machine's own unrelated real Docker daemon — the clean, Docker-free `E2E` runner never triggers that race at all.
- **Run 3** (`34336361163`, commit `4fb9f3a` — the "unambiguous HMAC input encoding" final blocker fix, `PageCursorCodec` only; no CI-workflow file itself changed): `Backend` PASS, `Frontend` PASS; `E2E` **FAIL on the first attempt** — `wget: Failed to fetch https://repo.maven.apache.org/maven2/.../apache-maven-3.9.9-bin.zip`, the Maven *wrapper's own* bootstrap download of the Maven distribution itself failing against Maven Central, a transient GitHub-runner/network issue with no relationship to this PR's code (this commit touched only `PageCursorCodec.java`/its test — no CI workflow changes). Re-ran only the failed job (`gh run rerun 34336361163 --failed`, same commit, no code change) and it passed cleanly: `E2E` PASS, **80/80**, "Backend is up after 18s". All three jobs green on `34336361163` as it now stands. `gh pr view 18` reports `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN`.

## Tests skipped

**0.** No test anywhere in `Backend`, `Frontend`, or `E2E` is skipped, disabled, or run with a suppressive flag. `grep`-verified locally (`.skip(`/`.todo(`/`xtest`/`xdescribe`/`@Disabled` — none found in any file touched or added by this PR or its predecessor Slice 1 PR).

## Any external verification that remains BLOCKED

Real, hosted-external Docker/OpenShift/Loki verification (beyond what this repository's own deterministic Fixture/mocked-adapter test suites already cover) is deliberately **out of PR CI's scope entirely**, per the recovery instructions — it is live/external verification, tracked and reported separately (see `docs/verification/LEGACY_REMEDIATION_SLICE_1_REPORT.md`'s `REAL_DOCKER_MULTI_PAGE` section, which — as of Part A's own real-Docker re-verification during this same PR — is now **PASS**, not BLOCKED: real Docker multi-page cursor traversal against this development machine's own Docker daemon was verified directly, with exact page-count conservation (270 events across 2 pages, both directions) proving no skip/duplicate). CI itself never attempts to reach real external infrastructure, by design.
