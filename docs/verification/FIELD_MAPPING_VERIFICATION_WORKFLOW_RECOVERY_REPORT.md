# Field Mapping Verification Workflow Recovery — Report

**Mission:** `FIELD_MAPPING_VERIFICATION_WORKFLOW_RECOVERY` — a narrow
recovery mission against `main`, on a NEW branch
(`fix/field-mapping-verification-workflow`), a SEPARATE PR from the
already-merged PR #55, never touching PR #54 /
`ux/v2-professional-redesign`. Fixes a real, owner-reported functional
defect found in the Mapping Verification Workspace (section 22 of
`docs/governance/OWNER_REQUIREMENTS_REGISTER.md`) after real-world
testing against real logs.

---

## 1. Owner-observed defect

Quick Schema Scan finds real paths. The UI shows a path as "observed in
latest scan" alongside a real sample value ("Found: `<value>`"). The
owner selects that exact discovered path from the dropdown picker.
Despite this, the field stays `UNVERIFIED`, and clicking Verify still
returns:

> Cannot verify … candidate path was not found in any of the given
> samples.

For `Exception` specifically: `stack_trace` is observed in the latest
scan with a real sample shown; the unobserved fallback candidate
`exception` alone caused verification to fail.

---

## 2. Root cause (confirmed by inspection before editing)

Per CLAUDE.md §5 ("audit before editing"), the existing implementation
was read in full before any change. `frontend/src/features/settings/fieldMapping/FieldMappingWorkspace.tsx`'s
`runSave()` called only:

```
POST /api/v1/settings/field-mapping/save
```

— `FieldMappingProfileService#confirmSave` (backend), which is a pure
boolean-flag flip (`validatedAndSaved.set(validationPassed)`). By its own
existing javadoc, it **never touches the active profile's candidate
paths**. Before that, `runValidate()` calls `POST /validate`, which is
intentionally **stateless** — it validates the caller-supplied draft
directly, without requiring it to be persisted first (also by design, so
a partial edit can be validated in context without a round trip).

The ONLY endpoint that ever mutates a scope's active profile candidates
is:

```
PUT /api/v1/settings/field-mapping/fields/{field}
```

— `FieldMappingProfileService#updateCandidates`. **`runSave()` never
called it.** This was true from the very first "Configurable Log Field
Mapping" mission's `FieldMappingSettingsPanel.tsx` (commit `7e04b57`)
onward, carried unchanged through three subsequent missions (Schema Scan,
Project-Scoped Schema Scan, Mapping Verification and Investigation
Workspace) and never caught, because no test at any layer asserted that a
field's candidate paths, as returned by a **subsequent** `GET`, actually
reflect what a preceding edit-then-save round trip submitted.

**Consequence:** the owner's newly-picked discovered path was validated
and shown as "Found: `<value>`" (correct — `/validate` checks the draft
directly), but never actually persisted to the backend's saved profile.
The saved profile silently kept its old candidate. Verify — which by
design reads the saved/active profile, not the draft (this is correct
behavior, unchanged by this fix) — then correctly rejected the
still-old, unobserved candidate. The exact contradiction the owner saw.

