# Current `main` Visual Audit — BEFORE the Modern Developer Console

Evidence-based visual audit of latest `main`
(`3f6b1b4bc30c282e0cd1e65510697ff128d79d73`). The only functional baseline is `main`. PR #54
(`ux/v2-professional-redesign`) is used as design history only.

- **Evidence.** 31 real screenshots and layout measurements are in [`baseline/`](baseline/README.md). They were
  captured with the real backend (`SPRING_PROFILES_ACTIVE=dev`, Fixture source) and the real Vite dev server at
  `deviceScaleFactor: 1`. States 02 and 03 used route mocking only, to hold the loading and error states on screen.
- **Method.**
  - Every screenshot was reviewed individually.
  - DOM measurements come from `baseline/measurements.json`.
  - Each observation below cites the file it was seen in.
  - What exists functionally is in [`CURRENT_BASELINE_INVENTORY.md`](CURRENT_BASELINE_INVENTORY.md).
- **Scope.** This is a visual and interaction audit. It does not re-judge Directions A/B/C (Direction B is
  owner-approved) and does not investigate search latency (lane `SEARCH_PERFORMANCE_ROOT_CAUSE`, deferred).

Each finding has a **Class**:

| Class | Meaning |
|---|---|
| `VISUAL_WEAKNESS` | Works, but the presentation slows scanning or reading |
| `FUNCTIONAL_GOOD_VISUALLY_WEAK` | Correct and complete behaviour hidden behind weak presentation |
| `LAYOUT_DEFECT` | Clipping, wrapping or scrolling that loses information |
| `COPY_DEFECT` | Words contradict the actual state |
| `FUNCTIONAL_GAP` | Behaviour inconsistency found while auditing; not a visual matter; flagged, not fixed |

Each finding also has a **Severity**: HIGH (slows the core investigation loop or misleads), MEDIUM (friction), or
LOW (polish).

## 1. Measured density (1440×900)

| Metric | 01 Search | 04 + Inspector | Source |
|---|---|---|---|
| Shell header | 62 px | 62 px | `measurements.json` |
| Toolbar | 62 px | 62 px | " |
| Active-filters row | 25 px | 25 px | " |
| Table top | 272 px | 291 px | " |
| Header row / body row | 34 / 45 px | 34 / 45 px | " |
| Body rows fully visible | **13** | **12** | " |
| Cell text | 12 px / 17.4 px, `ui-monospace` | same | " |
| Inspector width | — | 420 px | " |
| Fonts in use | system sans + `ui-monospace` only | | " |

Before the first event, 272 px of the 900 px viewport (30 %) is chrome. Every cell of the results table uses a
monospace stack, so messages, service names and IDs have the same texture, and only 13 events fit on a laptop-class
screen.

## 2. Findings

### 2.1 Shell and query bar

| # | Evidence | Observation | Class | Sev |
|---|---|---|---|---|
| S1 | `01-search-results-1440x900` | The shell spends 62 px on the title plus four bordered buttons (Privacy & masking, Log schema & field mapping, Docker settings, OpenShift) that all look the same as the primary actions. Settings look as important as Search. | VISUAL_WEAKNESS | MEDIUM |
| S2 | `01-…1440x900` | The toolbar puts Source, Services, Time, eight severity pills, the text search, Search, Live and More filters in one 62 px row. The severity pills (All, Errors only, Trace, Debug, Info, Warn, Error) are the most colourful thing on screen and outweigh the Search button. | VISUAL_WEAKNESS | HIGH |
| S3 | `01-…1366x768`, `13-service-exclude` | The search placeholder is cut ("users or pas…") at 1366 px and whenever a popover label grows. | LAYOUT_DEFECT | LOW |
| S4 | `01-search-results-390x844` | At 390 px the shell wraps to 3 rows and the toolbar to 5. Results start about 640 px down, so about 3 rows are visible. | LAYOUT_DEFECT | HIGH |
| S5 | `13-service-exclude` | EXCLUDE works and is worded ("All except 2 services (2)", then "Excluding: accounts-api, gateway"). But the open popover covers the active-filter summary, and the trigger's "(2)" count repeats the "2" in its own label. | FUNCTIONAL_GOOD_VISUALLY_WEAK | MEDIUM |
| S6 | `12-more-filters` | The More filters drawer (~420 px) overlays the table's right columns. Every field repeats an "EXACT MATCH" caption. Journey ID is cut at the fold, so the drawer scrolls. | VISUAL_WEAKNESS | MEDIUM |
| S7 | `24-keyboard-shortcuts` | The shortcuts popover is 518 px tall holding 932 px of content, and its last row is cut mid-line at the fold. | LAYOUT_DEFECT | LOW |
| S8 | all | Icons are Unicode glyphs (`🕐 ⌨ ⓘ … ✕ ↻ ⠿ ▲ ▼ ↕ ⚠`). Their rendering, weight and baseline vary by OS font; ⌨ renders as a coloured emoji on some systems. | VISUAL_WEAKNESS | MEDIUM |

