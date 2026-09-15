# Event Classification, Extraction, and Portable Rules — Verification Report

Mission `EVENT_CLASSIFICATION_EXTRACTION_AND_PORTABLE_RULES`.

- **Branch:** `feature/event-classification-extraction-rules`
- **Base:** latest `main` `3f6b1b4bc30c282e0cd1e65510697ff128d79d73` (fetched and confirmed before branching)
- **Design lane:** the Modern Developer Console design lane (PR #58) is paused and untouched. This feature uses the
  current production UI language.
- **Design sync:** `DESIGN_SYNC_REQUIRED_AFTER_FEATURE_MERGE=YES`

Outcomes use the project vocabulary: PASS / FAIL / BLOCKED / DEFERRED.

## 1. Architecture

```
Source line (Docker / Loki / OpenShift / Fixture; search, context, journey, live)
  → core.parse.LogLineParser   (existing parsing + active field mapping → CanonicalLogEvent)
  → core.classify.ClassificationEngine.classify   (immutable compiled rule snapshot; RuleMatch per rule)
  → adapter enrichment + core.search.EventFilters (includes the new ANY-tag filter)
  → api.SearchService (pagination, counts)
  → api.EventMapper   (masking + TextRedactor + ExtractedValueRedactor)  → EventDto (tags, classifications)
```

- **One hook for every source.** The engine runs once, at the end of `LogLineParser#parse`. Every adapter already
  calls that method for every line, so all sources and workspaces share one classification path. There is no
  source-specific or middleware-specific code.
- **Parser hook, not the mapper.** Classification runs before `EventFilters`, so a tag filter sees real tags. It also
  runs before masking, so extracted values are redacted at the single existing browser boundary.
- **Limitation.** Adapter-enrichment fields (`pod`, `namespace`, `containerName`, `composeProject`) are set after
  parsing, so rules cannot target them.
- **Backend-authoritative.** The frontend never classifies. It renders `tags` and `classifications` from the API.
- **Fixture cache.** The cached Fixture corpus is keyed on the classification generation as well as the mapping
  generation, so a saved rule applies to the next search.

**Packages**

| Package | Classes |
|---|---|
| `core.classify` | model (`ClassificationRule`, `RuleCondition`, `ExtractionDefinition`, enums); `FieldRef`; `RuleCompiler`; `CompiledRule`/`CompiledCondition`/`CompiledRuleSet`; `ClassificationEngine`; `RuleTester`; `ClassificationRuleRepository`; `ClassificationRuleService`; `RulesSchemaMigrator`; `RulesDocument`; `ClassificationPack`; `ClassificationLimits` |
| `core.classify.detect` | `Tokenizer`, `PatternDetector`, `DetectionResult` |
| `core.mask` | `ExtractedValueRedactor`, plus `MaskingService#maskOccurrences` |
| `core.model` | `RuleMatch`, `ExtractedField`; `CanonicalLogEvent#classifications`/`#tags()`; `SearchRequest#tags` |
| `api` | `ClassificationRulesController`, `ClassificationSampleCollector` (samples through `SearchService`), DTOs, `GlobalExceptionHandler` mappings |

## 2. Rule model and schemas

See `docs/user-guide/EVENT_CLASSIFICATION_RULES_SCHEMA.md` for the full property tables and a synthetic example.

- **Conditions.** A rule has 1–5 tags and 1–10 conditions: field reference, matcher (`EXACT` / `CONTAINS` /
  `STARTS_WITH` / `REGEX`), value, and `ignoreCase`. Conditions combine with `ALL` or `ANY`.
- **Extractions.** A rule has at most 20 extractions: user-defined output name and label, source field, `REGEX`
  group or `JSON_POINTER`, optional value type, and a `sensitive` flag.
- **Evaluation order.** Priority ascending, then id. Every enabled rule that matches contributes its own
  `RuleMatch`, so same-named extractions from different rules never overwrite each other.
- **Field references.**
  - canonical mapped fields (`message`, `service`, `severity`, `logger`, `thread`, `exception`, `businessStep`,
    `errorCode`, `uiIdentifier`, `journeyName`, trace/span/correlation/journey/event IDs, `devicePlatformType`,
    `language`, `serverHost`, `serverIp`, `rawLine`);
  - `extra.<key>` for preserved unmapped top-level fields;
  - `mdc.<key>` for preserved MDC fields.

  The five protected identifiers are deliberately not addressable.
- **Internal file.** `{"format":"log-explorer-classification-rules","schemaVersion":1,"revision":N,"updatedAt":…,"rules":[…]}`.
  Serialization is deterministic (record order, ISO instants, indented). Input is strict: unknown properties and
  duplicate keys are errors.
- **Portable pack.** `{"format":"log-explorer-classification-pack","schemaVersion":1,"pack":{…},"rules":[…]}`. Rule
  definitions only; no revision, metadata, paths, samples, extracted values, or credentials.
- **Schema evolution.** `RulesSchemaMigrator` rejects newer versions with a clear message and holds a `Migration`
  registry for future upgrades. Version 1 has no migrations.

## 3. Safe regex

- **Engine.** RE2/J 1.8 (`com.google.re2j:re2j`, BSD-3-Clause): linear-time automaton matching, so catastrophic
  backtracking cannot happen.
- **Compile once.** Expressions compile once, on save, import, test, or configuration load (`RuleCompiler`). They are
  never compiled per event (`ClassificationEngineTest#rulesAreCompiledOnceAndReusedAcrossEvents`).
- **No silent fallback.** RE2 has no lookaround, backreferences, or possessive quantifiers. Such expressions are
  rejected at validation with "Invalid or unsupported regular expression … (the linear-time RE2 engine does not
  support …)". They are never run on `java.util.regex`.
