# Component Inventory — Modern Developer Console

Classification of every production frontend component on latest `main`
(`3f6b1b4bc30c282e0cd1e65510697ff128d79d73`) against the Direction B design. Source of truth for
what exists: `CURRENT_BASELINE_INVENTORY.md`. Nothing here has been implemented.

| Class | Meaning |
|---|---|
| **KEEP** | No visual change needed, or not a visual component. Behaviour and structure stay. |
| **RESTYLE** | Same component, same structure and behaviour; new tokens, type, spacing, icons, states. |
| **RECOMPOSE** | Same behaviour; its parts move or regroup (placement, grouping, disclosure). |
| **REPLACE_VISUALLY** | Same data and behaviour; a new visual composition replaces the current markup. |
| **DEPRECATE_AFTER_IMPLEMENTATION** | Removed only after its replacement ships and passes regression. |

No new component library is proposed. The only new dependency the design needs is an icon set
(Lucide, ISC licence) to replace Unicode glyphs; everything else stays React + CSS modules.

## App shell and global

| Component | Class | What changes | What must not change |
|---|---|---|---|
| `app/App.tsx` | RECOMPOSE | Non-search workspaces (Investigation, Context, Mapping, Settings, Live) show a compact scope bar instead of the full query bar; Settings becomes a workspace takeover. | Takeover priority (Mapping > Live > Investigation > Results), Inspector mounted beside every mode, snapshot/restore driving Back labels, no URL state. |
| `app/Shell.tsx` | RECOMPOSE | Scope trail moves into the query bar's Source/Project fields; the three settings popover triggers become one **Settings** entry; a workspace trail (Search › Trace) is added; **Field mapping**, **Settings**, **Keyboard shortcuts** stay. | Every existing destination stays reachable; health stays visible. |
| `app/EnvironmentBadge.tsx` | RESTYLE | Token-based badge. | Hidden when no profile label. |
| `app/SourceHealthBadge.tsx` | RECOMPOSE | Health dot + word live inside the Source field; the details dialog opens from it and lists declared capabilities. | Dot + word (never colour-only), Retry when not UP, capability list truthfulness. |
| `app/KeyboardShortcutsHelp.tsx` | RESTYLE | New dialog styling; also listed under Settings › Keyboard shortcuts. | Generated from the live registry. |
| `app/useSearchState.ts`, `app/useProductivityShortcuts.ts`, `shared/keyboard/*` | KEEP | — | All state, shortcuts, Esc precedence. |

## Search

| Component | Class | What changes | What must not change |
|---|---|---|---|
| `app/Toolbar.tsx` | RECOMPOSE | One 44 px query bar: Source · Project │ Time · Services · Severity · text · More filters · **Search** · Live. Disabled-Search reasons become a gate strip under the bar. | Search disabled rules and their visible reason; Live only when `liveTail`; wrapping without page overflow. |
| `features/search/SourceSelect.tsx` | RESTYLE | Field-style trigger carrying health. | First source auto-selected. |
| `features/search/ComposeProjectSelect.tsx` | RESTYLE | Field-style trigger labelled **Project**. | Only when `composeProjectScoping`; empty/error copy. |
| `features/search/ServiceMultiSelect.tsx` | RESTYLE | Segmented **Include selected / Exclude selected**, explicit helper sentence, running/total meta. | `aria-pressed` mode, "All except N" labels, Clear, "no services" vs "no match" distinction (currently one message — see audit). |
| `features/search/SeverityFilter.tsx` | RECOMPOSE | Inline chips move into a **Severity** field whose popover holds All, Errors only and the five level chips; the field shows the active set with severity marks + words. | Default Info/Warn/Error; every level selectable; never colour-only. |
| `features/search/UniversalSearch.tsx` | RESTYLE | `/` key hint; icon. | ID detection prompt and `Search as <field>`. |
| `features/search/AdvancedFilters.tsx` | RECOMPOSE | Right-anchored dialog becomes a full-width panel under the query bar with four group columns and an Advanced query row. | Every field, exact/contains semantics, draft-only-until-Apply, Reset/Cancel/Apply, sensitive values never echoed. |
| `features/search/QueryBuilder.tsx` | RESTYLE | Opened from the Advanced query row. | Guided/Text/Raw LogQL (Raw only with `rawLogQL`), divergence dialog. |
| `features/search/ActiveFilters.tsx` | RECOMPOSE | Chips move into the scope strip beside the result readout, sort, Columns, Query details and Refresh. EXCLUDE chip keeps the word **Excluding**. | One chip per criterion, `Protected` for sensitive values, Clear all never touches source/scope. |
| `features/timerange/TimeRangeControl.tsx`, `CustomRangePopover.tsx` | RESTYLE | Field trigger, icon system. | Presets, Custom popover validation, actual interval + zone label, focus return. |

