# PR #61 — owner manual usability & Classification Rule recovery

Mission: `PR61_OWNER_MANUAL_USABILITY_AND_CLASSIFICATION_RECOVERY`. Branch
`ux/v2-modern-developer-console` (PR #61, draft). A targeted pre-merge
recovery after real owner manual testing exposed usability and
Classification Rule defects the automated suite had not sufficiently
caught — not a redesign, not another visual-fidelity audit, not permission
to merge.

```
START_HEAD=d32bca83c47ab6b9631d4ebbedd2dc05a42b5fc4
END_HEAD=<recorded at push, see FINAL_REPORT>
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