**What was already correct, confirmed by inspection and by the pre-existing
test suite before any new tests were added:** the backend's ordered-candidate
resolution (`core.mapping.FieldMappingResolver`, "first usable non-null
value wins") and `core.mapping.FieldMappingValidationService`'s
`foundCount`/`foundInAnySample()` computation. Both already implement
first-usable-candidate-wins semantics correctly — `FieldMappingResolverTest`
already had `nullFirstCandidate_populatedSecondCandidate_secondWins` and
`firstUsableNonNullCandidateWins_earlierCandidatePreferredOverLater`
passing before this mission touched anything. **No backend logic change
was needed or made** — only new regression coverage proving these
semantics end to end through the real `/verify` HTTP endpoint, since that
endpoint had no prior test with more than one candidate path.

---

## 3. The fix

### 3.1 Draft vs. saved state (the actual root-cause fix)

`FieldMappingWorkspace.tsx#runSave()` now pushes every edited field's
current draft to the backend via `PUT /fields/{field}` — the *same*
draft that was just validated, unchanged — **before** confirming the
save:

```ts
function runSave() {
  if (!validationReport || !validationReport.passed) {
    return;
  }
  setSaving(true);
  setActionError(null);
  const editedFields = Object.entries(drafts) as [CanonicalFieldKey, string[]][];
  Promise.all(
    editedFields.map(([field, candidatePaths]) =>
      updateFieldMappingCandidates(field, candidatePaths, sourceId ?? undefined, project),
    ),
  )
    .then(() => saveFieldMappingProfile(validationReport.passed, sourceId ?? undefined, project))
    .then(() => {
      setDrafts({});
      setValidationReport(null);
      onProfileChanged();
    })
    .catch((error: unknown) => setActionError(error instanceof Error ? error.message : 'Save failed'))
    .finally(() => setSaving(false));
}
```

If persisting any field fails, `drafts` is **not** cleared — the owner
can retry without re-entering anything, matching the mission's "no
circular dependency" requirement. This closes the workflow the mission
describes: **Edit → Validate (checks the draft) → Save (now genuinely
persists that same draft) → Verify (now genuinely checks what was just
saved)** — pattern A from the mission's own acceptable-implementation
list.

`canSave` was also tightened to require the draft's validation to have
actually **passed**, not merely to exist:

```ts
const canSave = hasUnsavedEdits && validationReport != null && validationReport.passed && !saving;
```

Previously a failed validation (an invalid path) could still be
"saved" — which only meant `confirmSave` persisted `validationPassed:
false` (still correctly blocking search), but with no clear signal to
the owner about why nothing became ready. Now Save itself stays visibly
disabled until validation genuinely passes, matching the mission's
explicit "Save must be enabled when: unsaved edits AND current draft
validation passes."

### 3.2 The owner should never have to guess which version is checked

A visible, textual "Unsaved changes" marker (`.unsavedBadge`, never
color alone) now appears directly next to the verification status badge
— the exact place the owner is already looking when wondering why a
field won't verify. The existing "Verify disabled while a draft is
pending" behavior (pattern A: disable + a clear, actionable reason) is
kept and its hint copy strengthened to explicitly name the **"6. Save
mapping"** button.

### 3.3 First-usable-candidate-wins verification (already correct — proven, not changed)

No backend logic changed. New regression tests were added at all three
layers a real Verify call passes through:

- **Resolver** (`FieldMappingResolverTest`, pre-existing coverage
  confirmed sufficient — no new tests needed here).
- **Validation service** (`FieldMappingValidationServiceTest`, 4 new
  tests): multi-candidate `foundCount` aggregation across samples —
  first-present/second-absent, first-absent/second-present,
  all-absent, and "found in at least one of several samples is enough."
- **Real HTTP `/verify` endpoint** (`FieldMappingSettingsControllerIntegrationTest`,
  6 new tests): the owner's exact `[stack_trace, exception]` scenario;
  the default `CORRELATION_ID` field's real two-candidate precedence
  (`mdc.X-Correlation-id` / `mdc["event.correlationId"]`, the mission's
  own second worked example); all-candidates-absent → 400; an invalid
  path rejected at the one place candidates are ever mutated (`PUT`),
  so it can never even reach a saved profile to verify; and one
  end-to-end test (`foundSampleAndVerifyNeverContradict_theOwnerScenarioEndToEnd`)
  replaying the owner's exact workflow — PUT → validate (asserting
  `foundInAnySample()==true`, i.e. what the UI shows as "Found") → save
  → verify, all against the SAME real project scope and the SAME sample
  string — plus a test proving a technically-valid mapping saves cleanly
  even while most fields remain `UNVERIFIED`.

### 3.4 Optional/absent fields never block Save

Confirmed unchanged by design and covered by a new test
(`validMappingCanBeSavedWithUnverifiedFields_verificationNeverGatesSave`):
`canSave`/`confirmSave` never read verification status at all — a field
with valid-syntax-but-absent-in-samples candidates (`mappedButAbsent`)
never fails `passed` (`passed = !anyInvalidPath`, unaffected by
absence), so it never blocks saving an otherwise-valid mapping.