## Results

| Component | Class | What changes | What must not change |
|---|---|---|---|
| `features/results/ResultsPanel.tsx` | RECOMPOSE | Summary, sort, Columns, Refresh and Query details move to the scope strip; loading, empty, error and load-more states use the new state panels; Context gains its summary + window plot. | State precedence, "Search last 1 day" (shown only when it would widen the range), load-more retry keeping rows, Back labels. |
| `features/results/ResultsTable.tsx` | RESTYLE | 28 px compact rows (34 px comfortable), severity mark in a 22 px gutter inside the Time cell, selection = tint + hairlines, root = tag + trigger hairlines, identity columns narrow when the Inspector opens. | One `<table>`/`<colgroup>`, `table-layout: fixed`, header/cell alignment ≤ 2 px, contained horizontal scroll, Actions last, roving tabindex, `aria-selected`/`aria-current`, gap rows. |
| `features/results/columnRegistry.tsx` | RESTYLE | New default widths and Inspector-open widths. | Column ids, optional columns, `—` for missing values. |
| `features/results/MessageCell.tsx` | RESTYLE | Malformed tag + raw line in mono, `(empty message)` in muted italics. | More/Less for long text; text-only rendering. |
| `features/results/ActionsCell.tsx` | RESTYLE | Icon button and menu styling. | Menu items and their conditions. |
| `features/results/SortControl.tsx` | RECOMPOSE | `<select>` becomes a toggle button ("Newest first") in the scope strip. | Single authoritative sort state shared with the Time header; hidden in Context. |
| `features/results/TableSettingsControl.tsx` | RESTYLE | Popover with grip handles, arrows, density segmented control. | Drag-and-drop + keyboard move, Actions locked last, Reset table, localStorage presentation-only. |
| `features/results/QueryPlanDisclosure.tsx` | RECOMPOSE | Opens from **Query details** in the scope strip instead of an inline disclosure. | Executed query, pushed/applied lists, honest "None" copy. |
| `features/results/ContextSummary.tsx` | RECOMPOSE | Stat row + a 60 s window ruler with event marks, gap bands and the selected-event line. | Every stat, truncation and aged-out notices, no-causality copy. |
| `columnMapping.ts`, `columnSort.ts`, `counts.ts`, `gapDetection.ts`, `tablePreferences.ts` | KEEP | — | All logic. |

## Inspector

| Component | Class | What changes | What must not change |
|---|---|---|---|
| `features/inspector/EventInspector.tsx` | RECOMPOSE | Default width 500 px (fits the five tabs on one row); becomes an overlay sheet below 1366 px instead of 1024 px. | Non-modal dialog, resizable 320–720 px with keyboard, focus to Close on open, Esc precedence. |
| `features/inspector/InspectorHeader.tsx` | RECOMPOSE | Meta line (level · service · time · position · prev/next/close), two-line title with trigger mark, action row (Show surroundings, View trace, Find same journey, Copy trace ID). The shortcut actions call the same handlers as the Request flow tab. | Position `aria-live`, title derivation, Show Surroundings confirm dialog. |
| `features/inspector/InspectorTabs.tsx` | RESTYLE | Underline tabs; a hollow "no data" dot on tabs whose section is empty. | Exactly five tabs, never hidden, reset to Overview on selection, roving tabindex. |
| `OverviewSection.tsx`, `RequestFlowSection.tsx`, `BusinessErrorSection.tsx`, `InspectorSection.tsx`, `shared/ui/FieldList.tsx` | RESTYLE | Grouped key/value lists; Request flow shows absent identifiers as "Not on this event" and unmapped ones as "Not mapped for this project". | Present data, actions per identifier, exception `<pre>` preserved. |
| `ActorClientSection.tsx` | RESTYLE | Masking note reflects the actual policy instead of always saying "never revealed". | No reveal action; masked strings as served. |
| `AllFieldsSection.tsx` | RESTYLE | Mapped vs unrecognised groups; JSON highlighting. | Filter, every field reachable, Canonical Event JSON. |
| `ContextAction.tsx` | RESTYLE | Button + confirm dialog styling. | ±30 s window, confirm step, no-causality copy. |
| `allFields.ts`, `sections.ts`, `timestampFormat.ts`, `title.ts`, `useResizablePanel.ts` | KEEP | — | — |

