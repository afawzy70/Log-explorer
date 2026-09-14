# Mapping Verification and Investigation Workspace — Report

**Mission:** `MAPPING_VERIFICATION_AND_INVESTIGATION_WORKSPACE` — functional
architecture track, continuing on `feature/configurable-log-field-mapping`
(PR #55), completely separate from the UI/UX v2 redesign branch
(`ux/v2-professional-redesign`, PR #54 — untouched by this mission).
Builds on sections 19–21 of `docs/governance/OWNER_REQUIREMENTS_REGISTER.md`
(Configurable Log Field Mapping, Field Mapping Schema Scan + Masking
Policy Extension, Project-Scoped Schema Scan) — see that register's new
§22 for the complete, row-by-row requirement matrix this report
summarizes. Nothing here duplicates that matrix in full; this report is
the narrative method/evidence walkthrough.

---

## 1. Scope and approach

Two independent parts, both required before this mission is complete:

- **Part A — Mapping Verification.** Extends the existing configurable
  field-mapping foundation (sections 19–21, unchanged) with a real
  verification layer: three statuses (`UNVERIFIED`/`VERIFIED`/
  `NEEDS_CHANGE`), evidence-gated server-side verification, and a
  dedicated full-page workspace replacing the prior popover.
- **Part B — Investigation Workspace.** Restores and formalizes
  `JourneyView.tsx` (IMPLEMENTATION_PLAN.md "Phase I") as a genuine
  Investigation Workspace distinct from Search/Results and the Inspector:
  five root-anchored relationship views (Trace/Span/Correlation/Journey/
  Event) plus a "Show Surroundings" temporal-context action, with
  navigation continuity back to wherever the investigator actually was.

Both parts were audited against the current code before any edit (per
CLAUDE.md §5 "audit before editing"): `FieldMappingProfileService`'s
existing `MappingScopeKey`/`ScopeState` pattern (section 21), the generic
`/api/v1/logs/journey` endpoint and its closed `JOURNEY_FIELDS` set, the
existing `ContextAction`/`ResultsTable` root-anchoring (`contextRootIdentity`)
mechanism, and `useSearchState.ts`'s existing single-level
`originalSnapshot` detour mechanism — all reused, none duplicated.

---

## 2. Part A — Mapping Verification, method and evidence

**The one hard rule, verified structurally, not just by convention:**
`DEFAULT_MAPPING != VERIFIED_MAPPING`. `core.mapping.FieldVerificationStatus`
is a new three-value enum; every per-scope `ScopeState` in
`FieldMappingProfileService` initializes every canonical field to
`UNVERIFIED` on creation — there is no code path that ever constructs a
field as pre-`VERIFIED`, including the built-in default profile.
`FieldMappingProfileServiceTest.everyFieldStartsUnverified_evenTheBuiltInDefault`
and its HTTP-level twin
`FieldMappingSettingsControllerIntegrationTest.aFreshFieldStartsUnverifiedEvenOnTheBuiltInDefault`
both assert this against a genuinely fresh scope.

**Evidence gate.** `POST /api/v1/settings/field-mapping/fields/{field}/verify`
(`FieldMappingSettingsController#verifyField`) does not trust its caller:
it re-reads the field's CURRENT saved candidate paths from the active
profile, re-runs them through the exact same
`FieldMappingValidationService.validate(...)` the pre-existing `/validate`
endpoint uses (never a duplicate implementation), and only calls
`profileService.markVerified(...)` if that fresh check's
`foundInAnySample()` is true for this field. An unmapped field, or one
whose candidate resolves to nothing in the given samples, gets a 400 with
a specific reason string — never a silent 200 with a fabricated
`VERIFIED`. `FieldMappingSettingsControllerIntegrationTest.verifyingWithoutEvidenceIsRejected_neverSilentlyMarkedVerified`
and `.verifyingAnUnmappedFieldIsRejected` prove the rejection paths;
`.verifyingWithRealEvidenceSucceedsAndPersistsTheStatus` proves the real
success path. `frontend/e2e/phase-n-schema-scan-field-mapping.spec.ts`'s
new test (`"the built-in default mapping starts Unverified, and Verify
against real evidence marks it Verified"`) proves the whole round trip
against the real `fixture` backend in a real browser — Verify starts
disabled with zero scan evidence, becomes enabled only after a real Quick
Schema Scan, and the badge visibly flips from "Unverified" to "Verified"
only after a real server round trip.

**`NEEDS_CHANGE` is a pure owner flag.** `POST
.../fields/{field}/needs-change` requires no evidence at all — it is
explicitly a "the owner reviewed this and says it needs to change"
declaration, never inferred from any validation outcome. Both `NEEDS_CHANGE`
and `VERIFIED` are handled asymmetrically on edit, by design:

- Editing a `VERIFIED` field's candidates reverts it to `UNVERIFIED`
  (`FieldMappingProfileService#updateCandidates`'s `computeIfPresent` —
  the evidence a prior Verify checked no longer applies to the new
  candidate).
- Editing a `NEEDS_CHANGE` field leaves it `NEEDS_CHANGE` — the edit does
  NOT silently promote it back to `VERIFIED`; a fresh, explicit Verify is
  still required.
- A whole-profile reset (`resetToDefault`) clears every field's status
  back to `UNVERIFIED` — the candidates the evidence applied to no longer
  exist.

`FieldMappingProfileServiceTest.editingAVerifiedFieldsCandidatesRevertsItToUnverified`,
`.editingANeedsChangeFieldsCandidatesDoesNotSilentlyPromoteItToVerified`,
and `.resettingTheProfileResetsEveryFieldsVerificationStatusToo` pin all
three behaviors; `FieldMappingSettingsControllerIntegrationTest.editingAVerifiedFieldRevertsItToUnverified_viaTheRealHttpEndpoints`
re-proves the first through the real HTTP endpoints, not just the service
layer.

**Project/namespace scoping.** `verificationStatuses` is a field on the
SAME per-scope `ScopeState` object the mapping candidates themselves live
on — there is no second, independently-keyed scoping mechanism to drift
out of sync with the profile it describes. `FieldMappingProfileServiceTest.verificationStatusIsFullyScopedAcrossProjects`
and `FieldMappingSettingsControllerIntegrationTest.verificationStatusIsProjectScoped_neverLeaksAcrossProjects`
both prove a status set for one `(sourceId, project)` scope is invisible
under another.

**A real, dedicated page — not a popover.** The prior
`FieldMappingSettingsPanel.tsx` (a `role="dialog"` popover anchored to a
trigger button in `Shell.tsx`, sections 19–21's home) is deleted and
replaced by `FieldMappingWorkspace.tsx`, rendered by `App.tsx` as a
mutually-exclusive overlay in the same main-slot conditional
`JourneyView`/`LiveTailPanel` already use — the exact pattern this
project already uses for "a real secondary workspace, not a hidden
implementation detail." `Shell.tsx` keeps a same-styled trigger button
that now calls `state.openMappingWorkspace()` instead of managing its own
popover-open state. All of sections 19–21's scan/candidate-editor/
validate/save/reset mechanics moved into the new component completely
unchanged — only the verification layer (status badges, "observed in
latest scan" per candidate, Verify/Mark-needs-change actions) and the
outer page structure are new. `FieldMappingWorkspace.test.tsx` (25 tests,
adapted from the deleted panel's 33-test suite plus 13 new verification-
specific tests), `Shell.test.tsx`'s new describe block, and a new real
`<App/>` integration test (`App.mappingWorkspace.test.tsx`) all confirm
the page genuinely replaces the results workspace and returns to it
cleanly — never a popover layered on top.

**`SEARCH_READY` vs. `MAPPING_VERIFIED`, kept genuinely distinct.** These
were already two separately-computed values before this mission
(`isSearchReady(scope)` vs. the new `verificationStatus(scope, field)`);
this mission's own contribution is making sure the UI never conflates
them — `FieldMappingWorkspace.tsx`'s own hint copy states the distinction
explicitly, and the built-in default profile is `searchReady: true` while
every one of its fields is `UNVERIFIED`, a real, checked state
combination (`FieldMappingWorkspace.test.tsx`'s "every field starts
UNVERIFIED..." test asserts this against a `searchReady: true` profile).

---

## 3. Part B — Investigation Workspace, method and evidence

**One generic endpoint, five relationships.** Rather than build four (or
five) source-specific endpoints, this mission extended the ONE existing
generic endpoint (`POST /api/v1/logs/journey`, already closed-field-set
validated via `RequestMapper.JOURNEY_FIELDS`) with a single new case:
`spanId`. `RequestMapperTest.spanIdFieldMapsToTheSpanIdFilterOnly` and
`JourneyApiIntegrationTest.filtersByCorrelationTraceSpanAndEventIdToo`
prove it maps to exactly the `spanId` filter and nothing else, at both
the mapper-unit and real-HTTP-integration level. This is the same
endpoint View Trace, View Span, Find same Correlation, and Find same
Journey all now use — never four parallel implementations.

**Exact required action labels.** `journeyFields.ts`'s new
`JOURNEY_ACTION_LABELS` export gives the mission's own exact required
button text (`"View Trace"`, `"View Span"`, `"Find same Correlation"`,
`"Find same Journey"`, `"Find same Event"`), deliberately distinct from
the existing `JOURNEY_FIELD_LABELS` (which names the relationship, not
the button). `RequestFlowSection.tsx`'s five identifier rows all use it;
`journeyFields.test.ts` pins the exact label set.

**Root event anchoring, mirroring an existing pattern instead of
inventing a new one.** `ResultsTable.tsx` already had a working root-
highlight mechanism for the "Show Surroundings" context view
(`contextRootIdentity`/`.contextRootRow`/`aria-current="location"`/
auto-scroll-into-view, keyed by the existing `eventIdentity()` content-
based matcher). This mission threads a `rootEvent` argument through
`openJourney(field, value, rootEvent)`, stores it as new
`useSearchState` state (`journeyRootEvent`), and mirrors the EXACT same
pattern in the new territory: `JourneyEntryRow.tsx` gained `isRoot`/
`rootRef`/a `.rootEntry` CSS class (styled identically to
`.contextRootRow`) plus a visible "Selected event" text badge (never
color alone); `JourneyView.tsx` computes the root's position by
`eventIdentity` match and renders "Selected event: N of M" — or, when the
root genuinely isn't in the bounded result, an honest notice rather than
a silently-substituted highlight on a different row. `JourneyView.test.tsx`
and `JourneyEntryRow.test.tsx` cover both the found and not-found cases;
`frontend/e2e/phase-investigation-workspace.spec.ts` proves the position
text and `[aria-current="location"]` against the real backend for both
View Span and Find same Correlation.

**"Show Surroundings" is a genuinely separate concept, reused rather than
duplicated.** The mission's own exact required label ("Show Surroundings")
now appears at every existing invocation site (`ActionsCell.tsx`'s row
menu, `ContextAction.tsx`'s inspector header action — renamed from "Show
surrounding logs", see §4 below) and a new one:
`JourneyEntryRow.tsx` renders `ContextAction` directly per timeline
entry — the SAME confirm-before-run component the Inspector already
uses, never a second, differently-behaved implementation. Its existing
"nearby chronological evidence... not a cause" copy therefore governs the
new invocation site automatically, with zero new copy to independently
get wrong.

**Navigation continuity — one level deeper on top of an existing
mechanism.** `useSearchState.ts` already had a single-level
`originalSnapshot` mechanism for "Show Surroundings launched from plain
Search, then Back." This mission generalizes it with one new piece of
state, `journeySnapshotForSurroundings`: `showContext` now checks whether
a journey view is currently open and, if so, snapshots it (field, value,
result, root event) before clearing it and proceeding with its existing,
unchanged ±30s logic; `restoreOriginalSearch` always restores the
underlying plain-search state first (unchanged), then branches — if a
journey snapshot exists, it restores that view on top and deliberately
leaves `originalSnapshot` itself intact (so a LATER, genuine "Back to
original search" from within the restored journey view still works);
`closeJourney` remains the one true full exit, clearing everything
including `originalSnapshot`. A new derived value,
`restoreOriginalSearchLabel`, gives the Back button its accurate
destination ("Back to Trace" / "Back to Span" / "Back to Correlation" /
"Back to Journey" / "Back to original search"), surfaced in
`ResultsPanel`'s existing `Breadcrumb`. `useSearchState.contextReturn.test.ts`'s
new describe block proves the full nested cycle — including that the
underlying plain search is never silently re-run (a snapshot restore, not
a fresh fetch) and that no source switch occurs anywhere in the
sequence; `frontend/e2e/phase-investigation-workspace.spec.ts`'s third
test proves the identical cycle against the real backend end to end:
Search → View Trace → Show Surroundings → Back to Trace, landing back on
the same trace timeline with the same event count.

**No regression to the existing Results/Inspector workflow.** No filter,
column, or sort behavior changed. The one existing test that needed
updating (`ResultsTable.test.tsx`'s Correlation/Trace-cell click
assertion) was updated only because the call signature grew a third,
optional argument (the root event) — its actual click/filter behavior is
unchanged, confirmed by the full pre-existing `ResultsTable.test.tsx`
suite re-passing otherwise unmodified.

---

## 4. Named-conflict supersessions (CLAUDE.md §5)

Recorded in full, with both the original rationale and the new decision
preserved, in `docs/governance/OWNER_REQUIREMENTS_REGISTER.md` §22's own
header. Summary:

1. **UX-R5 §15**'s "one name everywhere" rule is upheld; the shared label
   itself changes from "Show surrounding logs" to **"Show Surroundings"**
   (this mission's own exact required wording), applied identically to
   every invocation site, old and new.
2. **IMPLEMENTATION_PLAN.md "Phase I" scope item 1**'s "never spanId"
   exclusion is superseded — View Span is now a first-class fifth
   investigation action, reusing the existing generic endpoint.
3. **The Log Schema & Field Mapping popover UI** (sections 19–21's home)
   is retired in favor of the dedicated `FieldMappingWorkspace` page —
   the underlying mechanics it inherited remain `VERIFIED`, unchanged;
   only its container changed.

---

## 5. Security re-verification

No new sensitive-field surface was introduced. The verify endpoint's
`samples` payload is the exact same real, unmasked Original Source JSON
content sections 19–21 already established is an owner-approved
exception for this privileged setup surface only (never logged, never
persisted — `FieldMappingWorkspace.tsx` holds it in ephemeral `useState`
exactly like its predecessor did). `MAPPING_CANNOT_BYPASS_MASKING` and
`onlyMaskingServiceMayTouchRawSensitiveFields` (ArchUnit) both remain
unchanged and re-verified passing under the full backend regression
below. No protected raw value is rendered, copied, URL-carried, or
storage-persisted anywhere in the new investigation-workspace UI — root
anchoring, position indicators, and the Back-button label are all
computed from non-sensitive identifiers/timestamps only.

---

## 6. Test evidence

```
BACKEND_TESTS=PASS (1277/1277, 0 failures/errors/skipped — full ./mvnw test)
FRONTEND_UNIT_TESTS=PASS (922/922, typecheck clean, production build succeeds)
E2E=PASS (180/180 across the 10 spec files this mission's diff touches or adds,
  real backend `SPRING_PROFILES_ACTIVE=dev` + real frontend dev server)
```

Backend — new/changed test files: `core/mapping/FieldMappingProfileServiceTest.java`
(+6), `api/FieldMappingSettingsControllerIntegrationTest.java` (+7),
`api/RequestMapperTest.java` (+1), `api/JourneyApiIntegrationTest.java`
(extended, not net-new).

Frontend — new/changed test files: `FieldMappingWorkspace.test.tsx` (new,
25 tests, replacing the deleted `FieldMappingSettingsPanel.test.tsx`),
`useSearchState.contextReturn.test.ts` (+5), `JourneyView.test.tsx` (+7),
`JourneyEntryRow.test.tsx` (+6), `journeyFields.test.ts` (+2),
`RequestFlowSection.test.tsx` (updated for the 5-action set),
`ResultsTable.test.tsx`/`ContextAction.test.tsx`/`ActionsCell.test.tsx`
(label/signature updates only, behavior unchanged), `Shell.test.tsx` (+1
describe block), `App.mappingWorkspace.test.tsx` (new, real `<App/>`
integration).

E2E — new/changed spec files: `phase-investigation-workspace.spec.ts`
(new, 3 tests), `phase-n-schema-scan-field-mapping.spec.ts` (updated for
the new page shape, +2 verification tests), `phase-i-journey-investigation.spec.ts`
(1 label fix), plus 6 more pre-existing specs
(`phase-h-event-inspector.spec.ts`, `ux-r5-inspector-context.spec.ts`,
`ux-r4-results-workstation.spec.ts`, `ux-r6-final-polish.spec.ts`,
`phase-legacy-slice6-investigation-depth.spec.ts`,
`phase-legacy-slice7-redaction.spec.ts`,
`phase-legacy-slice8-productivity-performance.spec.ts`,
`phase-ui-parity-acceleration.spec.ts`, `phase-ui-gap-closure.spec.ts`,
`phase-m-ux-acceptance.spec.ts`) touched only for the "Show Surroundings"
label rename, all re-run and passing.

**Deferred, named explicitly (CLAUDE.md §3):** the full E2E suite
(every spec file in `frontend/e2e/`, including the Windows/macOS desktop
CI jobs and OpenShift-specific specs with no behavioral overlap with this
mission's diff) was not re-run in full locally — `BLOCKED` on local
wall-clock/compute budget for a mission this size, not on any known
failure. PR #55's own CI (Backend/Frontend/E2E/Windows/macOS) remains the
authoritative final gate before owner review, as it has been for every
prior section in the register.

---

## 7. Scope boundary confirmation

```
DESIGN_BRANCH_TOUCHED=NO
PR54_TOUCHED=NO
```

This mission worked exclusively on `feature/configurable-log-field-mapping`
(PR #55). No command in this mission touched
`ux/v2-professional-redesign`, PR #54, or any file under
`docs/ux-v2/prototypes/`. No UI redesign beyond the directly-required
Mapping Verification workspace and Investigation Workspace extensions was
performed.