- **Bounds.**
  - expressions ≤ 1,000 characters;
  - field values are matched on at most their first 32,768 characters;
  - JSON Pointer parses at most 65,536 characters;
  - errors are deterministic ProblemDetail (`RULE_INVALID` with `errors[{path, message}]`).
- **Evidence.** A `(a+)+$` pattern on 30,001 characters returns in well under 2 s
  (`RuleCompilerTest#catastrophicBacktrackingPatternStillRunsInLinearTime`).

## 4. Pattern detection

Detection is local and deterministic (`PatternDetector`): no network, AI, or randomness. It returns a suggestion
only.

1. **Sample.** `ClassificationSampleCollector` runs a normal search through `SearchService`, using the user's source,
   project, time range, services, service mode, and severities. The default is 200 events, the maximum 500. Sampled
   events are never retained. `sampledEvents` is the real count.
2. **Anchor.** The selected event's value is the anchor. Sampled values are redacted with the same boundary as the
   browser view, so suggestions never contain redacted literals.
3. **Tokenize.** Whitespace chunks are split into `label=`/`label:` pairs and classified as fixed text or a variable
   shape: number, duration, UUID, hex, mixed ID, URL, path, timestamp, IP, quoted, or redaction marker.
4. **Similar values.** A value is similar when the LCS of fixed-text tokens covers ≥ 60 % of the longer list,
   measured against the anchor.
5. **Stable text.** A fixed-text token is stable when it aligns in ≥ 90 % of similar values. Everything else is
   variable.
6. **Candidates.** Candidates are tried least-complex first:
   1. `EXACT`
   2. `STARTS_WITH` (the leading stable run)
   3. `STARTS_WITH` + `CONTAINS` stable labels
   4. `CONTAINS` the longest stable run (+ labels)
   5. `REGEX`

   The first that matches the anchor and ≥ 90 % of similar values, with zero non-similar matches, is suggested.
   Otherwise the best one is suggested with a false-positive warning.
7. **Extractions.** Labelled values (with type and unit, e.g. `durationMs`) and URLs/paths after a stable word are
   suggested only when they extract from ≥ 80 % of similar values.
8. **JSON.** JSON object values use top-level keys: `CONTAINS "key"` conditions and `JSON_POINTER` extractions.
9. **No safe suggestion.** Fewer than 3 similar values, too little stable text, or no adequate matcher returns
   `NO_SAFE_PATTERN_SUGGESTION` with a reason. Detection never generalizes from one event.
10. **Evidence, not confidence.** The result reports `sampledEvents`, `valuesWithField`, `similarEvents`, stable and
    variable segments, suggested conditions and pattern, measured coverage, and warnings. No confidence score is
    invented.

On the fixture corpus the flow produces `STARTS_WITH "Make webhook call to"` and `url`, `method`, `requestId`,
`responseCode`, `durationMs` extractions (`ClassificationRulesIntegrationTest`, E2E).

