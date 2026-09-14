# Configurable Log Field Mapping + Original JSON Sampling — Report

**Mission:** `CONFIGURABLE_LOG_FIELD_MAPPING` — functional architecture
track, completely separate from the UI/UX v2 redesign branch (`ux/v2-professional-redesign`,
PR #54 — untouched by this mission). Branch: `feature/configurable-log-field-mapping`,
based on `main` at `ed6dbf578451f0ebca4e769b9b04af7137937031`.

---

## 1. Root-cause confirmation

**Owner's observed defect:** filtering by CIF returned no results even
though the original log event contained CIF.

**Confirmed root cause.** `backend/src/main/java/com/logexplorer/core/parse/LogLineParser.java`
(pre-fix) extracted every sensitive/business canonical field via a single,
hard-coded literal path — always `mdc.<exact-key>` — with zero fallback
to any other location:

```java
builder.sensitive(new RawSensitiveFields(
    asString(mdc.get("cif")),
    asString(mdc.get("UserName")),
    asString(mdc.get("CustomerId")),
    asString(mdc.get("deviceId")),
    asString(mdc.get("deviceIp"))));
```

If a source event's `cif` value is at the JSON **top level** (or under any
key other than the literal `mdc.cif`), `mdc.get("cif")` is `null` —
`RawSensitiveFields.cif()` is `null` for that event, permanently. The
value is not discarded (it correctly lands in
`unknownTopLevelFields["cif"]`, per the existing "never discard unknown
fields" invariant), but it never reaches the canonical field the CIF
filter reads.

**Pipeline trace (confirmed by reading every stage):**

```
source raw event (JSON)
  → LogLineParser.parseObject()          [defect: hard-coded mdc.<key> only]
  → CanonicalLogEvent.sensitive().cif()  [null for a non-mdc.cif source]
  → EventFilters.matches() line 139      [reads event.sensitive().cif() directly]
       if (!fieldMatches(filters.cif(), raw.cif())) return false;
  → zero results, even though the source event genuinely had cif="2449"
```

`core.search.EventFilters` (structured filters) and `core.query.QueryFields`
(the DSL alias `cif` → `event.sensitive().cif()`) both read the exact same
`CanonicalLogEvent.sensitive()` accessor — filtering is **entirely
downstream of parsing**. This is why the fix is fully contained to the
parsing layer: no change to `EventFilters`, `QueryFields`,
`QueryPlanBuilder`, or `MaskingService` was needed for the bug itself to
be fixable.

`core.mask.MaskingService.mask()` likewise reads `event.sensitive()`
directly, entirely downstream of parsing — masking is structurally
blind to *which* JSON path supplied a sensitive value, which is what
makes `MAPPING_CANNOT_BYPASS_MASKING=YES` (§18) true by construction, not
by a separate enforcement rule.

**No existing test caught this class of bug.** `LogLineParserTest`
thoroughly covered *shape* (malformed lines, missing keys, unknown-field
preservation) but never an *alternate key spelling or top-level
placement* — and the Fixture corpus generator constructs its own sample
data using the exact same `mdc.*` literal keys the parser expected, so it
could never have surfaced this in testing. Confirmed via `grep` across
`backend/src/test/java` before writing the fix.

```
ROOT_CAUSE_CONFIRMED=YES
```

---

## 2. Architecture

New package `backend/src/main/java/com/logexplorer/core/mapping/`:

| Class | Role |
|---|---|
| `CanonicalField` | The 24 user-mappable canonical fields (enum), each with a stable wire `key()`, `displayName()`, and `sensitive()` flag |
| `JsonPath` | Deterministic, non-executable path parser/representation — dot-separated nested segments, `["literal.key"]` bracket syntax for a flat key containing special characters. No eval, no scripting (§21) |
| `JsonPathResolver` | Safe traversal of an already-parsed JSON `Map` tree — missing keys/non-map intermediates/null all resolve to `null`, never throw |
| `FieldMappingProfile` | Immutable: canonical field → ordered list of candidate `JsonPath`s |
| `DefaultFieldMappingProfile` | The built-in profile — reproduces the OLD hard-coded parser's exact paths, field for field (§11, §23 backward compatibility) |
| `FieldMappingResolver` | "First usable non-null/non-empty candidate wins; last candidate returned as-is" — the exact generalization of the old parser's single-path and two-candidate (`correlationId`) behaviors, proven equivalent by test |
| `FieldMappingProfileService` | The active profile + the search-readiness gate (`SEARCH_READY` / blocked) — in-memory, resets to the safe default on restart, same pattern as `MaskingPolicyService`/`OpenShiftProxyConfigService` |
| `FieldMappingValidationService` | Validates proposed candidates against real samples: found / absent / invalid-path / conflicting-candidate / structured-value-warning |
| `sample.FieldMappingSampleService` | Bounded (20 default, 50 max), stateless Original Source JSON sample fetch — reuses each source's own existing, already-bounded `search()` |

`core.parse.LogLineParser` is refactored to resolve every canonical field
(except `schemaVersion`/`severityNumber`, which aren't user-mappable per
mission §8's field list) through `FieldMappingResolver` against the
active profile, rather than hard-coded extraction. **There is now exactly
one authoritative field-resolution mechanism** (mission §24) — the old
hard-coded block is gone, not duplicated alongside the new one.

`CanonicalLogEvent` gained two new fields:
- `journeyName` (mission §9 — see §4 below).
- `originalRawJson` — always populated (unlike `rawLine`, malformed-only),
  used exclusively by the sample-fetch service. **Never** referenced by
  `api.EventMapper` (the sole `CanonicalLogEvent`→DTO boundary) — it
  cannot reach `EventDto`/the normal `/search` response by construction.

---

## 3. Original Source JSON — true raw event (§3)

`FieldMappingSampleService.fetchSamples` reuses each source's real,
already-bounded `LogSource.search()` (the same call every ordinary search
already makes) and extracts `CanonicalLogEvent.originalRawJson()` —
the exact source line/JSON text before any canonical normalization. It
is source-neutral by genuine architectural construction: all four
sources (Fixture, Docker, OpenShift, Loki) route through the same
`LogLineParser`, so `SourceCapabilities.originalSchemaSampling` is
truthfully `true` for all four — not fabricated (§6): it reflects a real,
uniform property, not an assumption.

```
ORIGINAL_SOURCE_JSON_SUPPORTED=YES (all 4 sources)
ORIGINAL_SAMPLE_IS_ACTUAL_SOURCE_EVENT=YES
```

---

## 4. Journey Name decision (§9)

Audited: `CanonicalLogEvent` had `journeyId` only — no journey-*name*
equivalent existed anywhere in the backend or frontend
(`grep -rn "journeyName"` returned zero hits before this mission).

**Decision:** added `CanonicalField.JOURNEY_NAME` as a new, genuinely
distinct canonical field (never equated with `journeyId` — a journey ID
identifies one journey *instance*; a journey name like `"SIGN_IN"`
identifies which journey *kind* it is). Wired end to end: `CanonicalLogEvent`,
`EventDto`, `EventMapper`, `SearchRequest`/`SearchRequestDto`/`RequestMapper`
(as a plain exact-match filter field — deliberately **not** added to
`RequestMapper.JOURNEY_FIELDS`, the narrower "Find this…" correlation-click
set, since a journey name is a category label, not a correlation
identifier to follow), `EventFilters`, `core.query.QueryFields` (DSL alias
`journeyname`).

Per mission §11's explicit instruction not to invent unverified defaults,
`DefaultFieldMappingProfile` ships `JOURNEY_NAME` with **zero** default
candidate paths — it is real, filterable, and mappable, but genuinely
unmapped until the owner confirms a real path against real source JSON.

```
JOURNEY_NAME_CANONICAL_DECISION=ADDED_AS_NEW_DISTINCT_FIELD_NO_DEFAULT_MAPPING_YET
```

---

## 5. Security review (§29)

```
MAPPING_SECURITY_REVIEW=PASS
```

- **Original sample not logged.** Verified by `FieldMappingSettingsLeakTest`
  (real Logback capture at the same DEBUG "realistic troubleshooting
  ceiling" `LogLeakTest` already establishes). **A genuine, narrow gap was
  found and fixed as part of this verification**: Spring's own codec
  logging (`org.springframework.core.codec.CharSequenceEncoder`/
  `StringDecoder`, and the shared `org.springframework.web.HttpLogging`
  marker logger some call sites route through instead) logs raw,
  pre-parse request/response body bytes at DEBUG, truncated to a fixed
  length — independent of any DTO's own redacted `toString()`.
  `LogLeakTest`'s existing sentinel values happened to sit past that
  truncation point in its own request shape, so this was never actually
  exercised before; this mission's own shorter-bodied endpoints are not
  truncated before the sensitive value, and would have logged it
  verbatim. Fixed by pinning both logger categories to `INFO` in
  `backend/src/main/resources/application.yml`, the same discipline
  already applied to `reactor.netty`/`io.netty` — a real, appropriately-scoped
  fix to the actual vulnerability found, not a broader logging redesign.
- **No sample in URL.** Both the sample-fetch and validate endpoints are
  `POST` with the sample content in the request/response body, never a
  query parameter.
- **No sample in localStorage.** Enforced by design (the backend never
  persists a sample at all — each fetch is a stateless request/response;
  see `FieldMappingSampleService`'s own javadoc) and by the frontend
  implementation (session-only React state — see the frontend section
  below).
- **Masked normal result still excludes raw protected field.** Confirmed
  in `CifFilteringRegressionTest.maskingStillAppliesRegardlessOfWhichPathSuppliedTheValue_mappingCannotBypassMasking` —
  a CIF resolved via a brand-new top-level path is still masked to
  `****` by the normal `/search` response.
- **Mapping does not bypass redaction.** Structural: `originalRawJson`
  never reaches `EventDto`; `MaskingService` only ever reads
  `event.sensitive()`, populated identically regardless of which
  `JsonPath` candidate supplied the value.
- **Invalid paths cannot execute code.** `JsonPath.parse` is a fixed,
  hand-written tokenizer with no `eval`, no scripting, no reflection —
  see `JsonPathTest.noEvalNoScripting_arbitraryExpressionSyntaxIsNotInterpreted`,
  which proves an expression-shaped string is treated as inert literal
  segments, never interpreted.
- **Sample memory bounded.** `FieldMappingSampleService.MAX_LIMIT = 50`,
  enforced server-side regardless of what a caller requests
  (`FieldMappingSampleControllerIntegrationTest.limitAboveTheSafeMaximumIsClamped_neverUnbounded`).
- **Credentials/tokens unaffected.** This mission touches only log-event
  field extraction and a new settings surface — no code path here reads,
  stores, or transmits OpenShift tokens, Docker TLS certificates, or any
  other credential.

---

## 6. Backward compatibility (§23)

```
BACKWARD_COMPATIBILITY=YES
FIXTURE_COMPATIBILITY=YES
DOCKER_COMPATIBILITY=YES
OPENSHIFT_COMPATIBILITY=YES
LOKI_COMPATIBILITY=YES
```

The built-in default profile reproduces the OLD hard-coded parser's
extraction exactly — proven by `DefaultFieldMappingProfileTest`
(asserts every literal path string matches the old hard-coded key,
field for field) and empirically by the **full existing backend test
suite passing unchanged, byte-for-byte, after the refactor**: 1078/1078
pre-existing tests still pass, zero modified expectations, run
immediately after the `LogLineParser` refactor and again in every
subsequent full run. No source (Fixture/Docker/OpenShift/Loki) needed
any change to its own adapter code — all four already routed through the
shared `LogLineParser`, so the mapping-layer refactor there covers all
four uniformly.

---

## 7. Test evidence

```
BACKEND_TESTS=PASS (1180/1180 — 1078 pre-existing + 102 new, zero failures)
MAPPING_TESTS=PASS (JsonPathTest 17, JsonPathResolverTest 15, FieldMappingResolverTest 20,
  DefaultFieldMappingProfileTest 4, FieldMappingProfileServiceTest 7,
  FieldMappingValidationServiceTest 11 — 74 tests)
FILTER_REGRESSION_TESTS=PASS (CifFilteringRegressionTest, 7 tests — the exact owner-reported
  scenario proven fixed end-to-end through the real LogLineParser + EventFilters pipeline)
SAMPLE_FETCH_TESTS=PASS (FieldMappingSampleControllerIntegrationTest, 6 tests — bounded
  retrieval, limit clamping at both ends, zero-event source, unknown source)
READINESS_GATE_TESTS=PASS (FieldMappingReadinessGateTest 5 + FieldMappingSettingsControllerIntegrationTest
  7 — default-ready, edit-blocks, save-restores, reset-restores, failed-validation-stays-blocked)
MAPPING_SECURITY_REVIEW=PASS (FieldMappingSettingsLeakTest, 3 tests, plus the application.yml
  logging fix described in §5)
```

Full new-test inventory:
- `core/mapping/JsonPathTest.java`, `JsonPathResolverTest.java`,
  `FieldMappingResolverTest.java`, `DefaultFieldMappingProfileTest.java`,
  `FieldMappingProfileServiceTest.java`, `FieldMappingValidationServiceTest.java`
- `core/parse/CifFilteringRegressionTest.java`
- `api/FieldMappingReadinessGateTest.java`,
  `FieldMappingSettingsControllerIntegrationTest.java`,
  `FieldMappingSampleControllerIntegrationTest.java`,
  `FieldMappingSettingsLeakTest.java`

(Frontend test evidence is recorded separately once the frontend
implementation — built concurrently in this same mission — lands; see
the mission's final structured response for the consolidated numbers.)

---

## 8. Scope boundary confirmation

```
DESIGN_BRANCH_TOUCHED=NO
PR54_TOUCHED=NO
```

This mission worked exclusively on `feature/configurable-log-field-mapping`,
branched from `main`. No command in this mission touched
`ux/v2-professional-redesign`, PR #54, or any file under
`docs/ux-v2/prototypes/`. No UI implementation beyond the directly-required
Log Schema & Field Mapping settings workflow was performed; no visual
redesign; Phase M untouched; v0.1.0 untouched.