### 2.2 Results table

| # | Evidence | Observation | Class | Sev |
|---|---|---|---|---|
| R1 | `01-…1440x900` | The Actions column header is clipped at the right edge ("ACTION"), and Correlation/Trace values are truncated to `fixture-tra…`. The ID an investigator most needs to compare is the one cut. | LAYOUT_DEFECT | HIGH |
| R2 | `01-…1440x900` | At 45 px, rows repeat "Sep 15, 2026," and a "User:"/"Trace ID:" prefix on every line. Scanning reads the same prefix 200 times. | VISUAL_WEAKNESS | HIGH |
| R3 | `01-…1440x900` | Severity is a dot plus an uppercase word in the same weight for INFO, WARN and ERROR, plus a 3 px left rail on WARN/ERROR rows. INFO is as loud as ERROR in the Level column. | VISUAL_WEAKNESS | MEDIUM |
| R4 | `01-…1440x900` | Every row carries a bordered "…" button. That makes 13 identical boxes in one column, which draws the eye away from messages. | VISUAL_WEAKNESS | LOW |
| R5 | `01-…1440x900` | The count line reads as one long sentence: "Showing 200 events loaded — total unknown for this source, more available — showing results for Sep 14, 4:39 PM – Sep 15, 4:39 PM". The counts are honest but hard to parse. | FUNCTIONAL_GOOD_VISUALLY_WEAK | MEDIUM |
| R6 | `01-…1440x900` | "Query details" is a full-width disclosure bar that takes a row above the table even when collapsed. | VISUAL_WEAKNESS | LOW |
| R7 | `02-search-running` | Loading shows only a centred "Searching…" and a dimmed button. It does not say what is being searched or show any placeholder structure. | VISUAL_WEAKNESS | MEDIUM |
| R8 | `03-search-error` | The error title and detail both read "Search failed", with no guidance line. | COPY_DEFECT | LOW |
| R9 | `23-no-results` | An orphan "Refresh" sits top-left. "No results for this range. Search last 1 day" is offered while the range already is Last 1 day. | COPY_DEFECT | MEDIUM |
| R10 | `25-table-settings` | Density and column settings work (drag handles, ↑/↓, optional columns), but the popover's list scrolls internally and uses glyph handles. | FUNCTIONAL_GOOD_VISUALLY_WEAK | LOW |

### 2.3 Inspector

