# Phase A2b — Fixture source & Playwright app wiring — Verification Report

Branch: `phase/a2b-harness-app-wiring`
Date: 2026-09-08

## Prerequisite check

Per `IMPLEMENTATION_PLAN.md` "Phase A2b": *"this phase runs only once its Phase B dependency is met; if Phase B has not passed, this phase does not start."*

Confirmed before any code was written this phase:
- PR #3 (Phase B) is merged into `main` (`gh pr list` — `state: MERGED`).
- Re-ran the Phase B backend suite fresh on the merged `main` (not trusted from memory): `./mvnw -q verify` → **83/83 tests, 0 failures, 0 errors, exit 0**.

Prerequisite satisfied. Branch created from `main` at `6f49cb5`.

## Scope delivered

Per `IMPLEMENTATION_PLAN.md` "Phase A2b":

1. **H3 — fixture `LogSource`** (`backend/src/main/java/com/logexplorer/source/fixture/`):
   - `FixtureCorpusGenerator` — a Java port of `tools/demo-log-generator`'s deterministic cycle-based generation (same 4 services, same required edge cases at fixed cycle positions: both correlation-precedence key variants, a 3-service/2-trace journey, obviously-fake sensitive values, a multiline exception, an empty message, a malformed line, an unknown MDC field, a burst). Produces raw JSON text, not `CanonicalLogEvent` directly.
   - `FixtureLogSource` — implements Phase B's `LogSource` SPI. Feeds every generated line through the **real** `LogLineParser` (the same parser Phase C/D will use), so the fixture and the parser are proven to agree on shape. Gated `@Profile({"dev", "test"})` — verified absent from the Spring context under no profile and under a `production` profile, present under `dev` and `test`, using a real `ApplicationContextRunner` with actual component scanning (not just an annotation inspection).
2. **H4b — Playwright/app wiring**:
   - Scaffolded a minimal `frontend/` (React 19 + TypeScript 7 strict + Vite 8) — a single placeholder page, explicitly out of Phase F's product-UI scope, just enough to give Playwright something real to run against.
   - Relocated A2a's app-agnostic Playwright helper library from `tools/playwright-harness/` into `frontend/e2e/` (`git mv`), including its geometry meta-tests and static fixtures. The old `tools/playwright-harness/` directory (now fully superseded) was removed.
   - `frontend/playwright.config.ts` points at the real Vite dev server via `webServer` (auto-starts `npm run dev`, waits for readiness) — no manual server juggling needed.
   - Added `frontend/e2e/smoke.spec.ts`: three new tests exercising the relocated helpers against the **real running app** for the first time (not just static fixture files) — title/heading render, no horizontal overflow, no horizontal overflow at 200% zoom.

## Explicitly not delivered

- Product UI (search toolbar, results table, etc.) — Phase F onward, as stated in Phase A2b's own "Out of scope."
- `frontend/src/{app,features,shared}` directory structure from `IMPLEMENTATION_PLAN.md` §3.2 — not scaffolded ahead of need; Phase F builds it when it has content to put there.

## Automated tests

All commands below were actually run this session.