## 5. Rule test

`RuleTester` compiles the draft rule on its own and evaluates it against a fresh bounded sample. It never persists
or activates the rule. It returns:
- sampled / matched / not-matched counts and `sampleLimitReached`;
- per-extraction coverage (extracted / invalid / of);
- ≤ 5 matched previews and ≤ 5 borderline (partial-condition) previews, each field value cut to 300 characters and
  redacted;
- the note "Review these matches for false positives …". No false-positive rate is claimed.

## 6. Persistence and failure semantics

**Location.** The rules file is `logexplorer.classification.rules-file`, which defaults to
`${LOGEXPLORER_CLASSIFICATION_RULES_FILE:${LOGEXPLORER_DATA_DIR:./data}/classification-rules.json}`. Nothing is
created until the first save.

**Write sequence** (`ClassificationRuleRepository#write`):
1. serialize deterministically and re-parse to verify the round trip;
2. write a same-directory temp file, `fsync`, and close it;
3. copy the previous valid primary to `.bak` (via temp file + move), or, if the primary is known to be invalid, move
   it aside as `.corrupt-<timestamp>`;
4. `ATOMIC_MOVE` the temp file over the primary, falling back to a replacing move where atomic moves are unsupported
   (the backup still allows recovery);
5. best-effort `fsync` of the directory;
6. only after a successful write, atomically swap the engine snapshot.

All writes are serialized by a lock.

**Load** (`ClassificationRuleService#load`):

| Situation | Result |
|---|---|
| Primary valid | `OK` |
| Primary missing, backup valid | `RECOVERED_FROM_BACKUP` |
| Primary invalid, backup valid | `RECOVERED_FROM_BACKUP`; the invalid primary is kept until the next save moves it aside |
| Both invalid | `INVALID` — empty snapshot, search keeps working, nothing overwritten silently |

Status messages never include file content. Logs carry reason codes only.

**Concurrency.** Every write carries `expectedRevision`. A stale revision returns HTTP 409 `RULES_REVISION_CONFLICT`
with `currentRevision`; a missing revision returns 400.

**Storage failure.** An unwritable storage location returns HTTP 503 `RULES_STORAGE_UNAVAILABLE` and leaves state
unchanged.

## 7. Import / export

- **Export.** `GET /export[?ids=…]` returns an attachment named `log-explorer-classification-pack.json`. An exported
  pack passes import validation (`ClassificationRuleServiceTest`).
- **Preview.** `POST /import/preview` (raw text) writes nothing. It checks:
  - size ≤ 256 KB (413);
  - valid JSON;
  - format identifier (the internal rules file is explicitly rejected);
  - schema version;
  - allowed top-level properties;
  - ≤ 200 rules;
  - per-rule strict binding and full validation, including RE2;
  - duplicate ids.

  Each rule is classified `NEW` / `IDENTICAL` / `CONFLICT` / `INVALID`.
- **Apply.** `POST /import/apply` re-validates the same text:
  - any invalid rule blocks the whole import;
  - `MERGE` with conflicts requires `KEEP_EXISTING` or `USE_IMPORTED`;
  - `REPLACE_ALL` requires `confirmReplaceAll`;
  - the resulting rule count must be ≤ 200;
  - the write uses the same atomic persist path;
  - an import that changes nothing does not bump the revision.

  Cancel = never calling apply.

## 8. Masking boundary

Extracted values reach a browser only through `api.EventMapper` → `ExtractedValueRedactor.present`:
1. definitions marked `sensitive`, or with credential-like names or labels, show only `[REDACTED]`;
2. credential headers (`Authorization`, `Proxy-Authorization`, `Cookie`, `Set-Cookie`, `X-API-Key`/`api-key`,
   `x-auth-token`, `x-access-token`, CSRF/XSRF tokens) are redacted in `Name: value` text, and JSON credential
   properties are redacted;
3. this event's protected identifiers are replaced with the policy's masked form (`MaskingService#maskOccurrences`);
4. `TextRedactor` runs (bearer/basic credentials, secret key-values, contextual IDs, JWTs, cards);
5. values are cut to 2,000 characters, with `redacted` and `truncated` flags.

Rule-test previews and detection inputs use the same redactor. All ArchUnit rules still pass: `api` never touches
`RawSensitiveFields`, and DTOs never reference `CanonicalLogEvent`.

