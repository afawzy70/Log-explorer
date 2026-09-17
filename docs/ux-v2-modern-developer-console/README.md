# Modern Developer Console: Visual Design Package

**Status: design proposal awaiting owner visual approval.** Nothing in this folder is production code. The production
frontend (`frontend/`) and backend (`backend/`) are unchanged.

| | |
|---|---|
| Direction | **B, Modern Developer Console**, owner-approved. A/B/C discovery was not repeated. |
| Functional baseline | latest `main` `51f06e51709455f2c20dcf5c1b32e2dd67443377` (after PR #59 Event Classification). The first pass used `3f6b1b4`; see [Post-feature design sync](#post-feature-design-sync-pr-59). |
| PR #54 | Design history only: research, old Direction B, principles, Impeccable setup. Not merged. |
| Recommended treatment | **B1 Instrument Neutral** (light primary + defined dark companion). Not auto-approved. The classification sync is drawn in B1. |
| Recommended production branch | `ux/v2-modern-developer-console`, to be created from latest `main` after owner approval |
| Deferred lane | `SEARCH_PERFORMANCE_ROOT_CAUSE`: not investigated. Loading visuals do not claim to fix latency. |

## Contents

| Document | Purpose |
|---|---|
| [`CURRENT_BASELINE_INVENTORY.md`](CURRENT_BASELINE_INVENTORY.md) | What latest `main` does today, screen by screen: new screens and workflows since PR #54, §13 Event Classification (PR #59) and the source-selector policy, and design risk notes |
| [`baseline/`](baseline/README.md) | 31 real BEFORE screenshots of `main` `3f6b1b4`, plus 32 BEFORE captures of the PR #59 classification UI on `51f06e5` in `baseline/classification/` |
| [`CURRENT_MAIN_VISUAL_AUDIT.md`](CURRENT_MAIN_VISUAL_AUDIT.md) | Evidence-based audit of `main`, what to preserve, functional gaps G1–G5 |
| [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) | §22 Classification scope, assisted extraction and tag colour (current truth; §22.10 supersessions, §22.11 what the design adds beyond production); §21 the earlier classification primitives it supersedes; philosophy, three product modes, tokens for four value sets with computed contrast, type, spacing, density, radii, elevation, icons, controls, tables, tabs, chips, panels, code, focus, selection and trigger, status, responsive, dark/light decision, accessibility, detector triage |
| [`MOTION_SYSTEM.md`](MOTION_SYSTEM.md) | Motion tokens, per-interaction specs, reduced-motion table, budget rules |
| [`COMPONENT_INVENTORY.md`](COMPONENT_INVENTORY.md) | Every production component classified KEEP / RESTYLE / RECOMPOSE / REPLACE_VISUALLY / DEPRECATE_AFTER_IMPLEMENTATION |
| [`VISUAL_TREATMENT_COMPARISON.md`](VISUAL_TREATMENT_COMPARISON.md) | B1 vs B2 vs B3 on the 12 required criteria, with the recommendation |
| [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) | Slices V2-B1 to V2-B7, per-slice gates, owner decisions D0–D40, deferred lanes |
| [`prototype/`](prototype/) | Static HTML/CSS/JS prototype: 96 states (40 first pass + 42 PR #59 sync + 14 PR #60 sync), 3 treatments plus dark companion |
| [`screenshots/`](screenshots/) | 222 captures of the prototype, plus `capture-report.json` and `axe-report.json` |

## Viewing the prototype

```bash
cd docs/ux-v2-modern-developer-console/prototype
python3 -m http.server 8765 --bind 127.0.0.1
# open http://127.0.0.1:8765/            → index of all states
# http://127.0.0.1:8765/index.html?state=04-inspector-overview&t=b1
```

| Parameter | Values |
|---|---|
| `state` | A state id from the index |
| `t` | `b1` (default) · `b2` · `b3` |
| `theme` | `dark` shows the B1 dark companion (B2 is always dark) |
| `nav` | `0` hides the review navigation |
| `motion` | `0` stops all animation |

The prototype is static. Controls are drawn, not wired. Behaviour is specified in `DESIGN_SYSTEM.md`,
`MOTION_SYSTEM.md` and `IMPLEMENTATION_PLAN.md`.

## States

These are the 20 required states from the mission brief:

| # | Required | Prototype state |
|---|---|---|
| 1 | Search + results | `01-search-results` |
| 2 | Running | `02-search-running` (re-search) · `21-first-search-running` (skeleton) |
| 3 | Error | `03-search-error` |
| 4 | Inspector Overview | `04-inspector-overview` |
| 5 | Inspector Actor & client | `05-inspector-actor` |
| 6 | Inspector Request flow | `06-inspector-request-flow` |
| 7 | Inspector Business / error | `07-inspector-business-error` |
| 8 | Inspector Technical / all fields | `08-inspector-technical` |
| 9 | Investigation Trace | `09-investigation-trace` |
| 10 | Investigation Journey (multi-trace) | `10-investigation-journey` |
| 11 | Surroundings | `11-context-surroundings` · `37-surroundings-from-trace` |
| 12 | More filters | `12-more-filters` · `34-raw-logql-loki` |
| 13 | Mapping workspace | `13-mapping-workspace` |
| 14 | Mapping field editing | `14-mapping-editing` |
| 15 | Mapping NEEDS_CHANGE / UNMAPPED | `15-mapping-needs-change-unmapped` |
| 16 | Settings sources / connections | `16-settings-sources` · `39-settings-openshift-connect` |
| 17 | Settings masking / proxy | `17-settings-masking-proxy` |
| 18 | Live LIVE | `18-live` |
| 19 | Live PAUSED / RECONNECTING | `19-live-paused` · `19b-live-reconnecting` · `38-live-failed` |
| 20 | Empty | `20-empty` |

These additional global and workflow states are also drawn:
- `22-source-unavailable`
- `23-no-services`
- `24-load-more-failure`
- `25-malformed-event`
- `26-mapping-not-ready` (search gate)
- `27-unsupported-capability` (Loki: no Live, no context; health details)
- `28-invalid-query`
- `29-services-exclude-open` ("All except 2" / EXCLUDING chip)
- `30-columns-settings`
- `31-startup`
- `32-time-custom-range`
- `33-time-custom-applied` (actual interval + zone)
- `35-row-actions-menu`
- `36-id-detection`

**Total: 40 states.**

## Screenshots

Captured with Playwright Chromium at `deviceScaleFactor: 1` with reduced motion, from the locally served prototype. The
capture script also records page overflow, fully visible rows, tab rows and clipped elements in `capture-report.json`.

| Folder | Content | Count |
|---|---|---|
| `screenshots/b1/` | All 96 states, B1 light, 1440×900 (all re-captured in the PR #60 sync) | 96 |
| `screenshots/b1-dark/` | 01, 04, 09, 11, 13, 18 plus classification states 45, 48, 57, 68 and the colour-carrying states 83, 85, 92, 93 in the B1 dark companion | 14 |
| `screenshots/b2/` | 01, 04, 09, 11, 13, 18 in B2 Night Bench | 6 |
| `screenshots/b3/` | The same six states in B3 Enterprise Workbench | 6 |
| `screenshots/responsive/` | 01, 04, 09, 13, 16, 18 and classification states 42, 45, 48, 57, 61, 63, 68, 82, 83, 85, 87, 91, 92, 94 at 1920×1080, 1366×768, 1024×768, 768×1024, 390×844 (1440 is in `b1/`) | 100 |
| **Total** | | **222** |

## Data, privacy and licences

- **Data is synthetic and anonymised** (`window.LX_DATA` in `prototype/scripts/data.js`):
  - service names are generic
  - masked identifiers look like `ra***07`
  - the one unmasked Device IP is a private example address, shown because state 17's policy leaves Device IP unmasked
  - hosts use `example.com` / `example.internal`
  - the `oc login` token is drawn as bullets

  No real customer data, credentials or infrastructure appear.
- **Fonts:**
  - Inter (SIL OFL 1.1): `prototype/assets/fonts/LICENSE-Inter.txt`
  - JetBrains Mono (SIL OFL 1.1): `prototype/assets/fonts/LICENSE-JetBrainsMono.txt`

  Both are self-hosted, with no CDN.
- **Icons:** Lucide (ISC), 68 symbols in `prototype/assets/sprite.svg`; licence in
  `prototype/assets/icons/LICENSE-lucide.txt`.

## Impeccable process

1. `impeccable context` was loaded once (PRODUCT.md, DESIGN.md, the surface brief). The mode is **Operate**. The request
   is a replacement visual world, so the new-work "create or replace the visual world" flow applies.
2. **The direction was brief-pinned.** Direction B is owner-approved, so no directions were rediscovered.
   `concept-seed --scope direction` (seed key `b85cc42b`) assigned position 5 of the grounded list: DevTools Network
   panel, terminal less/jq, Wireshark, NTSB sequence-of-events report, **logic analyzer / oscilloscope**, lab notebook,
   ATC flight strips. That concept became B's signature grammar: trigger = selected event, capture window, service lanes,
   gap bands, acquisition-state vocabulary for Live.
3. The six dealt catalog challengers were **declined as brief-pinned**: emission-line rail, split-flap board,
   cyclorama, deep-dive, catalog sleeve, design-annual plate.
4. **Direction contract** (THESIS, OWN-WORLD, STORY, FIRST VIEWPORT, FORM, FINISH):
   `.impeccable/surfaces/rn-developer-console-prototype-index-html-522d26e9.md`.
5. **Build**: code-led; no image generation.
6. **Verification**: bounded batched visual rounds (desktop and mobile together), then the independent reviews below.
7. **Detector**: `impeccable detect --json`. Every flag was triaged individually, as listed in `DESIGN_SYSTEM.md` §20:
   - fixed: radius and colour tokenization, the 11 px lane label
   - kept with justification: the Live pulse, gap-band hatching, Inter
   - false positive: the WARN triangle (redrawn with `clip-path`, so the flag no longer fires)
   - Inter: persisted as one `ignore-value` entry with a written reason
   - `design-system-font`: Inter Var and JetBrains Mono Var are not in the production `DESIGN.md`. They have per-value
     ignore entries with a written reason in `.impeccable/config.json`.
8. **Disclosed deviation: root `DESIGN.md` has not been replaced.** Impeccable's finish contract ends with the
   documenter rewriting `DESIGN.md`. Here the root `DESIGN.md` still documents the production baseline. It is replaced
   only after owner visual approval, so the repository never describes a look that is not shipped. `DESIGN_SYSTEM.md`
   and `prototype/styles/tokens.css` are the proposed source.
9. **Reviewer invocation note:** the `impeccable-finish-reviewer` agent definition was not registered as a callable
   agent type in this session. It was run as a fresh, independent general-purpose agent instructed to follow
   `.claude/agents/impeccable-finish-reviewer.md` and the craft floor.

## Review record

**Roles.** LERDESIGN-1 (designer) proposed. LERUX-1 (independent reviewer) and the Impeccable finish reviewer reviewed.
The designer did not approve its own work.

### Impeccable finish review: disposition FIX-THEN-SHIP

| Finding | Disposition |
|---|---|
| Live header implied search filters applied to Live; excluded services appeared | **Fixed.** Live shows its own scope ("Services All services", "Live shows new events for this source and project"). The underlying `main` gap is recorded as G4 / D8. |
| Live "2,000 kept" contradicts a 1,000 cap | **Rejected, with evidence.** `main` caps at 2,000 ("capped at 2,000; oldest events are evicted first", inventory §10). The CLAUDE.md §4 "starts at 1,000" wording is recorded as named conflict G5. |
| "Selected event" chip inside the message cell | **Fixed.** Trigger ring around the severity mark in the Time cell, plus visually hidden text. The message cell holds the message only. |
| Gap rows in the table; Surroundings oldest first | **Rejected, with evidence.** Existing `main` behaviour (inventory §4.3 gap rows, §7 "oldest first"). |
| Header clipping with the Inspector open | **Fixed.** Sentence-case 12 px headers; widths redistributed. |
| 390 px: first screen showed only Time/Level/Service; chips cut | **Fixed.** Sticky Time column, chips ellipsize. All 7 columns remain, with contained horizontal scroll by invariant. |
| Source "Healthy" while reconnecting | **Fixed** ("Checking…"). |
| Business step cell broke row hairlines | **Fixed.** CSS name collision removed. |
| 1024 px Live wrap; EXCLUDING chip cut | **Fixed.** Wrap breakpoint and chip ellipsis. |
| Logger mid-word break; stack trace cut at the right | **Fixed.** Break only after dots; stack traces wrap. |
| 768 px mapping segment wrap and clipping | **Fixed.** `nowrap` segments, toolbar wraps, invented origin line removed. |
| Search enabled while source unreachable | **Rejected, with evidence.** `main` does not disable Search on unhealthy sources (inventory §3.1 item 7, §11). |
| Lane colour close to WARN; eyebrow labels over single settings items; accent on every ID | **Fixed.** Lanes avoid severity hues; group labels replaced by one separator; IDs are ink, with accent only on hover/focus. |

### LERUX-1 review: verdict ACCEPT_WITH_CHANGES

- **Accepted and fixed:**
  - Load more drawn
  - custom range editor and applied interval with zone (32, 33)
  - Raw LogQL for Loki only (34)
  - per-field Verify and Mark needs change, with the step order Scan → Map → Validate → Save → Verify
  - clipping at 1366 px (query bar wraps ≤ 1439; Inspector stays 500 px docked ≥ 1366, overlay below)
  - sequence-table CSS collision
  - chip clipping 768–1439
  - Loki scope field selectable (Namespace › workload)
  - consistent masking story (05 matches 17)
  - Live "Time" column with date
  - axe issues (radio names, separator values, focusable scroll regions, filter labels, `aside` role)
  - newly drawn: row actions menu (35), ID detection (36), Back to Trace (37), Live failed (38), OpenShift `oc login`
    validation (39), Protected chip (20)
  - invented mapping origin labels removed; evidence reads "N / 200 events" from the scan
- **Flagged for owner decision, not silently changed:**
  - read-only compact scope with **Edit search** (D15)
  - severity quick actions inside the Severity popover (D16)
  - stale rows during re-search (D2)
  - Show Surroundings gated by `contextView` (D4)
- **Still `PRESERVED_BUT_NOT_DRAWN`.** These are specified by the inventory and the plan's invariants but have no
  dedicated screenshot:
  - the source list and Compose project option menus
  - the time preset menu
  - Guided and Text query editors
  - Query details content
  - Span / Correlation / Event capture variants (same grammar as Trace)
  - the context "root aged out" notice
  - mapping first-run, stopped-early, drift and capability-absent notices
  - Live STOPPED / NO ACTIVE STREAMS / SESSION EXPIRED
  - the keyboard shortcuts dialog
  - no sources, no Compose projects, truncated results

  None of these is removed from scope.

### LERUX-1 confirmation pass: verdict ACCEPT_WITH_CHANGES

A fresh independent agent rendered the fixed prototype with Playwright and axe-core.

- **Confirmed resolved:** F1, F3, F5, F7, F8, F10–F12, F14–F16, and L1–L4, L6, L8, L10–L15.
- **Rejections accepted:** F2 (the 2,000 Live cap), F4 (gap rows and oldest-first Surroundings), F13 (Search stays
  enabled while the source is unhealthy).
- **Results table:** 7 columns in order; header/cell difference 0 px at all six widths.
- **Page overflow:** none in 36 width × state combinations.

It left these items open. Each was then fixed and re-measured by the designer with Playwright, **without a further
independent pass**:

| Open item | Fix | Re-measured result |
|---|---|---|
| F6: 390 px scope field 446 px wide; Time chip squeezed to 3 px | Mobile scope field bounded with ellipsis; chips keep their width and scroll | Scope field 366 px in a 390 px viewport; Time chip 123 px |
| F9 / L5 / N2: Live stranded on its own row between 1024 and 1439 px | Search input basis reserves room for More filters + Search + Live | Live on the same row as Search at 1024, 1280, 1366, 1439 and 1440 |
| L7: custom-range chip unreadable | Compact interval plus `UTC+03:00`; the Time chip never shrinks; the field carries interval and zone | Chip text not clipped at 1024 or 768 |
| L9 / D16: one-click Errors only lost | **All levels / Errors only** kept as a one-click segmented control at the start of the scope strip | Visible at 1440 with no overflow |
| N1: mapping at 390 px, action bar 518 px, table hidden | At ≤ 767 px the mapping workspace scrolls as one column; the action bar wraps and sticks to the bottom | Action bar 390 px, Save visible, table rendered |
| N3: sequence header clipped at 768 and 390 | Sequence table minimum width 1120 px (contained horizontal scroll) | No clipped headers |
| N4: Live failed next to "Healthy" | The notice explains that source health and the Live stream are checked separately | — |
| N5: step indentation at 390 | Step connector lines hidden at ≤ 767 px | — |
| N6: no page `h1` in state panels | A visually hidden `h1` on every results-column state | axe `page-has-heading-one` clear |
| L4 minor: Validate marked current after passing | Validate is done; Save is current while editing | — |
| Stale-row opacity failed text contrast (found in the final sweep) | Tertiary ink instead of opacity | axe colour-contrast clear on 02, 19b, 26, 38 |

Owner conflicts the confirmation pass surfaced are recorded, not changed: the Live cap (G5), and the masking default
versus CLAUDE.md §2.1 (G5 and SSMP-6).

### Accessibility and responsive (automated, final build)

| Check | Result |
|---|---|
| axe-core, **all 40 states × 4 value sets** (B1, B1 dark, B2, B3), 1440×900 | **PASS**: 0 violations after the final fix (a focusable JSON block on 08) |
| Page horizontal overflow at 1920 / 1440 / 1366 / 1024 / 768 / 390 (01, 04, 09, 13, 16, 18) | **PASS**: none |
| Results table: 7 columns in order; header/cell left and width difference | **PASS**: 0 px |
| Trace sequence table header/cell difference | **PASS**: 0 px |
| Inspector tabs on one row at 1440 and 1366 | **PASS** |
| Search and Live visible at 1440, 1366 and 1024 | **PASS** |
| Contrast (computed, 4 value sets) | **PASS**: text ≥ 4.5:1, marks and control borders ≥ 3:1 (`DESIGN_SYSTEM.md` §2.5) |
| Reduced motion | **PASS**: token zeroing plus per-animation rules; pulse, skeleton, spinner and reconnect icon static when reduced |
| Keyboard behaviour | **NOT_VERIFIED**: the prototype is static; keyboard specs are in `DESIGN_SYSTEM.md` §20 and gated per slice |

## Owner action

Review this package. Approve the recommended B visual treatment, or choose B2 or B3, and decide D0–D40 in
`IMPLEMENTATION_PLAN.md` §3 before any production implementation starts.

Two of those decisions block drawn states rather than only styling them, so they are worth reading first:

- **D39 — import tag-colour resolution.** Surfacing the conflict before Apply is frontend-only; *carrying out*
  either resolution drawn in `91-import-colour-conflict` needs a new field on the import request, and one option
  rewrites saved rules that are not in the pack. Both choices are drawn **disabled** until this is decided.
- **D40 — does colour belong to the rule or to the tag?** Production stores one colour per *rule*, so two rules
  sharing a tag must share a colour, and a cluster of rules linked by shared tags collapses to one colour. The
  prototype fixture obeys that model, verified by running the real `TagColorPolicy`. Moving colour to the tag
  would remove a whole class of conflict, and is a server decision.

---

## Post-feature design sync (PR #59)

**Mission:** `MODERN_DEVELOPER_CONSOLE_POST_FEATURE_DESIGN_SYNC`. Design only: no production frontend or backend
change, nothing implemented, PR #58 not merged.

- **Baseline refreshed** to `main` `51f06e5` by merging `main` into the design branch (the only conflict was the owner
  requirements register, resolved by keeping §25 and §26/§26.1 in order).
- **BEFORE evidence**: 32 captures of the real classification UI (`baseline/classification/`), inventory
  `CURRENT_BASELINE_INVENTORY.md` §13, audit addendum `CURRENT_MAIN_VISUAL_AUDIT.md` §5.
- **Design**: `DESIGN_SYSTEM.md` §21 and §9 (Source field), `MOTION_SYSTEM.md` §7, `COMPONENT_INVENTORY.md`
  (Event classification), `IMPLEMENTATION_PLAN.md` §1 gate 9, §2.1 and decisions D17–D29, register §25.1.
- **Prototype**: `prototype/scripts/classification.js` and `prototype/styles/classification.css` (tokens only; no new
  colour tokens), 13 new Lucide icons in the sprite, small extension points in `app.js`; states 40–81.

### Results-row tag decision

> **Superseded by PR #60 — see “Final design sync (PR #60)” below.** The Tags column is **visible by default**
> (decision **D30**), and CLAUDE.md §4 now specifies eight default columns. The paragraph below is kept as the
> record of the first-pass decision.

~~**Optional Tags column** (first tag + `+N`, full list in the accessible name and tooltip), hidden by default so the
seven default columns and message-only “What happened” stay intact. Visible-by-default is owner decision D19.~~
Rationale and rejected options: `DESIGN_SYSTEM.md` §21.3, superseded by §22.3.

### Classification states (40–81)

| Area | States |
|---|---|
| Search | `40-source-list-loki-unavailable` (approximation of the native list) · `41-more-filters-tag-filter` · `79-more-filters-tags-error` · `80-more-filters-tags-empty` · `42-results-tag-filter-tags-column` · `43-results-multiple-tags` |
| Inspector | `44-inspector-one-classification` · `45-inspector-multiple-classifications` (overlapping tags; masked, redacted, missing, unreadable, JSON) · `46-inspector-long-json-values` |
| Settings › Classification rules | `47-rules-empty` · `48-rules-populated` (disabled rule, export selected) · `49-rules-delete-confirmation` · `50-rules-saved` · `51-rules-revision-conflict` · `52-rules-recovered-from-backup` · `53-rules-invalid-config` · `75-rules-more-menu` |
| Create tag rule from event | `54-rule-source` · `55-rule-detect-initial` · `56-rule-detecting` · `57-rule-detected` · `58-rule-no-safe-pattern` · `59-rule-classification` · `60-rule-conditions-advanced` · `61-rule-extraction` · `62-rule-testing` · `63-rule-test-results` · `64-rule-test-borderline` · `65-rule-save-conflict` · `74-rule-save-ready` · `76-rule-edit-mode` (Edit / Duplicate frame) · `81-rule-new-detect-no-source` · saved: `50` |
| Import / export | `66-import-choose-file` · `67-import-preview-clean` · `68-import-preview-conflicts` · `69-import-invalid-pack` · `70-import-replace-all-confirmation` · `71-import-applied` · `77-import-file-too-large` · `78-import-revision-conflict` · export all/selected in `48`, export one rule in `75` |
| Investigation and Live | `72-investigation-trace-tags` · `73-live-tags` |

Existing states changed in the sync: every Settings state gains the Classification rules nav item; `12` gains the
Classification tags group; Inspector states gain **Create tag rule**; `31` startup copy follows the source policy;
`27` and `34` are labelled capability references because OpenShift Loki is not selectable today.

### Automated checks (final build)

| Check | Result |
|---|---|
| Captures | 169 (`screenshots/capture-report.json`), `problems: []` |
| Page horizontal overflow, all captures incl. 1920 / 1440 / 1366 / 1024 / 768 / 390 | **PASS**: none |
| Results table geometry (header/cell left and width) | **PASS**: ≤ 2 px on every capture with a results table, Tags column on and off |
| axe-core 4.12.1 (WCAG 2.0/2.1/2.2 A/AA + best practice), 121 runs: all 82 B1 states, 4 B1-dark classification states, 7 classification states × 5 widths | **PASS**: 0 violations (`screenshots/axe-report.json`). Earlier runs in the sync found heading order on import pages, a partially covered chip remove target at 768 px, an `alert` role on a list (state 74) and a row menu covering other row controls (state 75); all fixed |
| Contrast of new pairs (computed, B1 light and dark) | **PASS**: `DESIGN_SYSTEM.md` §21.13 |
| Reduced motion | **PASS** by construction: §7 motion uses tokens zeroed under reduced motion plus explicit fade-only rules; captures use `reducedMotion: 'reduce'` |
| Impeccable detector | 2 findings, both previously triaged and kept with justification (§20: Live pulse, gap-band hatch). The sync's one new advisory (15 px font size) was fixed |
| Keyboard behaviour | **NOT_VERIFIED** (static prototype); specified in §21.14 and gated per slice |

### Review record

**Roles.** The designer (this session) proposed. Two fresh, independent general-purpose agents followed
`.claude/skills/log-explorer-professional-ux-reviewer/SKILL.md` (LERUX-1) and rendered the prototype with Playwright and
axe-core. The designer did not approve its own work.

#### LERUX-1 pass 1: verdict ACCEPT_WITH_CHANGES (6 MAJOR, 10 MINOR, 0 BLOCKER)

Passed: B1 coherence, density, classification comprehension, regex hidden, import destructive clarity, accessibility
(axe 0 violations at 1440, 768, 390 and dark). Every finding was fixed:

| ID | Severity | Finding | Fix |
|---|---|---|---|
| R1 | MAJOR | Detect “Changing parts” showed a value from another similar event; the API returns one example per part, from the anchor only | Column removed; table is Part · Kind · Example from this event; §21.7 states the API truth |
| R2 | MAJOR | Extraction Remove button clipped in table rows at every width; narrow cards had only Edit | Action column widened and not clipped; cards have Keep, Edit and Remove; draft panel collapses below 1440 px so the table fits at 1366 |
| R3 | MAJOR | Tag names 0 px wide in stacked rule rows at 390 px (a list-item grid rule leaked into nested tag lists) | Child-combinator selectors for stacked rule, extraction and import rows |
| R4 | MAJOR | Rules table crushed at 768 and 1024 px | Stacked rule rows below 1280 px |
| R5 | MAJOR | Import consequence column needed horizontal scroll at 768 and 1024 px | Import items stack below 1280 px with the effect line under the rule |
| R6 | MAJOR | Inspector states 44–46 enabled the optional Tags column and crushed What happened | 44–46 drawn with the seven default columns; §21.3: the Tags column is hidden while the Inspector is docked |
| R7 | MINOR | “no network call” is untrue for Detect | “read through the normal search path and compared deterministically; no AI service is involved” |
| R8 | MINOR | INVALID copy too narrow | “Could not be read” (production copy) |
| R9 | MINOR | “first 200 events” — the collector reads newest first | “the newest 200 events” |
| R10 | MINOR | Invented “Needed 3” stat | Removed; the server reason carries it |
| R11 | MINOR | Coverage note clipped | Coverage cells wrap (selector specificity fixed) |
| R12 | MINOR | “JSON path” vs API `JSON_POINTER` | “JSON pointer” everywhere |
| R13 | MINOR | States not drawn | Added 74 Save ready, 75 More menu, 76 Edit mode without an event, 77 file too large, 78 import revision conflict, 79 tag list error; §21.4/§21.6/§21.10/§21.11 map loading, empty, reload notice, New/Duplicate and Preview values |
| R14 | MINOR | State 40 is not a native select | Labelled as an approximation of the browser-drawn native list (hub and §9) |
| R15 | MINOR | “Shortened to 2,000 characters” on a 350-character value | Sample value is 2,000 characters |
| R16 | MINOR | Decode lane positions are not in the API | §21.7 specifies the client derivation and the fallback to plain lists when ambiguous |

The designer then re-measured with Playwright: no clipped action buttons, no zero-width tag text, no crushed tables
(22 state × width probes), What happened 286 px at 1440 with the Inspector open.

#### LERUX-1 pass 2 (fresh reviewer): verdict ACCEPT_WITH_CHANGES (4 MAJOR, 7 MINOR, 0 BLOCKER)

All 16 first-pass findings were confirmed **FIXED** in the rendered prototype. Criteria 1–5, 8 and 9 passed. The new findings were all fixed:

| ID | Severity | Finding | Fix |
|---|---|---|---|
| N1 | MAJOR | Turning on the Tags column crushed What happened (16 px at 768/390 in 42/43; also 72, 73) | Tags adds its width to the table minimum: results 1,124 px, captures 1,252 px, Live 892 px, all inside the existing scroll wrapper. What happened is now 240 px at ≤1024 in 42/43; 72 and 73 match their no-Tags widths (§21.3 width floor) |
| N2 | MAJOR | Tag-filter remove buttons and Clear all cut off at 1440/1366/1024 | The chip row scrolls horizontally at every width; Clear all sits outside the scrolling row and stays visible |
| N3 | MAJOR | Detect “Changing parts” table unreadable at 390 | Small evidence tables wrap at ≤767 px (smallest cell 111 px) |
| N4 | MAJOR | A value from another sampled event (“duration=n/a”) was shown in Detect and in the extraction edit row | Removed. Counts only (“16 of 17”); warnings are the server's count sentences as served |
| N5 | MINOR | “Fixed text in all 17 similar events” overclaims (stable = ≥ 90 % alignment) | “Fixed text across similar events” |
| N6 | MINOR | Test coverage omitted the Request body extraction | Every extraction listed, incl. `Request body 0 / 17` |
| N7 | MINOR | Examples in UTC while the anchor strip uses the display zone | Display zone everywhere in the builder |
| N8 | MINOR | More menu covered its own trigger at 390 (axe target-size) | The menu opens below the list; axe 0 |
| N9 | MINOR | Edit mode draft panel said “5 suggested values” | “5 values” |
| N10 | MINOR | Production “Preview values” action not drawn | Drawn beside Add value; runs Test (§21.8) |
| N11 | MINOR | No-safe-pattern reason paraphrased | Server text quoted verbatim from `PatternDetector` |

The designer re-measured every item with Playwright and axe (35 state × width probes: What happened widths, Clear all hit-test, narrow table cells, copy checks; axe 0 on all).

#### LERUX-1 pass 3 (fresh reviewer): verdict ACCEPT_WITH_CHANGES (0 BLOCKER, 0 MAJOR, 11 MINOR)

All R1–R16 and N1–N11 confirmed **FIXED**. Criteria 1–5 and 8–13 passed (responsive and accessibility included; axe
0 violations in 160 runs, light and dark). The reviewer withheld PASS because three minor findings still drew data the
server cannot produce. All eleven were fixed:

| ID | Finding | Fix |
|---|---|---|
| T1 | Decode lane split `5012ms` into a changing `5012` and a fixed `ms`; the server tokenizes `5012ms` as one duration named `duration` | One changing part `5012ms` labelled `duration · duration`; §21.7 “Segments follow server tokenization” |
| T2 | A borderline example matched 0 of 2 conditions; the server only returns near misses with ≥ 1 matched | Replaced by an example matching 1 of 2 |
| T3 | Coverage counted 1 “could not be read” while the example showed not found; the “shortened” sample was short | Coverage 16 / 17 with no unreadable count; the shortened sample is visibly cut; §21.9 rule |
| T4 | Draft panel said “kept as suggested” next to Keep buttons | “3 suggested, 3 confirmed” |
| T5 | Keep buttons unnamed per value | “Keep <value> as suggested” |
| T6 | No edit sheet in the narrow extraction cards | The edited value opens its edit sheet inside the card below 1280 px |
| T7 | More menu trigger not tied to the menu | `aria-haspopup="menu"` and `aria-expanded` |
| T8 | Tags column 132 px in Investigation and Live, tags cut even at 1920 | 156 px everywhere; capture and Live floors updated |
| T9 | No overflow cue on the scrolling chip row | Right-edge fade when the row overflows |
| T10 | Save drawn enabled beside a required-field issue | Matches production (Save stays enabled and re-checks); state and copy say “Not saved: …” after pressing Save; §21.6 |
| T11 | “This rule extracts no fields.” and the empty tag list were not drawn | Drawn in state 46 and new state 80; loading copy specified in §21.4 |

The designer re-measured all eleven with Playwright and axe (17 state × width probes, axe 0).

#### LERUX-1 pass 4 (fresh reviewer): verdict ACCEPT_WITH_CHANGES (0 BLOCKER, 1 MAJOR, 7 MINOR)

T1, T2 and T4–T11 confirmed **FIXED**; T3 **PARTIAL** (see V3). Criteria 1–6 and 8–12 passed; axe 0 violations in
131 runs. The reviewer compared the drawings with `PatternDetector`, `Tokenizer`, `RuleTester`, `ClassificationEngine`
and `ClassificationLimits` and found remaining places that drew data the API cannot return. All fixed:

| ID | Severity | Finding | Fix |
|---|---|---|---|
| V1 | MAJOR | Borderline examples showed extracted values; `RuleTester` builds near misses with no extractions | Borderline examples show time, service, level, “Matched n of m” and the field value only; help copy says values are extracted only for matched events; §21.9 |
| V2 | MINOR | The drawn two-condition suggestion cannot be produced by the detector's candidate order | Suggestion is the detector's prefix-plus-labels candidate (starts with “Make webhook call to” and contains `method=`, `requestId=`, `responseCode=`, `duration=`), carried consistently through Classification, advanced editing, Test (“Matched 3 of 5”), Save and the rules list; §21.7 candidate order |
| V3 | MINOR | Shortened sample was 324 characters; the preview limit is 300 | Exactly 300 characters |
| V4 | MINOR | Matched examples omitted the Request body extraction | Every matched example lists Request body `—` |
| V5 | MINOR | Suggested duration expression differed from the detector's | `duration=(?P<durationMs>\d+(?:\.\d+)?)ms`, as the detector writes it |
| V6 | MINOR | “Ready to save” heading beside a “Not saved” issue | “Review and save” |
| V7 | MINOR | Narrow step strip: current step off-screen, no overflow cue | Current step scrolled into view; edge fades where more steps are hidden |
| V8 | MINOR | EXCLUDING chip shrank to a fragment while the chip row scrolls | Chips keep their words; the row scrolls |

#### LERUX-1 pass 5 (fresh reviewer): verdict ACCEPT_WITH_CHANGES (0 BLOCKER, 2 MAJOR, 6 MINOR)

V1 and V3–V8 confirmed **FIXED**, V2 **PARTIAL**; every earlier R, N and T item FIXED; axe 0 violations in 164 runs.
The reviewer also ran the real compiled `PatternDetector`, `RuleCompiler` and `Tokenizer` against the drawn sample.
All findings were fixed:

| ID | Severity | Finding | Fix |
|---|---|---|---|
| W1 | MAJOR | More filters overflowed the viewport at 768 and 390 and could not be scrolled by pointer, hiding the Classification tags group and Apply (also in the older state 12) | The panel scrolls inside the viewport at every width and its Reset / Cancel / Apply footer is sticky; §21.4 |
| W2 | MAJOR | Advanced condition editor: Value column crushed to 0 px at 390 (fixed grid) | Rows stack below 1024 px (Value full width) and become one column at ≤ 767 px |
| W3 | MINOR | A Test example came from `notification-worker`, which the sample scope excludes | Example comes from a service inside the scope |
| W4 | MINOR | A drawn borderline event would itself count as similar, making Detect 17 of 18 | Replaced; the sample is now consistent with the detector |
| W5 | MINOR | “Make webhook configuration reload …” in the results matches 1 of 5 conditions but was missing from Borderline | Included (Matched 1 of 5) |
| W6 | MINOR | Step rail and §21.6/§21.9 still said “2 conditions” | “2 tags · 5 conditions”; docs updated |
| W7 | MINOR | The saved rule showed 5 values in Settings while the saved draft had 6 | The rule has 6 values (Request body, sensitive) in Settings, Inspector and Edit |
| W8 | MINOR | Sticky import action bar could cover focused content mid-scroll | `scroll-padding-bottom` keeps focused controls clear of the bar |

**Designer verification against the server code.** A harness compiled against `backend/target/classes` ran the drawn
sample (anchor, 17 similar events, the queued, 409 and configuration-reload events, filler to 198 values) through the
real `PatternDetector` and `RuleCompiler`. It returned exactly what states 57, 61 and 64 draw: similar 17; stable
segments `Make webhook call to`, `method=`, `requestId=`, `responseCode=`, `duration=`; variable `duration` as one
DURATION token (`5012ms`); the five-condition suggestion with coverage 17 / 17 similar and 0 / 181 other and no warnings;
extraction expressions and coverage (Duration 16 / 17); borderline events matching 1, 3 and 2 of 5 conditions.

#### LERUX-1 pass 6 (fresh reviewer): verdict ACCEPT_WITH_CHANGES (0 BLOCKER, 1 MAJOR, 7 MINOR)

W1–W6 confirmed **FIXED**, W7 and W8 **PARTIAL**; every earlier R, N, T and V item FIXED. The reviewer's own harness
against the compiled `PatternDetector`, `RuleCompiler` and `ClassificationEngine` reproduced states 57, 63 and 64
(noting that the undrawn similar events must vary their method, e.g. GET/PUT, as the designer harness does).
Findings, all fixed:

| ID | Severity | Finding | Fix |
|---|---|---|---|
| X1 | MAJOR | Keyboard focus hidden under the sticky import action bar at 390 (WCAG 2.4.11) | Settings action bars are not sticky at ≤ 767 px; focus can no longer be obscured |
| X2 | MINOR | Edit-mode compact summary said “Extracts 5” | Count 6 everywhere |
| X3 | MINOR | Readout and footer said 31 loaded while the table and Inspector showed 36 | Readout, footer and Inspector position all derive from the rendered list |
| X4 | MINOR | The queued borderline event was inside the loaded window but missing from results | Added to the results (untagged) |
| X5 | MINOR | An invalid regex row appeared inside the saved rule's editor (76) and uncounted in 59 | The typed invalid row exists only in state 60 and counts as a sixth draft condition there |
| X6 | MINOR | axe target-size on tag checkboxes at 768 (sticky footer half-covering) | Footer moved outside the scroll area; each full tag option row is the checkbox target |
| X7 | MINOR | Query preview crushed to a fragment at 390 | Preview takes its own row at ≤ 767 px |
| X8 | MINOR | Empty tag list copy extended production text | Exactly “No classification tags yet.” |

#### LERUX-1 pass 7 (fresh reviewer): verdict ACCEPT_WITH_CHANGES (0 BLOCKER, 2 MAJOR, 4 MINOR)

All X1–X8 and every earlier item confirmed **FIXED** (axe 0 violations in 146 runs; the reviewer's own harness
reproduced states 57, 58, 61 and the borderline counts). Findings, all fixed:

| ID | Severity | Finding | Fix |
|---|---|---|---|
| Y1 | MAJOR | State 46 drew “Acquirer partner call” matching an event its conditions reject, with a subset of values and an unsaved rule | Two saved rules make 46 producible: **Acquirer decline** (no extractions) and **Acquirer response details** (Response body, Callback URL, Error detail); every block lists all definitions in engine order; rules list, deleted-rules list (70) and tag cells follow |
| Y2 | MINOR | Middleware Request body drawn “not found” on W1, where it is present (sensitive); coverage said 0 / 17 | Drawn `[REDACTED]` in the middleware block (the acquirer rule, which does not mark it sensitive, shows the JSON); coverage 1 / 17; redacted chip on that Test example |
| Y3 | MAJOR | Keyboard focus on the narrow step strip could sit off-screen or under the edge fades | A focused step scrolls fully into view (40 px clear of the fades); the strip has end padding; fades follow scrolling |
| Y4 | MINOR | Tab order reached results covered by the open More filters panel | Results are inert while the panel is open; focus moves to the panel heading on open (§21.4) |
| Y5 | MINOR | Detect without a source event (pasted sample value, empty-value hint) not drawn | New state 81 (New rule) |
| Y6 | MINOR | Inspector resize handle focusable off-edge at 390 | Hidden at ≤ 767 px |

**Designer verification against the server code, extended.** A second harness runs the prototype's eight saved rules
and the drawn events (W1–W3, the long-value event, the borderline events, the Test examples, gateway and ledger rows)
through the real `RuleCompiler` and `ClassificationEngine`. Its tags, rule order, per-definition statuses and value
lengths are what states 43–46, 63 and 64 draw: W1 `middleware, external-api, partner` with the middleware Request
body PRESENT and sensitive; the long-value event `partner, external-api` with Acquirer decline (no fields) then
Acquirer response details (Error detail 2,479 characters, shortened to 2,000 by the redactor); borderline and
queued events untagged.

#### LERUX-1 pass 8 (fresh reviewer): verdict ACCEPT_WITH_CHANGES (0 BLOCKER, 2 MAJOR, 6 MINOR)

Y3–Y6 and every earlier item confirmed **FIXED**, Y1 and Y2 **PARTIAL**; axe 0 violations in 168 runs (light and
dark). The reviewer ran the rules and all 37 rendered result rows through the real `RuleCompiler`,
`CompiledRuleSet.ofEnabled`, `ClassificationEngine`, `ExtractedValueRedactor` and `RuleTester`. Findings, all fixed:

| ID | Severity | Finding | Fix |
|---|---|---|---|
| Z1 | MAJOR | The server sets `redacted=true` whenever redaction changed a value (`ExtractedValueRedactor.present`); the design turned every such value into a full `[REDACTED]` token, which would hide values the server sends | Only a value that is exactly `[REDACTED]` is a token; partly redacted JSON (`"token":"[REDACTED]"`) and policy-masked values (`84***31`) show as served with “Redacted by the server where required” and no copy action; §21.5 table corrected |
| Z4 | MAJOR | Results under the Inspector sheet (< 1366 px) took keyboard focus (also in the older state 04) | Results are inert while the Inspector is a sheet; §21.14 |
| Z2 | MINOR | Rule order: the server evaluates by priority then id, and the editor sets no priority | Rules, rule blocks, tag unions, the rules list and the Replace-all list follow id order (W1 tags `external-api, partner, middleware`) |
| Z3 | MINOR | The root event carries `uiElement: checkout.pay-button`, which the enabled Frontend call rule tags | Tagged `frontend-call` in results, captures (“Tagged 3 of 9”) and its Inspector (which now shows the Classification section in every Inspector state) |
| Z5 | MINOR | Tab reached the background behind the modal delete dialog | Everything behind a modal alertdialog is inert |
| Z6 | MINOR | “as served” on JSON the engine serializes compactly | “formatted for reading” |
| Z7 | MINOR | New rule breadcrumb said Edit rule | “New rule” |
| Z8 | MINOR | Rule heading tag line cut at 390 | Wraps at ≤ 767 px |

The designer harness now builds the rule set with `CompiledRuleSet.ofEnabled` (the server's sorting) and returns
exactly the drawn order and tags: W1/W2 `external-api, partner, middleware` (Acquirer partner call, then Middleware HTTP
call), the long-value event `partner, external-api`, the root event `frontend-call`.

#### LERUX-1 pass 9 (fresh reviewer): verdict ACCEPT_WITH_CHANGES (0 BLOCKER, 2 MAJOR, 2 MINOR)

Z1–Z8 and the spot-checked earlier items confirmed **FIXED**; V2 and W6 **REGRESSED** and X5 **PARTIAL** (all through
AA1); axe 0 violations in 168 runs. The reviewer ran the drawn rules and events through the real `RuleCompiler`,
`CompiledRuleSet.ofEnabled`, `ClassificationEngine`, `ExtractedValueRedactor`, `RuleTester` and `PatternDetector`.
Findings, all fixed:

| ID | Severity | Finding | Fix |
|---|---|---|---|
| AA1 | MAJOR | After the id-order sort (Z2), the Detect suggestion took the first rule by position (Acquirer decline), so 57–76 drew a one-condition suggestion the detector does not return for the webhook event | The suggestion takes `middleware-http-call`'s conditions by id: 57 lists the five detector conditions, the draft summaries say “Conditions 5” (6 with the typed regex in 60) |
| AA2 | MAJOR | The tag token input (“Add a tag”, 59, 60, 76) had no visible keyboard focus | The token field draws the shared 2 px focus ring while its input has focus |
| AA3 | MINOR | Edit mode marked Detect completed while its status said “Not run in this edit” | Detect is drawn as not done in edit mode |
| AA4 | MINOR | The file-too-large error added “Nothing was read.” to the production string | Production string only |

#### LERUX-1 pass 10 (fresh reviewer): verdict PASS (0 BLOCKER, 0 MAJOR, 3 MINOR)

AA1–AA4 and the spot-checked earlier items (R, N, T, V, W, X, Y, Z) confirmed **FIXED**; axe 0 violations in 131 runs
(42 classification states at 1440 / 768 / 390 plus five dark states), 22 keyboard Tab walks with no focus off-screen,
covered, zero-size or inside inert content, 78 responsive probes with no page overflow and results geometry within
2 px everywhere. The reviewer's own harness reproduced the drawn detection, rule order, per-event classification,
redaction states, rule-test counts and preview truncation from `PatternDetector`, `RuleCompiler`,
`CompiledRuleSet.ofEnabled`, `ClassificationEngine`, `ExtractedValueRedactor` and `RuleTester`.

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| AB1 | MINOR | Below ~1440 px the active-filter chip lane shows the tag chips only after scrolling, while the readout and Clear all keep their space | **Accepted as drawn.** The lane scrolls with a fade cue, every chip's remove button is keyboard-reachable and brought into view, and the More filters badge and panel state the committed tags (§21.4, N2/T9/V8) |
| AB2 | MINOR | The empty (47) and invalid-config (53) rules workspace drew runtime counters from a server run that had matched rules | Fixed: both states draw zeroed counters |
| AB3 | MINOR | The tag-filter error extended the production string with “Other filters still work.” | Fixed: production string only |

#### LERUX-1 pass 11 (fresh reviewer): verdict ACCEPT_WITH_CHANGES (0 BLOCKER, 1 MAJOR, 3 MINOR)

AB2, AB3 and every spot-checked earlier item (R, N, T, V, W, X, Y, Z, AA) confirmed **FIXED**, with the reviewer's own
harness reproducing the detection, rule order, redaction, rule-test and limit values; axe 0 violations in 132 runs,
42 keyboard Tab walks with 0 genuine focus defects, 96 responsive probes with 0 page overflow and a worst table
geometry delta of 0.00 px. Findings, all fixed:

| ID | Severity | Finding | Fix |
|---|---|---|---|
| AC2 | MAJOR | State 71 said an import added a rule, but still drew the 8 pre-import rules, count 8 and revision 13, which the server cannot return after `persist()` | The applied state draws the merged set: “Card issuer callback” in id order, Settings count 9, revision 14 |
| AC1 | MINOR | State 53 drew revision 13, but the server loads `RulesDocument.empty()` (revision 0) whenever the configuration is INVALID | Revision 0, and the meta line says the rules file could not be read |
| AC3 | MINOR | The row overflow menu (75) was drawn far from its trigger, with no visual tie to its row | The menu is anchored 4 px under its own row, right-aligned with the trigger, and the row is scrolled into view with it (§21.10) |
| AC4 | MINOR | The invalid-regex alert (60) extended the server string with “Shown when you test or save.” | The alert carries the server string only; the timing note moved to the field help |

## Final design sync (PR #60)

**Mission:** `MODERN_DEVELOPER_CONSOLE_FINAL_POST_PR60_DESIGN_SYNC`. Design only: no production frontend or backend
change, nothing implemented, PR #58 not merged. `git diff 6e71af8 -- frontend backend` is empty.

- **Baseline refreshed** to `main` `6e71af8` (PR #59 *and* PR #60) by merging `main` into the design branch — a
  clean merge, no conflicts.
- **BEFORE evidence**: 21 captures of the real post-PR #60 application in `baseline/pr60/` (real backend, Fixture
  source, synthetic data only), indexed in `baseline/pr60/README.md`; inventory `CURRENT_BASELINE_INVENTORY.md`
  §14 (observations C-12 … C-24, risk notes 19–24).
- **Design**: `DESIGN_SYSTEM.md` **§22** is now the current truth for classification (§21 is kept as the
  first-pass record); `IMPLEMENTATION_PLAN.md` §2.2 maps PR #60 into the slices as **restyle / recompose of
  shipping behaviour**, decisions **D30–D38**, with **D19 marked superseded**; `COMPONENT_INVENTORY.md` extended.
- **Prototype**: 14 new states (82–95), the eight-colour tag palette in `tokens.css` (light + dark companion), the
  chip redrawn as tinted pill + dot + neutral text, and the Tags column made a default column.

### What changed in the design, and why

| Production truth after PR #60 | Design response |
|---|---|
| Detect/Test sample the committed search | A **Sampled from this search** component states the scope, including the one filter deliberately left out (§22.6) |
| Extraction is assisted | Suggestions with measured coverage, confirmed values, and a real **no-suggestion** state — never a blank form (§22.7) |
| A classified event can be extended in place | *Add extraction from this event* and *Create another tag rule* are separated by frame, trail, step count and badge — not just wording (§22.8) |
| Classification is visible in the table | Tags is a **default** column: first tag + a **neutral** `+N`, full list in the accessible name (§22.3, D30) |
| Rules carry a semantic colour | Eight palette entries in B1's muted register, drawn as **tinted pill + dot + neutral text** so a RED tag never reads as an ERROR level (§22.2, D31) |
| One tag keeps one colour; conflicts refused | Named, resolvable conflict states on save and on import (§22.5, §22.9, D36) |

**What the design adds beyond production** is listed in one table — `DESIGN_SYSTEM.md` §22.11 (A1a, A1b, A2–A13) — so no
reader mistakes a proposal for shipped behaviour. The largest is **A1b**, and it is the only row that is not
frontend-only: executing either resolution drawn in `91-import-colour-conflict` needs the import request to carry a
tag-colour resolution, and one of the two rewrites saved rules that are not in the pack — open decision **D39**.
Its frontend-only half, **A1a**, is the highest-value addition here: the server already returns `tagColorConflicts`
on the import preview and already refuses the write, but the frontend never reads it, so today the refusal arrives
*after* Apply.

### Classification states (82–95)

| Area | States |
|---|---|
| Sample scope | `82-rule-detect-scope-summary` |
| Tag colour | `83-rule-classification-colour`, `84-rule-colour-conflict`, `94-rules-list-colours` |
| Assisted extraction | `85-rule-extraction-suggestions`, `86-rule-extraction-no-suggestion` |
| Extend a rule from an event | `87-extend-choose-rule`, `88-extend-suggestions`, `89-extend-test-coverage`, `90-extend-stale-rule` |
| Import | `91-import-colour-conflict` |
| Results table | `92-results-tags-default-column`, `93-results-tag-not-severity` |
| Inspector actions | `95-inspector-unclassified-actions` (the control case: an unclassified event offers only *Create tag rule from this event*) |

`93-results-tag-not-severity` exists to be checked on one point: a red `issuer` tag sits on INFO rows directly
above ERROR rows, so a reviewer can confirm colour identity never reads as severity.

### Automated checks (PR #60 build)

| Check | Result |
|---|---|
| Captures | **222**, 0 page overflow at 1920 / 1440 / 1366 / 1024 / 768 / 390; results header/cell within 2 px |
| axe-core 4.12.1 | **174 runs, 0 violations** (all 96 B1 states, the dark companion set, and states 82–94 across five widths) |
| Tag palette contrast | Light: text ≥ 7.04:1, dots ≥ 3.76:1 on their tint. Dark companion: text ≥ 7.46:1, dots ≥ 5.09:1. Measured on the rendered chips, both themes |
| Row height | A classified row is **28 px**, exactly like an unclassified one; 8 default columns |
| Reduced motion | 0 elements animating or transitioning under `prefers-reduced-motion: reduce` |
| Colour picker | 8 named swatches in one radiogroup, 2 px visible focus ring, keyboard reachable |
| `+N` counter | Transparent/neutral, never the tag's tint; full list in the accessible name (`Tags: …`) and tooltip |
| Impeccable detector | **0 anti-patterns**; 2 advisories, both pre-existing `#000` mask-image stops (a mask gradient needs a literal stop) |

The detector's one real finding this pass — a 2 px left accent bar on the scope summary, flagged as `side-tab` —
was accepted and removed; the block is grouped by its sunken surface alone. Two radius values were moved onto the
documented `--r-xs` / `--r-sm` tokens.

### Review record

#### LERUX-1 post-PR #60 pass 1 (fresh reviewer): verdict ACCEPT_WITH_CHANGES (0 BLOCKER, 5 MAJOR, 7 MINOR)

The reviewer rendered 126 light + 26 dark captures with layout probes, ran 52 axe runs (0 violations) and 8
keyboard walks (168 stops, 0 without a visible indicator), and read the production code at `6e71af8` to check
every claim in §22.11. Criteria 2, 3, 4, 5, 7, 8, 9 and 11 passed outright — including the table geometry
(header↔row delta **0.00 px** across all eight columns), the 28 px row height for classified and unclassified
rows alike, and the tag/severity separation in both themes. Findings, all fixed:

| ID | Severity | Finding | Fix |
|---|---|---|---|
| AE1 | MAJOR | `89`: the coverage column was crushed to 12 px with **no scrollable ancestor**, so the coverage figures — the payload of that state — were unreachable at 390 px | The table scrolls in its own labelled region with a 520 px floor; the State column widened to 150 px. No tight cell at any width |
| AE2 | MAJOR | `87`–`90`: the heading, sub-line and footer sat **flush against the viewport edge** at every width — they were siblings of `.rb-body`, which owns no gutter | Moved inside `.rb-main`, exactly as the six-step builder does. Gutter now 260 px at 1440 and 12 px at 390 — identical to state `61` |
| AE3 | MAJOR | `84`, `87`: the two sentences the design leans on hardest were flex rows of bare text runs, so each run wrapped in its own narrow box — up to **six ragged columns** at 390 px | Each sentence is one inline flow (icon + a single `<span>`). Two flex items, full-width text, normal wrapping |
| AE4 | MAJOR | `86`: the draft rail collapsed into the content column and the step footer rendered **inside** the warning callout | Root cause was an unclosed `<div>` in the panel markup, which made the parser nest the rail. Closed; the three-column grid is restored |
| AE5 | MAJOR | §22.11 A1 costed the import colour conflict as "read one existing field; one panel", but **neither drawn resolution can be executed by the shipping API** — no tag-colour field on the apply request, and one option would rewrite saved rules outside the pack | Split into **A1a** (surface the conflict — frontend only) and **A1b** (execute a resolution — server work, named explicitly), the section's closing claim corrected, §22.9 given the same caveat, and the prototype state label now names the dependency |
| AE6 | MINOR | `91`: the count row omitted the colour conflict | A fifth count chip, "Tag colour conflicts 1" |
| AE7 | MINOR | §22.6 claimed every builder step carries a scope block | Bounded the claim, and recorded that the states which report numbers keep their bounded wording at every width. *The bound itself was still wrong and was corrected in pass 7 — see AK7.* |
| AE8 | MINOR | `85`: value type was static text, documented as a control | A real `<select>` per suggestion row |
| AE9 | MINOR | `85`: a 44 px coverage track made 16/18 and 18/18 nearly identical | Track widened to 88 px |
| AE10 | MINOR | §22.2 said the dot "falls away" under forced colours; measured, it persists as `CanvasText` | Sentence corrected to the measured behaviour |
| AE11 | MINOR | `87`: a cross-reference to another control was styled like a link | Plain emphasis, and the sentence now names it as the event's own action |
| AE12 | — | Tags off-screen at 390 via table scroll | No change: CLAUDE.md §4 requires exactly this (the page never overflows; the table scrolls) |

#### LERUX-1 post-PR #60 pass 2 (fresh reviewer): verdict ACCEPT_WITH_CHANGES (0 BLOCKER, 2 MAJOR, 6 MINOR)

All eleven pass-1 items verified **FIXED** except AE9, which was fixed but caused a regression (AF1). 166 captures,
56 axe runs (0 violations), 212 keyboard stops across 10 walks (0 without a visible focus indicator), and every
row of §22.11 re-checked against the code at `6e71af8` and confirmed true. Findings, all fixed:

| ID | Severity | Finding | Fix |
|---|---|---|---|
| AF1 | MAJOR | **Regression from AE9's own fix.** Widening the coverage bar to 88 px inside an unchanged fixed 150 px grid track made `.sg-cov` overflow by 42 px, so the Output-name field painted over the denominator — the very numbers AE9 set out to make readable were the ones lost, at 1920/1440/1366 | The coverage track sizes to its content (`max-content`) and the type track was widened for its new select. Measured: `scrollWidth === clientWidth` on every suggestion row at 1920/1440/1366/390 |
| AF2 | MAJOR | The same crushing AE1 was raised for still applied to the **other** coverage tables (`82`, `57`, `63`) at 390: the only scrollable ancestor was the builder column itself, so reading a denominator dragged the rail, headings and footer with it | AE1's fix applied consistently: each table sits in its own named `overflow-x:auto` region with a min-width floor, and the Test step's two panels stack below 1024. Measured at 390: the builder column no longer scrolls in any of them, and no cell sits outside it |
| AF3 | MINOR | `91` drew two resolutions the shipping API cannot execute with no on-page marker — the caveat lived only in the docs, and §22.9 itself says "what must not happen is drawing two buttons that cannot act" | A visible note in the panel names it as a design target, points at decision **D39**, and states the honest interim: ship the panel with the choices disabled until the API question is decided |
| AF4 | MINOR | §22.2's chip cap was wrong and inverted (96 px "in a cell"; the cell actually removes the cap, and a rendered chip is ~131 px) | Corrected to the drawn rule |
| AF5 | MINOR | The README Contents table still said "82 states" and "169 captures" while the same file said 96/222 elsewhere | Both figures corrected |
| AF6 | MINOR | `84` showed the draft "Middleware HTTP call" conflicting with a saved rule of the same name — the canonical colour-conflict illustration appeared to conflict with itself | The colliding saved rule is now "Partner webhook call" |
| AF7 | MINOR | The same badge was spelled "Suggestion · not saved" and "Suggestion · nothing saved" | One spelling: *Suggestion · not saved* |
| AF8 | MINOR | `89`'s coverage table adds a State column production's plain list does not have — an addition missing from §22.11 | Recorded as **A10**, with its cost: frontend only, both columns derivable client-side |

#### LERUX-1 post-PR #60 pass 3 (fresh reviewer): verdict ACCEPT_WITH_CHANGES (0 BLOCKER, 5 MAJOR, 10 MINOR)

204 captures, 56 axe runs (0 violations), 212 keyboard stops across 13 walks, width sweeps at 20 px steps, and a
line-by-line re-check of §22.11 against the code at `6e71af8`. Pass-2 items were confirmed fixed except AF1,
which was fixed but left a residue. Findings, all fixed:

| ID | Severity | Finding | Fix |
|---|---|---|---|
| AG2 | MAJOR | **The prototype drew a colour model production cannot hold.** A rule stores *one* colour and paints *every* tag of that rule in it, so the fixture's two-colour rules were impossible — and worse, two rules sharing `external-api` in different colours is a write the server **refuses** | Each rule now carries one colour and the tag map is *derived* exactly as `TagColorPolicy` derives it. Verified by running the real policy over the prototype's own fixture: **0 conflicts**, and the derived map matches the prototype's byte for byte. The deeper consequence — a cluster of rules linked by a shared tag collapses to one colour — is documented in §22.2 and raised as decision **D40** |
| AG1 | MAJOR | A `min-width` added by the pass-2 fix applied to *every* `.cov` table, so the Test step's table painted 217 px outside its own card at 1920/1440 | Both floors scoped to the wrapped, scrollable variant only. Measured: no coverage table escapes its card at any width |
| AG3 | MAJOR | Below 1280 both suggestion-row actions shared one grid area, perfectly superimposed — **Preview values was unreachable by pointer** at 1024/768/390 | Each action has its own track. Hit-tested across ten widths from 390 to 1920: "Preview URL values" is the element at that point everywhere |
| AG4 | MAJOR | The suggestion row still overflowed by 38 px in the narrow 1440–1460 band, where the draft rail appears before the main column grows | The stacked layout now covers everything below 1480. `scrollWidth === clientWidth` on every row at all ten swept widths |
| AG5 | MAJOR | In forced colours every swatch computed identically — the **selected colour was indistinguishable** | The checked swatch gains a 3 px border and a ✓, so selection survives without hue. Measured under `forcedColors: 'active'` |
| AG6 | MINOR | `93` claimed a red tag sat "directly above" an ERROR row; it was nine rows away | The tag is placed on the rows adjacent to the first ERROR row. Measured: tag row WARN, row below ERROR |
| AG7 | MINOR | `88` and `89` told contradictory stories about which values were already saved | One consistent set across both steps |
| AG8 | MINOR | `82` stated the scope twice — the panel and the rail's block | The rail suppresses its block on the step that shows the panel |
| AG9 | MINOR | The rules list truncates tags where production draws every chip — an addition missing from §22.11 | Recorded as **A11**, and the state's label corrected |
| AG10 | MINOR | `91` drew the two un-executable resolutions as live radios | Both drawn disabled, matching the note beside them |
| AG11 | MINOR | The extend frame said "Add extraction to **this event**" before a rule was chosen | Pre-choice frame is named by the action; post-choice by the rule |
| AG12 | MINOR | The colour preview showed every tag; production previews one chip | One chip, plus a line stating all the rule's tags use it |
| AG13 | MINOR | The conflict named a rule absent from the package's own fixture | Uses "Acquirer partner call", which owns `external-api` in the drawn rule set |
| AG14 | MINOR | The Enabled switch vanished in forced colours (pre-existing) | A `CanvasText` border and a `Highlight` track |
| AG15 | MINOR | A single-tag cell announced "Tag:"; production always says "Tags:" | Matches production |

#### LERUX-1 post-PR #60 pass 4 (fresh reviewer): verdict ACCEPT_WITH_CHANGES (0 BLOCKER, 4 MAJOR, 7 MINOR)

230 render probes, 86 axe runs (0 violations), 14 keyboard walks, a width sweep at 20 px steps, and a Java
harness running the real `TagColorPolicy` over the prototype's own fixture. Pass-3's fixes held, with four
exceptions found and fixed here:

| ID | Severity | Finding | Fix |
|---|---|---|---|
| AH1 | MAJOR | **The pass-3 colour fix was incomplete.** The rules list, Inspector and chooser were converted to the rule-level model, but the **import preview** still resolved chips per tag — six pack rows drawn in two or three colours, the exact state §22.2 says the data model cannot hold. It also drew `pci` grey, a colour `TagColor.defaultFor` never returns | Every pack item carries one colour, like any rule. Verified across all four import states: each rule row draws exactly one colour |
| AH2 | MAJOR | `84` contradicted itself three ways: the draft tag read `middleware`, the error named `external-api`/Purple, and the button offered "Use Blue" — which would not have resolved the stated conflict | The state is one story: draft tag `external-api` in Red, error naming Purple and "Acquirer partner call", resolution **Use Purple** |
| AH3 | MAJOR | `91` credited the pack side to "Imported middleware", a rule absent from the pack listed three rows above | The conflict is attributed to **Card issuer callback**, which the pack really contains and which now visibly brings `external-api` in Red |
| AH4 | MAJOR | **Regression from the pass-3 grid rewrite.** The Type select landed on the two 30 px action tracks and rendered 70 px wide, clipping "Integer"/"Decimal" at five of the six target widths | Explicit tracks with a row of its own. Measured at 14 widths from 390 to 1920: the select is ≥ 104 px, no row overflows, the page never overflows |
| AH5 | MINOR | `93` put the red tag on a WARN and an ERROR row while the title and §22.2 said INFO — and a red tag *on* an error row weakens the very demonstration | Placed on the two nearest INFO rows above the first ERROR row |
| AH6 | MINOR | §22.11 lacked a row for the import preview drawing coloured chips where production renders plain text | Recorded as **A12** |
| AH7 | MINOR | `89` listed 2 already-saved values while `87`/`88` said 6 | All six listed |
| AH8 | MINOR | The forced-colours opacity override was declared before an equal-specificity rule, so it was dead | Ordering fixed; measured opacity 1 in forced colours |
| AH10 | MINOR | A required radiogroup whose options are all disabled | `aria-required` dropped, group described by the D39 note |
| AH11 | MINOR | The chooser implied a preferred rule | Both rows carry the same primary action, as production does |

#### LERUX-1 post-PR #60 pass 5 (fresh reviewer): verdict ACCEPT_WITH_CHANGES (0 BLOCKER, 2 MAJOR, 8 MINOR)

1,152 renders (96 states × 6 widths × light and dark) with **zero page-level horizontal overflow anywhere**, a
table-geometry sweep with 0 misalignments, 70 axe runs (0 violations), 8 keyboard walks, and a Java harness
running the real `TagColorPolicy` over the prototype's fixture merged with its own import pack. All four pass-4
MAJOR fixes were confirmed to hold; the reviewer also independently re-derived §14 of the baseline inventory and
found no place where the package overstates what ships. Findings, all fixed:

| ID | Severity | Finding | Fix |
|---|---|---|---|
| AI1 | MAJOR | **The pass-4 fix moved a contradiction instead of removing it.** State `84`'s *form* was made consistent (`external-api` in Red), but the draft rail and compact bar still showed the default draft — `middleware` in blue. The one screen whose subject is "one tag, one colour" showed its own draft under two tags in two colours | The step's draft summary is derived from the tag and colour the step actually draws. Verified at all six widths: form, rail and compact bar all read `external-api` in red |
| AI2 | MAJOR | The step rail still said "2 tags · 5 conditions" after the fixture rewrite reduced the rule to one tag — a stale count in six builder states | "1 tag · 5 conditions", matching the one chip the draft panel lists |
| AI3 | MINOR | §22.2 said the red tag sits "directly above" ERROR rows; three WARN rows intervene | Matches the prototype caption: the two nearest INFO rows above the first ERROR row |
| AI4 | MINOR | The import conflict's explanation reached the table row but not the card layout at ≤768 | Carried into the card |
| AI6 | MINOR | A11's claim is width-dependent — the narrow card layout draws every chip | Stated in A11 |
| AI7 | MINOR | `88` reused "a rule being written must not be evidence for itself" while extending an **already saved** rule | **This row was wrong when written.** The edit changed a different sentence and the rendered state was never re-checked, so the defect survived. Found again as AJ2 and fixed properly in pass 6 |
| AI8 | MINOR | At phone width the Output name field (96 px) was narrower than the Type select (204 px) — the narrower control was the one being edited | Output name takes the row; Type is capped. Swept at 12 widths × 2 states with no overflow |
| AI9 / AI10 | MINOR | §22.11 rows out of order; a stale "Optional Tags column" CSS comment | Sorted; comment updated to D30 |

#### LERUX-1 post-PR #60 pass 6 (fresh reviewer): verdict ACCEPT_WITH_CHANGES (0 BLOCKER, 2 MAJOR, 6 MINOR)

264 renders with 0 page overflow and 0 table-geometry misalignments, **108 axe runs (0 violations, `target-size`
included)**, 9 keyboard walks plus 2 arrow-key walks, a forced-colours render, 16 measured contrast pairs, and a
Java harness running the real `TagColorPolicy` — which confirmed the fixture is conflict-free and that both drawn
conflicts are the exact errors production emits. §22.11 was verified row by row against `6e71af8` and found
complete and honestly costed. Findings, all fixed:

| ID | Severity | Finding | Fix |
|---|---|---|---|
| AJ2 | MAJOR | **A verification failure, not just a defect.** Pass 5's table recorded AI7 as fixed; the rendered state was byte-identical to what had been reported. The edit had changed the suggestion read-out while the wrong sentence lived in the scope summary, and a dead `extendNote` branch no state passed. The defect is minor; asserting a fix the rendering contradicts is not (CLAUDE.md §3) | The scope summary takes an explicit reason, so each frame states what is true of it: the create flow says a rule being written must not be evidence for itself; the extend flow says the sample is picked by your search, not by the tag this rule already applies. **Verified by rendering both states**, and the pass-5 row above is corrected rather than left standing |
| AJ1 | MAJOR | States `85`/`86` carried the *extend* flow's 18-event sample into the *create* flow, so the step rail read "17 similar of 200 read" beside a panel reading "18 matching events" with every denominator `/18` — while `61`, `63`, `64` and `74` all said 17. The draft's Extracts count also ran backwards, 5 → none, between `83` and `85` | Both states use the create flow's 17-of-200 sample and its draft. Measured: no state in that flow now renders "18" anywhere, and `85` carries the same 5 values as the step before it |
| AJ3 | MINOR | The scope heading rule targeted `h4` while the markup emits `h3`, so it fell back to UA defaults — 15.2 px/700 in a 50 px block, louder than the panel headings beside it | Selector corrected; measured 13 px/600 in a 24 px block |
| AJ4 | MINOR | Below 1480 the row actions were drawn on the first line but came last in DOM order, so focus ran to the bottom of the card then jumped back to its top-right | Actions moved to the final line. Measured at 1440/768/390: focus now advances monotonically down the row |
| AJ5 | MINOR | The decisions heading said D30–D37 while the table held D30–D40, with the last three rows out of order | Retitled and sorted |
| AJ6 | MINOR | §21.10's "≤ 767 px" rules-list breakpoint is stale; the real one is ≤ 1023 px | Named in §22.10's supersession table |
| AJ7 / AJ8 | MINOR | Selected-vs-focus ring similarity in the picker; a hanging separator at 390 and the stale rail on the gone-rule state | Accepted as preferences and left as drawn — the reviewer explicitly classified them as not gating, and each is a deliberate B1 economy |

<!-- LERUX_PR60_REVIEW_7 -->

#### LERUX-1 post-PR #60 pass 7 (fresh reviewer): verdict ACCEPT_WITH_CHANGES (0 BLOCKER, 1 MAJOR, 7 MINOR)

The reviewer again compiled a harness against `backend/target/classes` and ran the real `TagColorPolicy` over the
pack the prototype draws — and that is what caught the MAJOR. Findings, all fixed:

| ID | Severity | Finding | Fix |
|---|---|---|---|
| AK1 | MAJOR | **The fix for AH1 broke three states.** Giving the shared `conflicts` pack a `card-issuer-callback` rule tagged `external-api` in RED made that one pack contain a tag-colour clash — so `68`, `70` and `71` drew an import the real policy refuses (`rules[…].displayColor — Tag "external-api" is already shown in PURPLE`) with no conflict chip, no panel and no blocker, while `91` drew the same pack *with* all three. One file, two stories | The clash now has a pack of its own, `partner-integration-rules.json`, used only by `91`; `shared-integration-rules.json` returns to `['issuer']` and is a pack production would accept. Verified by running the real policy over every pack outcome: `base` 0 conflicts, `clean` 0, `conflicts` 0, `colourConflict` exactly 1, naming `external-api`. Verified by rendering: `68`/`70` carry four count chips and no colour blocker, `91` carries five and two blockers, `71`'s banner names the pack from `68` |
| — | (same fix) | The colour panel credited "Acquirer partner call" as the existing claimant, but that rule is itself in the pack; the real error names `acquirer-response-details` | The panel names both purple rules, and the second resolution says how many saved rules it would rewrite |
| AK2 | MINOR | §22.11 had no row for Detect's evidence tables and coverage bars, which production renders as three plain `<ul>` lists and one sentence (`RuleEditor.tsx`) | Added as **A13**, frontend-only, no new data |
| AK3 | MINOR | README still said "§22.11 (A1–A9)" and "the largest is A1" after the A1a/A1b split and the A10–A12 additions | Corrected to A1a, A1b, A2–A13, and the largest row named as A1b — the only one that is not frontend-only |
| AK4 | MINOR | The Contents table pointed at §21 (superseded) and the owner action said D0–D16 | §22 named first with §21 marked as what it supersedes; D0–D40, with D39 and D40 spelled out as the two that block drawn states |
| AK5 | MINOR | `86`'s narrative — five conditions and zero extracted values — is unreachable through "Use this suggestion" | The state says on the page that its conditions were written by hand, which is the path that reaches it |
| AK6 | MINOR | At 390 px `89`'s third coverage column sits outside the viewport | Left as drawn: the column is inside a `.cov-wrap` with `overflow-x: auto` (measured `scrollWidth` 520 / `clientWidth` 332), which is the table-scroll invariant of CLAUDE.md §4, not a clip. Recorded rather than silently accepted |
| AK7 | MINOR | §22.6's caveat was width-scoped and the width was wrong | Measured at seven widths: the rail is never hidden — its **draft panel** collapses below 1440 px — and the *extend* frame carries no scope block at **any** width. Both exceptions now stated, and the pass-3 row that introduced the wrong bound is corrected in place |
| AK8 | MINOR | `92`'s label said "one tag per row" beside a row drawing `+2` | Label says what it draws: the first tag as a chip plus a neutral `+N` |

Re-verified after the fixes: **222 captures, 0 layout problems, 174 axe runs, 0 violations**; Impeccable detector
0 anti-patterns (2 pre-existing `#000` mask-image advisories).

<!-- LERUX_PR60_REVIEW_8 -->

#### LERUX-1 post-PR #60 pass 8 (fresh reviewer): verdict ACCEPT_WITH_CHANGES (0 BLOCKER, 2 MAJOR, 4 MINOR)

The widest sweep yet — **all 96 states × 6 viewports**: 0 page overflows, 0 geometry violations (max
header-vs-body delta **0.000 px**), 0 page errors, 0 axe violations at 1440 including `target-size`, with an
injected-`<img>` canary proving the axe harness was live rather than silently passing. The reviewer independently
re-ran the real `TagColorPolicy` over the fixture extracted from a rendered page and confirmed every drawn pack
is accepted or refused exactly as drawn. Findings, all fixed:

| ID | Severity | Finding | Fix |
|---|---|---|---|
| AL1 | MAJOR | **`91` drew a resolution the shipped policy refuses, and called it safe.** *Change every "external-api" rule to Red* would recolour `acquirer-partner-call` and `acquirer-response-details` — but both also carry `partner`, held in PURPLE by `acquirer-decline`, so the real policy returns two refusals on `partner`. The panel's *"either answer is safe"* was false as drawn. Not the D39/A1b caveat: the **end state** violates an invariant that already ships | The cascade is now the design, because it is the truth: the option reads *Change "external-api" to Red everywhere*, states that `Acquirer decline` is repainted too although it does not carry that tag, counts the rules and explains why the halfway state is refused. *Two details in this row were still wrong and were corrected in pass 9 — see AM2 and AM3: the reach is four rules but only three are repainted, and `pci` turns Red on only one branch of the separate rule-conflict choice.* The reassurance now distinguishes **safety** from **reach**. Verified with the real policy: Keep Purple ACCEPTED; resolution 2 as previously drawn REFUSED (2 errors on `partner`); resolution 2 with the cascade ACCEPTED |
| AL2 | MAJOR | **§22.5, §22.9 and `COMPONENT_INVENTORY` still named *Keep Blue* / *"middleware"* / *Use Blue*** after the fixture was rewritten, so §22.9 and §22.11 made directly contradictory statements about the same named state — and `COMPONENT_INVENTORY` is what a B6 slice builds from | All three updated to the rendered pair (*Use Purple* / *Rename this tag…*; on import *Keep Purple* / *Change "external-api" to Red everywhere*), and §22.9 gained the cascade paragraph with its policy evidence |
| AL3 | MINOR | §22.7 and `COMPONENT_INVENTORY` still specified the *extend* flow's "18 matching events" and `Found in 17 / 18` for state `85`, re-introducing in the normative spec the leak AJ1 closed in the render | Both corrected to 17 of 200 and `17 / 17`, each stating that the create and extend flows keep separate samples |
| AL4 | MINOR | §22.2 said the multi-colour case "is what states `92`/`93` draw" — measured, every Tags cell in both draws one chip plus a neutral `+N`, which is what §22.3 specifies | Points at `45-inspector-multiple-classifications` (measured: purple, purple, blue on one event) and says explicitly that the table draws one colour per row by design |
| AL5 | MINOR | Detect said *"0 of 181 other events that were read"* beside *"Read 200"*; 181 is 198 − 17, the with-a-message subset, so "read" meant 200 on one line and 198 on another | Checked against `PatternDetector` (`other` is drawn from the values that carry the field, so 181 is the right number): the **rendered** sentence now says "other events with a message" and reconciles 17 + 181 = 198 against the 200 read. *The normative §21.7 spec still carried the old wording and was missed here; pass 9 caught it as AM1.* |
| AL6 | MINOR | §22.11's preamble read as an absolute index, but two prototype additions are tracked elsewhere (Inspector tag casing; the Replace-all enumeration and *What applying does* column) | The preamble is scoped to §22 and cross-references §21.11 / D24 and `CURRENT_BASELINE_INVENTORY.md` §14 C-19 / C-7, which do carry them |

Re-verified after the fixes: **222 captures, 0 layout problems, 174 axe runs, 0 violations**; state `91` measured
at 1440/768/390 with no overflow; Impeccable detector 0 anti-patterns (2 pre-existing `#000` advisories).

<!-- LERUX_PR60_REVIEW_9 -->

#### LERUX-1 post-PR #60 pass 9 (fresh reviewer): verdict ACCEPT_WITH_CHANGES (0 BLOCKER, 2 MAJOR, 6 MINOR)

The reviewer re-derived the pass-8 cascade independently against the real `TagColorPolicy` and reproduced all six
branches, including the halfway-state refusal — then found that the fix had not reached one normative document, and
that one of its consequences is branch-dependent. 96 states × 6 viewports: 0 overflow, 0 geometry deviations, 0 axe
violations at 1440, with the instrument validated (24–27 `passes` per state) before its zeros were trusted. All 13
§22.11 rows were re-verified against `6e71af8` source and **no addition was found without a row**. Findings, all
fixed:

| ID | Severity | Finding | Fix |
|---|---|---|---|
| AM1 | MAJOR | **§21.7 still specified the sentence AL5 said was fixed.** The render said "other events with a message"; the normative *Suggested rule* spec a build slice works from still said "…other events **that were read**" beside "Read 200" — 200 − 17 = 183, not 181. Exactly the package's declared failure mode, with a README row asserting the fix | §21.7 carries the rendered wording and the 198-vs-200 reconciliation; the AL5 row above is corrected rather than left standing |
| AM2 | MAJOR | **`91` asserted `pci` turns Red, which is false on one of two live branches.** `pci` exists only on the *imported* `Acquirer partner call`; the rule-conflict choice on the same screen is Required and unanswered, so under *Keep existing* `pci` is not in the rule set at all. The panel whose whole purpose is exact disclosure of reach stated an unconditional consequence — replicated across four more documents | The clause is scoped to its branch on the page and in §22.9, D39, `COMPONENT_INVENTORY` and the README row. Verified with the real policy on **both** branches: cascade ACCEPTED either way, `pci=RED` only under *Use imported* |
| AM3 | MINOR | "repaints four" over-counted: three saved rules change colour; the fourth arrives in Red | "four rules reached, three of them repainted", in the panel and §22.9 |
| AM4 | MINOR | `Suggestion · nothing saved` survived in §22.7 and `COMPONENT_INVENTORY` after AF7 declared one spelling | Both say *Suggestion · not saved*, matching §21.7 and the render |
| AM5 | MINOR | §22.6's stat row said *Sampled · With this field · Similar*; the render and §21.7 both say *Read · With a message · Similar to this event*, and the bounded-sample sentence it cited renders only on Test and extend steps | §22.6 carries the rendered labels and attributes the sentence to the steps that show it |
| AM6 | MINOR | The tag-colour-conflict count was drawn only when non-zero, so a clean pack gave no evidence the check ran — against §21.11's "a zero count is dashed and tertiary" and §22.9's claim that it is a peer of the other four outcomes | Always drawn; measured on `67`/`68`/`69` as `Tag colour conflicts 0` and on `91` as `1` |
| AM7 | MINOR | `aria-label` on a plain `<div>` (Active filters) is prohibited on the `generic` role, so the name never reaches the accessibility tree — axe needs-review, not a violation | Prototype draws `role="group"`. **This is a production defect**, not a prototype slip (`ActiveFilters.tsx:78`), so it is recorded as `CURRENT_BASELINE_INVENTORY.md` **C-25** rather than silently corrected |
| AM8 | MINOR | `partner-integration-rules.json` claimed one tag in two colours *inside itself*, so `compileAll` means no installation could have held or exported it — yet the state labels it "Exported 2026-09-15" | The pack's own `Acquirer partner call` no longer claims `external-api`. Verified: the pack **on its own** is now ACCEPTED, while merging it still refuses on `external-api` under both branches — a file an installation could really have exported, clashing only with this server |

Re-verified after the fixes: **222 captures, 0 layout problems, 174 axe runs, 0 violations**; Impeccable detector
0 anti-patterns (2 pre-existing `#000` advisories).