| Check | Command | Result | Notes |
|---|---|---|---|
| Fixture corpus generator self-test | `FixtureCorpusGeneratorTest` | PASS | 5 tests: same seed+count reproduces byte-identical lines, different seeds differ, requested count respected exactly, every required edge case present (parsed through the real `LogLineParser`), timestamps anchored near the requested instant. |
| Fixture source profile gating | `FixtureLogSourceProfileGatingTest` | PASS | 4 tests using a real `ApplicationContextRunner` with `@ComponentScan(basePackageClasses = FixtureLogSource.class)` — the actual class's real `@Profile` annotation is what's evaluated, not a stand-in. **Verified to actually fail**: temporarily removed `@Profile` from the source, confirmed 2 of 4 tests failed with the bean unexpectedly present under "no profile" and "production", then restored the annotation and re-confirmed green. |
| Fixture source search/capability behavior | `FixtureLogSourceTest` | PASS | 12 tests: capability flags, health, service discovery, unfiltered search includes malformed fallback events, newest-first sort (incl. a dedicated malformed-sorts-last regression test — see below), filtering by service/level/text/journeyId/time-range/raw-sensitive-value. |
| Full backend regression | `./mvnw -q verify` | PASS | **104/104 tests, 0 failures, 0 errors**, exit 0. (83 from Phase B + 21 new.) |
| Frontend strict typecheck (app) | `npm run typecheck` (`tsc -b --noEmit`) | PASS | Clean, no errors. |
| Frontend strict typecheck (e2e) | `npm run typecheck:e2e` | PASS | Clean, after fixing two real ESM issues (see below). |
| Frontend production build | `npm run build` | PASS | `dist/index.html` + one JS bundle produced. |
| Playwright config resolution (Phase A2b's stated manual check) | `npx playwright test --list` | PASS | Resolves **8 tests in 2 files** against the real app — the literal PASS criterion from the plan. |
| Full Playwright run | `npx playwright test` | PASS | **8/8 passed**, `webServer` auto-started the real Vite dev server for the run (not already running — proves the auto-start path, not just an already-warm server) and it was cleanly torn down afterward (confirmed via `ps aux`). |

## Two real bugs found and fixed during this phase's own verification

Both were caught by actually running things end-to-end (real HTTP calls against a real dev-profile boot, and a real Playwright run against a real app) — not by unit tests alone, which is exactly why `IMPLEMENTATION_PLAN.md` §6 requires this sequence.

1. **Malformed events silently excluded from every time-bounded search.** `FixtureLogSource.matches()` required a non-null `event.timestamp()` to pass the start/end range check — but malformed events have no parsed timestamp by design (`LogLineParser` never fabricates one). Since virtually every real search is time-bounded, this meant malformed lines would vanish from realistic searches — the opposite of HANDOVER.md §5.4's "malformed lines become raw fallback events, never dropped." A second, related bug in the same area: `request.services().contains(event.service())` threw `NullPointerException` on Java's immutable `List.contains(null)` when a malformed event's `service()` was null and a service filter was active. Both fixed: time-range filtering is now skipped (not failed) when `timestamp()` is null; the services filter now null-guards the same way the levels filter already did.
2. **Malformed (no-timestamp) events sorted first, not last.** `Comparator.comparing(..., Comparator.nullsLast(...)).reversed()` is a real trap: reversing the *whole* comparator also reverses null placement, so nulls silently sort to the front instead of staying last. Caught via a real `curl` against a real dev-profile-booted app — the first 3 results of an unfiltered search were all malformed lines, burying real chronological data. My own unit test (`searchResultsAreSortedNewestFirst`) didn't catch this because it filtered out null-timestamp events *before* checking order, masking the exact case it should have tested. Fixed by reversing only the inner natural-order comparator (`Comparator.nullsLast(Comparator.reverseOrder())`), which keeps nulls pinned last regardless of direction, and added a dedicated `malformedEventsWithNoTimestampSortLastNotFirst` test — verified this new test actually fails against the reintroduced bug before trusting it, then confirmed it passes against the fix.
3. **(Frontend) `__dirname` is not defined in ESM.** The relocated helpers/tests broke immediately (`ReferenceError: __dirname is not defined in ES module scope`) because `frontend/package.json` declares `"type": "module"`, unlike A2a's standalone CommonJS `tools/playwright-harness/` package. Fixed by switching to `import.meta.dirname` (native in Node 21.2+/20.11+; this VM runs Node 24.19.0) in both `helpers.ts` and `geometry.spec.ts`. A follow-on `tsc` strict-mode issue (NodeNext module resolution demanding explicit `.js` extensions on relative TS imports) was resolved by aligning `frontend/e2e/tsconfig.json`'s module resolution with the rest of the frontend project (`Bundler`, matching `tsconfig.app.json`) rather than fighting NodeNext's extension requirement for files Playwright's own transform (not `tsc`) actually executes.

## Manual and browser checks

| Check | How run | Result | Evidence |
|---|---|---|---|
| Phase A2b's stated manual check: fixture source reachable via `/api/v1/sources` once Phase B's endpoint exists | Real `java -jar` boot with `--spring.profiles.active=dev`, real `curl` calls (not tests) | PASS | `GET /api/v1/sources` → `[{"id":"fixture","displayName":"Fixture (dev/test only)","capabilities":{"historicalSearch":true,...}}]`. `GET /api/v1/sources/fixture/health` → `{"status":"UP",...}`. `GET /api/v1/sources/fixture/services` → all 4 services with real counts. `POST /api/v1/logs/search` against `sourceId:"fixture"` → real masked events. |
| Sort-order fix re-verified end-to-end after the code fix | Same real boot, `curl` with `limit=5` (all non-malformed, descending timestamps) and `limit=200` (malformed events at indices 116-118 of 119, i.e. the end, not the start) | PASS | Confirmed via a second real boot after rebuilding the jar — the first attempt accidentally hit a stale leftover process still running the pre-fix code; caught via `ps aux`, killed, rebuilt, re-verified clean. |
| `docker compose --profile demo up` (A2a's demo generator) | Not re-run this phase — no `docker-compose.yml` exists yet (Phase K); this is the same situation Phase A2a itself reported | DEFERRED | Per the plan's own text for this check: "re-confirmed once Compose exists in Phase K — until then, direct process run" (satisfied above via the direct `java -jar` boot). |

Screenshots: none captured — `captureScreenshot` exists in the relocated helper library and is now correctly path-resolved for its new location, but nothing in this phase's scope calls for one yet (Phase F/G will).

## Results

- **PASS:** H3 (fixture source: implementation, profile gating verified to genuinely fail without the annotation, search/capability behavior, real end-to-end boot) and H4b (frontend scaffold, relocated Playwright harness, real `--list` resolution, real full test run against an auto-started real dev server).
- **FAIL:** none.
- **BLOCKED:** none.
- **DEFERRED:** `docker compose --profile demo up` re-confirmation — explicitly deferred to Phase K per the plan's own wording, not a gap in this phase.

## Regression

Full Phase B backend suite re-run as part of `./mvnw -q verify`: 104/104 (all prior 83 plus this phase's 21 new tests), 0 failures.

## Security check for this phase

- Sensitive values in responses: unaffected — the fixture source reuses Phase B's `EventMapper`/`MaskingService` boundary unchanged; `FixtureLogSource` only reads raw sensitive values internally for source-side filtering (an allowance `IMPLEMENTATION_PLAN.md` Phase B item 8 explicitly describes: "adapters may hold raw values for source-side filtering"), and a test (`filteringBySensitiveValueMatchesTheRawValueButNeverExposesItInTheResult`) confirms this filtering path exists without adding any new leak surface.
- Sensitive values in logs or errors: no new logging code was added; Phase B's log-leak protections are untouched.
- Sensitive values in URL or localStorage: N/A — the frontend placeholder page makes no API calls and stores nothing.
- New TLS, Docker, or OpenShift privileges introduced: none.
- `FixtureLogSource` is dev/test-profile-gated and cannot be reached in a production deployment — verified, not assumed (see Automated tests above).

## Traceability updated

No new `REQUIREMENTS_TRACEABILITY.md` rows are owned by Phase A2b itself (the harness, like A2a's, is additive infrastructure, not a handover §34 item). The 8 rows annotated `C (after A2b)` in the Phase A2a plan-amendment commit are now updated: the `(after A2b)` sequencing note is removed (the dependency is satisfied — Phase C may now start), and their evidence text is refreshed to reflect that `backend/` and `frontend/` exist (Phase B, Phase A2b) while the Docker-specific package itself (`source/docker/**`) still does not (Phase C, not yet started).

## Known gaps carried forward

None specific to this phase. Phase C (Docker source) may now begin — its prerequisite (fixture source existing) is satisfied.
