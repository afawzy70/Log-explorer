# Modern Developer Console — production implementation execution checkpoint

**This file is the authoritative, up-to-date state of the implementation.** Resume from here, not
from chat history or the PR description alone.

---

## Session 1

- **Timestamp (checkpoint written):** 2026-09-16 22:1x Asia/Kuwait (+03:00) — filled in precisely at final write, see the bottom of this file for the exact stop time.
- **Main baseline:** `6e71af8d901418d65de2bebb472240db27779147` (`main`, after PR #59 + PR #60). Verified unchanged and current at session start.
- **Design specification:** PR #58 (`design/v2-modern-developer-console`), HEAD `5b6e0da233ede03cd648f63d44ae316ae5a19058` at session start. Treatment: **B1 "Instrument Neutral"**.
- **Implementation branch:** `ux/v2-modern-developer-console`, created fresh from `main` `6e71af8` at the start of this session (did not exist before).
- **Implementation PR:** [#61](https://github.com/afawzy70/Log-explorer/pull/61) — **DRAFT, DO NOT MERGE**.
- **Production diff check:** `git diff main -- backend` was empty through the first eight commits (all frontend-
  only). The ninth commit (`d94b0ac`, A12) is the one exception — see its own entry below for exactly why a
  backend change was genuinely necessary, not a scope violation: `ClassificationRuleService.java` gained one field
  on the `ImportItem` record (additive, non-breaking), verified with the **full** backend suite (1424/1424 PASS)
  before and after, and the dev backend was restarted on the freshly-compiled code and re-verified end-to-end.

### Phase 0 — branch cleanup (complete)

Fetched/pruned, then deleted 5 branches whose PRs were confirmed **MERGED** via `gh pr list --state all` (not
merely git ancestry, since every one of them was squash-merged): `feature/configurable-log-field-mapping` (#55),
`feature/event-classification-extraction-rules` (#59), `feature/service-filter-docker-performance-default-mapping`
(#57), `fix/classification-scope-extraction-visual-tags` (#60), `fix/field-mapping-verification-workflow` (#56).
`git branch -d` (safe, non-force) succeeded for all five — no force-delete was needed. Local `main` fast-forwarded
to `6e71af8`. Preserved: `main`, `design/v2-modern-developer-console` (PR #58, open), `ux/v2-professional-redesign`
(PR #54, open) — none deleted, none touched.

### Phase 1 — implementation-plan drift correction (complete)

On `design/v2-modern-developer-console`, corrected three stale active-instruction spots in
`docs/ux-v2-modern-developer-console/IMPLEMENTATION_PLAN.md` that still said the pre-PR#60 baseline (`51f06e5`,
itself superseding an earlier `3f6b1b4`) and the old 7-column results-table invariant, even though §2.2 of the
same document already correctly described the PR #60 mapping. Corrected: header baseline (now `6e71af8`, both
PR #59 and #60 named as preserved, D30–D40 referenced), the slice-gate Playwright requirement (8 columns), and
the B3 "Invariants" field (8 columns in order, tagged/untagged row-height parity stated explicitly). Committed
(`4668e49`) and pushed to PR #58. Design review was **not** reopened — no visual/behavioral content changed, only
stale baseline references.

### Completed wave/slices this session

**Wave 1 Foundations — substantially complete** (tokens, fonts, icons, theme system all done and verified; the
remaining Foundations item, wiring v2 tokens into the Shell/Toolbar chrome itself, was assessed and deliberately
deferred — see "Next exact task" below):

| Commit | What | Verified |
|---|---|---|
| `043d68b` | `shared/tokensV2.css`: full B1 semantic token vocabulary (typography, spacing, density, shape, motion, icon sizing) + B1 light/dark colour sets, copied verbatim from the design package. Self-hosted Inter Var / JetBrains Mono Var (woff2 + licenses, copied from the design package's `prototype/assets/fonts/`). `lucide-react` added as a pinned dependency. `shared/theme/` (`themePreference.ts` + `useTheme.ts`): localStorage-backed light/dark/system preference, sets `data-theme` on `<html>`, tracks live OS appearance changes. Wired into `App`'s outer component. Additive only — no component consumes the new tokens/theme attribute yet except this file itself. | typecheck, 1079/1079 unit tests, build, rendered-browser (real dev server): tokens resolve to design values, v1 `--color-bg` byte-identical to before, `data-theme` switches light/dark/system through the real localStorage+reload path, both fonts load via the Font Loading API, 0 console errors |
| `1667244` | `shared/ui/Icon.tsx`: typed `lucide-react` wrapper, 68-name curated map (every icon name the design package actually draws, cross-checked against real lucide-react exports — 0 missing), `--v2-icon-sm/md/lg` sizing, 1.75 stroke width, decorative-by-default (aria-hidden) with an explicit-label escape hatch. Not yet imported by any shipped component (verified: unchanged production bundle hash before/after). | typecheck, 5/5 new tests (including a render-every-icon regression guard), build unchanged |
| `5af4436` | **B3**: restyled the shared `TagChip` component (consumed by Results, Inspector, Rule Builder, Rule Management alike) from "coloured text on a tint" to the approved "tinted pill + hue dot + neutral text" grammar (DESIGN_SYSTEM.md §22.2/§22.11 A4). Fixed a real defect the design itself corrects (§22.11 A3): the Results table's "+n" overflow counter was a second *coloured* `TagChip` in the first tag's own colour; a new `TagCountBadge` component renders it neutral (no dot, no tint, no `data-tag-color`). **Bug found and fixed, not merely worked around:** wrapping the chip's text in its own `<span>` for independent ellipsis truncation made that span a flex item of the chip's `inline-flex` container; flex items default to `min-width: auto`, silently defeating the intended truncation and forcing the chip (and its fixed-width table cell) wider than intended — fixed with an explicit `min-width: 0`. | typecheck, 1084/1084 unit tests, build, `classification-rules.spec.ts` + `phase-g-results-table.spec.ts` (11/11 in isolation), rendered-browser in both themes against the real dev backend |
| `9bb49fa` | **B3, D1**: compact (28px-target) density becomes the default (`tablePreferences.ts#defaultTablePreferences`) — comfortable stays fully available. Hardened `sanitizeTablePreferences`'s invalid-density fallback to a single source of truth (previously it silently special-cased 'compact' and treated *any other value* as the fallback, which happened to work only because the old default was 'comfortable'). | typecheck, 1084/1084, build, every E2E spec touching density/table config (`phase-legacy-slice4` 8/8, `phase-legacy-slice8` 35/35, `phase-g-results-table` 11/11), rendered-browser: table carries the compact class by default with no user action |
| `5b21985` | **A1a** (explicit Phase 2 mandate — "Implement A1a"): surfaces the backend's existing `tagColorConflicts` (shipped since PR #60, never read by the frontend until now) in Import Preview **before** Apply. New stat (always shown, including its zero count), a named `role="alert"` panel with the real server message, and a blocker disabling Apply under **both** Merge and Replace all. **A1b deliberately NOT implemented** — no resolution control, no client-side recolouring, no new backend mass-recolour endpoint, per this mission's explicit instruction. | typecheck, 1086/1086, build, 2 new tests, end-to-end against the real dev backend (real rule created, real pack file uploaded through the actual file-picker, real server response rendered, Apply genuinely disabled) |
| `fa34ecc` | **A9 (D38)**: corrected the colour-picker hint, which claimed a conflicting tag "keeps that rule's colour" — verified against the running backend that this is false (it is refused, not silently kept). **A11**: the classification rules management table now shows the first tag as a real chip plus a neutral "+n" (same `TagCountBadge`, same pattern as the Results table fix) instead of a chip per tag; the cell's `aria-label` carries the complete list. Deliberately left the "rules that classified this event" chooser row showing every tag (different context, not what A11 describes). | typecheck, 1088/1088 (one pre-existing test in `tagColor.test.tsx` deliberately updated to the new, correct shape — not weakened), build, `classification-rules.spec.ts` 2/2, rendered-browser with a real 3-tag rule |
| `8e35289` | **A2**: a save-time tag-colour conflict now shows scoped under the Tag colour field, not only in the generic error list. Root cause verified against the real backend: `TagColorPolicy` validates across the *whole* rule list, so even a single-rule save returns `rules[N].displayColor` (never bare `displayColor`), which `errorsAt`'s field-level lookup didn't match. Fixed in `errorsAt` itself (accepts an optional `rules[N].` prefix), not a new special case — verified this doesn't affect any other field (a missing-tags error returns plain `"tags"` from the real backend). | typecheck, 1089/1089, build, `classification-rules.spec.ts` 2/2, end-to-end against the real running app via network interception with the real server's captured error shape |
| `739d6f3` | **B3**: compact rows now measure ~29px, matching the design's `--v2-h-row: 28px` target (was 36-37px). Root cause traced precisely: the Actions column's trigger button is a deliberate, untouched 28×28px WCAG 2.5.8 hit target; the cell's own 4px top/bottom compact padding around it alone forced the whole row taller than every other (shorter-content) column needed. Fix scoped to exactly `.compact td.actionsCell` (padding-top/bottom: 0) — the button's own size is completely untouched, comfortable density untouched (different rule). | typecheck, 1089/1089, build, a new permanent E2E regression test (row height in a 26-31px band, button ≥28×28px and still clickable) plus every E2E spec touching table geometry/density (`geometry.spec.ts`, `phase-g-results-table.spec.ts` 10/10, `phase-legacy-slice4` 8/8, `phase-legacy-slice8` 28/28, `classification-rules.spec.ts` 2/2) — 58 E2E tests total this check, all PASS |
| `d94b0ac` | **A12 — the one backend change this session** (design's own "frontend only" claim was checked and found wrong before starting, not assumed correct). `ImportItem` (backend record) gains `displayColor` — the pack rule's OWN `effectiveDisplayColor()`, never the existing/matched rule's colour (explicitly proven for a CONFLICT item with a colour genuinely differing from the existing rule's), `null` only for a genuinely-unparseable pack entry (distinct from one that parsed but failed validation, which still gets its real default). `ImportPreviewItem` (frontend type) + `ImportPanel.tsx` updated to draw each pack rule's tags with the shared `TagChip` in that colour, replacing plain `Tags: a, b, c` text. | **Backend**: full suite **1424/1424 PASS** (was 1423, +1 new test). **Frontend**: typecheck, full suite **1091/1091 PASS** (3 new tests), build. **End-to-end**: dev backend killed and restarted on the freshly-`mvn test`-verified compiled code, then a real pack file uploaded through the actual browser file-picker rendered a real AMBER-tinted chip with the correct background colour, 0 console errors. `classification-rules.spec.ts` 2/2. |
| *(uncommitted, see below)* | **B4**: the Inspector's default panel width becomes 500px (`--v2-w-inspector`), up from 420px — measured in the real app that the five fixed tabs (Overview, Actor & client, Request flow, Business / error, Technical / all fields) genuinely wrapped to two rows at 420px, confirming the design's number is solving a real problem, not an arbitrary preference. 500px alone was not enough with the *existing* tab CSS (needs ~572px) — also tightened `InspectorTabs.module.css`'s tab padding/gap/font-size (13px → 12px, close to the design's own 11-12px scale) so all five genuinely fit on one row at 500px, verified by measuring distinct `top` values in the real rendered app, not assumed from the width number alone. `MIN_PANEL_WIDTH`/`MAX_PANEL_WIDTH` (320/720) untouched, so 500 is comfortably in range. | typecheck, full suite 1091/1091, build, full `phase-h-event-inspector.spec.ts` (16/16, one new permanent regression test asserting all 5 tabs share one row), real-browser screenshot confirming a clean, legible, non-cramped one-row tab bar |

**Discovered, not caused, while verifying the tab fix — a second pre-existing accessibility defect** (in addition
to the 390px overflow one below): running axe on the Inspector-open state found **593 elements** failing WCAG AA
`color-contrast` (serious) — `--color-text-tertiary` (`#868d99`) on various row-state backgrounds (selected,
hover, error-tinted), specifically the Results table's de-emphasised date text (`.timeDatePart`) and ID field
labels (`.idLabel`, e.g. "Trace ID:"). Measured contrast as low as 2.94:1 against the 4.5:1 AA minimum. **Verified
pre-existing, not introduced by this session**: reproduced identically with `git stash` reverting every change
this session made to the Inspector. Nothing in this session touches `--color-text-tertiary`, `.timeDatePart`, or
`.idLabel`. This is a significant finding (593 nodes, not a one-off) but fixing it properly means auditing every
state background `--color-text-tertiary` appears against across the whole Results table, which is real, separate
scope — not touched here, per this mission's "functional defects outside this redesign must remain separate
lanes" policy. **Flag this for a dedicated accessibility pass, not folded into this redesign.**

**Not started this session:** the remainder of B3 (sticky header already works structurally — `position: sticky`
already present in `ResultsTable.module.css:84` — but its visual treatment is still v1 tokens; selection/error/
root/trigger row states exist structurally (`UX-R4 §15` severity row marking) but are still v1-styled; loading/
re-search/empty/error panel restyle not started), B2 Search Shell (query bar, scope strip, severity popover,
source/project/time controls — assessed as genuinely large IA work, see below), B4 Inspector: **the 500px width
and 5-tab-on-one-row fit are now done** (see the table row above) — remaining B4 scope is the rest of the panel's
visual composition (colour parity is already inherited via the shared `TagChip` restyle from `5af4436`), and **the
action-hierarchy requirement ("Add extraction from this event" vs "Create another tag rule" as structurally
distinct actions) is already true in production**, shipped by PR #60, verified in
`features/inspector/InspectorHeader.tsx:98,103` — nothing to build there. B5 Investigation, B6 Settings/Mapping
(beyond the classification-rules pieces above), B7 — not started.

### A12 — done after all (design's own cost estimate was wrong)

Originally assessed as deferred (see prior note below, kept for the record): the design's §22.11 claimed A12 is
"frontend only", but neither the backend `ImportItem` record nor the frontend `ImportPreviewItem` type carried a
pack rule's own colour. With real remaining time, this was implemented properly instead of left for next session
— see commit `d94b0ac` above for the full verification record (full backend suite, full frontend suite, real
end-to-end). **Flag the inaccurate cost estimate in the design package itself when convenient** — §22.11 A12
should say "frontend + a small additive backend field", not "frontend only".

### Assessed and deliberately deferred (not a gap — a judgement call)

- **A8** (Tags column narrows to 132px when the Inspector is docked): requires threading "is the Inspector
  currently docked" state down into the Results table's column-width calculation (currently a static per-column
  `width` string in `columnRegistry.tsx`, no such state plumbed today) — more cross-component wiring than a
  five-minute CSS tweak, deferred.
- **Shell/Toolbar token wiring**: inspected `Shell.module.css` (55 lines) and `Toolbar.module.css` (21 lines) as a
  candidate low-risk "start of B2." Decided against doing it as a standalone commit tonight: the actual visual
  delta between the v1 tokens these files use today and their nearest v2 equivalents is **negligible** (e.g.
  `--color-border:#d8dce3` vs `--v2-line:#d6dbe1` — barely distinguishable), so the effort-to-visible-value ratio
  was poor, and a *meaningful* B2 slice needs real layout/element changes (workspace trail, severity popover,
  etc.), not a token rename on an already-similar palette. Genuine B2 work should be scoped as its own slice next
  session, not squeezed in as a low-value token swap.

### Tests run this session (cumulative, at the final code commit `d94b0ac`)

- `npm run typecheck` — PASS (every commit).
- `npm test` — **1091/1091 PASS** (final full run, after `d94b0ac`). Ran the complete suite after every commit;
  every regression the suite ever caught mid-session was a genuine, deliberate behavioural change this session
  made on purpose (the `+N` chip shape, the compact-density default, the rules-list truncation, the "reset table"
  density) — see each commit's own description above and in git history for the exact before/after. None were
  weakened assertions.
- `npm run build` — PASS, every commit (bundle size checked; `lucide-react`/`Icon.tsx` confirmed tree-shaken out
  until a future commit actually imports it).
- Targeted Playwright specs — PASS in isolation after every relevant commit: `classification-rules.spec.ts`,
  `phase-g-results-table.spec.ts`, `phase-legacy-slice4-table-configurability.spec.ts`,
  `phase-legacy-slice8-productivity-performance.spec.ts`.
- **Full Playwright E2E suite** (all 32 spec files) — run as the Wave-boundary check (this mission's own testing
  policy: "At wave completion: full frontend tests, full E2E"), two independent ways:
  - **GitHub Actions CI, on this exact commit (`8e35289`), a clean environment**: `gh pr checks 61` — **Backend
    PASS, Frontend PASS, E2E PASS (8m22s), Windows desktop build+smoke-test PASS, macOS desktop build+smoke-test
    PASS.** All five jobs green. This is the authoritative result.
  - **Local run** (this session's own dev server, `npx playwright test`, full suite): **320 passed, 1 failed, 1
    skipped** in 14.5 minutes. The one failure —
    `phase-legacy-slice5-live-resilience.spec.ts:122` ("a connection failure shows RECONNECTING, then a successful
    retry returns to LIVE") — timed out waiting for the Live badge to return to "LIVE" text after a deliberately-
    injected disconnect; the badge was still "RECONNECTING (attempt 1)" at the 10s timeout. **Not caused by this
    session**: zero commits this session touched anything under `features/live/` (verified: `git diff main --
    frontend/src/features/live` is empty), the test is inherently timing-sensitive (a real retry-timing race, by
    its own docstring), and the identical test **passed in the clean CI run on the identical commit** — strong
    evidence this was local resource contention (this session's own many Playwright/Chromium processes and dev-
    server load competing for CPU during a 14.5-minute run), not a real regression. Recorded here rather than
    silently dismissed; if it recurs, treat `phase-legacy-slice5-live-resilience.spec.ts` as a known-flaky spec to
    investigate, not evidence against this session's changes specifically.
- Backend tests — through commit `8e35289`, not run (zero backend files touched; CI's own Backend job also
  confirms this passed on that commit). From `d94b0ac` (A12) onward, the **full** backend suite was run twice
  locally (`mvn test`, no filter) — **1424/1424 PASS** both times, before and after adding the new field's own
  test.
- **CI confirmed green twice more since**, each on the actual latest push at the time, not assumed:
  - On `dabf489` (polish commit, supersedes `d94b0ac`) at 23:01 Kuwait: Backend (2m8s), Frontend (1m31s), E2E
    (7m2s), Windows (4m52s), macOS (2m10s) — all 5 PASS.
  - On `0ef2827` (B4 Inspector width/tabs, latest as of this checkpoint) at 23:26 Kuwait: Backend (2m5s), Frontend
    (1m28s), E2E (6m41s), Windows (3m41s), macOS (2m1s) — all 5 PASS.

### Known regressions

**None introduced.** One **pre-existing** defect was *discovered* (not caused) during verification of the
`5af4436` chip restyle, reproduced identically on the pre-restyle code with the same repro steps:

> With a classification rule whose tags render wide enough, `phase-g-results-table.spec.ts`'s 390px
> horizontal-overflow assertion fails — `document.documentElement.scrollWidth` (759px) diverges from
> `document.body.scrollWidth` (390px, correctly contained) even though the Results table's own `.scrollWrapper`
> visibly and correctly contains the table (`overflow-x: auto`, its own box stays within the viewport). Root
> cause not yet found (`<html>` vs `<body>` scrollWidth divergence in a nested-flex/fixed-table-in-scroll-
> container layout — several hypotheses tested and ruled out: not the chip's own width, not a `position:absolute`
> element, not transient/timing). A related, also pre-existing characteristic: `classification-rules.spec.ts` and
> `phase-g-results-table.spec.ts` share one real dev backend, so running them together with parallel workers can
> let one spec observe the other's transient rule state mid-test — this is how the defect was first surfaced.
>
> **Repro:** create a classification rule with 3 tags of moderate length (e.g. `middleware-call`, `payments-flow`,
> `slow-response`), search the Fixture source at 390px viewport width, measure
> `document.documentElement.scrollWidth - document.documentElement.clientWidth` — reproducibly ~369px, whether or
> not this session's chip restyle is applied.
>
> **This is a separate functional-defect lane, per this mission's own policy** ("functional defects outside this
> redesign must remain separate lanes... the redesign must not make them worse") — flagged here, not fixed, and
> confirmed not worsened by anything in this session.

### Files currently being worked on

None — the working tree is clean at the last code commit (`d94b0ac`), nothing mid-edit, nothing uncommitted.

### Design states used as reference

`docs/ux-v2-modern-developer-console/prototype/` states `82`–`95` (the PR #60 design-sync additions), especially:
`83-rule-classification-colour` (chip grammar, colour picker), `84-rule-colour-conflict` (A2's target UX),
`91-import-colour-conflict` (A1a's target UX, though its two *resolution* buttons remain intentionally disabled
per D39/A1b — not built), `92-results-tags-default-column` / `93-results-tag-not-severity` (chip grammar in
Results), `94-rules-list-colours` (A11's target — first tag + neutral counter). `DESIGN_SYSTEM.md` §22 (current
truth), §22.11 (A1a/A1b/A2–A13 — what the design adds beyond production, the source for tonight's A1a/A2/A9/A11/A12
work).

### Owner decisions assumed (per this mission's explicit Phase 2 policy — not invented)

- **B1_INSTRUMENT_NEUTRAL=APPROVED**, **LIGHT_THEME=IN_SCOPE**, **DARK_THEME=IN_SCOPE**,
  **COMPACT_28PX_DEFAULT=APPROVED** (D1 — implemented; note the *literal 28px* row height is not yet achieved,
  only the *default* is compact — see "Not started").
- **D40 KEPT** exactly as current production stores it: one `displayColor` per rule, every tag in that rule
  inherits it, rules sharing a tag must satisfy `TagColorPolicy`. Not redesigned to per-tag colour. Every colour
  surface touched this session (chip grammar, import conflict, save conflict, rules-list truncation) verified
  against the real running `TagColorPolicy`, never assumed.
- **A1a: IMPLEMENTED.** **A1b: domain-mutation NOT implemented** (no new backend mass-recolour behaviour) — the
  UI states the honest disabled truth and points the user at fixing the pack/existing rule outside the app,
  exactly as instructed.

### A1b status (explicit per the mission's required field)

```
A1A_IMPLEMENTED=YES
A1B_DOMAIN_MUTATION_IMPLEMENTED=NO
A1B_UI_TRUTHFUL_DISABLED_STATE=YES  # inherited from the design package's own drawn state (91) - not newly built
                                     # this session; A1a's new panel correctly blocks Apply without offering any
                                     # resolution control, which is the same "no false affordance" property.
```

### Time stopped

See the final line of this file (written at the hard stop, after this checkpoint is committed) for the exact
timestamp and final verification numbers.

---

## Resuming tomorrow — exact next task

1. **Re-verify the branch is where this file says it is**: `git log --oneline -10` on `ux/v2-modern-developer-
   console` — check what's at HEAD against this file's own record. As of this checkpoint, HEAD is `0ef2827` (B4
   Inspector width/tabs); **CI confirmed all 5 jobs PASS** (Backend, Frontend, E2E, Windows, macOS) on that exact
   commit at 23:26 Kuwait time — re-run `gh pr checks 61` for whatever commit is actually at HEAD now, don't
   assume it's still green without looking (a later session may have pushed since).
2. **Done this session**: B3's literal row-height (`739d6f3` — 29px), A12 (`d94b0ac` — full backend+frontend
   suites green, real end-to-end verified), B4's Inspector width + five-tabs-on-one-row (`0ef2827`). What's left in
   B3: sticky header, selection/error/root/trigger row states, and the loading/re-search/empty/error panels are
   all still v1-token-styled — restyling them to v2 tokens is the next contained B3 piece, verified structurally
   already in place (position: sticky exists, severity row marking exists) so this is a genuine RESTYLE, not new
   behaviour. **Also flagged for a separate lane, not part of this redesign**: a pre-existing WCAG AA
   `color-contrast` defect affecting 593 elements (`--color-text-tertiary` on tinted row backgrounds) - see its
   own entry above for the measured evidence; fixing it properly needs an audit of every state background that
   token appears against, real scope of its own.
3. **Then B2 Search Shell.** Checked `COMPONENT_INVENTORY.md` (design branch) precisely for what this actually
   requires, rather than assuming: `app/Shell.tsx` is marked **RECOMPOSE**, not restyle —
   (a) the three separate settings popover triggers (**Privacy & masking**, **Docker settings**, **OpenShift**)
   consolidate into ONE **Settings** entry point with sections, (b) Scope trail moves from the Shell into the
   query bar's Source/Project fields, (c) a new **workspace trail** breadcrumb (Search › Trace) is added, (d) the
   standalone **Classification rules** button is deprecated in favour of Settings › Classification rules. The
   inventory itself flags the real risk: **"existing E2E selectors migrated"** - this touches selectors across
   many existing specs, not just this session's own. This is genuine, judgement-heavy IA work, not a token swap
   (confirms the earlier assessment that a `Shell.module.css`/`Toolbar.module.css` colour-only pass would be
   low-value) - scope it as its own deliberate slice with real planning time, not squeezed into a session's
   remaining hours.
4. Keep running the full typecheck/test/build/targeted-E2E discipline after every bounded change, and the full
   E2E suite (frontend) / full `mvn test` (if backend is touched again) at the next wave boundary — not after
   every small CSS edit (this mission's own testing policy).
