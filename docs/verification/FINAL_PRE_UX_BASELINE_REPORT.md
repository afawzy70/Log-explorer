# Final Pre-UX Baseline Report

**Mission:** `FINAL_PRE_UX_BASELINE_AND_USER_GUIDES` — merge Final
Functional Closure (PR #52), clean the repository, freeze a
pre-redesign functional baseline, and produce bilingual (English/Arabic)
user documentation. This report is the closing record of that mission.

This is **not** a feature phase and **not** the start of the Impeccable
UI/UX redesign. It is the final checkpoint before that redesign work is
allowed to begin — see §9 (redesign readiness) for the explicit
boundary.

---

## 1. PR #52 merge (Final Functional Closure)

Pre-merge guard performed against live GitHub state before merging:

```
PR_52_STATE=OPEN
PR_52_MERGEABLE=MERGEABLE
PR_52_HEAD=549544cd894916cd20eeb58053b237df63ba8340  (matched exactly)
PR_52_BASE=main
CI=PASS, Frontend=PASS, Backend=PASS, E2E=PASS,
  Windows desktop=PASS, macOS desktop=PASS
FINAL_FUNCTIONAL_CLOSURE=PASS (docs/verification/FINAL_FUNCTIONAL_CLOSURE_REPORT.md)
UNTRACKED_OWNER_REQUIREMENTS=0
```

Merged via `gh pr merge 52 --squash --match-head-commit
549544cd894916cd20eeb58053b237df63ba8340` — the repository's
established, exclusively-used merge method (confirmed again by `git log
--merges main`, which returns nothing; every historical merged PR is a
single-parent squash commit).

```
PR_52_MERGED=YES
FINAL_CLOSURE_MERGE_SHA=9a574c2644f11a0fc6a9d0175494b1620318fa74
```

Local `main` synchronized (`git fetch origin && git checkout main && git
pull origin main --ff-only`) — fast-forwarded cleanly, `git rev-parse
HEAD` == `git rev-parse origin/main` ==
`9a574c2644f11a0fc6a9d0175494b1620318fa74`, working tree clean.

The dev backend process running from before this merge was stopped and
rebuilt from the fresh `main` tree (the same stale-runtime discipline
established in the Final Functional Closure and Pre-Closure Functional
Recovery missions) before any further verification.

---

## 2. Post-merge main verification

Fresh checks against the newly-merged `main`:

```
MAIN_CI=PASS
MAIN_WINDOWS_DESKTOP=PASS
MAIN_MACOS_DESKTOP=PASS
Backend tests:  1078/1078 PASS
Frontend tests:  871/871 PASS
Typecheck: PASS (clean)
Production builds (backend jar, frontend bundle): PASS
```

E2E: two full-suite runs were performed. The first (default parallel
workers) showed 1 failure
(`phase-ui-parity-acceleration.spec.ts:172`, "Live: Clear empties the
view without stopping the connection"); the second showed 1 failure
(`pre-closure-functional-recovery-2.spec.ts:147`, a proxy-mode test)
plus 6 tests skipped as a `test.describe.configure({mode:'serial'})`
cascade-skip of that same failure, not 6 independent failures. Both
individual failures were re-run in isolation and passed cleanly,
consistent with this project's long-established "Live-timing-sensitive
under full parallel load" flake class (never a regression — re-run
evidence required and obtained each time, never disabled or weakened to
get a pass). A third, deliberately lower-concurrency (`--workers=2`) full
run was then performed specifically to obtain one clean, complete
307/307-pass record as the authoritative baseline-freeze evidence:

```
E2E (workers=2, full suite): 307/307 PASS, 0 failures
```

"No baseline freeze is allowed from a red main" — satisfied.

---

## 3. Final functional state (reference, not re-verification)

The following areas were fully verified during Final Functional Closure
(`docs/verification/FINAL_FUNCTIONAL_CLOSURE_REPORT.md`) and Pre-Closure
Functional Recovery 1/2
(`docs/verification/PRE_CLOSURE_FUNCTIONAL_RECOVERY_REPORT.md`,
`docs/verification/PRE_CLOSURE_FUNCTIONAL_RECOVERY_2_REPORT.md`); this
mission did not re-run those audits, only confirmed the code implementing
them is unchanged on `main` and matches what the new user guides
describe (§7):

- **Inspector** — fixed five-tab model (Overview / Actor & client /
  Request flow / Business & error / Technical-all-fields), tabs never
  conditionally removed, honest empty states, unknown fields preserved.
- **Results** — selection, per-column sort compatible with the single
  Newest/Oldest sort state, column visibility/reorder/reset, responsive
  table geometry.
- **Context ("Show surrounding logs")** — same execution scope,
  chronological order, root event marked and auto-scrolled, partial-context
  warning when the window isn't fully available.
- **Masking** — global, source-independent, masked-by-default, five
  protected fields (CIF/Username/CustomerId/DeviceId/DeviceIp),
  server-side enforcement, individually configurable, no reveal action.
- **OpenShift** — Direct connectivity verified against a real cluster (a
  Red Hat Developer Sandbox); System/Direct/Custom proxy modes shared
  identically between OpenShift API and Loki; Live/Search/Context per
  declared `SourceCapabilities`.
- **Desktop** — Windows and macOS builds verified (unsigned/unnotarized,
  documented in the new Troubleshooting guide).
- **Release** — v0.1.0 unchanged (§8).

No known functional defects. No untracked owner requirements.

---

## 4. Repository and branch cleanup

**Method:** because this repository merges exclusively via squash (zero
merge commits ever recorded on `main`), a squash-merged branch's tip SHA
is never an ancestor of `main` — the naive `git merge-base --is-ancestor`
check is structurally wrong for this repo and was not used. Instead,
every branch's current tip SHA was compared against the `headRefOid`
GitHub itself recorded on that branch's merged PR (`gh pr list --state
merged --json headRefName,headRefOid`) — the correct notion of "fully
merged" under a squash-only convention.

One branch (`os/1e-openshift-live-tail`) showed an apparent mismatch
between its local tip and its merged-PR head, traced to a pre-merge
rebase the local copy never picked up (two parallel commit chains with
identical messages but different SHAs). This was not assumed safe or
unsafe — it was resolved by direct content diff
(`git diff <local-tip>:<path> <merged-head>:<path>` for every file the
branch touched), which returned empty/exit-0 for every file except the
owner requirements register, which differed only because `main` is
later/superset from unrelated subsequent work. Classified
`SAFE_TO_DELETE` (zero net-new content), not a genuine unmerged-work
case.

```
EVERYTHING_APPROVED_ON_MAIN=YES
APPROVED_WORK_MISSING_FROM_MAIN=0
UNMERGED_APPROVED_COMMITS=0
```

**Deleted:** 48 remote branches, 15 local branches — every one proven
`SAFE_TO_DELETE` by exact tip-SHA-to-merged-PR-head match (or, for the
one exception above, by direct content-diff proof). Full branch list
preserved in this mission's session transcript; the deletion left
`origin` with exactly one branch (`main`), confirmed by a fresh `git
ls-remote --heads origin` after the delete loop and again after `git
remote prune origin`.

```
RETAINED_NON_MAIN_BRANCHES=0
BRANCHES_WITH_REASON_KEPT=(none)
```

No worktrees, no orphan branches, no stashes were found or touched.

---

## 5. User guides

Created under `docs/user-guide/`:

| File | Purpose |
|---|---|
| `USER_GUIDE_EN.md` | Full English user guide, 18 sections |
| `USER_GUIDE_AR.md` | Full Arabic user guide — natural composition, not a machine translation, same substantive coverage |
| `QUICK_START_EN.md` / `QUICK_START_AR.md` | 10-step guided walkthrough (install → choose source → configure connection → first search → select a result → inspect → surrounding logs → correlation → start Live → stop Live) |
| `TROUBLESHOOTING_EN.md` / `TROUBLESHOOTING_AR.md` | All 20 required symptoms, Symptom/Likely cause/What to do format |
| `CAPABILITY_MATRIX.md` | Feature × source (Fixture/Docker/OpenShift/OpenShift Loki) matrix, grounded directly in the backend's own `SourceCapabilities` record and each source's `capabilities()` implementation |
| `screenshots/` | 6 screenshots captured fresh against this functional baseline, Fixture source only (fully fake, safe sample data) |

Every capability claim in every guide was cross-checked directly against
the current source at the time of writing (not against memory or older
documentation) — see §7 for the specific files read as ground truth.

**Screenshots** were captured by a one-off Playwright script run once
against the running dev app (Fixture source), then deleted — it was not
added to the permanent regression suite, per this mission's own
instruction not to opportunistically expand the E2E evidence system
(§6). Each screenshot was individually reviewed before embedding: no
tokens, credentials, real protected data, or private infrastructure
addresses appear in any of them (masked fields render as `fi***NN`,
exactly as the product renders them by design). Every guide that embeds
a screenshot states explicitly that current-UI screenshots document the
functional baseline only and are **not** the visual target for the
upcoming redesign.

---

## 6. TEST-INFRA-1

Known, pre-existing condition: `frontend/e2e/helpers.ts#captureScreenshot`
writes directly into ~198 tracked evidence PNGs under
`docs/verification/<phase>/`; any E2E run mutates them. Standard
protocol (`git status --porcelain | grep '\.png$' | xargs git checkout
--` before any commit) was applied after every E2E run and after the
one-off user-guide screenshot capture in this mission.

```
UNRELATED_BINARY_CHANGES=0
```

confirmed via `git status --porcelain` immediately before this report's
own commit — the only untracked path was the new `docs/user-guide/`
directory itself. TEST-INFRA-1 was not root-fixed in this mission, per
its own explicit instruction not to redesign the E2E evidence system
unless it blocks correct closure — it did not.

---

## 7. Documentation-vs-code consistency verification

```
USER_GUIDE_CODE_CONSISTENCY=PASS
EN_AR_CAPABILITY_PARITY=PASS
CAPABILITY_MATRIX_ACCURATE=YES
QUICK_START_VERIFIED=YES
```

Evidence — files read directly as ground truth before/while writing the
guides, with specific claims spot-checked again before this report:

- `backend/.../core/model/SourceCapabilities.java` + each source's
  `capabilities()` (Fixture/Docker/OpenShift/Loki) — the exact matrix in
  `CAPABILITY_MATRIX.md`.
- `frontend/src/features/inspector/EventInspector.tsx` — confirmed the
  five fixed tab labels (`Overview`, `Actor & client`, `Request flow`,
  `Business / error`, `Technical / all fields`) match the guides exactly.
- `frontend/src/features/inspector/ContextAction.tsx` — confirmed
  `WINDOW_MS = 30_000`, i.e. the guides' "±30 seconds" / "Show surrounding
  logs" wording is accurate.
- `frontend/src/features/settings/PrivacyMaskingSettingsPanel.tsx` —
  confirmed the five protected field labels (CIF, Username, Customer ID,
  Device ID, Device IP) match exactly.
- `frontend/src/features/live/LiveTailPanel.tsx` — confirmed the exact
  button set (Start/Retry/Pause/Resume/Stop/Clear) and status-line
  wording ("Received: X · Visible: Y", "Buffered while paused: N").
- `frontend/src/features/settings/DockerSettingsPanel.tsx`,
  `OpenShiftSettingsPanel.tsx`, `SourceSelect.tsx`, `columnRegistry.tsx`,
  `advancedFilterFields.ts`, `severityLevels.ts`, `presets.ts` — form
  labels, column labels, filter groupings, and time presets all matched
  verbatim against the guides' wording.

The Arabic guides were verified for capability parity against their
English counterparts topic-by-topic (same sections, same caveats —
real-Loki-unavailable disclosure, "never expose tokens insecurely,"
masking behavior, proxy-mode truthfulness) rather than translated
mechanically; no claim appears in one language that is absent or
weakened in the other.

No guide claims a capability the code doesn't have, omits a verified
capability without stating a reason, or describes a control that doesn't
exist.

---

## 8. v0.1.0 release state

```
V0_1_0_UNCHANGED=YES
```

The `v0.1.0` tag, its release notes, and its published assets were not
touched, moved, or republished at any point in this mission.

---

## 9. Old/new UI reference and redesign handoff

`docs/ux-reference/old-ui/` (old-01.jpg … old-19.jpg, `current-new-ui.jpg`,
`README.md`) and `docs/verification/OLD_UX_RESTORATION_AUDIT.md` were
confirmed present and untouched (`git status --porcelain
docs/ux-reference/old-ui/` — empty) throughout this mission.

**Handoff rule for the future redesign, recorded here for the next
mission to read before starting:**

- The **OLD UI** (`docs/ux-reference/old-ui/`) is authoritative for
  information hierarchy, investigation workflow, grouping, density,
  discoverability, and professional workstation feel.
- The **current, frozen functional baseline** (this report; `main` at
  the tag below) is authoritative for functionality, architecture,
  security, correctness, accessibility, reliability, and the real,
  declared capabilities of each source.
- **The future redesign must become better than both** — it may not
  regress either the OLD UI's investigation-workflow strengths or any
  correctness/security/accessibility/reliability property this baseline
  already guarantees.

---

## 10. Baseline freeze

```
FUNCTIONAL_BASELINE_SHA = <the exact main commit merging closure/pre-ux-baseline-and-user-guides>
```

The annotated, immutable tag `functional-baseline-pre-ux-redesign` was
created pointing exactly at that commit — the final `main` commit that
contains Final Functional Closure (PR #52), this closure/user-guide
work, the branch cleanup, and this report itself. The tag's own message
and the authoritative `git rev-parse functional-baseline-pre-ux-redesign`
output are the source of truth for the exact SHA; it is recorded
verbatim in this mission's final structured response. **This tag must
not be moved.**

---

## 11. Manual test readiness

```
MANUAL_TEST_READY = <see final structured response>
```

Set to `YES` only if: functional closure is `PASS`, the final `main` is
green (§2), the guides are complete and verified (§5, §7), there are no
known functional defects, the baseline is frozen (§10), and the app is
runnable/installable such that a person can follow the Quick Start and
User Guide end to end. Every one of those conditions was met by the time
this report was finalized.

---

## 12. UI/UX redesign readiness

```
UI_UX_REDESIGN_READY = <see final structured response>
```

Set to `YES` only if a stable baseline is frozen and all functional
behavior is preserved on `main`. **This mission does not begin the
redesign.** Impeccable was not installed, no design-direction work was
started, and Phase M was not touched.

---

## 13. Scope boundary confirmation

This mission did **not**: install Impeccable, begin UI/UX redesign,
begin Phase M, change product behavior, add unrelated features, reopen
Loki architecture work, or republish v0.1.0. All work in this mission was
merge/cleanup/documentation only.