| # | Evidence | Observation | Class | Sev |
|---|---|---|---|---|
| I1 | `04-inspector-overview-1440x900` | The 420 px Inspector pushes User/Customer, Correlation/Trace and Actions out of view, so the table scrolls horizontally inside its wrapper while an event is open. | LAYOUT_DEFECT | HIGH |
| I2 | `04-…1440x900` | The five fixed tabs wrap onto two rows ("Business / error", "Technical / all fields" on row 2). That breaks the one-row tab idiom and spends about 48 extra px. | LAYOUT_DEFECT | HIGH |
| I3 | `04-…1440x900` | Overview is a label-over-indented-value list with a divider per field, so about six fields fill the panel height. "Source: —" appears for a Fixture event. | VISUAL_WEAKNESS | MEDIUM |
| I4 | `04-…390x844` | The logger value breaks mid-word (`notificationwork / er.App`). | LAYOUT_DEFECT | LOW |
| I5 | `05-inspector-actor-client` | "Protected / masked - never revealed" appears above CIF, Username and Customer ID values that render **unmasked** (masking defaults to off since SSMP-6). The label contradicts what is on screen. | COPY_DEFECT | HIGH |
| I6 | `06-inspector-request-flow` | Each ID is followed by right-aligned text links (Find same Correlation / View Trace / View Span / Find same Event / Copy). The actions work but have no visual grouping, and a large empty area sits below them. | FUNCTIONAL_GOOD_VISUALLY_WEAK | MEDIUM |
| I7 | `07-inspector-business-error` | The stack trace is red monospace text in a pink box. A whole block in error red is hard to read and carries no extra meaning. | VISUAL_WEAKNESS | MEDIUM |
| I8 | `08-inspector-technical` | The tab shows only a collapsed "ALL FIELDS — 30 fields…" disclosure, leaving the panel otherwise empty. One extra click is needed on the tab meant for technical depth. | VISUAL_WEAKNESS | MEDIUM |

### 2.4 Investigation and Context

| # | Evidence | Observation | Class | Sev |
|---|---|---|---|---|
| V1 | `10-investigation-journey` | A 4-event journey is four ~104 px cards. Each repeats the full Trace/Span/Correlation/Event IDs and a monospace "Show Surroundings" button. It shows no timeline and does not show the time between events at a glance. | FUNCTIONAL_GOOD_VISUALLY_WEAK | HIGH |
| V2 | `09-investigation-trace`, `10-…` | Root anchoring works: "Selected event: 4 of 4", with a dashed outline and a "Selected event" tag. It is conveyed only by a dashed box, which reads as a drop target. | FUNCTIONAL_GOOD_VISUALLY_WEAK | MEDIUM |
| V3 | `09-…`, `10-…` | The historical toolbar and filter chips stay above the investigation, so the investigation looks like a filtered search rather than a distinct mode. | VISUAL_WEAKNESS | MEDIUM |
| V4 | `10-…` | Service identity is a coloured left rail plus a coloured service name. It is paired with the name (good), but the rail colours compete with the severity rails used in the results table. | VISUAL_WEAKNESS | LOW |
| C1 | `11-surrounding-context` | Opening Surroundings **auto-scrolls the page** (scrollY 151), so the shell and toolbar leave the screen. The investigator loses the Back target and scope. | LAYOUT_DEFECT | HIGH |
| C2 | `11-…` | A 9-metric summary, a gap list and a non-causality note stack before the table. The gap rows' text is truncated inside the Time column ("Gap detected — 6s with nc…"). | VISUAL_WEAKNESS | MEDIUM |
| C3 | `11-…` | The Context view injects a `Service: payments-api` chip that looks like any other user filter. | VISUAL_WEAKNESS | LOW |

### 2.5 Field mapping

