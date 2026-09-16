# Component Inventory — Modern Developer Console

Classification of every production frontend component on latest `main`
(`51f06e51709455f2c20dcf5c1b32e2dd67443377`, after PR #59; first pass `3f6b1b4`) against the Direction B design. Source of truth for
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
| `features/search/SourceSelect.tsx` | RESTYLE | Native `<select>` styled as a field; health shown beside the value, not inside options (D26). | Policy order Docker → OpenShift → OpenShift Loki; Loki a native `<option disabled>` labelled “OpenShift Loki — Not available”; guarded `onChange`; highest-priority available source selected first (register SSEL-1…3). |
| `features/search/ComposeProjectSelect.tsx` | RESTYLE | Field-style trigger labelled **Project**. | Only when `composeProjectScoping`; empty/error copy. |
| `features/search/ServiceMultiSelect.tsx` | RESTYLE | Segmented **Include selected / Exclude selected**, explicit helper sentence, running/total meta. | `aria-pressed` mode, "All except N" labels, Clear, "no services" vs "no match" distinction (currently one message — see audit). |
| `features/search/SeverityFilter.tsx` | RECOMPOSE | Inline chips move into a **Severity** field whose popover holds All, Errors only and the five level chips; the field shows the active set with severity marks + words. | Default Info/Warn/Error; every level selectable; never colour-only. |
| `features/search/UniversalSearch.tsx` | RESTYLE | `/` key hint; icon. | ID detection prompt and `Search as <field>`. |
| `features/search/AdvancedFilters.tsx` | RECOMPOSE | Right-anchored dialog becomes a full-width panel under the query bar with four group columns plus a **Classification tags** group, and an Advanced query row. | Every field, exact/contains semantics, draft-only-until-Apply, Reset/Cancel/Apply, sensitive values never echoed; tag group shown only with `onApplyTags`, loading/error/“No classification tags yet” copy, ANY semantics, committed tags that no longer exist stay listed so they can be unchecked. |
| `features/search/QueryBuilder.tsx` | RESTYLE | Opened from the Advanced query row. | Guided/Text/Raw LogQL (Raw only with `rawLogQL`), divergence dialog. |
| `features/search/ActiveFilters.tsx` | RECOMPOSE | Chips move into the scope strip beside the result readout, sort, Columns, Query details and Refresh. EXCLUDE chip keeps the word **Excluding**. Tag chips `Tag <name>` with the tag icon; chip remove targets 24 px. | One chip per criterion (one per tag), `Protected` for sensitive values, Clear all never touches source/scope. |
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

## Event classification (PR #59, added in the design sync)

| Component | Class | What changes | What must not change |
|---|---|---|---|
| `features/settings/classification/ClassificationRulesWorkspace.tsx` | RECOMPOSE | Moves from a shell-button takeover into **Settings › Classification rules** (D17): meta line (revision, file name only D28, runtime counts), toolbar, rules table with plain-language matcher, Extracts count, switch with word, Test/Edit/More; banners; delete becomes a modal alertdialog with a danger button (D27); stacked rows ≤ 767 px. | Every write carries the last-read revision; 409 → “changed elsewhere” + Reload rules; enable toggle, edit, duplicate, test, delete with confirmation; filter by name or tag; export all/selected; import file size limit check; status banners for RECOVERED_FROM_BACKUP and INVALID; runtime stats; `onRulesChanged` refreshes app-wide tags. |
| `features/settings/classification/RuleEditor.tsx` | REPLACE_VISUALLY | Wizard becomes the rule builder workspace: anchor strip with the trigger, step rail with status lines, draft panel, compact scope bar (§21.6). Detect splits into Observed evidence and Suggested rule with the decode lane; conditions in plain language with advanced editing behind a disclosure; extraction as a table with Suggested/Confirmed (D21) and an edit row; Test as stat row, coverage table, Matched/Borderline examples; Save summary. | Modes new / edit / duplicate / fromEvent; steps reachable in any order; Detect is a suggestion only (NO_SAFE_PATTERN_SUGGESTION handled); Test never saves; required name and tag checks; limits from `rulesState.limits`; RE2 help; JSON pointer help; sensitive flag; revision conflict keeps the draft; focus to the step heading on change. |
| `features/settings/classification/ImportPanel.tsx` | REPLACE_VISUALLY | Process strip, count tags, items table with “What applying does”, conflict and invalid detail rows, choice cards for Merge / Replace all, danger zone listing rules to delete (D24), blockers beside Apply. | Preview writes nothing; Apply is the only write; invalid rules block Apply; MERGE with conflicts requires one resolution; REPLACE_ALL requires confirmation; revision conflict → Reload rules and re-preview; result counts reported after apply. |
| `features/settings/classification/ruleDraft.ts` | KEEP | — | `SAVED_MESSAGE`, `REVISION_CONFLICT_MESSAGE`, matcher labels, tag normalisation, writable-rule shaping. |
| `features/inspector/ClassificationSection.tsx` (+ module CSS) | RESTYLE | Tag chips lowercase as stored (D20); per-rule block with “adds <tags>” and a Rule link (D29); value states per §21.5 (redacted token, unreadable icon, clamp + Show more, JSON disclosure, copy on present values only). | Rendered only when a rule matched; inside Overview, never a tab; values rendered as text exactly as served; `—` for ABSENT/INVALID with the reason; redacted and truncated notes. |
| `features/inspector/InspectorHeader.tsx` | RECOMPOSE (addition) | **Create tag rule** as a ghost action in the action row with the tag icon. | Opens the rules workspace in fromEvent mode for the current event; event held in React state only. |
| `features/inspector/allFields.ts` | KEEP | — | `tags` row in Technical / all fields. |
| `features/results/columnRegistry.tsx` | RESTYLE (addition) | New optional **Tags** column (hidden by default, D19) rendering the tag cell primitive. | Seven default columns unchanged; column ids and preferences; `—` for no tags. |
| `features/journey/JourneyView.tsx`, `features/live/LiveTailPanel.tsx` | REPLACE_VISUALLY / RECOMPOSE (addition) | Tags column in the capture sequence table and Live table; `Tagged n of N` stat in captures; Live note about rules saved after Start (D25). | Data already on each event (`tags`); no extra requests; bounded DOM. |
| `app/Shell.tsx` “Classification rules” button | DEPRECATE_AFTER_IMPLEMENTATION | Replaced by Settings › Classification rules (D17). | Reachable in ≤ 2 actions; E2E selectors migrated (`classification-rules.spec.ts` uses the button name). |
| `features/search/sourcePolicy.ts`, `app/useSearchState.ts` (source guard, tag state) | KEEP | — | Source order policy, UI-unavailable ids, guarded setter, `refreshClassificationTags`, `buildClassificationSampleScope`. |

### New design primitives and where they appear

| Primitive (DESIGN_SYSTEM §21) | Search | Inspector | Investigation / Live | Settings › Classification rules | Rule builder |
|---|---|---|---|---|---|
| Tag chip (18 / 22 px) + `+N` | Tags column, tooltip | Tag list, rule blocks | Tags column | Tags column, import items | Token input, draft panel |
| Tag filter chip / tag option | Scope strip, More filters | — | — | — | — |
| Classification section, value states | — | Overview | — | — | Test samples (value chips) |
| Rule status (switch + word, disabled row) | — | — | — | Rules table / list | Classification step (Enabled) |
| Plain-language condition line | — | — | — | Matches when | Suggested rule, Classification, Save, draft panel |
| Decode lane (fixed / changing segments) | — | — | — | — | Detect |
| Suggestion vs Measured panels and tags | — | — | — | — | Detect |
| Suggested / Confirmed status tag | — | — | — | — | Extraction |
| Coverage evidence bar | — | — | — | — | Detect, Extraction, Test |
| Borderline tag | — | — | — | — | Test |
| Import count tag, import status tag, danger zone, choice card | — | — | — | Import | — |
| Workspace banner (success / warning / danger) | — | — | — | Saved, conflict, degraded, import applied | Save conflict |
| Destructive alertdialog | — | — | — | Delete rule | — |
| Unavailable source option | Source field | — | — | — | — |

