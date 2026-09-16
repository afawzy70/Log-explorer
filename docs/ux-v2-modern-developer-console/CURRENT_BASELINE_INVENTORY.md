# Current Baseline Inventory — Latest `main`

**Baseline:** `main` @ `51f06e51709455f2c20dcf5c1b32e2dd67443377` (refreshed after PR #59; §1–§12 were written at
`3f6b1b4` and remain accurate except where §13 says otherwise)
**Compared against:** PR #54's frozen design baseline `ed6dbf5` (`functional-baseline-pre-ux-redesign`, #53)
**Method:** read directly from `frontend/src` on latest `main` (not from docs), cross-checked with
`git diff ed6dbf5 origin/main -- frontend/src` and `git log ed6dbf5..origin/main`.

Commits on `main` since PR #54's baseline:

| Commit | PR | What it added to the UI |
|---|---|---|
| `399fe2b` | #55 | Log Schema & Field Mapping workspace (scan, samples, discovered schema, verify / needs-change), project-scoped mapping, mapping-not-ready search gate, root-event anchoring in Investigation, Span investigation, Surroundings-from-Investigation with contextual Back label, "Show Surroundings" / "View Trace" / "Find same …" renames, "Canonical Event JSON" |
| `c74e318` | #56 | Mapping Save now persists drafts (`PUT` per edited field before `/save`); "Unsaved changes" badge; Verify disabled while a draft is pending |
| `3f6b1b4` | #57 | Service Include/Exclude mode + "All except …" / "Excluding: …" summaries; owner-approved default mapping starts Verified (scan hint suppressed for Verified fields) |
| `51f06e5` | #59 | Event Classification rules workspace, Create tag rule from event, Detect pattern, Test rule, structured extraction, Classification section in the Inspector, Classification tags filter and chips, JSON rule pack import/export, source-selector policy with OpenShift Loki visible but not selectable (see §13) |

Flag legend: `NEW_SINCE_PR54` (did not exist at `ed6dbf5`) · `CHANGED_SINCE_PR54` (existed, visibly/behaviourally changed) · `UNCHANGED`.