## Investigation workspace and Live

| Component | Class | What changes | What must not change |
|---|---|---|---|
| `features/journey/JourneyView.tsx` | REPLACE_VISUALLY | Card list becomes a capture: mode bar, stat row, timeline plot (service lanes, trace brackets, gap bands, selected-event line) and a sequence table. | Relation types (Trace/Span/Correlation/Journey/Event), root anchoring and "Selected event i of N", truncation notice, no-causality copy, per-entry Show Surroundings, Back. |
| `features/journey/JourneyEntryRow.tsx` | REPLACE_VISUALLY | Card row becomes a table row (time, offset, service swatch, level, step, message, trace/span, action). | Service colour is paired with the service name; malformed raw line; root badge. |
| `features/journey/journeyFields.ts`, `serviceColor.ts` | KEEP / RESTYLE | `serviceColor` maps to lane tokens. | Deterministic service colour. |
| `features/live/LiveTailPanel.tsx` | RECOMPOSE | Mode bar with acquisition-state badge and controls, counts bar, notice, display filter row, event table. | Every connection/source state string, controls by state, counts, 2,000 cap notice, partial `(a/r active)`, Jump to newest, shortcuts. |
| `useLiveTail.ts`, `useLiveKeyboardShortcuts.ts`, `liveTailTypes.ts`, `mockEventSource.ts` | KEEP | — | — |

## Settings and mapping

| Component | Class | What changes | What must not change |
|---|---|---|---|
| `features/settings/DockerSettingsPanel.tsx` | RECOMPOSE | Popover dialog content moves into the Settings workspace → Sources & connections, with a "Docker source only" scope tag and a read-only marker on configured values. | Read-only summary, Test connection never changing running config, TLS copy. |
| `features/settings/OpenShiftSettingsPanel.tsx` | RECOMPOSE | Same move; connection summary, investigation scope selectors, Disconnect as a danger button. | Every connection state and error copy, network-exposed block, scope selection rules, proxy fieldset behaviour. |
| `features/settings/PrivacyMaskingSettingsPanel.tsx` | RECOMPOSE | Same move → Privacy & masking, "All sources" scope tag, switches with Masked/Unmasked words, warning banner while any field is unmasked. | Five fields, server-side enforcement, applies to new requests only, no reveal. |
| `features/settings/fieldMapping/FieldMappingWorkspace.tsx` | REPLACE_VISUALLY | Card column becomes a field table (field · mapped path · evidence · status · action) with an inline editor row, a process strip (Scan · Map & verify · Validate · Save), an evidence side panel (Original event sample + discovered schema) and a sticky action bar. Stale "defaults start Unverified" copy is replaced. | Scan gating by `originalSchemaSampling`, draft → validate → save → verify order, Verify disabled while a draft is pending, Needs change semantics, reset, scope isolation, first-usable-candidate-wins, no auto-assignment of discovered paths. |
| `features/settings/useOpenShiftScopeSummary.ts` | KEEP | — | — |

## Shared

| Component | Class | What changes | What must not change |
|---|---|---|---|
| `shared/tokens.css` | REPLACE_VISUALLY | New semantic token set (`DESIGN_SYSTEM.md`), light primary plus dark companion. | Reduced-motion handling (extended), focus ring visibility. |
| `shared/ui/Button.tsx` | RESTYLE | Adds `danger` variant, `sm` size and an icon slot. | Existing variants' semantics. |
| `shared/ui/VisuallyHidden.tsx`, `useDismissableLayer.ts`, `usePopoverTrigger.ts`, `table/emptyValue.ts` | KEEP | — | Esc/outside-click/focus return; `—`. |

## Deprecated after implementation

| Item | Replaced by | Condition |
|---|---|---|
| Unicode glyph icons (`🕐 ⌨ ⓘ … ✕ ↻ ⠿ ▲ ▼ ↕ ⚠`) | Lucide icon component with one stroke weight | Every usage replaced, accessible names unchanged. |
| Shell popover triggers **Privacy & masking**, **Docker settings**, **OpenShift** as separate shell buttons | Settings workspace sections | Same forms reachable in ≤ 2 actions; existing e2e selectors migrated. |
| `SortControl` `<select>` | Sort toggle in the scope strip | Shared sort state test still green. |
| Inline "Query details" `<details>` in the results header | Query details popover | Same content and honest empty copy. |
| Per-service coloured left border in investigation rows | Lane swatch next to the service name | Service name always adjacent to its colour. |