| # | Evidence | Observation | Class | Sev |
|---|---|---|---|---|
| M1 | `14-mapping-workspace` | A ~930 px centred card column on a 1440 px screen, with ~140 px per field. About 3 of 25 fields fit per viewport, and no summary of how many are verified is visible. | FUNCTIONAL_GOOD_VISUALLY_WEAK | HIGH |
| M2 | `14-…` | The intro copy says an inherited default "starts Unverified", while every default badge shows **Verified** (stale since #57). | COPY_DEFECT | MEDIUM |
| M3 | `16-mapping-field-edited` | Every card repeats a full-width picker, Add and an Advanced disclosure. The edited field's "Unsaved changes" badge is easy to miss in the stack. | VISUAL_WEAKNESS | MEDIUM |
| M4 | `17-mapping-needs-change-unmapped` | Verified, Unverified and Needs change differ mainly by border colour. A colour-vision-deficient user must read every word. | VISUAL_WEAKNESS | MEDIUM |
| M5 | `15-mapping-after-scan` | The sample JSON and discovered schema sit below the fold, far from the field being mapped. | VISUAL_WEAKNESS | MEDIUM |

### 2.6 Settings

| # | Evidence | Observation | Class | Sev |
|---|---|---|---|---|
| T1 | `18`, `19`, `20` | There is no Settings page. Docker, OpenShift and Privacy & masking are three separate popovers over an empty canvas. Their scope (one source vs all sources) is not stated visually. | FUNCTIONAL_GOOD_VISUALLY_WEAK | MEDIUM |
| T2 | `19-settings-openshift` | The Custom proxy radio has no spacing before "Paste your oc login command". | LAYOUT_DEFECT | LOW |
| T3 | `20-settings-privacy-masking` | The five checkboxes are unchecked (the default is unmasked), with a warning box. It is correct, but "checked = masked" is not stated next to the controls. | VISUAL_WEAKNESS | LOW |

### 2.7 Live

| # | Evidence | Observation | Class | Sev |
|---|---|---|---|---|
| L1 | `21-live-running` | A red top rule and a red "LIVE" pill use error red for a healthy running state. | VISUAL_WEAKNESS | HIGH |
| L2 | `21-…` | The feed is a card per event (~90 px), about 7 events per viewport, with a different layout from the results table, so moving between Live and Search means re-learning the layout. | VISUAL_WEAKNESS | MEDIUM |
| L3 | `21-…` | A malformed line renders "— — —" as its meta. | VISUAL_WEAKNESS | LOW |
| L4 | `22-live-paused` | PAUSED is an amber pill, with "Buffered while paused: 9" in body text and a large empty canvas below 4 cards. | VISUAL_WEAKNESS | LOW |

### 2.8 Functional gaps noticed during the audit (not visual; flagged, not fixed)

| # | Evidence | Observation | Disposition |
|---|---|---|---|
| G1 | inventory §11, `ActionsCell`, `InspectorHeader` | Show Surroundings is gated only on timestamp presence, not on the source's `contextView` capability, so it can appear for Loki. | Tracked for owner decision (`IMPLEMENTATION_PLAN.md` V2-B4). The prototype draws it gated. |
| G2 | inventory §11 | "No services" and "no match for the typed filter" share one message (`No services match “”.`). | Tracked (V2-B2). |
| G3 | inventory §11 | No message is rendered when a source list is empty. | Tracked (V2-B7). |
| G4 | `frontend/src/app/App.tsx:163`, `App.tsx:189` | Live is started with `state.selectedServices` and no `serviceFilterMode`, so under Service EXCLUDE the excluded service names are sent as Live's `services` parameter. How the backend treats that parameter was not verified in this design mission. | Tracked for owner decision as a functional lane (`IMPLEMENTATION_PLAN.md` D8). The prototype shows Live's own effective scope rather than implying the search's Include/Exclude applies. |
| G5 | CLAUDE.md §4 vs inventory §10; CLAUDE.md §2.1 vs inventory §8 | These are existing named conflicts, not caused by the redesign. CLAUDE.md says the Live display cap "starts at 1,000", while the product caps at 2,000 (a later decision). The mapping workspace shows Original Event Samples unmasked ("real, unmasked — never persisted", register §19) while CLAUDE.md §2.1 says protected fields are masked before browser serialization. | Recorded, not changed. The design reproduces current product behaviour and copy. |

## 3. What is functionally good and must be preserved

These behaviours are correct on `main` today. The redesign changes their presentation only:

- A 7-column semantic table: one `<colgroup>`, `table-layout: fixed`, header/cell alignment, `—` for missing values,
  newest first, one Load more model, contained horizontal scroll.
- Honest distinct counts (loaded / total unknown / more available / truncated).
- Severity never shown by colour alone (dot plus word).
- Five fixed Inspector tabs that are never hidden; prev/next with an `aria-live` position; Esc precedence; resizable
  panel.
- Request flow actions: Find same Correlation, View Trace, View Span, Find same journey, Find same Event, Copy.
- Root-anchored investigation ("Selected event i of N"), per-entry Show Surroundings, contextual Back labels, and the
  non-causality notices.
- Services Include/Exclude with explicit words; Docker never reads excluded services.
- The mapping workflow order (scan → map → validate → save → verify / needs change), the search gate, owner-approved
  defaults as Verified, Journey ID and UI Identifier left unmapped, and scope isolation.
- Masking enforced on the server, with no reveal action anywhere.
- Live bounds: 2,000 cap, distinct Received/Visible/Buffered counts, pause/resume/stop/clear/follow.
- Capability-driven rendering: Live, Raw LogQL, Project and scan are hidden when a source does not declare them.

## 4. Design implications taken into the Modern Developer Console

| Audit evidence | Design response (see `DESIGN_SYSTEM.md`) |
|---|---|
| 13 visible rows; monospace everywhere (§1, R2) | 28 px compact rows; Inter for prose, JetBrains Mono only for time/IDs/paths; no repeated prefixes. The prototype shows 25 full rows at 1440×900. |
| Severity pills dominate (S2, R3) | A Severity field in the query bar; shape marks in a 22 px gutter; only WARN/ERROR words take colour. |
| Clipped trace IDs and Actions (R1, I1) | Column widths redistributed; identity columns narrow when the Inspector opens; middle-ellipsis IDs keep both ends. |
| Tabs on two rows (I2) | 500 px Inspector with compact underline tabs on one row. |
| Contradictory masking label (I5) | The masking note reflects the actual policy (copy fix, V2-B4). |
| Card-based investigation (V1–V3) | A capture view: mode bar, stat row, a timeline plot with service lanes, and a sequence table anchored on the selected event (the "trigger"). |
| Auto-scroll hides chrome (C1) | Instant scroll of the table body only; chrome is sticky. |
| Card-column mapping (M1–M5) | A field table with an evidence side panel, a process strip and a sticky action bar. |
| Three settings popovers (T1) | One Settings workspace with scope tags. |
| Red LIVE (L1) | Acquisition-state vocabulary: LIVE (success), PAUSED, RECONNECTING, STOPPED, FAILED; the table layout is reused. |
| Unicode glyphs (S8) | One Lucide icon set at 1.75 stroke. |

---

## 5. Addendum — Event classification on `main` `51f06e5` (PR #59)

Evidence: `baseline/classification/` (32 real captures). Findings C-1…C-11 are listed with their classification in
`CURRENT_BASELINE_INVENTORY.md` §13.8. What is functionally good and must be preserved:

- Detection is honest: measured counts (read, with the field, similar, matched/other), a suggestion-only contract and a
  clear NO_SAFE_PATTERN state. No confidence scores.
- The test step never saves, reports bounded counts and extraction coverage, shows borderline events, and ends with
  “Review these matches for false positives.”
- Every write is revision-checked and a conflict keeps the draft.
- Import previews before writing, blocks invalid packs, requires a conflict choice and a Replace-all confirmation.
- Extracted values arrive masked/redacted, render as text, and missing values are never invented.
- Loki is visible but not selectable; no request is made for it as the active source.

Design implications taken into §21 of `DESIGN_SYSTEM.md`: split evidence from suggestion (C-2); move expressions behind
an explicit edit path (C-3); compact test examples beside a result summary (C-4); danger styling for destructive
actions (C-5); stacked rule rows at narrow widths (C-6); one lowercase tag grammar everywhere (C-7); plain-language
matchers (C-8); file name instead of a server path (C-9); UI type for status lines (C-10); tags in results, captures
and Live without breaking the seven-column invariant (C-11). *(Superseded by PR #60: the default set is eight
columns, Tags included — `DESIGN_SYSTEM.md` §22.3, `CURRENT_BASELINE_INVENTORY.md` §14, CLAUDE.md §4.)*

