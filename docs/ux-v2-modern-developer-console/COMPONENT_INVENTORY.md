# Component Inventory — Modern Developer Console

Classification of every production frontend component on latest `main`
(`6e71af8d901418d65de2bebb472240db27779147`, after PR #59 and PR #60; earlier passes `51f06e5` and `3f6b1b4`)
against the Direction B design. Source of truth for what exists: `CURRENT_BASELINE_INVENTORY.md`. Nothing here has
been implemented.

**Refreshed after PR #60** (`6e71af8d901418d65de2bebb472240db27779147`). The classification entries below are extended,
not replaced, by "Event classification after PR #60" at the end of this file; where an entry is stale it is marked in
place. Design truth for those entries: `DESIGN_SYSTEM.md` §22 and `IMPLEMENTATION_PLAN.md` §3.1 (D30–D37); production
truth: `CURRENT_BASELINE_INVENTORY.md` §14 and `baseline/pr60/README.md`.

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
| `features/results/columnRegistry.tsx` | RESTYLE (addition) | ~~New optional **Tags** column (hidden by default, D19)~~ — **SUPERSEDED by PR #60 / D30**: the column ships and is **visible by default**; see the PR #60 table below. Rendering the tag cell primitive. | ~~Seven default columns unchanged~~ → **eight**, Tags between "What happened" and "User/Customer"; column ids and preferences; `—` for no tags. |
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


## Event classification after PR #60 (`6e71af8`)

These entries **extend** the PR #59 table above; nothing there is repeated. Every row is a component that already
ships — PR #60's endpoints, sample scope, suggestion engine, colour storage and conflict rules are done and tested
(`IMPLEMENTATION_PLAN.md` §2.2), so the classes below are deliberately RESTYLE / RECOMPOSE / REPLACE_VISUALLY and
never "build this". Production truth: `CURRENT_BASELINE_INVENTORY.md` §14. Design truth: `DESIGN_SYSTEM.md` §22.

| Design piece | Production file | Class | What changes | What must not change | Prototype state |
|---|---|---|---|---|---|
| **Classification chip + colour palette** | `shared/ui/TagChip.tsx`, `shared/ui/TagChip.module.css` (colour names from `core/classify/TagColor.java`) | RESTYLE | The chip's grammar changes from *tint + same-hue text* to **tinted pill + 6 px dot + neutral `--ink-2` text** (D31), drawn from eight new `--tag-<hue>` / `--tag-<hue>-tint` token pairs in B1's muted register (D32), with a dark companion defined in its own right. 18 px in a row, 22 px in the `.lg` panel variant; max 96 px in a cell, 160 px in a list; text ellipsises, the dot never shrinks. | The tag text is **always** rendered — colour is identity only, never severity/success/failure/causality and never the only signal; the `forced-colors` rule that drops the tint and keeps the text; the 18 px cap that keeps a classified row the same height as an unclassified one; `tagColorsOf` resolving one colour per tag from the rules that matched. | `93-results-tag-not-severity` |
| **Overflow `+N` counter** | `features/results/columnRegistry.tsx` (`TagsCell`) | RECOMPOSE | Today the counter is a **second `TagChip` in the first tag's colour**. It becomes a **neutral** counter beside the chip: it counts identities, it is not one (D30, §22.3). | The complete comma list stays in the cell's accessible name (`Tags: a, b, c`) **and** its `title` — the overflow must never be the only place the rest of the tags exist, and must never become hover-only. | `92-results-tags-default-column`, `93-results-tag-not-severity` |
| **Tags column cell** | `features/results/columnRegistry.tsx` (`tags` definition) | RESTYLE | New fixed width (156 px, 132 px with the Inspector docked) against production's single `150px`, and the message column keeps its 240 px floor. Cell composition is the chip + neutral counter above. | `defaultVisible: true` and the position between `whatHappened` and `userCustomer` — **eight** default columns (D30, CSX-8, CLAUDE.md §4 as amended); `—` when unclassified, never an absent cell; the column stays hideable and movable under **Columns** like any other; `sortAccessor` on the first tag. | `92-results-tags-default-column` |
| **Tag colour picker / swatch** | `features/settings/classification/RuleEditor.tsx` — the `Tag colour` fieldset | RECOMPOSE | One radio group of eight swatches, each a **dot and its colour name** rather than a chip painted in the colour; the accent ring marks the selection and focus is visible on the label, not only the hidden input; arrow keys move within the group. Copy states that choosing is optional because the server derives a deterministic default from the first tag. | Exactly the eight palette names, never a free hex field; `role="radiogroup"`; the selected value still being `displayColor` on the draft; the deterministic default when nothing is chosen. | `83-rule-classification-colour` |
| **Live preview chip** | `features/settings/classification/RuleEditor.tsx` — the `Preview:` row | RESTYLE | Redrawn in the new chip grammar so the preview is literally the chip Search and the Inspector will draw. | It must keep showing the **real first tag** (falling back to `tag` when none is typed yet) and the currently selected colour — a preview that is not the shipped chip is worse than none. | `83-rule-classification-colour` |
| **Tag-colour conflict block** | `features/settings/classification/RuleEditor.tsx` (`validationSummary`) and `features/settings/classification/ImportPanel.tsx` | REPLACE_VISUALLY | A named, resolvable state replaces the raw `<path>: <message>` list: the tag, the colour it already has and which rule gives it, and two inline resolutions (**Use Purple** / **Rename this tag…** — the colour named is the one the tag already holds; on import, *Keep Purple* / *Change "external-api" to Red everywhere*) — D36, §22.5 / §22.9. The import variant must also state the **reach** of the second resolution: a colour belongs to the rule, so recolouring a tag repaints every rule linked to it by any shared tag — in the drawn pack it reaches four rules, three of them repainted — and the halfway state is refused by `TagColorPolicy` (D40). Any consequence that holds on only one branch of the rule-conflict choice (such as `pci`, which exists only on the imported rule) must be stated as conditional, never asserted. In the import preview it becomes a fifth reportable outcome beside new / identical / rule conflict / invalid, and a blocker for **both** MERGE and REPLACE ALL. | `TagColorPolicy`'s refusal is the invariant — the UI reports it, never resolves it client-side and never picks a winner. **Note the gap this closes:** `tagColorConflicts` is returned by the preview API but read nowhere in `frontend/src` today, so the first step is to read the field that already exists, not to add a rule (§14 C-23). | `84-rule-colour-conflict`, `91-import-colour-conflict` |
| **Sample-scope summary** | New component fed by `app/useSearchState.ts#buildClassificationSampleScope`; replaces the hint paragraphs in `RuleEditor.tsx`'s Detect and Test steps | REPLACE_VISUALLY | One `scope-summary` panel — source · project · time · query · services · severity, a *Change filters* affordance, and the single honest omission (a classification tag filter is not applied). Detect shows the full panel; every other step relies on the rail's identical *Sample scope* block, generated from the same list so the two cannot drift (D33, §22.6). | The scope shown must equal the committed request body **field for field**; counts stay measured and bounded ("Counts describe this bounded sample only, not the whole source"). This also carries the recommended production copy fix: the current hint names only source/project/services/severity/time and understates what is sampled (§14 C-14). | `82-rule-detect-scope-summary` |
| **Extraction suggestion row + coverage bar** | `features/settings/classification/RuleEditor.tsx` — `suggestionList` / `suggestionRow` | RECOMPOSE | The row becomes checkbox · name · **coverage bar** (`Found in 17 / 17` in the create flow, `17 / 18` in the extend flow — each flow keeps its own sample; today text only) · editable output name · **value type** · *Never show* · **preview** · remove, inside a panel tagged *Suggestion · not saved* with the read-out and the footer actions (D35, §22.7). Value type and preview are **additions**, not restyles. | Coverage is **measured on the sample, never estimated**; *Suggested* and *Confirmed* stay visually distinct; `alreadyDefined` keeps being stated so a suggestion cannot silently duplicate a confirmed value; manual authoring stays first-class with RE2 / capture group / JSON pointer behind **Advanced: how this value is read**. | `85-rule-extraction-suggestions` |
| **No-suggestion state** | `features/settings/classification/RuleEditor.tsx` — the extraction `emptyState` | RESTYLE | A titled explanation of why nothing could be inferred and what extraction is for, above the three existing ways forward. | Never a blank page; the server's own reason is shown; the three actions stay *Detect extractable values again*, *Add extraction manually*, *Skip extraction*, and skipping keeps saying the rule will still tag matching events. | `86-rule-extraction-no-suggestion` |
| **Rule chooser row** | `features/settings/classification/ClassificationRulesWorkspace.tsx` — the `chooseRule` view | RECOMPOSE | Each row gains the rule's **coloured tags, matcher summary and current extract count** (today: name + tags + button only), and its action reads *Add values to this rule*. The panel also points at the other intention: "Looking for a new identity for this event instead? Use **Create another tag rule**." | One matching rule still opens **directly** on its extraction step — the chooser appears only when several matched, and there is never an ambiguous default; Cancel returns to the list; nothing is mutated before an explicit save. | `87-extend-choose-rule` |
| **Extend-a-rule frame** | `features/settings/classification/RuleEditor.tsx` opened in `edit` mode at `initialStep: 'extraction'`, via `useSearchState#openClassificationExtractionFromEvent` | RECOMPOSE | The same editor is **framed** as a 3-step **Values · Test · Save** flow titled by the rule ("Add extraction to \"Middleware HTTP call\""), with the trail Search › Event › *the rule* and an *Extending a saved rule* badge — structurally distinct from the 6-step *Create tag rule* (D34, D37, §22.8). | **One editor, not two.** The frame is presentation over the existing `RuleEditor`; forking it duplicates the revision-protected save, `rulesState.limits` and the RE2 / JSON-pointer help. The event stays the anchor for suggestions; save stays revision-protected. | `88-extend-suggestions`, `89-extend-test-coverage` |
| **Stale-rule recovery** | `features/settings/classification/ClassificationRulesWorkspace.tsx` — the `addExtraction` resolution notice and `listError` | REPLACE_VISUALLY | The two bare notices ("The rules that classified this event are no longer saved…", "That rule no longer exists…") become one truthful recovery state: nothing was created or changed, plus *Reload rules*, *Choose another rule…* and *Create a tag rule from this event instead*. | It must stay reachable and stay honest — a rule that disappeared must never be silently replaced by authoring something else; an unclassified event still says there is no rule to extend. | `90-extend-stale-rule` |
| **Rules list colour column** | `features/settings/classification/ClassificationRulesWorkspace.tsx` — the rules table `Tags` cell | RESTYLE | The chips already ship here (PR #60 replaced the comma text); they are redrawn in the new chip grammar so the list, the table and the Inspector are one primitive. | Colour parity with Search and the Inspector; the filter still matching by name **or** tag; the enabled switch keeping its word; Edit / Duplicate / Test / Delete. | `94-rules-list-colours` |

### Primitive-to-surface map after PR #60

The point of this map is that **one concept never gets two visual primitives**. A tag is one chip everywhere it
appears; coverage is one bar everywhere it is measured; a colour conflict reads the same on save and on import. Where
a cell says "—" the surface genuinely has no use for that primitive — not that a second variant is allowed there.

It extends the PR #59 map above (whose "Tag chip (18 / 22 px) + `+N`" row is now the *coloured* chip of §22.2, and
whose Rule-management and Import columns are split apart here).

| Primitive (DESIGN_SYSTEM §22) | Search | Inspector | Investigation / Live | Rule management | Import | Rule builder |
|---|---|---|---|---|---|---|
| Classification chip (pill + dot + neutral text) | Tags column (the **filter** chip stays the separate `Tag <name>` primitive of §21 — a filter criterion is not an event's identity) | Tag row, per-rule blocks | Tags column in captures and the Live table | Rules list Tags cell, chooser rows | Item rows (tags of each packed rule) | Draft panel, classification step, colour preview, test examples |
| Neutral `+N` overflow counter | Tags column | — (the Inspector always lists every tag in full) | Tags column in captures and Live | — (the list has room for every tag) | — | — |
| Eight-swatch colour control | — | — | — | — | — | Classification step (D32) |
| Tag-colour conflict block | — | — | — | Save conflict from the rules list | Preview blocker, both modes | Classification step / Save step |
| Sample-scope summary ("Sampled from this search") | — (the committed search **is** the scope; never repeated into ordinary search UX) | — | — | — | — | Detect (full panel) + rail block on every other step |
| Coverage evidence bar | — | — | — | — | — | Detect, extraction suggestions, Test |
| Suggestion vs Confirmed status tag | — | — | — | — | — | Extraction step |
| No-suggestion / recovery empty state | — | — | — | Stale-rule recovery | Invalid-pack blocker | Extraction step |
| Rule chooser row | — | Entered from *Add extraction from this event* | — | Chooser view | — | — |
| *Extending a saved rule* frame badge + trail | — | Origin of the trail (Search › Event › rule) | — | Hosts the framed editor | — | The framed editor itself |
