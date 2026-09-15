# Current-main visual baseline (BEFORE)

Real rendered screenshots of latest `main` (`3f6b1b4`), used as the BEFORE
reference for the Modern Developer Console redesign. Captured
2026-09-15 against the real backend (`SPRING_PROFILES_ACTIVE=dev`) and the
real Vite dev server, **Fixture source** only, one Chromium instance,
`deviceScaleFactor: 1`. Nothing here is a mockup.

- **Route-mocked** states are marked; everything else is real backend data.
- Field-mapping state changed for a capture (states 10, 16, 17) was reset to
  defaults afterwards (`POST /api/v1/settings/field-mapping/reset?sourceId=fixture`).
- Fixture data is synthetic (`fixture.userNN`, `FAKE-CIF-…`, `DEMO-…`); no
  real customer data or credentials appear.
- Default time preset renders as **Last 1 day** on this build.

Measurements: [`measurements.json`](measurements.json) (states 01 and 04 at 1440×900).

## Index

| File | State | How reached | Route-mocked | Notes (broken / clipped / notable) |
|---|---|---|---|---|
| `01-search-results-1440x900.png` | Search + populated results | Select Fixture, Search | no | Actions column header clipped at right edge ("ACTION"); Correlation/Trace values truncated (`fixture-tra…`). No page-level overflow. |
| `01-search-results-1366x768.png` | Same at 1366×768 | same | no | Search placeholder truncated; Actions header clipped. |
| `01-search-results-390x844.png` | Same at 390×844 | same | no | Shell actions wrap to 3 rows; toolbar wraps to 5 rows; results start ~640px down — only ~3 rows visible. Table scrolls inside its wrapper (no page overflow). |
| `02-search-running-1440x900.png` | Search in flight | Search request delayed 15s via `page.route` | **yes (delay only)** | Only a centered "Searching…" line + dimmed button; no skeleton, nothing about scope/source being searched. |
| `03-search-error-1440x900.png` | Search failure | Search response replaced with HTTP 500 problem+json | **yes** | Title and detail both read "Search failed" (duplicated) — the detail comes from the mocked `detail`, but there is no secondary guidance line. Retry present. |
| `04-inspector-overview-1440x900.png` | Results + Inspector, Overview | Search, click first row | no | Inspector 420px; table loses User/Customer (clipped) and everything right of it — horizontal scroll inside table. Tabs wrap to 2 rows. Overview is label-over-indented-value list with dividers. "Source: —". |
| `04-inspector-overview-1366x768.png` | Same at 1366×768 | same | no | Same clipping; "Use…" cut at table edge. |
| `04-inspector-overview-1024x768.png` | Same at 1024×768 | same | no | Inspector becomes a full-height overlay with scrim covering the table; shell actions wrap; search input moves to its own row. |
| `04-inspector-overview-390x844.png` | Same at 390×844 | same | no | Inspector fills the viewport; logger value breaks mid-word (`notificationwork / er.App`). |
| `05-inspector-actor-client-1440x900.png` | Inspector, Actor & client | row → tab | no | Label "Protected / masked - never revealed" is shown while CIF/Username/Customer ID values render **unmasked** (masking defaults to off since SSMP-6) — the label reads as contradictory. |
| `06-inspector-request-flow-1440x900.png` | Inspector, Request flow | row → tab | no | IDs + text-link actions (Find same Correlation / View Trace / View Span / Find same Event / Copy) right-aligned under each value; large empty area below. |
| `07-inspector-business-error-1440x900.png` | Inspector, Business & error (ERROR row) | first ERROR row → tab | no | Stack trace in a pink box with red monospace text; error code `ERR_NONE` on an ERROR event (fixture data). |
| `08-inspector-technical-1440x900.png` | Inspector, Technical / all fields | row → tab | no | Only a collapsed "ALL FIELDS — 30 fields…" disclosure; panel otherwise empty. |
| `09-investigation-trace-1440x900.png` | Investigation: Trace | Request flow → View Trace | no | This row's trace has 1 event (fixture data), so the timeline is a single card. Summary strip (Errors/Warnings/First→Last/Gaps), non-causality notice in amber box, root card dashed-outlined with "Selected event" tag. Toolbar/filters remain visible above. |
| `10-investigation-journey-1440x900.png` | Investigation: Journey (4 events, 4 services, 4 traces) | Journey ID mapping configured via PUT+save (no default), Request flow → Find same journey | no | Per-service colored left rails; root event last, dashed outline. Each card repeats full Trace/Span/Correlation/Event IDs + a "Show Surroundings" button in monospace. Mapping reset afterwards. |
| `11-surrounding-context-1440x900.png` | Show Surroundings (±30s) | Row Actions → Show Surroundings | no | **Page auto-scrolls** (scrollY 151) so the shell and toolbar are off-screen; context header, 9-metric summary, gap list, non-causality note, then the same results table with gap rows ("Gap detected — 6s with nc…" truncated in the Time column). Root row at bottom, dashed outline. Active filters show an injected `Service: payments-api` chip. |
| `12-more-filters-1440x900.png` | More filters drawer | Search → More filters | no | Right drawer (~420px) overlays the table's right columns; fields in groups with "EXACT MATCH" per field; list continues below fold (Journey ID input cut, drawer scrolls); Reset/Cancel/Apply footer. |
| `13-service-exclude-1440x900.png` | Services popover in Exclude mode, 2 selected | Search → Services → Exclude selected → tick 2 | no | Trigger reads "All except 2 services (2)"; popover covers the active-filter summary chip; search placeholder truncated ("users or pas"). |
| `13b-service-exclude-summary-1440x900.png` | Exclude applied, popover closed, re-searched | as 13, Escape, Search | no | Summary chip "Excluding: accounts-api, gateway"; count line switches to "Showing 122 of 122" wording. |
| `14-mapping-workspace-1440x900.png` | Log schema & field mapping, default | Shell → Log schema & field mapping | no | Narrow centered column (~930px) with wide empty margins; one tall card per field (~140px); intro copy still says an inherited default "starts Unverified" while every default badge shows **Verified** (stale copy). Toolbar still visible above. |
| `15-mapping-after-scan-1440x900.png` | Mapping after Quick Schema Scan | Run Quick Schema Scan | no | Scan summary prose, "not observed: journeyName" notice, sample select + JSON block; Discovered Source Schema below fold. |
| `16-mapping-field-edited-1440x900.png` | UI Identifier edited, unsaved | Scan → picker adds `uiIdentifier` | no | Page scrolled into the field list; "Unverified" + dashed "Unsaved changes" badges; Verify disabled with explanation; every card repeats full-width picker + Add + Advanced disclosure. |
| `17-mapping-needs-change-unmapped-1440x900.png` | Trace ID NEEDS_CHANGE beside unmapped Journey ID | `POST /fields/traceId/needs-change`, scroll | no | "Needs change" amber-outlined badge; Journey ID "Unverified" + "Not mapped yet."; badges differ mainly by border color. "Run a Quick Schema Scan first" hint on the non-verified rows. Reset afterwards. |
| `18-settings-docker-1440x900.png` | Docker settings popover | Shell → Docker settings | no | Popover over empty canvas ("Run a search to see r…" hidden behind); read-only summary in monospace, restart note, Test connection form. |
| `19-settings-openshift-1440x900.png` | OpenShift connection popover | Shell → OpenShift | no | "Not connected"; proxy radios; `oc login` textarea; disabled Connect. Custom proxy radio has no visible spacing before "Paste your oc login command". |
| `20-settings-privacy-masking-1440x900.png` | Privacy & masking popover | Shell → Privacy & masking | no | All five checkboxes unchecked (default unmasked) + warning box. |
| `21-live-running-1440x900.png` | Live running | Live | no | Red top rule, red "LIVE" pill, card-per-event feed with service-colored rails; historical toolbar remains above; malformed line shows "— — —" meta. |
| `22-live-paused-1440x900.png` | Live paused | Live → Pause | no | Amber "PAUSED" pill, "Buffered while paused: 9"; large empty canvas under 4 cards. |
| `23-no-results-1440x900.png` | No results | free text `zz-no-such-event-qq`, Search | no | Orphan "Refresh" at top-left, collapsed Query details, then "No results for this range. Search last 1 day" — offered even though the range already is Last 1 day. |
| `24-keyboard-shortcuts-1440x900.png` | Keyboard shortcuts help | Search → shortcuts button | no | Popover 518px tall with 932px content (internal scroll); last row cut mid-line at the fold ("an event is selected)"). |
| `25-table-settings-1440x900.png` | Table settings (density + columns) | Search → Columns | no | Density toggle, drag handles + ↑/↓ per column, 6 default columns checked + optional Logger/Thread/Trace ID/Span ID/Correlation ID; list scrolls internally. |

**BLOCKED:** none — every requested state was reached for real (02/03 use route
mocking only to make the loading/error state observable).

## Key measurements (1440×900)

| Metric | 01 Search | 04 + Inspector |
|---|---|---|
| Shell header height | 62px | 62px |
| Toolbar height | 62px | 62px |
| Active-filters row height | 25px | 25px |
| Table top (y) | 272px | 291px |
| Table header row | 34px | 34px |
| Body row height | 45px (Comfortable) | 45px |
| Body rows fully visible in viewport | 13 | 12 |
| Rows in DOM | 200 | 200 |
| Table cell font-size / line-height | 12px / 17.4px | same |
| Inspector width | — | 420px |
| Page horizontal overflow | no | no |

Colors: text is dominated by `#1a1d23` (primary), `#868d99` (tertiary),
`#5b6270` (secondary); backgrounds `#ffffff` / `#f7f8fa` / `#f0f2f5` plus the
severity dot/rail colors (`#1a5e9a` info, `#8a5a00` warn, `#b3261e` error,
`#7a5ba6` trace). Fonts: the system sans stack and the `ui-monospace` stack
only. Font sizes in use are overwhelmingly 12px and 13px.