---

## 4. Real-browser proof against the actual owner scenario

A new Playwright E2E test
(`frontend/e2e/phase-n-schema-scan-field-mapping.spec.ts`, "a picked
candidate genuinely persists after Save (proven by reopening the
workspace) and then Verify succeeds against exactly that saved value")
drives the real `fixture` backend end to end:

1. Run a real Quick Schema Scan.
2. Remove CIF's default candidate, pick a different real discovered path
   from the picker.
3. Validate → Save.
4. **Leave the Mapping Verification Workspace entirely and reopen it** —
   a genuine fresh `GET`, not client memory.
5. Assert the newly-picked path (not the old default) is what's shown.
6. Rescan (a fresh scope of evidence) and click Verify.
7. Assert the field becomes `Verified`, with no error banner.

This test would have failed before the fix (step 6 would have returned
the 400 rejection the owner saw) and passes after it — the strongest
available proof this recovery mission actually fixes the reported defect,
not just a plausible-looking reinterpretation of it.

---

## 5. Test evidence

```
BACKEND_TESTS=PASS (1287/1287 — 1277 pre-existing + 10 new, 0 failures/errors/skipped)
FRONTEND_TESTS=PASS (925/925 — 922 pre-existing + 3 new)
TYPECHECK=PASS
PRODUCTION_BUILD=PASS
E2E=PASS (phase-n-schema-scan-field-mapping.spec.ts: 8/8, including the new recovery test, against the real backend `SPRING_PROFILES_ACTIVE=dev` fixture source)
```

New/changed test files:
- `backend/src/test/java/com/logexplorer/api/FieldMappingSettingsControllerIntegrationTest.java` (+6)
- `backend/src/test/java/com/logexplorer/core/mapping/FieldMappingValidationServiceTest.java` (+4)
- `frontend/src/features/settings/fieldMapping/FieldMappingWorkspace.test.tsx` (+3 net: 2 new save-flow tests, 1 new full-workflow test, 1 test rewritten to match the corrected `canSave` gate)
- `frontend/e2e/phase-n-schema-scan-field-mapping.spec.ts` (+1)

Required-flag checklist from the mission prompt:

```
SELECT_DISCOVERED_PATH_THEN_VALIDATE_SAVE_VERIFY=PASS
VERIFY_USES_CURRENT_SAVED_MAPPING_AFTER_SAVE=PASS
VISIBLE_DRAFT_AND_VERIFIED_VALUE_CANNOT_DIVERGE=PASS
FIRST_USABLE_CANDIDATE_WINS_VERIFICATION=PASS
STACK_TRACE_PRESENT_EXCEPTION_FALLBACK_ABSENT=PASS
FIRST_CANDIDATE_ABSENT_SECOND_CANDIDATE_PRESENT=PASS
ALL_CANDIDATES_ABSENT=VERIFY_FAIL (confirmed)
INVALID_JSON_PATH=VERIFY_FAIL (confirmed, rejected at the PUT step)
OPTIONAL_FIELD_NOT_OBSERVED_DOES_NOT_BLOCK_SAVE=PASS
VALID_MAPPING_CAN_BE_SAVED_WITH_UNVERIFIED_FIELDS=PASS
PROJECT_SCOPE_PRESERVED=PASS
NO_CROSS_PROJECT_SAMPLE_MISMATCH=PASS
REAL_SAMPLE_FOUND_AND_VERIFY_CONTRADICTION=NO
```

---

## 6. Scope boundary confirmation

```
DESIGN_BRANCH_TOUCHED=NO
PR54_TOUCHED=NO
```

This mission worked exclusively on a new branch,
`fix/field-mapping-verification-workflow`, based on `main` at
`399fe2b200d3ea7404e5043b6e3415590ca51934` (the already-merged PR #55).
No command in this mission touched `ux/v2-professional-redesign`, PR
#54, or the already-merged/closed PR #55 branch.