Evidence:
- `ExtractedValueRedactorTest`;
- `RuleTesterTest#previewValuesPassTheMaskingBoundary`;
- `ClassificationRulesIntegrationTest#extractedValuesNeverCarryRawSecretsToTheBrowser` — the fixture's password, JWT,
  card number, and customer ID never appear in the HTTP response, even when a rule extracts the entire message and
  stack trace.

## 9. Tag filtering and runtime semantics

- **Tag filter.** `SearchRequest.tags` uses ANY semantics, is case-normalized, and is enforced in `EventFilters` on
  the canonical events each adapter retrieved. It is included in the cursor fingerprint and shown in the query plan
  as `tag in [...] (classification tags, evaluated on the events this source returned)`.
- **No pushdown.** Nothing is pushed down to Docker, Loki, or OpenShift. A tag filter narrows within each source's
  normal read bounds and does not extend how much history a source reads.
- **After a save.**
  - New searches, context, journeys, and new Live events use the new snapshot.
  - Already-loaded results and events already in the Live buffer are not retroactively changed. The UI says "Rule
    saved. Re-run Search to classify currently loaded results."
- **Results table.** Unchanged; the 7-column contract is untouched.
  `RESULT_ROW_TAG_PRESENTATION_DEFERRED_TO_DESIGN_SYNC=YES`.

## 10. Performance characteristics

- **Hot path.** Per event: one volatile snapshot read, then for each enabled rule its pre-compiled conditions against
  field values resolved at most once per event (memoized). Extraction runs only for matching rules; JSON is parsed at
  most once per field.
- **What never happens on the hot path.** No disk I/O, no rule-file parsing, no regex compilation.
- **No rules.** With no rules, `classify` returns the same event instance, so there is zero extra allocation.
- **Observability.** Aggregate counters only (`eventsEvaluated`, `ruleMatches`, `evaluationFailures`), exposed in the
  rules state. There are no per-value metrics or labels.
- **Failure handling.** A rule that throws on one event is skipped and counted; search continues. A failed
  extraction is `INVALID` for that value only.

## 11. Packaging persistence

| Packaging | Rules file | Survives |
|---|---|---|
| Dev (`spring-boot:run` in `backend/`) | `backend/data/classification-rules.json` (git-ignored) | restarts |
| Docker Compose | `/app/data/classification-rules.json` on named volume `log-explorer-data` (image sets `LOGEXPLORER_DATA_DIR=/app/data`; dir owned by `logexplorer`, group 0 `g=u`; entrypoint fixes ownership of a fresh volume) | `down`/`up`, `--force-recreate`; removed only by `down -v` |
| OpenShift | `/app/data` on PVC `log-explorer-data` (50Mi RWO; `readOnlyRootFilesystem` stays true; `strategy: Recreate` for the RWO claim) | pod restarts / redeploys |
| Windows desktop | `%LOCALAPPDATA%\LogExplorer\data\classification-rules.json` — launcher passes `LOGEXPLORER_DATA_DIR`; outside `{localappdata}\Programs\Log Explorer`; installer never deletes it | upgrade, uninstall/reinstall |
| macOS desktop | `~/Library/Application Support/LogExplorer/data/classification-rules.json` | app replacement / upgrade |
| CI E2E | `${{ runner.temp }}/log-explorer-data` | isolated per run |

Verification is in §12 and §13.

## 12. Test evidence

Commands actually run on this branch:

| Check | Command | Outcome |
|---|---|---|
| Backend baseline before feature tests | `./mvnw -o -q test` (backend) | PASS — 1,319 tests, 0 failures, 0 errors |
| Backend full verify | `./mvnw -o -q verify` (backend) | PASS — 1,404 tests, 0 failures, 0 errors (85 new) |
| Frontend typecheck | `npm run typecheck` | PASS |
| Frontend unit tests | `npm test` | PASS — 78 files, 997 tests (54 new) |
| Frontend production build | `npm run build` | PASS (lazy `ClassificationRulesWorkspace` chunk ≈ 41 KB) |
| E2E acceptance flow | `npx playwright test e2e/classification-rules.spec.ts --workers=1` (real backend, `SPRING_PROFILES_ACTIVE=dev`, isolated `LOGEXPLORER_DATA_DIR`) | PASS — 1 passed |
| E2E full suite (real backend, dev profile, isolated data dir) | `npx playwright test --workers=2` | PASS — 320 tests: 319 passed, 1 skipped, 0 failed (11.7 min); tracked evidence PNGs rewritten by E2E were restored afterwards (TEST-INFRA-1, `UNRELATED_BINARY_CHANGES=0`) |
| `typecheck:e2e` | `npm run typecheck:e2e` | FAIL — one error in `e2e/phase-n-schema-scan-field-mapping.spec.ts:257` (`exact` option on `filter`). That file is unchanged on this branch, and CI does not run this script. The new spec type-checks cleanly. |

