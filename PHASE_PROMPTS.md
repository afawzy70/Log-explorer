# Phase Prompts for Claude Code

Copy one block per session. Every prompt assumes `CLAUDE.md`, `IMPLEMENTATION_PLAN.md`, `REQUIREMENTS_TRACEABILITY.md`, and `LOG_EXPLORER_CLAUDE_CODE_HANDOVER.md` are in the repo root.

---

## 0. Session bootstrap (first session only)

```text
You are taking over the Log Explorer project on this machine.

Setup:
1. gh repo clone afawzy70/Log-explorer, then cd into it.
2. Copy LOG_EXPLORER_CLAUDE_CODE_HANDOVER.md, IMPLEMENTATION_PLAN.md, CLAUDE.md, and
   REQUIREMENTS_TRACEABILITY.md into the repo root on a branch called phase/a-audit.
3. Read CLAUDE.md and IMPLEMENTATION_PLAN.md in full, then read the handover in full.

Then stop and confirm: repo default branch, current HEAD, whether the working tree is clean,
and a one-paragraph statement of what you understand the project to be. Do not change any
project code yet.
```

---

## Phase A — Audit

```text
Execute Phase A of IMPLEMENTATION_PLAN.md. Audit only — no behavior changes, no dependency
bumps, no test fixes, no refactors.

Produce docs/AUDIT.md containing:
1. Repo state: default branch, recent commits, branches, open PRs, working tree status.
2. Tree inventory: backend and frontend layout, build files, existing docs and tests.
3. Build baseline: run the real build and test commands and paste actual output, including
   failures. Do not fix anything.
4. Environment probe: Docker version, Compose plugin, Java, Node, disk, socket accessibility,
   whether Playwright browser deps install.
5. A capability matrix covering every item in handover section 34:
   Capability | Required | Present | Partial | Missing | Broken | Evidence (file:line)
   Every row needs evidence or an explicit "absent". No row may say "assumed".
6. Security assessment: where masking happens today, whether raw events can reach the browser,
   any dangerouslySetInnerHTML, any trust-all TLS, any committed secrets, any logging of search
   values or customer identifiers.
7. Architecture assessment against IMPLEMENTATION_PLAN.md section 3.
8. Contradictions: anything in the plan that repo reality disproves, with a proposed amendment.

Fill in REQUIREMENTS_TRACEABILITY.md status columns from your findings.
Open a PR with only these documents. Then stop.
```

---

## Phase A2a — Verification harness (standalone components)

*Split from the original single "Phase A2" — see IMPLEMENTATION_PLAN.md §2 "Verification harness sequencing". H3 and H4's real-app wiring move to Phase A2b, run after Phase B.*

```text
Execute Phase A2a of IMPLEMENTATION_PLAN.md on branch phase/a2a-harness.

Build, entirely standalone (no dependency on backend/ or frontend/, which do not exist yet):
- tools/demo-log-generator: emits canonical Spring Boot JSON across several fake services,
  deterministic given a seed, and deliberately includes every edge case listed in the plan
  (literal dotted event.correlationId key, hyphenated X-Correlation-id, cross-service journeys
  spanning multiple traceIds, fake sensitive fields, multiline exceptions, empty messages,
  malformed non-JSON lines, an unknown MDC field, stderr output, and bursts). Fake values only.
- tools/mock-loki: query_range fixtures plus 401/403/429/timeout/5xx scenarios, exercising
  configurable gateway prefix, tenant, and label keys.
- tools/playwright-harness: an app-agnostic Playwright helper library with setViewport, setZoom,
  assertTableGeometry(tolerance 2px), assertNoHorizontalOverflow, and screenshot capture into
  docs/verification/<phase>/. Validate the geometry helpers against two small static HTML
  fixtures committed alongside the harness: one table with correct shared header/body geometry
  (must PASS) and one deliberately broken table — header and body built with different layout
  systems, plus a row with an omitted cell — that must make the assertion FAIL. Do not defer
  this: an assertion that has never caught a regression is not proven to work.

Add a self-test proving the generated corpus contains at least one instance of each required
edge case. Each harness component must run from one documented command.

Report PASS/FAIL/BLOCKED per component, then stop.
```

---

## Phase A2b — Fixture source & Playwright app wiring

*Run immediately after Phase B and before Phase C — not "sometime after B". Phase C's verification depends on the fixture source existing.*

```text
Execute Phase A2b of IMPLEMENTATION_PLAN.md on branch phase/a2b-harness-app-wiring.

Prerequisite: confirm Phase B has passed verification. If it has not, stop and report — do not
start this phase early.

Build:
- backend/.../source/fixture: an in-process deterministic LogSource implementing Phase B's
  LogSource SPI, dev/test profiles only, never presented as a production source. Same
  deterministic corpus shape as Phase A2a's demo log generator.
- frontend/e2e + frontend/playwright.config.ts: relocate/import Phase A2a's app-agnostic
  Playwright helper library (tools/playwright-harness/) into the real frontend project, and
  point the config at the Phase B/F dev server. Prove `npx playwright test --list` resolves
  against the real running app.

Report PASS/FAIL/BLOCKED per component, then stop.
```

