# Modern Developer Console: Visual Design Package

**Status: design proposal awaiting owner visual approval.** Nothing in this folder is production code. The production
frontend (`frontend/`) and backend (`backend/`) are unchanged.

| | |
|---|---|
| Direction | **B, Modern Developer Console**, owner-approved. A/B/C discovery was not repeated. |
| Functional baseline | latest `main` `3f6b1b4bc30c282e0cd1e65510697ff128d79d73` |
| PR #54 | Design history only: research, old Direction B, principles, Impeccable setup. Not merged. |
| Recommended treatment | **B1 Instrument Neutral** (light primary + defined dark companion). Not auto-approved. |
| Recommended production branch | `ux/v2-modern-developer-console`, to be created from latest `main` after owner approval |
| Deferred lane | `SEARCH_PERFORMANCE_ROOT_CAUSE`: not investigated. Loading visuals do not claim to fix latency. |

## Contents

| Document | Purpose |
|---|---|
| [`CURRENT_BASELINE_INVENTORY.md`](CURRENT_BASELINE_INVENTORY.md) | What latest `main` does today, screen by screen: new screens and workflows since PR #54, and design risk notes |
| [`baseline/`](baseline/README.md) | 31 real BEFORE screenshots of `main`, plus `measurements.json` |
| [`CURRENT_MAIN_VISUAL_AUDIT.md`](CURRENT_MAIN_VISUAL_AUDIT.md) | Evidence-based audit of `main`, what to preserve, functional gaps G1–G5 |
| [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) | Philosophy, three product modes, tokens for four value sets with computed contrast, type, spacing, density, radii, elevation, icons, controls, tables, tabs, chips, panels, code, focus, selection and trigger, status, responsive, dark/light decision, accessibility, detector triage |
| [`MOTION_SYSTEM.md`](MOTION_SYSTEM.md) | Motion tokens, per-interaction specs, reduced-motion table, budget rules |
| [`COMPONENT_INVENTORY.md`](COMPONENT_INVENTORY.md) | Every production component classified KEEP / RESTYLE / RECOMPOSE / REPLACE_VISUALLY / DEPRECATE_AFTER_IMPLEMENTATION |
| [`VISUAL_TREATMENT_COMPARISON.md`](VISUAL_TREATMENT_COMPARISON.md) | B1 vs B2 vs B3 on the 12 required criteria, with the recommendation |
| [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) | Slices V2-B1 to V2-B7, per-slice gates, owner decisions D0–D16, deferred lanes |
| [`prototype/`](prototype/) | Static HTML/CSS/JS prototype: 40 states, 3 treatments plus dark companion |
| [`screenshots/`](screenshots/) | 88 captures of the prototype, plus `capture-report.json` |

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
| `screenshots/b1/` | All 40 states, B1 light, 1440×900 | 40 |
| `screenshots/b1-dark/` | 01, 04, 09, 11, 13, 18 in the B1 dark companion | 6 |
| `screenshots/b2/` | The same six states in B2 Night Bench | 6 |
| `screenshots/b3/` | The same six states in B3 Enterprise Workbench | 6 |
| `screenshots/responsive/` | 01, 04, 09, 13, 16, 18 at 1920×1080, 1366×768, 1024×768, 768×1024, 390×844 (1440 is in `b1/`) | 30 |
| **Total** | | **88** |

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

Review this package. Approve the recommended B visual treatment, or choose B2 or B3, and decide D0–D16 in
`IMPLEMENTATION_PLAN.md` §3 before any production implementation starts.