New backend test classes:
- `RuleCompilerTest`
- `ClassificationEngineTest`
- `ClassificationRuleServiceTest` (persistence + import/export)
- `PatternDetectorTest`
- `RuleTesterTest`
- `ExtractedValueRedactorTest`
- `LogLineParserClassificationTest`
- `FixtureLogSourceClassificationTest` (including new Live lines)
- `ClassificationRulesIntegrationTest` (HTTP, Fixture source)
- new cases in `DockerLogSourceTest` and `LokiLogSourceTest`

New frontend test files:
- `ClassificationSection.test.tsx`
- `ClassificationRulesWorkspace.test.tsx` (list, import, wizard, axe)
- `client.classification.test.ts`
- `useSearchState.classification.test.ts`
- `classificationTagFilter.test.tsx`
- `App.classificationWorkspace.test.tsx`
- new cases in `EventInspector.test.tsx`

Existing tests were only extended with the new `LogEvent`/`SearchState` fields; none were weakened or deleted.

**E2E acceptance scenario** (`frontend/e2e/classification-rules.spec.ts`):
1. Start from empty rules.
2. Search the fixture.
3. Open a webhook event and choose **Create tag rule from this event**; the field defaults to `message`.
4. **Detect pattern** — Sampled 200, Similar > 0, stable structure shown. **Use this suggestion**.
5. Name the rule and tag it `middleware`.
6. The suggested extractions include `url`, `responseCode`, `durationMs`.
7. **Test rule** — matches, coverage, review note.
8. **Save rule** — the "Re-run Search" message.
9. Re-search. The Inspector shows **MIDDLEWARE** and the URL, response code, and duration parsed from that event's
   own message.
10. The deliberately similar `Make webhook configuration reload…` event is not tagged.
11. Tag filter: the request carries `tags:["middleware"]` and every returned event carries the tag.
12. **Export all** — pack format, one rule, no revision/metadata/path.
13. Delete with confirmation; the tag-filtered search now truthfully returns 0 and the classification disappears.
14. Import — preview New 1, Apply, Added 1.
15. Re-search; classification and extraction are restored.

## 13. Environment-dependent verification

These results are filled in from the runs listed in the PR:

- **E2E full suite:** recorded below.
- **Docker recreate persistence:** `scripts/smoke.sh` step "rule survived container recreation".
- **Windows desktop:** CI `Windows Desktop` workflow — `packaged-smoke-test.ps1` asserts the per-user data path
  outside the install directory and that the file survives uninstall.
- **macOS desktop:** CI `macOS Desktop` workflow — `packaged-smoke-test.sh`, the same assertions.

## 14. Known limitations

- **Adapter-enrichment fields.** Rules cannot target `pod`, `namespace`, `containerName`, or `composeProject`;
  classification runs before adapter enrichment.
- **Tag filter scope.** It applies to events each source retrieved within its normal read limits; there is no source
  pushdown.
- **No retroactive changes.** Loaded results and the existing Live buffer are not reclassified after a rule change.
- **RE2 feature set.** No lookaround or backreferences; such expressions are rejected.
- **Detection heuristics.** Similarity is token-based and needs ≥ 3 similar events. Unlabelled variable values other
  than URLs/paths are not auto-suggested as extractions (they can be added manually).
- **Results table.** No tag badge in results rows yet (deferred to the design sync).
- **Rule-management trust model.** It matches the existing unauthenticated local-tool model of the other settings
  endpoints.
- **Scope boundary.** Not combined with the Live Service EXCLUDE defect (D8) or `SEARCH_PERFORMANCE_ROOT_CAUSE`.
  `SEARCH_PERFORMANCE_INVESTIGATION_STARTED=NO`.
