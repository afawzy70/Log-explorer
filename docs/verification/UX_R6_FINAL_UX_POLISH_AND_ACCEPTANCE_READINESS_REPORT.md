# UX-R6 — Final UX Polish, Structural Consistency & Acceptance Readiness — LERUX-1 / LERDESIGN-1

Mission: `UX_R6_FINAL_UX_POLISH_ACCEPTANCE_READINESS`.
Base: `c0003ca58cc98f5cff6fe1214d5e081bb6ac15db` (post-PR #36 `main`).
Branch: `ux/r6-final-polish-acceptance-readiness`.

UX-R6 is a **polish and acceptance-readiness** slice, not a redesign. Its
most valuable output is not a new surface: it is that four defects which
had been carried as "cosmetic", "structural debt" or "environment-specific"
turned out, on measurement, to be real, and are now fixed and regression-tested.

---

## 1. Skill activation

```
UX_REVIEW_SKILL_REGISTERED=YES     REACT_DESIGN_SKILL_REGISTERED=YES
UX_REVIEW_SKILL_DISCOVERABLE=YES   REACT_DESIGN_SKILL_DISCOVERABLE=YES
UX_REVIEW_SKILL_LOADED=YES         REACT_DESIGN_SKILL_LOADED=YES
UX_REVIEW_PROTOCOL=LERUX-1         REACT_DESIGN_PROTOCOL=LERDESIGN-1
```

Both project-local skills were invoked and their bodies loaded before any
implementation. The workflow they mandate was followed for every change
below: LERUX-1 measured, LERDESIGN-1 proposed, the change was implemented,
LERUX-1 verified the rendered result. The designer role certified nothing.

---

## 2. PR #36 merge gate

| Gate | Result |
|---|---|
| HEAD equals accepted `fc2ef2223d7a2e365bf1d83023ac5a4a3b5bcf3f` | PASS — matched exactly |
| PR OPEN / MERGEABLE | PASS (`MERGEABLE` / `CLEAN`) |
| Backend / Frontend / E2E / Windows Desktop | PASS — all four green |
| Squash-merge | PASS — merge commit `c0003ca58cc98f5cff6fe1214d5e081bb6ac15db` |
| Local `main` synced | PASS — fast-forward, clean |
| Post-main CI | PASS — `CI: success`, `Windows Desktop: success` |

Environment note: unlike UX-R4, no stale processes from prior sessions were
present. Backend and dev server were both started from this checkout.

---

## 3. §21 — the "environment-specific" Playwright failure, root-caused

**Classification: (A) deterministic product defect.** Not B (environment-
specific test defect), not C (stale process contamination), not D (a
timing flake to be retried away).

The Phase-M Task 1 spec had been carried since UX-R4 as an unexplained
local failure that passed in CI. UX-R6 traced it properly.

**What actually happens**, captured live from the running app:

1. The app loads with `local-docker` selected by default and issues
   `GET /api/v1/sources/local-docker/services`.
2. The test (or a user) selects `fixture`, which issues
   `GET /api/v1/sources/fixture/services`.
3. Fixture answers **first** with its four services.
4. Docker answers **second** — and overwrites them.

The rendered service filter then listed `caddy`, `db`, `web` (this
machine's unrelated `sofra-*` Compose project) while the selected source
was Fixture. So `payments-api` genuinely did not exist in the dropdown,
and the test was right to fail.

```
CHECKBOX NAMES (before): ["caddy1/1 running","db1/1 running","web1/1 running"]
CHECKBOX NAMES (after):  ["accounts-api…","gateway…","notification-worker…","payments-api…"]
```

**Why CI never saw it**: CI has no Docker daemon with containers, so
`local-docker`'s request fails fast and never wins the race. CI remained
trustworthy — it simply could not exercise the losing ordering.

**Why it looked like a flake**: the first run after a cold start passed
(Docker's first API call is slow), and every run afterwards failed once
the daemon was warm. That "passes once, then fails" signature is what had
previously been mistaken for environmental noise.

**The defect is not limited to the test.** The same unguarded pattern
covered `services`, `compose-projects` **and** `health` — and the health
response carries the source's declared **capabilities**, so the race could
paint one source's capabilities under another source's name.

**Fix**: a monotonic generation token (`discoveryGenerationRef`) captured
by every effect that starts source-scoped discovery; every `setState` is
gated on it still matching. This is the same protection
`activeRequestRef` already gave searches. Verified by five consecutive
runs of the previously-failing spec, plus three unit tests that resolve
responses out of order on purpose.

```
ENVIRONMENT_SPECIFIC_PLAYWRIGHT_ROOT_CAUSE=A_DETERMINISTIC_PRODUCT_DEFECT (stale-response race in source-scoped discovery)
ENVIRONMENT_SPECIFIC_PLAYWRIGHT_STATUS=FIXED_AND_REGRESSION_TESTED
```

No retry, reduced assertion or skip was used anywhere in this resolution.

---

## 4. §3 — Inspector scroll model (DEC-D)

**Decision: option C** — bounded, viewport-height, sticky column with its
own scroll. Neither "leave it" nor a full bounded-layout rewrite.

### What was measured on the existing model

| Property | Measured |
|---|---|
| Panel height | **9,224px** at 1440×900 — the *results column's* height, regardless of the event's own content |
| Sparse event (malformed line) | **8,150px of empty panel** below the content |
| Scrolling results with the Inspector open | The Inspector's content scrolled out of view; only UX-R5's sticky header survived, so it degraded to a header-only strip |
| Narrow widths (≤1024px) | Already a bounded fixed sheet — correct, and left untouched |

### What was measured and found already correct

These are why the layout was **not** restructured wholesale, and each was
checked rather than assumed:

- **The clicked row does not move when the panel opens** — 0px
  displacement, tested from scroll depths 600 / 1500 / 3000. An earlier
  reading of mine suggested it jumped; measurement disproved it (the jump
  was my own test clicking the *first* ERROR row, which Playwright had to
  scroll to).
- Focus returns to the originating row on Escape.
- No page-level horizontal overflow at any width.

### Result

| | Before | After |
|---|---|---|
| Empty panel for a sparse event | 8,150px | **0** |
| Overview readable while results scrolled to 3000px | no | **yes** |
| Inspector has its own scroll container | no (`overflow-y: auto` never engaged — nothing bounded it) | **yes**, with `overscroll-behavior: contain` so it cannot chain into the results |
| Clicked-row displacement on open | 0px | **0px** (preserved) |

Full UX-R4 + UX-R5 + geometry suites re-run green (63/63) after the
change. Under CSS `zoom`, `100vh` resolves against the unzoomed viewport,
so at 125%/200% the panel is proportionally taller than the visible area;
measured as still usable (position indicator, Overview and the context
action all in view, internal scroll working, no overflow) and recorded
here rather than hidden.

---

## 5. §11 — empty / loading / error states

| Surface | State | Finding |
|---|---|---|
| Results | EMPTY | `SAME_CORRECT` — "No results for this range." plus a one-click "Search last 1 day" |
| Results | **ERROR** | **`NEW_BETTER`** — was a bare strip with the backend's sanitized detail, no statement of what failed and **no action at all**, above a large blank region. The "Load more" path already had an inline Retry, so the pattern existed and had simply never been applied to the primary error. Now: "Search failed" / detail / **Retry search** |
| Inspector | missing-data section | `SAME_CORRECT` — one concise line, not a grid of em dashes (UX-R5) |
| Live | CONNECTING/LIVE/PAUSED/RECONNECTING/STOPPED | `SAME_CORRECT` — distinct labels verified through the real lifecycle |
| Settings / Compose | loading / empty / error | `SAME_CORRECT` |

The error copy is asserted to carry **no typed search value**: a search
for `super-secret-customer-12345` that fails renders only the backend's
own sanitized detail.

---

## 6. §13 — keyboard and focus

The core loop was driven keyboard-only end to end: row traversal → Enter
to open → `]`/`[` to navigate → Escape to close → focus back on the row.

**One real defect found and fixed.** Escape closed the top-most transient
layer **and the panel beneath it**: with the Inspector open, opening a
row's Actions menu and pressing Escape dismissed both.

The first fix attempt — asking "is any dismissable layer open?" — did not
work, and measurement said so rather than reasoning: layers listen in the
**capture** phase, `ShortcutRegistry` in the **bubble** phase, and React
flushes the layer's close (and therefore its removal from the layer stack)
in between, so the stack already read empty by the time the outer handler
ran. The shipped fix marks the **event itself** as consumed, which is
immune to that ordering because it is the same `KeyboardEvent` object in
both phases.

Also verified: the results table remains a **single** tab stop (roving
tabindex), not one per row.

---

## 7. §4 / §12 — cross-surface consistency

Audited by enumerating every rendered control label across Search, More
Filters, Results, Inspector, Live and Settings.

| Concept | Finding |
|---|---|
| "Show surrounding logs" | `SAME_CORRECT` — identical wording in the row Actions menu and the Inspector header; `±30 seconds` appears nowhere as a control label (UX-R5) |
| Severity language | `SAME_CORRECT` — one system across Results, Context and Live |
| Selected / context-root treatment | `SAME_CORRECT` — root marker's dashed outline asserted by computed style |
| Live lifecycle verbs | `SAME_CORRECT` — Pause / Resume / Stop / Clear / Follow newest, each distinct |
| Return actions | `SAME_CORRECT` — "Back to search results" (leaving Live) and "Back to original search" (leaving a context detour) are deliberately different because the destinations differ |
| Confirm patterns | `SAME_CORRECT` — Apply/Cancel in drawers, Run/Cancel in the bounded-context confirm |

No label was renamed for style. §12's "do not rename stable actions merely
for style" was treated as binding: the only naming change in this whole
programme was UX-R5's, which removed a genuine two-names-one-action
inconsistency.

---

## 8. §15 / §31 — responsive matrix

Verified in the real browser at **1920 / 1440 / 1280 / 1024 / 768 / 390**
and at **200% zoom**. For each: table geometry within 2px, no page-level
horizontal overflow, Search reachable, and — with the Inspector open —
both "Show surrounding logs" and the close control reachable.

---

## 9. §16 — performance

| Metric | Before (`c0003ca`) | After | Delta |
|---|---|---|---|
| `index.js` | 294.91 kB | 295.51 kB | +0.60 kB (+0.20%) |
| `index.js` gzip | 88.37 kB | 88.51 kB | +0.14 kB |
| `index.css` | 42.43 kB | 42.64 kB | +0.21 kB (+0.49%) |
| `index.css` gzip | 6.84 kB | 6.91 kB | +0.07 kB |
| **Total gzip delta** | | | **+0.21 kB** |

No new API calls were added; UX-R6 **removes** work rather than adding it:
the bounded Inspector no longer lays out a 9,224px panel (the sparse-event
case dropped ~8,150px of painted, scrolled DOM), and the discovery-race
fix removes redundant state writes from superseded responses. The
generation guard is an integer comparison.

---

## 10. §17 — security regression pass

Reconfirmed in the rendered app **and** on the wire against a **real
Docker container** emitting deliberately sensitive values:

| Check | Result |
|---|---|
| Raw `UserName: alice.example` on the wire | **absent** — rendered as `al***le` |
| Raw `cif: CIF-999` on the wire | **absent** — rendered as `****` |
| Reveal / unmask / show-raw control anywhere in the Inspector | **none** (asserted by locator count) |
| "All fields" expanded | no raw protected value |
| Context view | masking preserved |
| `localStorage` / `sessionStorage` | no event content, message text or identifiers |
| URL | no query content or identifiers |
| Error copy | carries no typed search value |

---

## 11. §22 — real-source verification

**Fixture — PASS.** The whole UX-R6 suite runs against the real backend's
deterministic corpus.

**Real Docker — PASS.** A real container under Compose project `uxr6`:

| Check | Result |
|---|---|
| Health / capabilities | UP, `contextView=true`, `composeProjectScoping=true` |
| Service discovery | correct |
| Search | 20 timestamped events |
| Context | 20 events, **all within ±30s** of the root |
| Sort | FORWARD ascending and BACKWARD descending both truthful |
| Masking | verified on the wire (above) |

Also observed and correct: this machine's unrelated `sofra-*` containers
emit non-JSON, and Log Explorer preserves them as malformed fallback
events with no parsed timestamp rather than dropping them (CLAUDE.md §4).

**Real Loki — BLOCKED.** No reachable Loki/OpenShift environment: no
endpoint, no credentials. Not reported as PASS.

```
REAL_LOKI_UX=BLOCKED
```

---

## 12. §18 — Four Questions, final

| Question | State at the end of UX-R1..R6 |
|---|---|
| **WHAT IS HAPPENING?** | Strong. Message is the primary scanning field with a guaranteed floor; ERROR/WARN are scannable at row level; the Inspector leads with identity and message |
| **WHERE IS IT HAPPENING?** | Strong. Active scope (source/Compose project) is always visible and distinct from per-event service; time is stated once with zone and UTC retained |
| **WHY IS IT HAPPENING?** | Good. Surrounding-logs evidence is one action away from both the row and the Inspector, the detour preserves and restores investigation state, gaps stay truthful, and chronology is never presented as causality |
| **WHO DID WHAT?** | Adequate and deliberately bounded. Actor/client is grouped and always masked, with no reveal path. This is the question the product answers least expansively — by design, not omission |

Scenarios A–E (recent service errors; masked user/customer; trace/
correlation/journey; event → inspector → surrounding logs → return;
Live → pause → resume → stop → back to Search) were all exercised.

---

## 13. §20 — classification

| Surface | Classification |
|---|---|
| Source-scoped discovery (services / projects / health) | **NEW_BETTER** (real defect fixed) |
| Inspector scroll model | **NEW_BETTER** (DEC-D) |
| Failed-search state | **NEW_BETTER** |
| Escape layering | **NEW_BETTER** (real defect fixed) |
| Search / More Filters | **SAME_CORRECT** — no measured friction |
| Results workstation (UX-R4) | **SAME_CORRECT** — re-verified intact |
| Inspector content hierarchy (UX-R5) | **SAME_CORRECT** — re-verified intact |
| Context view | **SAME_CORRECT** — re-verified intact |
| Live mode | **SAME_CORRECT** — full lifecycle re-verified |
| Settings / Compose | **SAME_CORRECT** |

```
STILL_OLD_THINKING_COUNT=0
REGRESSION_COUNT=0
```

Four surfaces were deliberately left alone because measurement said they
were already right. No redesign was manufactured to justify the slice.

---

## 14. Tests

| Suite | Result |
|---|---|
| Backend `./mvnw test` | PASS — 610, 0 failures (UX-R6 is frontend-only) |
| Frontend `vitest` | PASS — 726 (721 + 5 new) |
| Typecheck / production build | PASS |
| Playwright — UX-R6 suite | PASS — 23/23 |
| Playwright — full suite | **PASS — 270/270, 0 failures.** The first fully-green local run of this suite in the UX programme: UX-R4 reported 219 passed / 2 failed and UX-R5 251 passed / 1 failed, both because of the discovery race root-caused in §3 |

**New tests**: `useSearchState.discoveryRace.test.ts` (3),
`useDismissableLayer.test.tsx` (+2), `ux-r6-final-polish.spec.ts` (23).

---

## 15. Readiness recommendation for REL-1

**UX-R6: PASS.** The UX transformation programme (UX-R1 → UX-R6) is
complete to its stated exit criteria: no known critical or high UX
regression remains, no unexplained broken workflow remains (the one
outstanding unexplained failure was root-caused as a product defect and
fixed), the Inspector's structural decision is evidence-backed, and the
keyboard, responsive, zoom, security and performance passes hold.

**This is not a statement that the project is complete.** Still ahead:
REL-1, then the Final Legacy Parity + Hardening Audit, then Phase M Final
Acceptance. Specifically carried forward:

- **Real Loki verification remains BLOCKED** across UX-R4, UX-R5 and
  UX-R6 — sorting, context and the `contextView` capability (UX-25) have
  never been exercised against a real Loki. This is the single largest
  unverified area in the product and should be treated as a REL-1 /
  hardening prerequisite, not a UX one.
- The CSS `zoom` vs `100vh` interaction (§4) is understood, measured and
  usable, but is a known imprecision rather than a designed behaviour.
- `WHO DID WHAT?` is the least expansively answered of the four questions,
  by design. If the owner wants more, it is a product-scope decision, not
  a UX defect.
