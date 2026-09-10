---
name: log-explorer-professional-ux-reviewer
description: Professional UI/UX diagnostic and verification workflow for the Log Explorer frontend. Use this whenever asked to audit, diagnose, repair, or verify Log Explorer's user experience — old-vs-new UX comparison, "does this filter actually work", investigation-workflow quality, table/grid behavior, inspector/navigation behavior, settings usability, responsiveness, accessibility, or "verify this UI fix in the real app". Always use this instead of generic intuition when the request is about how the app looks, feels, or behaves for a real investigator, or whether a control/filter genuinely functions end to end rather than merely rendering. Not for greenfield visual-aesthetic design work (colors/typography/branding) — that is a different concern.
license: Project-local skill, no external license. Authored for this repository, Legacy Remediation UX restoration mission.
---

# Log Explorer — Professional UX Reviewer

This project has no external "react-ui-bug-checker" or equivalent installed
skill, and none should be installed from an unverified source merely to fill
this role — see the readiness-gate discussion in
`docs/verification/OLD_UX_RESTORATION_AUDIT.md` for why this project-local
skill was created instead. It encodes, as a reusable checklist/protocol, the
UX review discipline this repository's own `CLAUDE.md` §6 ("Visual bug
debugging sequence") already establishes, extended with the specific
old-vs-new comparison and filter-functional-truth requirements this
project's UX restoration work needs.

**Protocol marker for this skill: `LERUX-1`** (Log Explorer Reviewer UX,
v1). State this marker in the first line of any report this skill produces,
so it's traceable which protocol version was used.

## Core principle

**Rendered-browser evidence first. Compilation, a passing unit test, or a
"looks right in the source" read-through is never proof of a working UI.**
A claim about how the app behaves for a real user must be backed by either
(a) a real Playwright run against the real dev server + real backend
producing observable output (screenshot, DOM snapshot, network payload), or
(b) an explicit `NOT_VERIFIED`/`BLOCKED` label naming why it couldn't be
checked this way. Never write "PASS" for something only read from source.

## When to use this skill

- Auditing Log Explorer's current UX against a prior baseline (the OLD
  legacy application, described in `legacy-app-docs/`) or against a design
  intent.
- Diagnosing "this doesn't seem to work" reports about filters, search,
  table behavior, the inspector, settings, or Live.
- Verifying that a UI/UX fix actually changed the rendered application, not
  just the source.
- Reviewing information architecture, interaction design, and workspace
  composition — not just individual component correctness.

## The five-layer trace (for any "is X actually working" question)

For a control/filter/interaction, trace all five layers and report where it
breaks, not just that it's broken:

1. **UI control** — what the user actually sees/clicks/types, and what
   local React state it sets (`frontend/src/...`).
2. **Client request model** — how that state becomes a request object
   (`shared/api/client.ts`, `types.ts`, `useSearchState.ts`).
3. **Wire payload** — the actual serialized JSON that leaves the browser
   (capture this for real — a Playwright network intercept or a
   `page.on('request')` log, not an assumption).
4. **Backend handling** — controller → DTO → validation → service →
   `LogSource` adapter → actual source-side filtering or bounded
   post-filtering (`backend/src/main/java/...`).
5. **Rendered result** — does the returned/rendered data actually reflect
   the filter (right events included, right events excluded)?

Classify each traced item as one of: `PASS`, `PARTIAL`, `BROKEN`,
`UNSUPPORTED_BY_SOURCE`, `UX_MISLEADING` (the control implies a capability
the app doesn't actually have — e.g. a "sort" that's silently page-local,
not global). Never call a control "working" merely because it doesn't
throw or returns HTTP 200.

## Evidence-collection protocol

1. **Reproduce**: drive the real, running app (`npm run dev` + a real
   backend, `SPRING_PROFILES_ACTIVE=dev` for the deterministic Fixture
   source unless the scenario specifically needs Docker/Loki) via
   Playwright — either an ad hoc script/spec or the existing
   `frontend/e2e/` suite's own conventions and helpers
   (`frontend/e2e/helpers.ts`: `assertTableGeometry`,
   `assertNoHorizontalOverflow`, `captureScreenshot`, `setViewport`).