Capability flags (`SourceCapabilities`, `shared/api/types.ts`): `historicalSearch`, `liveTail`, `rawLogQL`,
`serviceDiscovery`, `queryStatistics`, `contextView`, `composeProjectScoping`, `originalSchemaSampling` (the last is
`NEW_SINCE_PR54`, #55).

---

## 1. Application layout (mode switching)

**File:** `app/App.tsx`, `app/App.module.css` — `CHANGED_SINCE_PR54` (#55)

- Top chrome `[data-app-chrome]` = `Shell` (header) + `Toolbar` (search controls + active-filters row). Always visible,
  in every mode.
- Main row = one **results column** + the **Event Inspector** docked to its right (`EventInspector` is always mounted;
  it renders nothing until an event is selected).
- The results column shows exactly one of, in priority order:
  1. **Field Mapping workspace** (`state.mappingWorkspaceOpen`) — `NEW_SINCE_PR54`
  2. **Live** (`live.connectionState !== 'idle'`)
  3. **Investigation workspace / JourneyView** (`state.journeyQuery`)
  4. **Results panel** (default, also hosts Context/Surroundings)
- Lazy-loaded sections show a status line: `Loading mapping verification…`, `Loading Live…`, `Loading journey…`.
- Switching source or Compose project while Live is active exits Live.
- Design note: these are full takeovers of the same column, not routes — there is no URL state (CLAUDE.md §2 rule 4).

## 2. Shell / global chrome

### 2.1 Shell header — `app/Shell.tsx` — `CHANGED_SINCE_PR54` (#55)
Left → right, wraps (`flex-wrap`), no horizontal scroll:
- `h1` **Log Explorer**
- **EnvironmentBadge** (below)
- **Scope trail** `data-testid="scope-trail"`: source display name, then `›`-separated segments:
  - OpenShift: `Namespace: <ns>` (when discovery API is namespaces) or the project name; `<Kind>: <workload>`; pod;
    container.
  - Docker (`composeProjectScoping`): selected Compose project.
- spacer
- **Privacy & masking** (popover trigger)
- **Log schema & field mapping** button → opens Field Mapping workspace — `NEW_SINCE_PR54`
- **Docker settings** (popover trigger)
- **OpenShift** (secondary button, popover dialog)
- **Keyboard shortcuts** icon button `⌨`
- **SourceHealthBadge**

### 2.2 EnvironmentBadge — `app/EnvironmentBadge.tsx` — `UNCHANGED`
Uppercased backend profile label (e.g. `DEV`), `title="Active backend profile: …"`. Hidden when no label / fetch fails.

### 2.3 SourceHealthBadge — `app/SourceHealthBadge.tsx` — `UNCHANGED`
- States: `Checking…` (loading), `Unknown` (no health), `Healthy` (UP), `Degraded`, `Unhealthy` (DOWN). Dot + word
  (never colour-only). `Retry` ghost button when not UP.
- `ⓘ` opens **Source health details** dialog: Status, Message, Checked (UTC), Latency (`N ms` / `Not measured`),
  Warnings list, Capabilities list (`✓`/`✗` Historical search, Live, Service discovery, Raw query, Context, Stats), Close.
- Health fetch failure is rendered as DOWN with message `Unable to reach the health endpoint`.

### 2.4 Keyboard shortcuts — `app/KeyboardShortcutsHelp.tsx`, `app/useProductivityShortcuts.ts`,
`shared/keyboard/ShortcutRegistry.tsx` — `UNCHANGED`
Dialog **Keyboard shortcuts**, grouped `Search & filters` / `Results & inspector` / `Live` / `Help`, generated from the
live registry (so it never lists a shortcut that is not registered).

| Keys | Action | Condition |
|---|---|---|
| `?` | Open shortcuts help | — |
| `Ctrl/Cmd + Enter` | Run search | works while typing |
| `/` | Focus search box | — |
| `M` | Open/close More filters | — |
| `R` | Refresh | results shown |
| `X` | Show ±30 s context | event selected with timestamp |
| `B` | Back to original search / close journey | in context or journey view |
| `Esc` | Close inspector | inspector open, not consumed by a popover |
| `[` / `]` | Previous / next event | inspector open |
| `↑` / `↓` | Move between result rows | row has focus (listed as scoped) |
| `Enter` / `Space` | Open row / row Actions menu | row / actions focus |
| `P` `S` `C` `F` | Live pause-resume / stop / clear / follow newest | Live is active view |

## 3. SEARCH

### 3.1 Toolbar — `app/Toolbar.tsx` — `CHANGED_SINCE_PR54` (#55 gate, #57 service mode)
Single wrapping row, in this order:
1. **Source** `<select>` (visually hidden label "Source") — `features/search/SourceSelect.tsx` — `CHANGED` in #59:
   fixed order Local Docker → OpenShift → OpenShift Loki — Not available (native disabled option); the
   highest-priority available source is selected on startup (§13.9).
2. **Compose project** select (only when `composeProjectScoping`) — `ComposeProjectSelect.tsx` — `UNCHANGED`.
   Visible label `Compose project`; option `All projects`; disabled while loading or empty; empty copy
   `No Docker Compose projects detected on this Docker engine`; error `Could not list Compose projects: <msg>`.
3. **Services** multi-select — `ServiceMultiSelect.tsx` — `CHANGED_SINCE_PR54` (#57).
4. **Time range** — `features/timerange/*` — `UNCHANGED`.
5. **Severity** — `SeverityFilter.tsx` — `UNCHANGED`.
6. **Universal search** input — `UniversalSearch.tsx` — `UNCHANGED`.
7. **Search** primary button — label `Search` / `Searching…`; disabled while loading, when OpenShift has no project
   selected, or when mapping is not search-ready. `title` explains why.
8. **Live** secondary button — only when `liveTail`; disabled with `title="Select a Project to start Live"` if OpenShift
   scope missing.
9. Inline status hint (`role="status"`): `Configure and validate log field mapping before searching this source.`
   (`NEW_SINCE_PR54`, #55) **or** `Select a Project|a Namespace to search OpenShift`.
10. **More filters** trigger (contains the **Query** trigger inside its panel).

Below: **Active filters row** (`ActiveFilters.tsx`) — `CHANGED_SINCE_PR54` (#57).

### 3.2 Services — `ServiceMultiSelect.tsx`
- Trigger label: `All services` (none selected, either mode) · INCLUDE: `<name>` / `N services` · EXCLUDE:
  `All except <name>` / `All except N services`. Count badge when ≥1 selected.
- Panel dialog "Select services": **Include selected / Exclude selected** `aria-pressed` toggle (`NEW_SINCE_PR54`,
  #57); search box `Search services…` (autofocus); checkbox list with `running/total running` meta; empty copy
  `No services match “<filter>”.` (note: also shown with an empty filter when the source has no service list); footer
  `N selected` + `Clear`.
- Service list is fetched only when `serviceDiscovery`; otherwise empty (OpenShift Direct / Loki).
- Mode is session state; reset to INCLUDE by Clear all; restored when returning from a detour.

### 3.3 Time range — `TimeRangeControl.tsx`, `CustomRangePopover.tsx`, `shared/time/presets.ts`, `label.ts`
- Trigger `🕐 <label>` (+ zone label for custom). Menu `role="menu"` of `menuitemradio`: Last 15 minutes / 30 minutes /
  1 hour / 4 hours / 1 day (default) / 7 days, separator, `Custom…`.
- Custom dialog "Custom time range": `Start` / `End` `datetime-local`, validation `role="alert"`, `Cancel` / `Apply`.
  Dismissable (outside click / Esc = cancel).

### 3.4 Severity — `SeverityFilter.tsx`, `severityLevels.ts`
Group "Severity": quick actions `All`, `Errors only`; chips `Trace`, `Debug`, `Info`, `Warn`, `Error` (dot + text,
`aria-pressed`, tinted when active). Default selection INFO/WARN/ERROR.

### 3.5 Universal search — `UniversalSearch.tsx`, `idDetection.ts`
Placeholder `Search messages, errors, users or paste an ID`. Enter runs search. ID detection (prefix `trace-`, `corr-`,
`journey-`, `event-`, UUID, 16–32 hex) shows status: `This looks like a <Trace ID>. Search as <Trace ID> instead?` with
`Search as <field>` + `✕` dismiss (Esc dismisses).

### 3.6 More filters — `AdvancedFilters.tsx`, `advancedFilterFields.ts` — `UNCHANGED`
- Trigger `More filters` + active-count badge. Panel dialog positioned below the app chrome (full width ≤640 px),
  heading focus on open.
- Fieldsets with per-field `Exact match` / `Contains` hint:
  - **Who / customer** (sensitive): User name, Customer ID, CIF, Device ID, Device IP
  - **Request flow**: Trace ID, Span ID, Correlation ID, Journey ID, Event ID
  - **What happened**: Error code, Business step, UI identifier, Logger / class contains, Message contains
  - **Client context**: Device platform, Language
  - **Advanced query**: the Query builder trigger
- Actions `Reset` · `Cancel` · `Apply` (draft is only committed on Apply).

### 3.7 Query builder — `QueryBuilder.tsx`, `queryAuthoring.ts` — `UNCHANGED`
- Trigger `Query` (+ `●` when active). Dialog tabs `Guided` / `Text` / `Raw LogQL` (Raw tab only when `rawLogQL`).
- Guided: nested groups with `All (AND)` / `Any (OR)`, condition rows (field / operator / value / `✕`), `+ Condition`,
  `+ Group` (depth-limited), `Remove group`, **Generated query** preview (`(no query)`).
- Text: `Query text` textarea, placeholder `service = "gateway" and level = "ERROR"`; switching back to Guided with
  divergent text shows an alertdialog `Keep editing text` / `Discard and switch`.
- Raw LogQL: expert note `Advanced: executed directly against the source, bypassing the generated query. Off by
  default.`; placeholder `{namespace="prod",app="gateway"}`.
- Actions `Clear` · `Cancel` · `Apply`. Switching to a source without `rawLogQL` falls back to Guided without discarding
  the typed text.

### 3.8 Active filters — `ActiveFilters.tsx` — `CHANGED_SINCE_PR54` (#57)
Row "Active filters": `Time range: <label>` chip (always), `Severity: …` chip when non-default, per-service
`Service: <name>` chips (INCLUDE) **or** one summary chip `Excluding: a, b, c` (≤3) / `All services except N services`
(EXCLUDE), one chip per advanced field (sensitive values render **Protected**, never the raw value), each chip with `✕`
remove; `Clear all` always present. Clear all resets criteria but never the source/scope.

## 4. RESULTS

### 4.1 Results panel — `features/results/ResultsPanel.tsx` — `CHANGED_SINCE_PR54` (#55: Back label)
States, in precedence order:
- **Search failed**: alert `Search failed` + message + `Retry search`.
- **Loading**: status `Searching…` (replaces the table).
- **Initial**: `Run a search to see results.`
- **Empty**: `No results for this range.` + `Search last 1 day` (commits 1-day preset and runs), plus `↻ Refresh` and
  Query details.
- **Loaded**: summary row `buildCountsSummary` text (e.g. `Showing 200 events loaded — total unknown for this source,
  more available` / `Showing N of M (truncated)`) + ` — showing results for <interval>`; **Sort** select
  (`Newest first` / `Oldest first`, hidden in context view); **Columns**; `↻ Refresh`; **Query details** disclosure;
  table; **Load more** (`Loading…`) with inline load-more error + `Retry` (existing rows are kept).
- **Breadcrumb** (context view): label + `← Back to original search` or `← Back to <Trace|Span|Correlation|Journey|Event>`
  when Surroundings was launched from an Investigation view (`NEW_SINCE_PR54`, #55).

### 4.2 Query details — `QueryPlanDisclosure.tsx` — `UNCHANGED`
`<details>` "Query details": Executed query (code + `Raw LogQL` badge), Pushed to source, Applied after retrieval, Notes;
honest "None — …" copy when empty.

### 4.3 Results table — `ResultsTable.tsx`, `ResultsTable.module.css`, `columnRegistry.tsx`, `columnMapping.ts`,
`MessageCell.tsx` — `CHANGED_SINCE_PR54` (#55: journey action titles/root event arg)
- One `<table>` + one `<colgroup>`, `table-layout: fixed`, `min-width: 1266px`, inside `results-scroll-wrapper`
  (`overflow-x: auto`; page never scrolls).
- Default visible columns (in order): **Time** (190 px; date part + clock part), **Level** (90; dot + word), **Service**
  (160), **What happened** (elastic; `MessageCell`), **User/Customer** (160; `User:`/`Customer:` label + masked value),
  **Correlation/Trace** (170; button → Investigation, `title` = `View Trace` / `Find same Correlation` …), then
  **Actions** (56, always last, not configurable).
- Optional columns (hidden by default): Logger, Thread, Trace ID, Span ID, Correlation ID, Journey ID, Event ID, Error
  code, Business step, UI identifier, Container, Pod, Namespace, Compose project, Compose service, Device platform,
  Language.
- Missing values render `—`.
- `MessageCell`: `(empty message)` for empty string; malformed rows show raw line + `malformed` badge; `More`/`Less`
  toggle for text > 80 chars.
- Header sort: Time header toggles the single authoritative `sortDirection` (shared with the Sort select); other sortable
  headers apply a client-side column sort (`▲`/`▼`/`↕`, `aria-sort`, visually-hidden instructions). Column sort
  suppresses gap rows. Sorting disabled in context view.
- Row states: `errorRow` (tint + 3 px red inset rail), `warnRow` (3 px amber rail), `selectedRow` (selected bg + 4 px
  accent rail, survives hover), `contextRootRow` (accent bg + 3 px rail + 1 px dashed outline, `aria-current="location"`,
  visually hidden "Original event you were investigating", auto-scrolled to centre), `gapRow` (context only; italic,
  dashed borders, `Gap detected — <dur> with no observed events (<from> → <to>)`).
- Keyboard: roving tabindex (one row tab stop), `↑`/`↓` move rows (or between Actions buttons), `Enter`/`Space` opens
  the inspector; clicks on inner controls do not open it.
- Density `compact` reduces cell padding only.

### 4.4 Row actions — `ActionsCell.tsx` — `CHANGED_SINCE_PR54` (#55 rename)
`…` button "Actions for this event" → menu "Event actions": `View details`, `Show Surroundings` (only when the event
has a timestamp), separator, `Copy <Trace ID|Correlation ID|…>` per available non-sensitive identifier.

### 4.5 Columns / table settings — `TableSettingsControl.tsx`, `tablePreferences.ts` — `UNCHANGED`
Trigger `Columns` → dialog **Table settings**: Density `Comfortable` / `Compact`; Columns list with drag handle `⠿`
(HTML5 drag-and-drop), visibility checkbox, `↑`/`↓` move buttons; hints `Drag a row (⠿) to reorder, or use the ↑/↓
buttons. Actions is always shown, last, and cannot be moved.` and `At least one column besides Actions must stay
visible.`; `Reset table`, `Close`. Persisted in `localStorage` key `logexplorer.tablePreferences.v1` (presentation only).

## 5. INSPECTOR

**Files:** `features/inspector/*` — overall `CHANGED_SINCE_PR54` (#55: action labels, Canonical Event JSON, Show
Surroundings rename)

- **Panel** `EventInspector.tsx`: `role="dialog"` `aria-modal="false"` "Event details", docked right, sticky full height,
  **resizable** 320–720 px (default 420; pointer drag or `←`/`→` on the separator; width not persisted). Close button
  receives focus on open. ≤1024 px: fixed overlay sheet `min(100vw, 420px)` + backdrop (click to close).
- **Header** `InspectorHeader.tsx`: level badge (dot + word, `UNKNOWN` fallback), service, position
  `Event N of M loaded` (`aria-live`), `h1` title (`deriveInspectorTitle`: message collapsed to 140 chars /
  `Malformed log line` / `Error <code>` / `(empty message)`), `← Previous`, `Next →`, **Show Surroundings** (ContextAction),
  close `✕`.
- **Tabs** `InspectorTabs.tsx`: fixed five, never conditionally removed — `Overview`, `Actor & client`,
  `Request flow`, `Business / error`, `Technical / all fields`. WAI-ARIA tabs with roving tabindex, `←`/`→`/`Home`/`End`.
  Active tab resets to Overview on every new selection.
- **Overview**: Message, Time (local + zone · UTC secondary), Source, Service, Compose project / Container / Namespace /
  Pod / Stream (when present), Level, Logger.
- **Actor & client**: note `Protected / masked - never revealed` + Username, Customer ID, CIF, Device ID, Device IP,
  Device platform, Language (present-only). Empty: `No actor or client data on this event.`
- **Request flow**: rows for Journey ID, Correlation ID, Trace ID, Span ID, Event ID with actions `Find same Journey`,
  `Find same Correlation`, `View Trace`, `View Span` (`NEW_SINCE_PR54`), `Find same Event`, plus `Copy`. Empty:
  `No journey, correlation, trace, span, or event ID on this event.`
- **Business / error**: Business step, UI identifier, Error code (mono) + exception `<pre>` (multiline preserved). Empty:
  `No business step, UI identifier, error code, or exception on this event.`
- **Technical / all fields**: collapsible "All fields" (`N fields, including any unrecognised JSON/MDC keys`), `Search
  fields` filter (`Filter by field name or value…`), canonical fields, `Unknown fields` group, empty `No fields match
  "<q>".`, `<details>` **Canonical Event JSON** (renamed from "Raw JSON", #55).
- **Context action** `ContextAction.tsx`: `Show Surroundings` opens a confirm dialog "Confirm surrounding-context search"
  showing `Scoped to service <svc>. <from> – <to>` (±30 s) and `Nearby chronological evidence around this event - not a
  cause. Replaces the current results with this bounded window; you can return to the original search afterward.`
  with `Run` / `Cancel`. Hidden when the event has no timestamp.

## 6. INVESTIGATION WORKSPACE (JourneyView)

**Files:** `features/journey/JourneyView.tsx`, `JourneyEntryRow.tsx`, `journeyFields.ts`, `serviceColor.ts` —
`CHANGED_SINCE_PR54` (#55: root anchoring, Span, per-entry Surroundings)

- Entry points: Correlation/Trace cell in the table; Request flow tab actions. Relation types (title label):
  **Trace**, **Span** (`NEW_SINCE_PR54`), **Correlation**, **Journey**, **Event**.
- Header: `← Back to search results` + `h1` `<Trace>: <value>` (value styled separately).
- States: error alert; `Loading timeline…`; empty `No events found for this <trace> ID in the current source and time
  range.`
- Loaded:
  - Summary `N events across S services [and T traces], same source, ascending by timestamp. Using <trace> correlation.`
    (multi-trace journeys call out trace count).
  - Root anchoring (`NEW_SINCE_PR54`): `Selected event: i of N` or `Selected event is not present in this result (outside
    the bounded window or guardrail limit).`; root entry auto-scrolled to centre, `aria-current="location"`, **Selected
    event** badge.
  - Stats: Errors, Warnings, First → Last (UTC), Gaps.
  - Truncation notice `⚠ Results may be incomplete — this source returned a bounded subset (limit reached).`
  - Disclaimer `Ordered by timestamp — this does not indicate causality between events. A detected gap means no event was
    observed in that interval, not evidence that anything failed.`
  - Ordered list of `JourneyEntryRow`: left border in a deterministic per-service colour; timestamp, service (same
    colour), level dot + word, business step chip, root badge; message (raw line for malformed); meta
    `Trace: … Span: … Correlation: … Event: …`; **Show Surroundings** per entry (`NEW_SINCE_PR54`).
  - Gap markers between entries (`Gap detected — …`).
- Navigation continuity (`NEW_SINCE_PR54`, #55): Surroundings launched from an Investigation view snapshots the journey;
  the context breadcrumb then reads `← Back to <Trace|…>` and restores the journey (and its root event); `B` shortcut;
  `closeJourney` is the only exit that clears the original-search snapshot.

## 7. CONTEXT (Surroundings)

**Files:** `ResultsPanel.tsx`, `ContextSummary.tsx`, `gapDetection.ts`, `useSearchState.showContext` — `UNCHANGED`
(except Back label, #55)

- Replaces the results panel content with the ±30 s window, oldest first, root row marked (see 4.3).
- **ContextSummary** (`role="note"` "Surrounding-context summary"): stats Events, Services, Errors, Warnings, Window
  `60 seconds (±30s)`, Observed span, Range (with zone), Source, Gaps.
- Notices: truncation (same copy as journey); root missing `⚠ The original event is no longer available from this source
  — showing nearby evidence only. It may have aged out of the retained log window since your original search.`
- Gap list `N sequence gap(s) detected:` with durations; threshold 5 s (`DEFAULT_GAP_THRESHOLD_MS`).
- Disclaimer: `Sorted chronologically, oldest first — this order does not indicate causality between events. …`
- Sort control and header sorting are disabled in context view; Load more works within the context window.

## 8. FIELD MAPPING — Log Schema & Field Mapping Verification

**File:** `features/settings/fieldMapping/FieldMappingWorkspace.tsx` (+ `.module.css`) — **`NEW_SINCE_PR54`** (#55,
fixed #56, default-verified #57). Replaces the removed `FieldMappingSettingsPanel` popover.

- Opened from Shell `Log schema & field mapping`; full takeover of the results column; `← Back to search results`;
  `h1` **Log Schema & Field Mapping Verification**.
- Intro hint (note: still says an inherited default starts **Unverified** — stale since #57, see risk notes).
- Profile states: load error alert; `Loading…`; status `Search ready.` / `Search is disabled — configure and validate log
  field mapping before searching this source.`; scope note `Showing the mapping and verification status for <scope>
  only — never implied verified for any other project or namespace.`
- **1. Quick Schema Scan** (gated by `originalSchemaSampling`; otherwise `This source does not support Original Source
  JSON sampling — capability not advertised.`):
  - Button `Run Quick Schema Scan (up to 200 events)` / `Scanning…` / `Rescan`; scan error alert.
  - Stats: `Selected scope: <label | All (no project selected)>. Services observed: …`; `Observed N events (S structured
    JSON, K non-JSON/malformed excluded …, V structural variants). This is the observed schema from this scan, not a
    guaranteed-complete one …`
  - Bound notice `Scan stopped early: event limit reached, byte limit reached, time limit reached.`
  - Drift banner: `Newly discovered since the last scan: <code…>` / `No longer observed since the last scan: …`.
  - Alert `Saved mapping path(s) not observed in this scan: … The saved mapping is unchanged …`
  - **Original Event Samples**: select `Sample i — <SEVERITY>` labelled `N representative Original Event Sample(s) (real,
    unmasked — never persisted)` + pretty-printed JSON `<pre>`.
  - `<details>` `N non-JSON/malformed line(s) (diagnostics only — never used for field mapping)`.
- **2. Discovered Source Schema** (after a scan): table Path (code) / Type(s) / Seen / Coverage %.
- **3. Map & verify canonical fields**: one row per canonical field (25):
  - Header: display name, `Protected` badge (sensitive fields), verification badge **Verified** / **Unverified** /
    **Needs change**, `Unsaved changes` badge (`NEW_SINCE_PR54`, #56).
  - `Not mapped yet.` when no candidate (Journey ID and UI Identifier by default since #57 — there is no separate
    UNMAPPED status value; it is empty candidates + Unverified).
  - Ordered candidate list: `<code>` path + `(observed in latest scan)` / `(not observed in latest scan)`, `↑` `↓` `×`.
  - Discovered-path picker `Select a discovered path…` + `Add`; `<details>` `Advanced: enter a path manually`
    (placeholder `e.g. mdc.cif or cif`, datalist of discovered paths) + `Add`.
  - Per-field validation line: `Invalid path(s): …` / `Found: <examples>` (+ nested object/array warning) / `Mapped, but
    not found in the current samples.`
  - Actions `Verify` / `Verifying…` (enabled only with candidates, no pending draft, scan evidence) and `Mark needs
    change` / `Marking…` (hidden when already Needs change).
  - Hints: pending-draft `This field has unsaved changes — click 6. Save mapping below first …`; `Run a Quick Schema Scan
    first — verification needs real samples as evidence.` (not shown for Verified fields since #57); verify error alert.
- **4. Validate & preview**: `Validate mapping` / `Validating…` (needs scan samples; hint otherwise); summary
  `✓ Valid — no invalid paths.` / `✗ Not valid — fix the invalid path(s) …` + `Checked against N sample(s) (K malformed
  skipped)` + conflicts `Path <p> is claimed by more than one field: …`.
- Footer actions: `5. Reset to defaults` (`Resetting…`), `6. Save mapping` (`Saving…`; enabled only with unsaved edits
  AND a passing validation). Action errors in an alert.
- Scope: profile keyed to source + Compose project (Docker) or selected OpenShift project; all local scan/draft/verify
  state resets when source or project changes.
- **Search gate** (`NEW_SINCE_PR54`): toolbar Search disabled + inline hint when `searchReady` is false; a backend
  mapping-not-ready error during search refreshes the profile.

## 9. SETTINGS

All three are popover dialogs anchored in the Shell header (no dedicated Settings page).

### 9.1 Docker — `features/settings/DockerSettingsPanel.tsx` — `UNCHANGED`
Trigger `Docker settings` → dialog **Docker connection**: read-only summary `<dl>` (Mode Local/Remote, Connection name,
Host, Port (remote), TLS Enabled/Disabled, Compose project filter or `None configured — every Compose project is
visible`) + settings note; **Test connection** sub-form (Mode Local/Remote, Host, Port placeholder `2375`, `Use TLS
(certificate verification is always required when enabled)`, `Certificate directory path (server filesystem)`),
`Test Connection` / `Testing…`, result `Reachable|Unreachable|Degraded: <msg>`; `Close`. Test does not change the
running configuration.

### 9.2 OpenShift — `features/settings/OpenShiftSettingsPanel.tsx`, `useOpenShiftScopeSummary.ts` — `UNCHANGED`
Trigger `OpenShift` → dialog **OpenShift connection** with state pill (dot + word): `Connected` / `Not connected` /
`Session expired` / `Connection failed` / `Connecting…`.
- Network-exposed block: `Sign-in is disabled because Log Explorer is reachable from the network. …`
- Disconnected form: `Connection name (optional)` (placeholder `Production OpenShift`), `Paste your oc login command`
  (placeholder `oc login --token=… --server=https://api.example.com:6443`), `Connect` / `Connecting…`; specific error
  copy for rejected token, forbidden listing, unreachable cluster, proxy failure, non-https, `--insecure-skip-tls-verify`,
  shell syntax, unsupported/duplicate/missing options, stale request.
- Connected: summary Server (mono), User, TLS `Verified (private certificate authority)`, Proxy, Projects/Namespaces
  count; zero-scope copy `This account can sign in, but has no projects. Ask a cluster administrator …`; **Project /
  Namespace** select (`All projects (none selected)`); scope controls once a project is selected: **Workload** (`All
  workloads`, `Discovering workloads…`, forbidden and partial-kind notices), **Pod** (`All matching pods`, `name (phase,
  ready)`, `No pods currently match this scope.`, partial notice), **Container** (`Select a specific pod to choose a
  container.`, `All applicable containers`); stale-selection errors (`That workload is no longer available …`).
- **Proxy** fieldset: radio `Use system proxy` (honours HTTPS_PROXY/HTTP_PROXY/NO_PROXY, default), `Direct connection`,
  `Custom proxy` → `Proxy server` / `Proxy port` + `Apply proxy`, validation copy.
- `Disconnect`.
- Scope feeds the Shell scope trail, the Search gate and the mapping scope.

### 9.3 Privacy & masking — `features/settings/PrivacyMaskingSettingsPanel.tsx` — `UNCHANGED` (comment-only diff)
Trigger `Privacy & masking` → dialog: hint (applies to every source; server-side; no reveal action); checkbox per field
CIF, Username, Customer ID, Device ID, Device IP (checked = masked; disabled while saving); warning when any field is
unmasked `⚠ Unmasked fields may show real, unmasked values in new search results and event details. …`; update error;
`Close`. Current default (register SSMP-6): unmasked.

## 10. LIVE

**Files:** `features/live/LiveTailPanel.tsx`, `useLiveTail.ts`, `liveTailTypes.ts`, `useLiveKeyboardShortcuts.ts` —
`UNCHANGED`

- Only reachable when `liveTail`; takes over the results column; header `← Back to search results`, status badge,
  `h1` source display name, controls.
- Connection states → badge text: `NOT STARTED` (idle) · `CONNECTING` · `LIVE` (pulsing dot; reduced-motion aware) ·
  `PAUSED` · `RECONNECTING (attempt n)` · `STOPPED` · `CONNECTION FAILED`.
- Source-status overrides (live/paused/stopped): `CONNECTING`, `NO ACTIVE STREAMS`, `SESSION EXPIRED`,
  `SCOPE CHANGED — RESTART LIVE`, `RECONNECTING`; partial connectivity suffix `(<active>/<resolved> active)` when
  DEGRADED.
- Controls by state: `Start` (idle/stopped), `Retry` (failed), `Pause` (live), `Resume` (paused), `Stop` (active),
  `Clear` (has events), `Follow newest` / `✓ Follow newest` (`aria-pressed`).
- Notices: disclaimer `Showing events received since Start — this is not a complete historical record. … capped at
  2,000; oldest events are evicted first.`; `Reconnected N time(s) this session — events during a disconnected period may
  have been missed.`; error alert (e.g. `Live connection lost after 5 reconnect attempts. Click Retry to try again.`);
  source warnings list.
- Local filter row: Severity chips + `Filter displayed events…` (display-only).
- Counts: `Received: N · Visible: V (of R retained) · Buffered while paused: B · Evicted (retention cap): E · Dropped
  (server buffer full): D`.
- `↑ Jump to newest (N new)` when follow is off.
- Empty copy: `Connecting…` / `Reconnecting…` / `No events match the current filter.` / `Waiting for new events…` /
  `Click Start to begin streaming new events as they happen.`
- Event list reuses `JourneyEntryRow` (newest at top).
- Reconnect: exponential backoff 500 ms → 15 s, 5 attempts, jitter; batching every 100 ms.

## 11. GLOBAL STATES

| State | What the user sees today | Where |
|---|---|---|
| Startup | Sources fetched; first source auto-selected; health `Checking…`; results `Run a search to see results.`; mapping profile loading (Search disabled until `searchReady`) | `useSearchState`, `SourceHealthBadge`, `ResultsPanel`, `Toolbar` |
| No sources returned | Empty Source select; no dedicated message (`sourcesLoading` not rendered) | `SourceSelect` |
| Source unavailable | Health badge `Unhealthy` + `Retry`; details message; search errors surface as `Search failed` | `SourceHealthBadge`, `ResultsPanel` |
| No services | Trigger stays `All services`; panel shows `No services match “”.` | `ServiceMultiSelect` |
| No Compose projects | `No Docker Compose projects detected on this Docker engine` (select disabled) | `ComposeProjectSelect` |
| No OpenShift projects / scope missing | Settings: `This account can sign in, but has no projects…`; toolbar: `Select a Project to search OpenShift`, Search/Live disabled | `OpenShiftSettingsPanel`, `Toolbar` |
| Mapping not ready | Toolbar hint `Configure and validate log field mapping before searching this source.`, Search disabled; workspace status `Search is disabled — …` | `Toolbar`, `FieldMappingWorkspace` (`NEW_SINCE_PR54`) |
| No results | `No results for this range.` + `Search last 1 day` | `ResultsPanel` |
| Invalid query | Backend 400 surfaced as `Search failed` + message + `Retry search`; custom range validation inline | `ResultsPanel`, `CustomRangePopover` |
| Search failure | `Search failed` alert + `Retry search` | `ResultsPanel` |
| Load-more failure | Inline alert next to Load more + `Retry`; rows kept | `ResultsPanel` |
| Partial / truncated | Count summary `(truncated …)`; context/journey `⚠ Results may be incomplete …`; OpenShift partial pod list; mapping `Scan stopped early …` | `counts.ts`, `ContextSummary`, `JourneyView`, settings, mapping |
| Malformed log | Raw line + `malformed` badge in table; `Malformed log line` inspector title; raw line in journey/live rows | `MessageCell`, `title.ts`, `JourneyEntryRow` |
| Unsupported capability | Control is not rendered: Live button, Raw LogQL tab, Compose project select, scan button replaced by capability note. Health details list `✗` capabilities. **Show Surroundings is not gated by `contextView`** (only by timestamp presence) | `Toolbar`, `QueryBuilder`, `FieldMappingWorkspace`, `SourceHealthBadge`, `ActionsCell`, `InspectorHeader` |
| Context root aged out | `⚠ The original event is no longer available from this source …` | `ContextSummary` |
| Narrow viewport | Header/toolbar wrap; table scrolls inside wrapper (min 1266 px); inspector becomes overlay sheet ≤1024 px; More filters full width ≤640 px. No other breakpoints exist | CSS modules |

## 12. Shared primitives

`shared/ui/Button.tsx` (`primary` / `secondary` / `ghost`), `FieldList.tsx` (label/value list, mono option, secondary
line), `VisuallyHidden.tsx`, `usePopoverTrigger.ts` + `useDismissableLayer.ts` (every popover: Esc / outside-click,
focus return), `shared/ui/table/emptyValue.ts` (`—`), `shared/tokens.css` (single light theme; motion tokens 120/180 ms,
zeroed under reduced motion). No icon library — glyphs are Unicode (`🕐 ⌨ ⓘ … ✕ ↻ ⠿ ▲ ▼ ↕ ⚠`).

---

## NEW_SCREENS_SINCE_PR54

1. **Log Schema & Field Mapping Verification workspace** (full-column takeover; scan, Original Event Samples,
   Discovered Source Schema, per-field map & verify, validate, reset, save) — #55/#56/#57.
2. **Span investigation view** (JourneyView with `Span: <id>`) — #55.
3. **Root-anchored Investigation view** (Selected-event position line, root badge, per-entry Show Surroundings) — #55
   (same JourneyView surface, materially new composition).
4. **Services panel Include/Exclude mode** and EXCLUDE summary chip — #57 (panel-level, not a new page).

## NEW_WORKFLOWS_SINCE_PR54

1. Map → scan → pick discovered path → validate → save → verify / mark needs change, per source + project scope.
2. Search blocked until an edited mapping is validated and saved (mapping-not-ready gate); reset to defaults restores
   readiness.
3. Owner-approved default mapping trusted as Verified without a scan; Journey ID / UI Identifier deliberately unmapped
   until configured.
4. Investigation → Show Surroundings on an entry → `Back to <Trace|…>` returns to the same investigation with its root
   event.
5. View Span from Request flow.
6. Service EXCLUDE filtering ("All services except …").

## DESIGN_RISK_NOTES

1. **Table geometry invariants** — one `<table>`/`<colgroup>`, `table-layout: fixed`, header/cell alignment ≤2 px,
   `min-width: 1266px` inside the scroll wrapper, Actions last and fixed width. Any grid/flex re-implementation or
   separate sticky header table breaks CLAUDE.md §4 and existing geometry E2E (`geometry.spec.ts`).
2. **Row-state CSS precedence** — `selectedRow` must beat hover, `contextRootRow` must survive selection and severity
   rails (a higher-specificity selection rule has already erased the root marker once). Severity rails, selection rail
   and root dashed outline currently all use `box-shadow`/`outline` on the same `<tr>`; restyling one can silently
   cancel another.
3. **Inspector fixed five tabs** — never conditionally hidden (PCFR2-1); tab reset to Overview on selection; roving
   tabindex; `[`/`]`/Esc shortcuts depend on `selectedEvent`, and Esc must not fire when a popover consumed it.
4. **Mode takeover order** — Mapping > Live > Journey > Results, with the Inspector always mounted beside all of them;
   snapshot/restore (`originalSnapshot`, `journeySnapshotForSurroundings`) drives Back labels. A redesign that turns these
   into routes/tabs or unmounts state will break continuity and `B`.
5. **Capability-driven rendering** — Live, Raw LogQL, Compose project select, schema scan are hidden (not disabled) from
   declared capabilities. Note the existing inconsistency: Show Surroundings ignores `contextView`; a redesign must not
   enlarge this gap and should flag it rather than design around it.
6. **Mapping status vocabulary** — only three backend statuses exist (Verified / Unverified / Needs change);
   "Unmapped" is derived (no candidates), "Observed" is scan-derived and per path. Designing a fourth persisted status or
   merging Observed with Verified would misrepresent the model. The intro hint copy is stale since #57.
7. **Search gating & hints** — Search disabled reasons (loading, OpenShift scope, mapping) are communicated by `title` +
   inline `role="status"` text; relocating the button must keep a visible reason.
8. **Masking** — sensitive values render only masked strings or `Protected` in chips; never add reveal affordances,
   hover-to-show, or client-side reconstruction.
9. **No-causality copy** — context, journey and context-confirm copy explicitly deny causality; timeline visuals
   (arrows/connectors) must not reintroduce it.
10. **Live bounds and truthfulness** — 2,000 retained cap, distinct Received/Visible/Buffered/Evicted/Dropped counts,
    partial `(a/r active)`; the pulsing dot is the only animation tied to real liveness.
11. **Popover mechanics** — every settings/filter panel relies on `usePopoverTrigger`/`useDismissableLayer` for Esc,
    outside click and focus return; More filters positions itself under `[data-app-chrome]` via ResizeObserver —
    changing the chrome structure/attribute breaks panel placement.
12. **Narrow widths** — only two breakpoints exist (1024 inspector sheet, 640 More filters); header + toolbar rely on
    wrapping; adding toolbar controls has previously pushed the page sideways at 390 px.

---

## 13. EVENT CLASSIFICATION (PR #59, `51f06e5`) — `NEW_SINCE_3F6B1B4`

Read from `frontend/src` on `main` and rendered for real: 32 BEFORE captures in
[`baseline/classification/`](baseline/README.md#event-classification-before-pr-59-main-51f06e5) (real backend, dev
profile, Fixture source; three states route-mocked and labelled).

### 13.1 Entry points
- Shell button **Classification rules** (beside Log schema & field mapping) → takeover workspace (`App.tsx`, lazy).
- Inspector header ghost button **Create tag rule from this event** (`InspectorHeader.tsx`) → same workspace in
  create-from-event mode for that event (event held in React state only).
- Empty state copy points to both.

### 13.2 Classification rules workspace — `ClassificationRulesWorkspace.tsx`
- Header `← Back to search results`, `h1` **Classification rules**, hint “Rules tag matching events and extract named
  values from them. They are applied by the server to the events each search retrieves.”
- Meta: `Revision N · Stored in <full server path>`; `Runtime: N events evaluated · N rule matches · N evaluation
  failures`.
- Status banner when `status` ≠ OK: “Rules were recovered from a backup file.” / “The saved rules file is invalid.” +
  server message.
- Actions: **New rule** (primary), **Import…** (hidden file input, size check against `maxImportBytes`), **Export
  all**, **Export selected (n)**.
- Notices: “Rule saved. Re-run Search to classify currently loaded results.”; import result “Import applied. Added n,
  replaced n, unchanged n, kept existing n, removed n.”; list errors; revision conflict “These rules were changed
  elsewhere. Reload the latest rules, then save again.” + **Reload rules**.
- Empty: “No classification rules yet.” + how to create one.
- Filter “Filter rules by name or tag”; table: select checkbox · Name (+ description) · Tags (comma text) · Matches on
  (`message · STARTS_WITH`, `2 conditions (ANY)`) · Enabled (checkbox `role=switch`, On/Off) · Actions Edit,
  Duplicate, Test, Delete.
- Delete: inline `alertdialog` “Delete rule?” with primary **Delete rule** and **Cancel** (focus on Cancel; Esc and
  outside click dismiss).

### 13.3 Rule editor — `RuleEditor.tsx` (modes new / edit / duplicate / fromEvent)
- Step buttons `1. Source … 6. Save` (Source only in fromEvent), `Step n of 6: <step>` heading receives focus on
  change; Back / Next / Cancel. Every step reachable.
- **Source**: Time, Service, Severity summary; Field select (message preselected); read-only Sample value.
- **Detect**: explanation (samples up to 200 events from the current search scope; suggestion only); **Detect
  pattern** / **Skip / write conditions manually**; `Detecting…`; error alert. Result: Sampled / With this field /
  Similar; Stable structure (quoted mono list); Variable parts (name, kind, example); Suggested pattern; “Matches n of
  n similar events; also matches n other sampled events.”; Suggested extractions “extracted from n of n similar
  events”; Warnings; **Use this suggestion** → “Suggestion copied into the draft. Nothing is saved yet…”.
  NO_SAFE_PATTERN_SUGGESTION: reason + “No safe pattern could be suggested. You can still create the rule manually
  (Advanced).” + warnings.
- **Classification**: Rule name, Tags (comma-separated, lowercase note, chip preview), Description, Enabled; conditions
  overview sentence; **Advanced**: match mode radios ALL/ANY, condition fieldsets (field with datalist, matcher
  Exact/Contains/Starts with/Regex, value, ignore case, remove), Add condition (limit).
- **Extraction**: one fieldset per extraction — Name, Label, Source field, Type (Regular expression (RE2) / JSON
  pointer), Expression, Group, Value type (Text/Integer/Decimal/Boolean), “Never show this value”, Remove; Add
  extraction; Preview values (jumps to Test and runs it).
- **Test**: **Test rule** / `Testing…`; Sampled events / Matched / Not matched; sample-limit note; Extraction coverage
  “Label — n / n (n could not be read)”; Matched examples (≤ 5, each with time · service · severity, field, value
  block and extracted field list); Borderline (matched some conditions); review note from the server.
- **Save**: summary (Name, Tags, Enabled, Conditions, Extractions); “not been tested” hint; required-field issues;
  save error; revision conflict + Reload rules (“Latest rules loaded. Your draft is kept…”); **Save rule**.

### 13.4 Import — `ImportPanel.tsx`
- “Import classification rules”, file name, “Nothing has been imported yet.”, pack name/version/description.
- Counts: Rules in pack, New, Identical, Conflicts, Invalid; item list (name, id, status text, existing name for
  conflicts, tags, validation errors with path).
- Import mode radios Merge / Replace all; Conflicting rules (required) Keep existing / Use imported (one choice for
  all conflicts); Replace-all confirmation checkbox; blocker list; **Apply import** disabled while blocked; revision
  conflict → Reload rules + re-preview.

### 13.5 Inspector — `ClassificationSection.tsx`
- Rendered in the **Overview tab after the Overview fields**, only when at least one rule matched; never a new tab.
- Tags as uppercase badges; one sub-section per matching rule (rule name + extracted `FieldList`); ABSENT → `—` “Not
  found in this event”; INVALID → `—` “Could not be read”; redacted → value as served (`[REDACTED]`) with “Redacted”;
  truncated → “Truncated”. “This rule extracts no fields.” when empty.
- Technical / all fields lists a `tags` row.

### 13.6 Search
- More filters → **Classification tags** fieldset: help “Matches events with any selected tag. Tags are applied by
  the server to the events each search retrieves.”; checkbox per tag; loading / error / “No classification tags
  yet.”; draft until Apply; count badge includes tags.
- Active filters: one chip per tag `Tag: <name>` with remove.
- **Results rows, Investigation, Surroundings and Live show no tags today** (deferred to this sync).

### 13.7 Persistence and runtime truth the design must not contradict
- Rules are server-side JSON (revisioned, atomic write, backup); no database; events and extracted values are never
  stored. Rules apply to future reads only; loaded results and existing Live rows are not reclassified.
- Detect and Test read a bounded sample (default 200, max 500) of the committed search scope and never write.
- Tag filtering runs after retrieval; it does not read more history.

### 13.8 BEFORE observations (feed the design; not functional defects)

| # | Observation | Classification |
|---|---|---|
| C-1 | Workspace is a centred column under the full search chrome, like the old mapping page; step buttons read as a row of equal pills | VISUAL_WEAKNESS |
| C-2 | Detect evidence and the suggestion are one undifferentiated list of headings and bullets | FUNCTIONAL_GOOD_VISUALLY_WEAK |
| C-3 | The extraction step shows expression, group and type fields for every value by default: regex is on the ordinary path; five suggested values make a 2,100 px page | UX weakness (regex exposure, length) |
| C-4 | Test results render five full cards with every extracted value; the page reaches 2,140 px and the review note sits at the bottom | FUNCTIONAL_GOOD_VISUALLY_WEAK |
| C-5 | Delete confirmation uses the primary (accent) button style for a destructive action | VISUAL_WEAKNESS |
| C-6 | Rules table at 390 px: columns collapse to character-wide text, actions cut off | LAYOUT_DEFECT (narrow) |
| C-7 | Tags are plain comma text in the list and uppercase badges in the Inspector | COPY / consistency |
| C-8 | Matcher shown as enum text (`message · STARTS_WITH`) | COPY |
| C-9 | Full server storage path in the meta line | COPY (disclosure of a server path) |
| C-10 | Extracted-value status lines render in monospace (“Not found in this event”) | VISUAL_WEAKNESS |
| C-11 | Tags absent from result rows, captures and Live | Deferred by PR #59 |

### 13.9 Source selector policy (register §26.1)
Options are ordered by stable id, never API order: `local-docker` (Local Docker / Local Docker Compose), `openshift`,
`openshift-loki` (label “OpenShift Loki — Not available”, native `disabled`), then other sources (dev/test Fixture).
The guarded setter refuses Loki from any path; no health, service or search request is made for it as the active
source. Evidence: `baseline/classification/source-select-options.json`, `c00-*.png`.

### 13.10 Design risk notes added by PR #59
13. **Classification is server-authoritative.** The UI never classifies, never infers tags, and never shows values the
    API did not return; redacted values must not gain copy or reveal affordances.
14. **Revision concurrency.** Every write sends the last-read revision; a redesign must keep the conflict path visible
    and keep drafts on conflict.
15. **Five tabs.** Classification stays inside Overview.
16. **Seven columns.** Result-row tags must not enter “What happened” or become a default eighth column without an
    owner decision (D19).
17. **Native disabled Loki option.** Replacing the Source select with a custom listbox breaks SSEL-2 and its tests.
18. **Bounded samples.** Detect/Test copy must say “sample” and must not claim false-positive rates or completeness.