---

## Phases B through M

Use this template, substituting the phase letter and name:

```text
Execute Phase <LETTER> — <NAME> from IMPLEMENTATION_PLAN.md, on branch phase/<letter>-<slug>.

Before coding:
1. Confirm the working tree is clean; if not, stop and report.
2. Re-read the phase section and the relevant CLAUDE.md invariants.
3. State your implementation approach and the files you expect to touch. If repo reality
   differs from the plan's assumptions, say so before writing code.

Implement exactly the phase scope. Nothing from later phases. Nothing from the out-of-scope list.

Then verify:
- Run every automated test listed for the phase. Paste real commands and output.
- Run every manual/browser check listed. Capture screenshots into docs/verification/<letter>/.
- Apply the phase's PASS / FAIL / BLOCKED rules literally. External unavailability is BLOCKED,
  never PASS.
- Run the phase's regression set.

Then deliver:
- docs/verification/PHASE_<LETTER>_REPORT.md using the report template below.
- Updated REQUIREMENTS_TRACEABILITY.md rows for everything this phase touched.
- A PR via gh with scope, files, commands run, results table, screenshots, and known gaps.

Do not start the next phase.
```

Phase list and slugs:

| Letter | Name | Slug |
|---|---|---|
| B | Canonical model, parser, masking, guardrails | `core-correctness` |
| A2b | Fixture source & Playwright app wiring (dedicated prompt above; runs after B, before C) | `a2b-harness-app-wiring` |
| C | Docker source (local + optional remote) | `docker-source` |
| D | OpenShift Loki source | `loki-source` |
| E | Query engine | `query-engine` |
| F | Historical search UX | `search-ux` |
| G | Results table correctness | `results-table` |
| H | Event inspector | `inspector` |
| I | Trace / correlation / journey | `journey` |
| J | Live tail | `live-tail` |
| K | Portable Docker Compose delivery | `portable-compose` |
| L | OpenShift deployment assets | `openshift-assets` |
| M | Final acceptance | `acceptance` |

---

## Recovery prompt (use after any FAIL)

```text
Phase <LETTER> verification failed. Recover, do not restart.

Rules:
1. Fix only the failed or incomplete requirements. Do not refactor working code.
2. Do not weaken, skip, or delete a test to get a green result. If a test itself is wrong,
   fix it deliberately and justify it in the report.
3. Preserve behavior that already passed.
4. Re-run the exact checks that failed, then the phase's full regression set.
5. Update docs/verification/PHASE_<LETTER>_REPORT.md with a Recovery section: what failed,
   root cause, the smallest fix applied, the regression test added, and re-verification output.
6. If something remains blocked, say so plainly with the reason and what would unblock it.

Failed checks:
<paste the failing checks and output here>
```

---

## Visual-regression prompt (for any layout or geometry FAIL)

```text
A visual invariant is failing. Follow this sequence exactly and do not skip a step.

1. Reproduce the failure and describe what you see.
2. Capture a baseline screenshot at the failing viewport and zoom.
3. Inspect the network payload for the request that produced the view.
4. Inspect the DOM and computed layout at the failure point.
5. State the invariant that is being violated, in one sentence.
6. Implement the smallest fix that restores it.
7. Add a permanent regression test asserting that invariant.
8. Re-verify the rendered result at 1920, 1440, 1280, 1024, 768, and 390 widths, and at 125%
   and 200% zoom. Attach screenshots.

Reminder: a working backend search proves nothing about UI correctness, and the table may not
be described as fixed while any header/cell geometry assertion exceeds 2 CSS pixels.
```

---

## Verification report template

```markdown
# Phase <LETTER> — <NAME> — Verification Report

Branch: phase/<letter>-<slug>
Commit: <sha>
Date: <date>

## Scope delivered
<what was implemented, in requirement terms>

## Explicitly not delivered
<anything deferred, with the reason and the owning phase>

## Automated tests
| Check | Command | Result | Notes |
|---|---|---|---|

<paste relevant output, including any failures>

## Manual and browser checks
| Check | How run | Result | Evidence |
|---|---|---|---|

Screenshots: docs/verification/<letter>/

## Results
- PASS: <list>
- FAIL: <list, with what failed>
- BLOCKED: <check, reason, what would unblock it>
- DEFERRED: <check, decision reference>

## Regression
| Suite | Command | Result |
|---|---|---|

## Security check for this phase
- Sensitive values in responses: none / <detail>
- Sensitive values in logs or errors: none / <detail>
- Sensitive values in URL or localStorage: none / <detail>
- New TLS, Docker, or OpenShift privileges introduced: none / <detail>

## Traceability updated
<handover section 34 items moved to Done or Deferred>

## Known gaps carried forward
<list, with owning phase>

## Recovery (only if this phase previously failed)
- What failed:
- Root cause:
- Smallest fix applied:
- Regression test added:
- Re-verification output:
```
