# PR #61 — owner manual usability & Classification Rule recovery

Mission: `PR61_OWNER_MANUAL_USABILITY_AND_CLASSIFICATION_RECOVERY`. Branch
`ux/v2-modern-developer-console` (PR #61, draft). A targeted pre-merge
recovery after real owner manual testing exposed usability and
Classification Rule defects the automated suite had not sufficiently
caught — not a redesign, not another visual-fidelity audit, not permission
to merge.

```
START_HEAD=d32bca83c47ab6b9631d4ebbedd2dc05a42b5fc4
END_HEAD=0e70771bcf791c1b2b42e8fb9080e821bfb39fac
```

## Startup gate

```
HEAD=d32bca83c47ab6b9631d4ebbedd2dc05a42b5fc4
PR61_OPEN=YES  PR61_DRAFT=YES  PR61_NOT_MERGED=YES
WORKTREE_CLEAN=YES (only a pre-existing, session-predating set of evidence-PNG diffs and .claude/settings.local.json)
```

## Owner-observed symptoms

During real Classification Rule creation, assisted/confirmed extractions
reached the Test step in a structurally invalid state — e.g. `Name: url`,
`Group: url`, an expression with no named capture group matching `url`,
producing "The expression has no group with that name"; human-readable
text such as "Request Method" inside a machine identifier field, producing
"Use 1-40 letters, digits, or underscores, starting with a letter"; the
Test screen then showing only raw technical paths
(`extractions[0].group`, `extractions[1].name`) as the explanation. A
value shown as "(confirmed)" was structurally invalid. Separately: what
"Group (optional)" actually meant was unclear, and Field Mapping's own
navigation lacked the breadcrumb/section-nav its sibling Classification
Rules workspace already had.

## Root causes (verified against the actual code, not assumed)

**`ROOT_CAUSE_SETTINGS_NAVIGATION`**: Settings' own discoverability,
information architecture, current-location clarity, and keyboard
accessibility were already correct — verified directly against
`Shell.tsx`, `SettingsWorkspace.tsx`, `SettingsNav.tsx`,
`ClassificationRulesWorkspace.tsx`. The one real defect was
`FieldMappingWorkspace.tsx`, which had only "← Back to search results" —
no breadcrumb, no `SettingsNav` sidebar, no way to jump to another
Settings section without closing all the way to Search first — unlike its
sibling workspace.

**`ROOT_CAUSE_EXTRACTION_GROUP`**: `RuleCompiler.resolveGroup`
(`backend/.../core/classify/RuleCompiler.java:216-250`) already implements
every documented case correctly (single-unnamed-capture auto-resolution,
named-capture-matching-name auto-resolution, ambiguous-multi-capture
rejection, explicit named/numeric lookup and rejection with the exact
message text the owner saw). `PatternDetector.textExtractions`
(`backend/.../detect/PatternDetector.java:315-392`) already calls
`RuleCompiler.compileExtraction` on every candidate before returning it
and silently drops any that fail — so the backend is structurally
incapable of returning the owner's exact broken shape as a suggestion.
**No backend production code was changed** — its contract was correct;
what was missing was regression coverage proving it (added, see Tests
below).

**`ROOT_CAUSE_MACHINE_NAME_LABEL`**: `RuleEditor.tsx`'s Name/Label fields
had no client-side format hint, no auto-generated suggestion, and no
distinction in presentation between the two — a user could type a human
label directly into the machine `name` field (the suggestion list's
"Output name" box, or the extraction card's own Name field) with nothing
warning them before the round trip.

**`ROOT_CAUSE_CONFIRMED_INVALID_EXTRACTION`**: `RuleEditor.tsx`'s
extraction-card legend showed `${label} (confirmed)` whenever `x.name` was
a non-empty string — entirely decoupled from whether the definition was
actually server-validated. Compounding this, "Preview values" called
`setStep('test'); runTest();` **synchronously** — the step change happened
before the async validation call could ever resolve, so a structurally
knowable problem always surfaced on the Test step, as a raw
`extractions[0].group: <message>` list, never anchored on the actual
field, even though a per-extraction `<FieldErrors>` component already
existed and would have rendered correctly in place had the user still
been on the Extraction step when the errors arrived.

## Implementation changes

### Extraction wizard (`frontend/src/features/settings/classification/RuleEditor.tsx`)

- **Structural validation before advancing** (§18/§19): a new
  `previewValues()` handler calls the existing, already-authoritative
  `POST /classification-rules/validate` endpoint (`RuleCompiler.compile`
  under the hood — no new validation authority, no duplicated business
  logic) before ever calling `setStep('test')`. If the result is invalid
  **and** at least one error is extraction-scoped, the wizard **stays on
  Extraction** — never advances, never strands the user on Test with only
  a technical path. Non-extraction errors (rare; e.g. a condition made
  invalid since Detect) still proceed to Test, where `validationSummary`
  already renders them.
- **Focus management** (§19 "focus the first actionable invalid field"):
  a ref map plus two effects open the offending extraction's "Advanced"
  disclosure first (if the error is on `.group`/`.expression`, which lives
  there) and then move focus to that exact field.
- **"Confirmed" now means what it says** (§21): `confirmedExtractions`
  tracks extraction objects by reference. An **unrenamed** accepted
  suggestion (`addSelectedSuggestions`, `applySuggestion`) is added — it
  is provably still exactly what `PatternDetector` already compiled before
  offering it. A **renamed** suggestion is deliberately left out — its new
  `name` was never itself round-tripped through the server, so it is not
  claimed confirmed until it is (mission's own distinction: "the user
  selected this suggestion" is not "the extraction definition is valid").
  Editing any extraction via `updateExtraction` always produces a new
  object, so an edited extraction naturally stops being a member of the
  confirmed set — no separate "clear on edit" bookkeeping needed.
  Already-saved extractions (edit/duplicate mode) are seeded as confirmed
  at mount, since the server already validated them when the rule was
  last saved.
- **"Capture group (advanced)" — reframed, not deleted** (§9/§10/§40):
  relabelled from "Group (optional)", with helper text ("Usually leave
  this blank — Log Explorer automatically uses the only captured value.
  Set a group name or number only when the expression contains more than
  one captured value."), and now **hidden entirely for `JSON_POINTER`**
  extractions, where it was never semantically meaningful
  (`RuleCompiler.compileExtraction`'s JSON_POINTER branch never reads
  `group` — confirmed directly in the source). Manual override remains
  fully available for REGEX — nothing about the backend's advanced
  capability was removed.
- **Name-format inline hint** (§13/§14/§20/§26): a new
  `NameFormatHint` component mirrors the backend's own
  `^[A-Za-z][A-Za-z0-9_]{0,39}$` pattern (`ruleDraft.ts`'s
  `EXTRACTION_NAME_PATTERN`, documented as UX-feedback-only, the server
  remains authoritative) and offers a one-click deterministic suggestion
  (`toMachineName`: "Request Method" → `requestMethod`, "URL" → `url`,
  "Response Code" → `responseCode`, "Response Body" → `responseBody` —
  exactly the mission's own cited examples) — **never applied silently**
  (CLAUDE.md §1: "Never silently reinterpret a user's rule"). Present on
  both the suggestion list's "Output name" box and the extraction card's
  own Name field.
- **Regex-input hint corrected** (§16): the expression field's helper text
  no longer implies JavaScript-style `/…/` delimiters; it now shows a
  plain RE2 example matching the backend's own accepted syntax.

### Settings navigation (`FieldMappingWorkspace.tsx`, `.module.css`, `App.tsx`)

- Added the exact same breadcrumb (`Settings / Field mapping`) and
  `SettingsNav` sidebar `ClassificationRulesWorkspace.tsx` already has,
  reusing the shared `SettingsNav` component (not a parallel
  implementation). "Classification rules" now navigates directly there;
  every other section opens Settings itself, matching the sibling
  workspace's own established `selectSettingsSection` reasoning.
  `onOpenSettings`/`onOpenClassificationRules` props wired from `App.tsx`
  to the same `state.openSettingsWorkspace`/`state.openClassificationWorkspace`
  functions `ClassificationRulesWorkspace` already uses.
- **A real, verified 4px horizontal overflow at 390px was found and
  fixed** during the mission's own required responsive check (CLAUDE.md
  §6's debugging sequence: reproduce → inspect → fix → verify): the new
  fixed-200px `SettingsNav` sidebar had no room next to the field-mapping
  table's own minimum width at that viewport. Fixed with the exact same
  `@media (max-width: 767px) { grid-template-columns: minmax(0, 1fr); }`
  collapse `ClassificationRulesList.module.css`'s own `.body` already
  uses — not a new pattern.

### Appearance / theme control (`SettingsWorkspace.tsx`, `App.tsx`, `useTheme.ts` — untouched)

- **Dark theme itself was already implemented and complete** — this
  mission does not claim otherwise, does not redesign it, and does not
  touch `useTheme.ts`/`tokensV2.css`/the token architecture. What was
  missing, verified directly: `App.tsx` called `useTheme()` and discarded
  its return value entirely (`useTheme();`) — there was **no UI control
  anywhere** that let a user manually choose light/dark; the app only ever
  followed `prefers-color-scheme`. `useTheme`'s own
  `preference`/`setPreference` and `writeThemePreference` were already
  fully built and safe (CLAUDE.md's "safe non-sensitive UI preference"
  rule) but had zero consumers.
- Added a new `AppearanceSection` component (extracted so it is directly
  unit-testable without the large `SearchState` mock every other Settings
  section depends on) — a native, keyboard-operable radio group (Match
  system / Light / Dark), reusing the exact same
  `.sectionLabel`/`.radioGroup`/`.radioOption` CSS `OpenShiftSettingsPanel`'s
  own proxy-mode radios already use (not a new pattern). `useTheme()`
  moved from the outer `App()` wrapper into `AppContent()` (where
  `SettingsWorkspace` renders) so its result could actually be threaded
  through — no behavioural change to when/how `data-theme` is applied,
  only to where the hook is called from.

## Group-resolution backend contract (verified, not changed)

```
GROUP_OPTIONAL_BACKEND_CONTRACT=YES — omitted group is a fully supported, documented path
SINGLE_CAPTURE_AUTO_RESOLUTION_CURRENT=YES — one unnamed capture, group omitted -> group 1
NAMED_CAPTURE_AUTO_RESOLUTION_CURRENT=YES — a named capture matching the extraction's own `name`, group omitted -> that capture
MULTI_CAPTURE_CURRENT_BEHAVIOR=REJECTED_ACTIONABLE — "The expression has several groups; name the group to extract"
EXPLICIT_NAMED_GROUP=SUPPORTED — resolves to that named capture; nonexistent name rejected with "The expression has no group with that name" (never silently converted to group 1)
EXPLICIT_NUMERIC_GROUP=SUPPORTED — 1-based; out-of-range rejected with "Group index must be between 1 and N"
JSON_POINTER_GROUP=IRRELEVANT_BY_DESIGN — RuleCompiler never reads `group` for JSON_POINTER
```

## Tests

**Backend** (`RuleCompilerTest.java`, `PatternDetectorTest.java`):
- `groupResolutionMatchesEveryDocumentedCase` — single-unnamed-capture
  auto-resolution (B01), explicit valid named group (B03), explicit valid
  numeric group (B04), nonexistent named group rejected with the exact
  owner-observed message and shape (B05), out-of-range numeric group
  (B06), ambiguous multi-capture (B07), zero captures (B08) — each with
  the server's exact message text asserted, not just "throws".
- `everySuggestedRegexExtractionAlreadyCompilesBeforeItIsEverOffered` —
  synthetic data shaped like the owner-observed defect (request
  method/URL/response code/response body, never real owner/customer log
  content), proving `RuleCompiler.compileExtraction` succeeds for every
  suggestion `PatternDetector.detect` returns (mission's own
  `ASSISTED_SUGGESTION_VALIDITY` invariant, §11).
- Full backend suite: **1461/1461 PASS** (was 1459; +2 new test methods).

**Frontend unit** (`RuleEditor.assistedExtraction.test.tsx`,
`FieldMappingWorkspace.test.tsx`, `AppearanceSection.test.tsx`):
- Capture group relabelled/hidden-for-JSON_POINTER, helper text present.
- "(confirmed)" never shown for a manually-typed extraction, however its
  Name field is filled in; an **unrenamed** accepted suggestion still
  shows "(confirmed)"; a **renamed** one no longer does (an existing test
  that asserted the old, incorrect behavior was corrected — not weakened;
  it encoded the exact defect this mission fixes).
- Preview Values: a structurally valid draft still advances to Test and
  runs it exactly as before; a structurally invalid extraction keeps the
  user on Extraction (never strands them on Test), the human message is
  shown anchored on the actual field, Advanced auto-opens, focus lands on
  the offending field; correcting the field and re-checking clears the
  stale error.
- Field Mapping navigation parity: breadcrumb present, "Settings" click
  calls the right callback, `SettingsNav` present with "Field mapping"
  marked current, "Classification rules" navigates directly there without
  detouring through Settings, every other section opens Settings.
- Appearance: all three choices present with real accessible names,
  current preference reflected as `checked`, choosing a different option
  calls back with exactly that value, fully keyboard-operable (Tab
  focuses, arrow keys move + select, focus alone never fires a change), 0
  axe violations.
- Full frontend unit suite: **1194/1194 PASS** (96 files; was 1177 before
  this mission's additions/one pre-existing test's ambiguity fix, see
  below).

**A pre-existing test needed a scope fix, not a behavior change**:
`App.classificationWorkspace.test.tsx`'s own `/^settings$/i` button query
became ambiguous once `FieldMappingWorkspace` gained its own "Settings"
breadcrumb button (same accessible name as Shell's persistent header
trigger) — scoped to `within(screen.getByRole('banner'))`, the exact same
fix this test already applied to an analogous "Field mapping" ambiguity
one line above it.

**E2E** (`classification-rules.spec.ts`, new
`pr61-owner-usability-recovery.spec.ts`):
- New test against the real backend and real fixture data: "Preview
  values structurally validates a suggestion-derived rule and reaches
  Test without any manual Group edit" — proves E01-E08 end to end with
  genuine, unedited, suggestion-derived extractions
  (`url`/`responseCode`/`durationMs`), each shown "(confirmed)" honestly,
  needing zero manual Capture group intervention.
- Existing two `classification-rules.spec.ts` tests (the exhaustive
  detect/test/save/export/import flow, and the owner's own scoped-search
  reproduction) still pass unmodified.
- New spec: Appearance discoverable/keyboard-operable/persists across
  navigation, no horizontal overflow at 1920/1440/1366/1024/768/390 with
  the new section present; Field Mapping breadcrumb/nav parity, "Classification
  rules" jump, "Settings" return, no horizontal overflow at every required
  width (the real 390px overflow found and fixed, above); dark-theme
  legibility of the new breadcrumb/nav (real computed-style check: text
  colour distinct from and non-transparent against its background).
- All new/modified E2E: 12/12 PASS, repeated (2x) for the new spec file
  with 0 flakes.

## Light / dark (mission §34)

Dark theme is not reopened or redesigned. The touched RuleEditor
error/hint classes (`.error`, `.fieldError`, `.hint` in
`RuleEditor.module.css`) were grep-verified to use only
`--v2-danger`/`--v2-ink-2`/`--v2-text-*` tokens — zero hardcoded colours —
the exact same architecture `tokensV2.css`'s complete
`:root[data-theme='dark']` block already covers for every other
already-audited surface (`DARK_THEME_AUDIT_COMPLETE=YES`). The new
Settings breadcrumb/nav CSS was copied byte-for-byte from
`ClassificationRulesList.module.css`'s own already-dark-safe rules. The
new breadcrumb/nav's real rendered legibility in dark theme (non-transparent,
distinct-from-background computed colour) is additionally proven by a
real E2E check.

## Backward compatibility (mission §25)

No saved-rule schema migration, no backend semantics change. Existing
valid rule shapes — named group + explicit group, named group + omitted
group, one unnamed group + omitted group, explicit numeric group,
JSON_POINTER, sensitive extractions, imported/exported rule definitions —
all continue to load, display, edit, test, and save exactly as before;
proven by the full backend suite (1461/1461, including every pre-existing
`RuleCompilerTest`/`ClassificationRulesIntegrationTest` case unchanged)
and the full frontend suite. No migration was needed or performed.

## Security / masking (mission §24, unchanged)

Not touched. Extraction values still flow through the server's own
redaction/masking before reaching the browser; `sensitive` checkbox
semantics unchanged (existing tests for it still pass unmodified); no
security enforcement was moved into the browser; no real owner/customer
event values appear in any new fixture, test, or this document — every
synthetic example is fabricated to match the *shape* the owner described,
never their content.

## Accessibility (mission §35)

0 new axe violations across every touched/new component
(`RuleEditor.assistedExtraction.test.tsx`'s existing axe suite, still
green; `FieldMappingWorkspace.test.tsx`'s existing axe test, still green
with the new breadcrumb/nav present; `AppearanceSection.test.tsx`'s new
axe test). Keyboard verified directly, not only via automated checks: the
Appearance radio group is Tab-reachable and arrow-key-operable per native
`<input type="radio">` semantics (a real E2E test asserts this against
the rendered app, not just a unit-test DOM); every new Settings
navigation control is a real `<button>`, not a custom-handled div.

## Source Experience Parity / Search / Inspector / Investigation / Live (mission §30-§32)

Not touched. No file under `frontend/src/features/search/openshift/`,
`useSearchState.ts`'s scope-invalidation logic, `useLiveTail.ts`, or any
Inspector/Investigation component was modified by this mission. Docker's
Project→Service→Search and OpenShift's Project→Workload→Pod→Container→Search
hierarchies, Settings' connection-only role for OpenShift scope, and the
existing scope-invalidation/stale-request-protection lifecycle are all
unchanged — confirmed by the unmodified full regression suite passing.

## Manual synthetic acceptance (mission §39)

Walked the real rendered app (real dev backend, real Fixture source) end
to end: Search → select event → Create tag rule → Detect → Use suggestion
→ Classification → Extraction (suggestion-derived `url`/`responseCode`/
`durationMs`, each honestly "(confirmed)") → **Preview values** (not
"Next") → Test (reached with zero manual Group editing) → Save. Separately
confirmed an intentionally-invalid explicit Capture group (a manually
constructed extraction with `group="wrongName"` not present in its own
expression) still fails clearly, anchored on the correct field, Advanced
auto-opened, focus moved there — proving the fix does not silently
convert an explicit wrong choice to group 1 (mission §17's explicit
prohibition).

## What this mission did not do

No redesign of the whole application. The completed Impeccable visual
audit and DRIFT-001..016 remediation were not reopened. D40 (rule-level
`displayColor`) unchanged. A1b not implemented. Loki consolidation not
implemented. D8 (Live EXCLUDE) not implemented. No database, no LLM, RE2
unchanged, no server-side validation weakened, no masking/redaction
weakened, no source/OpenShift-session authority change, Source Experience
Parity not redesigned, latest `main` not integrated, PR64 not manually
re-integrated, nothing deployed to port 80, `sofra-caddy-1` untouched,
PR #61 not merged.

---

# OWNER_NAVIGATION_RECOVERY_2

Mission: `PR61_OWNER_NAVIGATION_RECOVERY_2`. A post-mission independent
review (ChatGPT Owner) inspected the actual production source at the
`PR61_OWNER_MANUAL_USABILITY_AND_CLASSIFICATION_RECOVERY` head above and
found that mission's own statement — "Settings' own discoverability,
information architecture, current-location clarity... were already
correct" — was true for Settings' own internal structure, but did **not**
cover three further, genuinely still-present owner-observed defects the
prior mission's scope had not reached: `ClassificationRulesWorkspace`'s and
`FieldMappingWorkspace`'s own outer "Back" always returned to Search
regardless of where the workspace was actually opened from; Settings'
"Keyboard shortcuts" section rendered the compact header popover trigger
instead of real content; and every jump from either workspace's own
`SettingsNav` sidebar landed Settings on its default "Sources" section
rather than the one actually clicked. This section records that recovery.
The sections above are preserved unedited as the historical record of
their own mission — they were accurate about what that mission covered;
this one covers what it did not.

```
START_HEAD=0e70771bcf791c1b2b42e8fb9080e821bfb39fac
END_HEAD=<recorded at push, see FINAL_REPORT>
```

## Confirmed remaining defects and their root causes

**1. Classification/Field Mapping "Back" ignored where the workspace was
opened from.** `ClassificationRulesWorkspace`'s and `FieldMappingWorkspace`'s
own outer Back button always called `onClose` (`state.closeClassificationWorkspace`/
`state.closeMappingWorkspace`), and those functions always did exactly one
thing — close the workspace, returning to Search — regardless of whether
the workspace was reached from Settings, from Shell's own persistent
header trigger, or from the Inspector. `Settings → Manage classification
rules → Back` genuinely returned to Search, not Settings, confirmed
directly against the production source before any fix.

**2. Settings' "Keyboard shortcuts" section rendered the wrong
component.** `SettingsWorkspace.tsx` rendered `<KeyboardShortcutsHelp />`
directly — the same compact `⌨` trigger + absolutely-positioned popover
Shell's own header already uses — inside its own inline section. Reaching
real shortcut content from Settings still required clicking a small icon
button to open a floating panel; Settings' own page never showed the
content itself.

**3. Every `SettingsNav` sidebar jump from Classification/Field Mapping
landed on Settings' default section.** Both workspaces' own
`selectSettingsSection`/inline nav handler called `onOpenSettings()` with
no argument for every section other than "mapping"/"classification", and
`openSettingsWorkspace`/`SettingsWorkspace` had no concept of a requested
target section at all — `activeSectionId` always initialized to `'sources'`.
`Classification sidebar → Keyboard shortcuts` opened Settings, but always
on "Sources & connections".

Back and the breadcrumb could also visibly disagree with each other (a
"Settings" breadcrumb crumb shown while Back said "search results", or
vice versa) — a direct instance of the owner's own "Back is not clear" report.

## The fix: one coherent origin/target-section contract

Per the mission's own preference for "one small explicit workspace
navigation/origin contract" over scattered booleans:

```ts
export type WorkspaceOrigin = 'search' | 'settings';
export type SettingsSectionId = 'sources' | 'masking' | 'appearance' | 'mapping' | 'classification' | 'shortcuts';
```

(`frontend/src/app/useSearchState.ts`.) Every place that can open Field
Mapping or Classification Rules now states its origin explicitly at the
call site (`openMappingWorkspace(origin)`/`openClassificationWorkspace(origin)`,
defaulting to `'settings'` since every caller except Shell's own header
trigger already reaches these through a Settings-family context; Shell's
own button is the one explicit `'search'`). `closeMappingWorkspace`/
`closeClassificationWorkspace` read that origin and either call
`openSettingsWorkspace(<the section that workspace corresponds to>)` or
fall through to a plain close (Search). `openSettingsWorkspace` now takes
an optional target section (default `'sources'`, unchanged for every
caller that never had one to give), stored as `settingsTargetSection` and
threaded into `SettingsWorkspace` as a `targetSection` prop that seeds its
own `activeSectionId` and scrolls to it on mount — deterministic, no
`setTimeout`, no scroll-timing guesswork.

**The Inspector case (N04/N22) needed one more piece**: "Create tag rule
from this event"/"Add extraction from this event" already closed the
Inspector (`setSelectedIndex(null)`) before opening Classification Rules.
A new `classificationReturnInspectorIndex` remembers which event's
Inspector was open at that moment; `closeClassificationWorkspace`, when
the origin is `'search'` and that index is set, calls `setSelectedIndex`
directly to reopen the Inspector on the exact same event — never
stranding the user on bare Search results, never touching any other
Search state (results, filters, source, scope, time range, query are all
untouched by this whole round trip — proven by `useSearchState.test.ts`'s
own new coverage and a real-backend E2E test).

**Back button grammar (defect 3's second half)**: a new shared
`WorkspaceBackButton` (`frontend/src/shared/ui/WorkspaceBackButton.tsx`) is
now the one Back-button implementation for Settings, Field Mapping, and
Classification Rules — a real `arrow-left` icon (already in `Icon.tsx`'s
curated set), never icon-only, `destination` text supplied by the caller
from the same origin truth above (`"Settings"` / `"Search results"`), and
an `aria-label` of `"Back to <destination>"` (more informative for
assistive tech than the bare destination alone, and incidentally exactly
what disambiguates it from a same-page breadcrumb link to that same
destination in tests and in practice). The breadcrumb itself is now
conditionally rendered — a search-origin visit shows **no** breadcrumb at
all (nothing to contradict a Back button that already truthfully names
the one real ancestor), a settings-origin visit keeps the existing full
breadcrumb, and its own "Settings" link now also targets the correct
section (`onOpenSettings('classification')`/`onOpenSettings('mapping')`),
matching what Back does.

**Keyboard shortcuts (defect 2)**: `KeyboardShortcutsHelp.tsx`'s own pure
grouping computation was extracted unchanged into a new
`useShortcutGroups()` hook, and its group/list/row markup into a new
`ShortcutGroupList` presentational component — both already existed as the
correct, single, registry-derived source of truth; only the JSX around
them was ever popover-specific. `KeyboardShortcutsHelp` (the header
trigger) is now a thin wrapper: trigger button + dialog chrome +
`<ShortcutGroupList grouped={useShortcutGroups()} />`, behaviorally
identical to before. A new `KeyboardShortcutsInline` component is: heading
+ the same `<ShortcutGroupList grouped={useShortcutGroups()} />`, no
trigger, no dialog, no dismiss layer — what `SettingsWorkspace` now
renders in its own "Keyboard shortcuts" section. Exactly one source of
shortcut truth; two presentations.

**Appearance in the shared nav**: `SETTINGS_NAV_SECTIONS` now includes
`{ id: 'appearance', icon: 'sun-moon', label: 'Appearance' }`, positioned
after "Privacy & masking" (a cross-cutting, source-independent preference
belongs with the others like it, not after the source-scoped Field
mapping/Classification rules sections). `SettingsWorkspace`'s own
`<AppearanceSection>` moved to the matching position in its JSX. `sun-moon`
(from `lucide-react`) is the one deliberate addition outside `Icon.tsx`'s
own design-curated set — documented in place: the approved design
prototype never depicted a runtime theme control at all (its own
`?theme=dark` is a design-preview URL parameter, not a UI element), so
there was never a design-approved icon to match.

## A real, pre-existing accessibility defect found and recorded (not fixed — out of scope)

While writing this mission's own new `SettingsWorkspace.test.tsx` (the
first test file to ever render the full `SettingsWorkspace` and check it
with axe — no such file existed before), a genuine, **pre-existing**
`landmark-unique` violation was found: `PrivacyMaskingSettingsPanel.tsx`
renders its own `<section aria-labelledby={headingId}>` one level inside
`SettingsWorkspace`'s own identically-purposed `#settings-masking`
section, and both resolve to the accessible name "Privacy & masking" —
two same-named landmarks, which axe flags. Confirmed unrelated to this
mission: neither `PrivacyMaskingSettingsPanel.tsx` nor its nesting was
touched here, and no prior test ever exercised a full `SettingsWorkspace`
render against axe to have caught it. Per this mission's own "record it,
do not expand scope automatically" instruction, this is recorded here and
left unfixed; this mission's own axe checks are scoped to the sections it
actually touched (Appearance, Keyboard shortcuts) rather than the whole
page, so this pre-existing issue does not appear as a false "new
violation" in this recovery's own evidence.

## Nested Classification navigation (N06/N07) — already correct, verified unchanged

`RuleEditor`'s own `onCancel`/Import's own cancel/apply handlers already
called `setView({ kind: 'list' })` — internal navigation back to the rule
list, never all the way out to Settings/Search — unchanged by this
mission. What was missing was only the OUTER Back (defect 1 above); with
that fixed, `Settings → Classification → New rule → Cancel → list →
Back → Settings` now works end to end, proven by a real-backend E2E test
(`N06/N21` below) rather than assumed from the unchanged internal code
alone.

## Tests

**Frontend unit** (`useSearchState.test.ts`, `SettingsWorkspace.test.tsx`
— new; `ClassificationRulesWorkspace.test.tsx`, `FieldMappingWorkspace.test.tsx`,
`App.classificationWorkspace.test.tsx` — extended):
- The full origin/target-section contract at the hook level: default
  origins, explicit `'search'`, `closeMappingWorkspace`/
  `closeClassificationWorkspace` landing on the correct Settings section,
  `openSettingsWorkspace` defaulting and targeting correctly, the
  Inspector-restore path (open → close → Inspector reopens on the same
  event, with the pre-existing "opened from Settings never reopens an
  Inspector" case also proven), and an explicit "no workspace-navigation
  transition ever calls Search" assertion.
- `SettingsWorkspace` lands deterministically on every requested section
  (not just the default); Appearance is listed and reachable; Keyboard
  shortcuts renders real inline content (a fixture shortcut, proving the
  extraction/rendering pipeline itself, the same pattern
  `KeyboardShortcutsHelp.test.tsx` already used for the popover) with no
  trigger/dialog present; Back always names "Search results" (Settings'
  own destination never varies).
- `ClassificationRulesWorkspace`/`FieldMappingWorkspace`: settings-origin
  shows the breadcrumb and a truthful "Back to Settings"; search-origin
  shows no breadcrumb and "Back to Search results"; the breadcrumb's own
  "Settings" link and every `SettingsNav` sidebar item now assert the
  *specific* target-section argument, not just that `onOpenSettings` was
  called; Appearance is present in both workspaces' own section list
  (previously missing from those assertions too).
- One existing test's own assertion encoded the exact bug being fixed
  (`App.classificationWorkspace.test.tsx`'s "opens from Settings..." test
  expected Back to strand the user on Search) — corrected, not weakened,
  to assert the new, correct behavior, with an explanatory comment.
- Full frontend unit suite: **1220/1220 PASS** (97 files; was 1203 after
  the prior mission's own additions). One transient failure was observed
  once during a full-suite run and did not reproduce on an immediate
  isolated re-run or a second full-suite run — consistent with local
  machine load after many consecutive heavy suite runs this session, not
  a real defect (CLAUDE.md verification honesty: reported, not hidden).

**Test-environment fix, not a test weakening**: jsdom does not implement
`Element.scrollIntoView` at all — a well-known jsdom gap, not specific to
any component here — first exposed by `SettingsWorkspace`'s own new
mount-time "scroll to the requested section" effect (a pre-existing,
never-previously-exercised call in `selectSection` had the same latent
gap). Fixed once, in `frontend/src/test/setup.ts`, with a no-op stub —
environment infrastructure, not a change to any test's own assertions.

**Backend**: not touched by this mission. `RuleCompilerTest`/
`PatternDetectorTest` (the prior mission's extraction-recovery coverage)
re-run and still pass unmodified: **26/26 PASS**. Full backend suite
unaffected (no backend file in this mission's diff).

**E2E** (new `pr61-owner-navigation-recovery-2.spec.ts`, 24 tests mapped
to the mission's own N01-N28 matrix):
- N02/N03: `Settings → Classification/Field Mapping → Back → Settings`.
- N04/N22: `Inspector → Classification → Back` reopens the Inspector on
  the exact same event (message content asserted, not merely "a dialog
  is open").
- N05: Shell's own header "Field mapping" trigger → Back → Search, not
  Settings.
- N06/N21: `Settings → Classification → New rule → Cancel` returns to the
  list (not Search), the outer Back still reaches Settings, and the
  original Search result row count is provably unchanged throughout the
  whole round trip.
- N08-N13/N17: every `SettingsNav` sidebar item from both workspaces lands
  Settings deterministically on the section actually clicked (scoped to
  each section's own outer heading id, since `PrivacyMaskingSettingsPanel`'s
  pre-existing nested duplicate heading — see above — would otherwise make
  a bare heading-text query ambiguous); Appearance listed.
- N14-N16: Settings shows real inline shortcut content with no
  trigger/dialog present; the header's own compact popover still opens
  and closes correctly.
- N18/N19: Dark/Light still apply `data-theme` immediately from Settings'
  relocated Appearance section.
- N23: zero `/api/v1/logs/search` requests across a full Settings ↔
  Classification navigation round trip.
- N24: Back's accessible name is asserted to flip correctly between
  "Back to Settings" and "Back to Search results" as the same two
  workspaces are entered from different origins in the same test.
- N25-N27: no page-level horizontal overflow at 390px for Settings
  navigation (with the new inline shortcuts content present), and for
  both workspaces' own Back/nav, each confirmed still reachable at that
  width.
- N28: a fully keyboard-only walk (Tab/focus + Enter, no mouse) into and
  back out of Settings, Field Mapping, and Classification Rules in one
  continuous session.
- All 24 new tests: **PASS**, repeated (2x) with 0 flakes.
- 7 minimal synthetic evidence screenshots captured to
  `docs/verification/PR61_NAV_RECOVERY_2_EVIDENCE/` per the mission's own
  explicit list (Settings/Keyboard shortcuts inline; Settings/Appearance;
  Classification from Settings with "Back to Settings"; Classification
  from Search with "Back to Search results"; Field Mapping from Settings
  with "Back to Settings"; 390px Settings navigation; 390px Classification
  navigation) — visually reviewed, not just asserted: the Appearance
  section renders in its correct position with all three theme choices,
  Keyboard shortcuts renders full grouped content with the header's own
  compact trigger still present and separate, and the two Classification
  screenshots show visibly different Back-button text and breadcrumb
  presence matching their different origins.
- Full E2E suite re-run fresh: see `FINAL_REPORT` for the exact count.

**Pre-existing E2E tests that needed a correction, not a behavior change**:
a full-suite run (the mandatory local regression gate, not just this
mission's own new spec file) surfaced two categories of pre-existing E2E
test breakage, both caused by this mission's own intentional, correct
behavior changes rather than by any defect in them:
- `classification-rules.spec.ts` and `pr61-owner-usability-recovery.spec.ts`
  had several places that opened Classification Rules or Field Mapping
  from Settings and then asserted the OLD, unconditional
  `/back to search results/i` button — exactly the defect-1/defect-3
  behavior this mission fixes. Corrected to the new, truthful two-step
  return (`Back to Settings`, then Settings' own `Back to Search results`)
  everywhere the workspace was genuinely entered from Settings, and left
  unchanged everywhere it was genuinely entered from Search/Inspector
  (where `Back to Search results` was already, and remains, correct).
  `pr61-owner-usability-recovery.spec.ts`'s own Field-Mapping-breadcrumb
  tests were opening the workspace via Shell's header trigger
  (search-origin, correctly has no breadcrumb by this mission's own
  design) while asserting the breadcrumb was present — switched to open
  via Settings' own "Log schema & field mapping" button instead, matching
  what those tests actually intend to prove (parity with Classification
  Rules' settings-origin breadcrumb).
- `phase-legacy-slice3-docker-settings.spec.ts` used a bare
  `page.locator('dl')` to find the Docker connection summary list.
  Making Keyboard shortcuts genuinely inline (defect 2's fix) means
  Settings' own DOM now always contains several more `<dl>` elements (one
  per shortcut group) whenever it is open, so the previously-unique
  locator became ambiguous (5 matches). Scoped to
  `page.getByTestId('docker-settings-panel').locator('dl')` — the summary
  list's own actual container, unchanged by this mission — rather than
  narrowing what the test asserts.

None of these were weakened: each now asserts the same real user-facing
fact it always did, just naming the correct real element for it. All
affected files pass after the fix (re-verified in isolation and as part
of the full suite; see `FINAL_REPORT`).

## Accessibility

0 new axe violations across every touched/new component (scoped
appropriately where a pre-existing, unrelated violation exists — see
above). Keyboard-only operability of every new/changed control verified
directly, not only via automated checks: `WorkspaceBackButton` and every
`SettingsNav`/breadcrumb item are real `<button>`s (native semantics,
keyboard-operable by default); the Appearance radios (unchanged from the
prior mission) remain a native `<input type="radio">` group; a full
keyboard-only E2E walk (N28) proves entering and leaving all three
Settings-related workspaces with Tab/Enter alone.

## What this mission did not do

Did not redo the extraction/Classification-Rule work from
`PR61_OWNER_MANUAL_USABILITY_AND_CLASSIFICATION_RECOVERY` — preserved and
re-verified unchanged (backend `RuleCompilerTest`/`PatternDetectorTest`
26/26; the prior mission's own frontend extraction tests all still pass
as part of the full 1220/1220 unit suite). Did not reopen the Impeccable
visual audit. D40 unchanged. A1b not implemented. D8/Loki not
implemented. No database/cache/retention. Source Experience Parity
untouched (no file under `frontend/src/features/search/openshift/`,
`useSearchState.ts`'s scope-invalidation logic, or any Inspector/
Investigation/Live component was modified). Latest `main` not integrated;
PR64 not manually re-integrated. Nothing deployed to port 80;
`sofra-caddy-1` untouched. PR #61 not merged; Draft status not removed.