2. **Capture a baseline screenshot** before making any claim about visual
   state.
3. **Inspect the network payload** — the actual request body and response
   body for the interaction under review, not an assumed shape.
4. **Inspect the DOM and computed layout** where the concern is visual
   (alignment, table geometry, overflow, density) — `getBoundingClientRect`
   comparisons, not eyeballing a screenshot alone for pixel-level claims.
5. **Define the invariant in words** before proposing a fix — what should
   always be true, precisely.
6. Only then assess/implement the smallest fix, and **re-verify in the
   rendered app** — a second real screenshot/DOM check, never "should be
   fixed now" from source alone.

This mirrors `CLAUDE.md` §6 exactly; this skill exists to make sure that
discipline is actually followed for UX/investigation-workflow review, not
skipped under time pressure.

## Old-vs-new comparison protocol

When comparing the OLD application's UX (documented in `legacy-app-docs/` —
there are no OLD screenshot image files in this repository, only textual
specs/audits: `UX_SPEC.md`, `UX_QA.md`, `UX_ACCEPTANCE_REPORT.md`,
`audit/AUDIT-*.md`) against the current app:

- Read the OLD documentation as the UX baseline for *behavior*
  (interaction model, information hierarchy, workspace composition,
  discoverability), not as a pixel-exact template. A described OLD
  behavior is authoritative evidence of *intent and prior validation*, not
  a literal screenshot to clone.
- For each meaningful OLD behavior, render the current app and check it for
  real, then classify: `SAME`, `NEW_BETTER`, `PARTIAL`, `MISSING`,
  `BROKEN`.
- Rate user impact (`CRITICAL`/`HIGH`/`MEDIUM`/`LOW`) and recommend a
  disposition (`RESTORE`/`KEEP_NEW`/`REPAIR`/`DEFER`) — never restore an
  OLD behavior that conflicts with a security, correctness, or performance
  invariant this project has since established (`CLAUDE.md` §2/§4); when
  OLD and a non-negotiable invariant conflict, keep NEW and say so
  explicitly rather than silently dropping the comparison row.
- A raw percentage-parity number is not acceptable as the primary
  conclusion of a UX review — task-by-task quality matters more than a
  count of matched rows. If a percentage is reported at all, it must be
  clearly subordinate to the row-by-row table, not the headline finding.

## Investigation-workflow lens

Log Explorer's core loop is: Search → scan results → click/select an event
→ inspect → previous/next → show surrounding logs → correlate/contextualize
→ return to results → refine filters/query → search again. Judge every
individual control not only in isolation but as part of this one coherent
workflow — does a change make the *whole loop* faster and clearer, or does
it just make one screen look nicer in isolation? A "workstation" framing
(one coherent tool) beats a "collection of screens" framing every time
information hierarchy or navigation is in question.

## Report structure

Use this structure for a full audit; for a narrower diagnosis, use the
relevant subset:

```
# [Title] — LERUX-1

## Scope
## Method (what was actually run/observed, real evidence only)
## Findings
  For each area: OLD behavior | CURRENT behavior | status | user impact | recommended disposition
## Filter functional trace (if applicable)
  Filter | UI control | Request field | Backend field | Adapter handling | Expected dataset | Actual dataset | Status | Root cause | Test evidence
## Screenshots/evidence references
## Open questions / owner decisions required
```

## What this skill is not

- Not a visual-aesthetic/branding design tool (see the `frontend-design`
  skill/plugin for that concern — different job).
- Not a license to redesign broadly. Diagnosis and a proposed plan are the
  default deliverable; implementation only proceeds once the audit's
  findings are reviewed, unless a defect is severe, proven, and
  security/correctness-relevant enough that continuing the audit without
  fixing it would produce misleading evidence (and even then, the fix
  stays narrowly scoped and is not auto-merged).
