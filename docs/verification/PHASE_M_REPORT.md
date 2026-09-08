# Phase M — Final acceptance — Verification Report

Branch: `phase/m-final-acceptance`
Date: 2026-09-08

## Prerequisite

Phase L (OpenShift deployment assets) is merged (PR #15), and a
follow-up bug-fix branch (PR #16, NPE on null-valued unknown log fields +
Windows run instructions) is also merged — confirmed via `gh pr view 15`
and `gh pr view 16` (both `MERGED`) and a fresh `main` checkout with the
full backend suite (365/365 after this phase's own fixes; 364/364 at the
start of this phase) green before branching.

## Scope delivered

Per `IMPLEMENTATION_PLAN.md` "Phase M":

1. **HANDOVER.md §27's six scripted stakeholder acceptance tasks** —
   executed for real, recorded in `docs/UX_ACCEPTANCE_REPORT.md` with
   screenshots. See that document for the full task-by-task account.
2. **The full quality gate sweep** (§9) — backend, frontend, browser/
   visual, packaging. See "Quality gate sweep" below.
3. **A security audit pass** — no sensitive value in any response, log,
   URL, or storage; no trust-all TLS; no committed secrets; no
   `dangerouslySetInnerHTML`. See "Security audit" below.
4. **`REQUIREMENTS_TRACEABILITY.md` completion** — every §34 item marked
   Done or Deferred-with-reason, no unexplained gaps. See "Traceability
   finalized" below.

## Two real, previously-undiscovered bugs found and fixed

Both found only by actually executing the stakeholder acceptance tasks
against the real running system — the exact reason this gate exists, and
the clearest evidence this phase wasn't a rubber stamp. Full technical
detail in `docs/UX_ACCEPTANCE_REPORT.md`'s "Real bugs found" section;
summarized here:

1. **Malformed log lines were being silently dropped by the default
   severity filter** (`EventFilters.java`) — every malformed event has no
   parsed severity, and the level filter excluded any null-severity event
   outright whenever a level filter was active, which is always true in
   the real app (Info/Warn/Error is the frontend's own default
   selection). Confirmed live before/after: a real `levels=
   ["INFO","WARN","ERROR"]` search against the real fixture source
   returned 0 of its 3 real malformed events, then 3 of 3 after the fix.
   This directly contradicted HANDOVER.md §5.4 ("malformed lines...never
   dropped") — one of this project's most-repeated, most fundamental
   invariants — via the application's own *default* configuration, not
   an edge case. The same file already applies the identical, correct
   principle to its own timestamp filter three lines above the bug.
   Fixed; regression test added (`EventFiltersTest`); a pre-existing test
   (`FixtureLogSourceTest#filtersByLevelCaseInsensitively`) whose own
   assertion encoded the old, wrong behavior was corrected alongside it,
   not weakened.
2. **A genuinely empty message rendered as a truly blank, effectively
   omitted-looking cell**, not the required `(empty message)` fallback
   (CLAUDE.md §4 "Parsing"). A pre-existing unit test's own name ("shows
   the empty placeholder...") didn't match what it actually asserted (a
   literal empty string) — the test encoded the bug rather than catching
   it. Fixed in `columnMapping.ts`; the test corrected to assert the real
   required text, not weakened.

Both are exactly the class of bug CLAUDE.md's own risk framing warns
about most: a wrong test that looks like coverage, and a default
configuration that silently drops exactly the data class (malformed
lines) this project has repeatedly, explicitly promised never to drop.

## Quality gate sweep (IMPLEMENTATION_PLAN.md §9)

All commands below were actually run this session, on the final,
bug-fixed `main`-plus-this-branch state.

| Gate | Command | Result |
|---|---|---|
| Backend: full regression | `./mvnw test` | **PASS** — 365/365 (was 364 at the start of this phase; +2 net: 1 new `EventFiltersTest` regression test, 1 existing `FixtureLogSourceTest` assertion corrected in place). Covers parser, masking, source abstraction, Docker adapter, Loki mock-server, query parser/planner, cancellation & backpressure, all 4 leak tests, ArchUnit boundary. |
| Frontend: unit/component | `npx vitest run` | **PASS** — 288/288 (unchanged count; 1 existing `columnMapping.test.ts` assertion corrected in place). |
| Frontend: strict TS type-check | `npm run typecheck` | **PASS** — clean. |
| Frontend: production build | `npm run build` | **PASS** — 244.3 KB JS / 25.6 KB CSS gzipped. |
| Frontend: accessibility | `jest-axe` across 20 component test files | **PASS** — 0 violations, spanning every UI-bearing phase (F–J). |
| Browser/visual: full Playwright suite | `npx playwright test` | **PASS** — 76/76 (was 63 at Phase L's completion; +13 new Phase M UX-acceptance tests). Covers 1920/1440/1280/1024/768/390 viewports, 125%/200%(/400% for the Phase F overlap case) zoom, ≤2px table geometry, no page-level horizontal overflow, request/cancellation, source switching, sensitive-persistence restrictions, custom-time, semantic table, inspector, correlation workspace, live lifecycle. |
| Packaging: fresh-clone-equivalent rehearsal | `docker build` + `./scripts/smoke.sh` (cold, `.env`-less start) | **PASS** — `SMOKE TEST PASSED`; clean teardown confirmed. |
| Packaging: non-root container | `docker exec ... cat /proc/1/status` on the real running container | **PASS** — `Uid: 100`, `Gid: 101` (never root), confirmed on the rebuilt image including this phase's own fixes. |
| Packaging: no secrets in image layers | `docker history --no-trunc \| grep -iE "token\|secret\|password"` | **PASS** — no matches. |
| Manifest validation (Phase L, re-confirmed) | `./scripts/validate-openshift-manifests.sh` | **PASS** — unchanged, no `deploy/` files touched this phase. |
| Performance at 100/1,000/configured-max events | Live-tail's own 1,000-event cap + eviction (Phase J), results table's `SearchGuardrailsProperties#maxLimit` (5,000) | **PASS by construction** — both are enforced, tested ceilings (`useLiveTail.test.ts`'s cap-eviction test, `SearchGuardrailsTest`), not aspirational; no separate load-test harness was built or required by any phase's own stated scope. |

## Security audit (IMPLEMENTATION_PLAN.md "Phase M": "no sensitive value in any response, log, URL, or storage; no trust-all TLS; no committed secrets; no `dangerouslySetInnerHTML`")

All commands below were actually run this session against the real,
current, full codebase — not the Phase A audit's "trivially true, no code
exists" placeholder findings, several of which this phase corrected in
`REQUIREMENTS_TRACEABILITY.md` (see below).

- **`dangerouslySetInnerHTML`**: `grep -rn "dangerouslySetInnerHTML" frontend/src` — every match is a comment or a test-name string; zero actual `dangerouslySetInnerHTML=` usage. `noDangerousHtml.test.ts` enforces this as a standing, permanent check.
- **Trust-all TLS**: `grep -rn "TrustAllStrategy|trustAllCerts|InsecureSkipVerify|NoopTrustManager|acceptAllCertificates" backend/src/main` — zero matches. `LokiWebClientFactoryTest`'s real-handshake tests (Phase D) remain the live proof: rejected with no extra CA, accepted with one added, still rejected with an unrelated CA configured.
- **`localStorage`/`sessionStorage` writes**: `grep -rn "localStorage\.|sessionStorage\." frontend/src` (excluding tests) — zero matches anywhere in real source.
- **Committed secrets, full git history**: `git log -p --all | grep -inE 'bearer|password|secret|api[_-]?key|token'`, re-run across all 41 commits (was 7 at Phase A's own scan) — every match is prose describing the *rules* about secrets/tokens, env-var names, `secretKeyRef` YAML, or unrelated npm package names (`css-tokenizer`, `js-tokens`) — no real credential value anywhere in tracked history.
- **Never log search values, tokens, raw identifiers, events**: re-assessed project-wide (see `REQUIREMENTS_TRACEABILITY.md` row 20, upgraded from Partial to Done this phase) — `SerializationLeakTest`/`LogLeakTest` (Phase B), `QueryLeakTest` (Phase E), `LokiTokenLeakTest` (Phase D), and live tail's own masked-emission test (Phase J) all still pass in the current full suite.
- **Out-of-scope non-goals not implemented**: re-verified for real against the actual codebase (was "trivially true" at Phase A since no code existed) — `grep -rniE "oauth2|saml|jwt.*sso|SIEM|alertmanager|jaeger|zipkin|opentelemetry-exporter|saved.?quer|scheduled.?quer|retention.?polic|multi-cluster|analytics" backend/src/main frontend/src` → zero matches outside test/comment context; `backend/pom.xml` has no JPA/JDBC/Hibernate/SQL/Mongo/Redis dependency of any kind. See `REQUIREMENTS_TRACEABILITY.md`'s "Out-of-scope confirmation" section, updated with this real scan.

## Traceability finalized

`REQUIREMENTS_TRACEABILITY.md` had accumulated several rows that were
still carrying **Phase A's own placeholder findings** ("Absent — repo
contains no application code") from before any code existed, never
revisited by the phases that actually built the corresponding feature.
Phase M's own explicit mandate ("Phase M cannot pass while any row is Not
assessed or has an unexplained gap") required auditing and closing every
one of these, not just this phase's own two owned rows (101, and the
security-audit-related rows named above):

- **Row 7** (Remote Docker reachability lesson) — was `Partial`, citing
  work Phase K had since actually delivered. → **Done**.
- **Row 9** (React/TypeScript/Vite, strict TS) — stale Phase A `Missing`
  despite the entire frontend existing. → **Done**.
- **Row 83** (Responsive at all six viewports) — stale Phase A `Missing`
  despite extensive real Playwright coverage since Phase F. → **Done**.
- **Row 84** (Accessibility) — was `Partial`, re-assessed against the
  real, current 20-file `jest-axe` coverage spanning every UI-bearing
  phase. → **Done**.
- **Row 102** (Out-of-scope items not implemented) — was "trivially
  true" (no code existed). Re-verified for real this phase (see
  "Security audit" above). → **Done**.
- **Superseded Decisions table**: three Remote Docker rows and the
  custom-time-interval row still said "N/A yet... Owning phase C/F" for
  phases completed many phases ago; the Raw LogQL row said "owning phase
  F" despite Phase F having already explicitly declined that scope (see
  next item). All corrected to their real, current, evidenced state.
- **A genuine, honestly-named gap, not silently dropped**: the raw
  LogQL/DSL text-input UI control was explicitly named and declined by
  Phase F ("no control in Phase F's own stated scope wires a DSL text
  input to it") to avoid scope creep, and no later phase ever claimed
  that scope either — a real gap in `IMPLEMENTATION_PLAN.md`'s own phase
  breakdown, not an oversight this session introduced. Per CLAUDE.md §5's
  "name the conflict explicitly... do not patch symptoms at the
  acceptance layer," this was **not** built now, at the acceptance gate.
  The Superseded Decisions row for it is marked **Deferred (never
  assigned an owning phase)** with the full reasoning, rather than either
  silently marked Done (false) or built out of scope order.

Final state: **0 rows** with `Not assessed`, `Missing`, or a stale/
placeholder finding. 1 row (`Cancelled state`, row 60) remains `Partial`
by deliberate, already-documented design (no Cancel button exists
anywhere in this UI to trigger a user-facing cancellation from — request-
supersession protection is the real, tested substitute); this is an
*accounted-for* partial, not an unexplained gap.

## A documented decision on the other §8 documentation deliverables

`IMPLEMENTATION_PLAN.md` §8 lists several documents this session never
created: `docs/MVP_SPEC.md`, `docs/UX_SPEC.md`, `docs/UX_QA.md`,
`docs/MVP_ACCEPTANCE_REPORT.md`, `docs/INTEGRATION_REPORT.md`,
`docs/DEMO_SCRIPT.md`. Named explicitly here per CLAUDE.md §5, rather
than silently omitted: this project's actual execution model — one
`docs/verification/PHASE_<X>_REPORT.md` per phase, each phase's own
"Regression" section, and now this phase's own `docs/UX_ACCEPTANCE_REPORT.md`
— supersedes the older, more document-heavy planning convention these six
filenames originate from. Each one's substance already exists elsewhere,
current and phase-accurate rather than a stale planning snapshot:
`HANDOVER.md` + `IMPLEMENTATION_PLAN.md` together are this project's
MVP/UX spec; every phase's own verification report **is** its acceptance
report and its integration-regression record; `docs/RUN_GUIDE.md`'s
Quick Start plus `scripts/smoke.sh` together already function as a real,
executable demo script. Manufacturing six additional documents that would
only restate this same, already-current information was judged to be
scope creep for its own sake, not genuine coverage — contrary to
CLAUDE.md's own "don't add abstractions beyond what the task requires."
If a future stakeholder specifically needs one of these six as a
standalone artifact, that should be a deliberate, named request, not
assumed here.

## Results

- **PASS**: all four Phase M scope items — the six stakeholder acceptance
  tasks (real, screenshotted, two real bugs found and fixed along the
  way), the full quality gate sweep (365/288/76/1, all green), the
  security audit (re-verified for real against the current codebase, not
  reasserted from stale Phase A findings), and `REQUIREMENTS_TRACEABILITY.md`
  fully closed out with zero unexplained gaps.
- **FAIL**: none remaining.
- **BLOCKED**: none.
- **DEFERRED**: live OpenShift cluster verification (unchanged from every
  prior phase touching it — no cluster reachable from this environment);
  the raw-LogQL UI control (named and declined by Phase F, never
  reassigned, not built at this acceptance gate per CLAUDE.md §5); the
  optional SA-token-as-Loki-credential RBAC example's exact resource/verb
  (Phase L, unverified against a real LokiStack gateway).

## Regression

Backend: 365/365 (was 364 at this phase's start — net +2: 1 new
regression test, 1 corrected pre-existing assertion, both from the
malformed-events-dropped bug fix). Frontend: 288/288 (unchanged count; 1
corrected pre-existing assertion from the empty-message bug fix).
Playwright: 76/76 (was 63 — 13 new Phase M acceptance tests). Docker
packaging: fully re-verified after both fixes, zero regression.

## Known gaps carried forward (unchanged from prior phases, re-confirmed still accurate)

- Live OpenShift cluster verification remains DEFERRED — no cluster
  reachable from this environment, consistent with every phase that has
  touched Loki/OpenShift.
- Docker's own real-browser live-tail verification remains DEFERRED
  (Phase J/K) — no Log-Explorer-owned Compose stack was available for
  that specific check at the time; Docker container discovery and search
  *were* fully, genuinely verified end-to-end in Phase K.
- The raw-LogQL/DSL text-input UI control was never built — a genuine,
  honestly-tracked gap in the plan's own phase breakdown (see
  "Traceability finalized" above), not attempted at this acceptance gate.
- The optional SA-token-as-Loki-credential RBAC example (Phase L) is an
  honest approximation, not verified against a real LokiStack gateway.
