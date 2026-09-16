# Classification search scope, assisted extraction, and visible coloured tags — verification report

Mission: `CLASSIFICATION_REAL_SEARCH_SCOPE_ASSISTED_EXTRACTION_AND_VISUAL_TAGGING_RECOVERY`
Baseline: `main` after PR #59 — `51f06e51709455f2c20dcf5c1b32e2dd67443377`
Branch: `fix/classification-scope-extraction-visual-tags`
Register: `docs/governance/OWNER_REQUIREMENTS_REGISTER.md` §27 (CSX-1 … CSX-13)

This is a functional recovery, not a redesign. The Modern Developer Console
design lane (PR #58) is untouched; so are the Live Service EXCLUDE defect,
`SEARCH_PERFORMANCE_ROOT_CAUSE`, and the OpenShift Loki backend capability.

---

## 1. The reported defect

The owner tested the packaged Windows build against real Docker Compose
logs: source Docker, a Compose project selected, Last 1 day, several
severities, and a search containing `API_LOGS`. The results table was full
of events whose message began `API_LOGS:`.

From one of those events: **Create tag rule from this event → Detect
Pattern** reported roughly **one** similar event. Configuring
`message STARTS_WITH "API_LOGS:"` by hand and running **Test Rule**
reported **sampled 200, matched 1, not matched 199** — flatly contradicting
the visible population.

## 2. Root cause (confirmed in code, not assumed)

`api/ClassificationSampleCollector` rebuilt its own `SearchRequest` from
`ClassificationSampleScopeDto`, which carried only:

```
sourceId · composeProject · start · end · services · serviceFilterMode · levels
```

Everything else that defines the visible population — the free-text search,
the parsed query DSL, raw LogQL, every identifier and mapped advanced
filter, and the five protected filters — was dropped. Detect and Test
therefore sampled *the newest N events of the whole source*, which for a
text-narrowed search is a different population from the one on screen. With
one `API_LOGS` event among the newest 200 of everything, "matched 1 of 200"
was the truthful answer to the wrong question.

## 3. What changed

**Search scope (CSX-1 … CSX-4).** `ClassificationSampleScopeDto` now
mirrors the search body field for field, and the collector builds the
request through the one real `RequestMapper`, so every filter behaves
exactly as it does for Search. Three things stay the sample's own:

| Field | Why |
|---|---|
| `direction`, `limit`, `cursor` | A sample is one bounded newest-first page of its own size (default 200, max 500). |
| `tags` | **Deliberately not carried.** Tags exist only after classification by the *saved* rules, so sampling through them while a rule is being authored would make the evidence depend on the very classification being created — a circular, silently tiny sample. Every other committed filter is preserved, and the extraction step states what the sample was read from. |

**Anchor guarantee (CSX-3).** The scope carries the selected event's
timestamp. If the bounded page stops short of it, the collector makes one
extra, strictly bounded read of that single millisecond with identical
filters and merges the event in, de-duplicated. Counts stay truthful: the
returned list is exactly what was evaluated.

**Assisted extraction (CSX-5, CSX-6).** `POST /extractions/suggest` samples
the committed scope, keeps the events the rule actually matches, and runs
the same deterministic detector Detect pattern uses. `PatternDetector`'s
suggestion pass was generalised from `label=value` pairs only to three
shapes, with no knowledge of any log format:

1. `label=value` / `label: value` pairs (unchanged);
2. a value after ordinary fixed text — `==>RequestPath: /a/b`, `[Status]: 200`;
3. a value further along a run of variables — the URL in `[API]: POST https://host/path`.

Each suggestion is compiled and measured on the sample and kept only if it
really produced a value in ≥ 80 % of similar values. No confidence score is
invented and no external service is involved.

The extraction step explains what extraction is, lists suggestions with
their measured coverage (`Found in 17 / 18`), and allows accept, deselect,
rename, edit, preview, mark-sensitive and remove, plus manual authoring.
When nothing can be inferred it says so and offers *Detect extractable
values again*, *Add extraction manually*, *Skip extraction*. Regex and JSON
Pointer live behind a per-value "Advanced: how this value is read"
disclosure.

**Add extraction from this event (CSX-7).** A classified event offers *Add
extraction from this event* and *Create another tag rule*; an unclassified
one offers only *Create tag rule from this event*. One matching rule opens
directly on its extraction step; several ask which rule to extend; a rule
that has since been deleted says so. The update goes through the normal
revision-protected save — nothing is ever mutated silently.

**Classification visible in Search (CSX-8).** A **Tags** column is visible
by default between "What happened" and "User/Customer": the first tag as a
chip plus a `+n` counter, with the complete list in the cell's accessible
name and tooltip. This **supersedes** the seven-default-column contract
(CLAUDE.md §4) and the design package's "hidden by default" decision (D19).
Every other table invariant is unchanged, and a classified row is exactly
as tall as an unclassified one (the chip is capped at 18 px inside the
28 px row).

**Tag colour (CSX-9 … CSX-11).** `ClassificationRule.displayColor` is one
of `GRAY BLUE CYAN GREEN AMBER ORANGE RED PURPLE` — a semantic name in the
server JSON, never a CSS value. Omitted colours get a deterministic default
derived from the first tag, so old rules files and packs keep loading (no
schema version change was needed) and the same tag lands on the same colour
everywhere. Within a rule set one tag resolves to exactly one colour; a
same-tag/different-colour conflict is reported and refused on save and on
import (preview lists it, MERGE and REPLACE_ALL both refuse) — never
silently resolved. Colour is identity only: every chip carries its tag
text, each pair is ≥ 5.5:1 contrast, and forced-colours mode drops the tint
and keeps the text.

**Fixture corpus.** A second synthetic family was added to
`FixtureCorpusGenerator` (four multi-line `API_LOGS:` events and one
deliberately similar `API_LOGS_SUMMARY:` line per 40-event cycle) so the
defect is reproducible in tests without any real log data.

## 4. Verification

All commands were run in this working tree; outcomes are reported as run.

| Check | Command | Result |
|---|---|---|
| Backend build + tests | `./mvnw -o verify` (backend) | **PASS** (19 new tests: 7 scope, 5 extraction-suggestion, 7 colour) |
| Frontend unit/component tests | `npx vitest run` (frontend) | **PASS** — 84 files, 1,063 tests (48 new, 2 rewritten) |
| Typecheck | `npx tsc -b --noEmit` (frontend) | **PASS** |
| Production build | `npm run build` (frontend) | **PASS** — built in 983 ms |
| E2E (Playwright, real backend `SPRING_PROFILES_ACTIVE=dev`, Fixture source) | `npx playwright test` | **PASS** — 321 passed, 1 skipped, 0 failed (13.7 min) |
| Windows / macOS desktop packaging | GitHub Actions `Windows Desktop`, `macOS Desktop` | run by the PR (they trigger on `backend/**`, `frontend/**`); not runnable on this Linux host — `BLOCKED` locally, see §6 |

Existing tests were updated only where this recovery deliberately changed a
contract, never to make something pass:

- the results-table column contract (unit + E2E) moved from seven default
  columns to eight, with the supersession recorded in CLAUDE.md §4 and the
  register;
- `e2e/classification-rules.spec.ts` no longer asserts `Sampled: 200` for a
  text-narrowed search — that number *was* the defect; it now asserts the
  sample reflects the searched population and that most of it is similar;
- E2E specs that addressed the Correlation/Trace cell by position moved from
  index 5 to 6, and the owner-reproduction test lives in that same serial
  spec file because Playwright runs spec files in parallel and classification
  rules are shared backend state.

### 4.1 Evidence of the fix itself

`ClassificationSearchScopeIntegrationTest` (7 tests, real HTTP, Fixture
source) pins both the corrected behaviour and the contrast with the old
scope:

- with the query in scope, a 20-event sample of an `API_LOGS` search is
  mostly similar events and the rule matches most of them;
- with the pre-fix scope (no query), the same call sees fewer similar
  events and matches fewer — the reported symptom, kept as a regression
  guard;
- services, severities, service-filter mode and identifier filters all
  narrow the sample the way Search narrows results, and a filter that
  excludes the population yields an honestly empty sample;
- the anchor takes part when the bounded page stops short of it, and a
  sample without an anchor stays exactly the requested size;
- a tag filter never reaches a sample.

`ExtractionSuggestionIntegrationTest` (5 tests) covers suggestions from the
matched events, already-defined filtering, the two no-suggestion paths, and
a deleted rule. `TagColorTest` (7 tests) covers the deterministic default,
persistence across a reload, a pre-colour rules file, the conflict refusal,
pack round-trip and import conflicts.

`e2e/classification-scope-extraction-color.spec.ts` reproduces the owner's
own workflow end to end against the real backend: search `API_LOGS` →
Create tag rule → Detect (many similar) → colour BLUE → assisted extraction
(remove one value, ask again, adopt the suggestion) → Test → Save → re-run
Search → **the tag is visible in the table in its colour** → inspector
shows the same identity and the extracted values → *Add extraction from
this event* → Test → Save → re-run → the new value is extracted → export
(pack carries `displayColor`) → delete → import → everything restored.

### 4.2 Visual evidence

`docs/verification/classification-recovery/` holds three AFTER captures from
the real running application: the results table with the tag visible in its
colour, the inspector offering *Add extraction from this event*, and the
assisted extraction step. Evidence folders from earlier missions were
deliberately not regenerated, so their screenshots still show the table as
it was before this recovery.

## 5. Manual verification on the packaged Windows app

The defect was found in the Windows desktop build, so it should be
re-checked there before merge. Build and install per
`docs/development/BUILD_DESKTOP.md` §Windows:

```powershell
# from the repository root, on Windows with the prerequisites in that document
.\scripts\build-desktop-windows.ps1
# optional: the repository's own packaged smoke test (install → launch → health → UI → API → shutdown → uninstall)
.\desktop\packaging\packaged-smoke-test.ps1
```

Then, in the installed application against real Docker Compose logs:

1. **Reproduce the original path.** Source **Docker**, select the Compose
   project, **Last 1 day**, the severities you normally use, and type a term
   that narrows the table to a recognisable family of events (the owner's
   case: `API_LOGS`). Confirm the table is full of matching events.
2. **Detect.** Open one of them → **Create tag rule from this event** →
   **Detect pattern**. *Expected:* "Sampled" reflects that search (not the
   newest events of the whole source) and "Similar" is a realistic share of
   it — not 1. The suggested condition quotes text from the events you can
   see.
3. **Test.** Give the rule a tag, choose a **Tag colour**, continue to
   **Test rule**. *Expected:* matched is consistent with the population on
   screen, and the near-miss list contains events that really are similar
   but do not match.
4. **Tag visibility and colour.** Save, return to Search, run the search
   again. *Expected:* the **Tags** column shows the tag on every matching
   row, in the colour you chose, without opening the inspector; rows are no
   taller than before; an event that should not match carries no tag.
5. **Inspector parity.** Open a matched event. *Expected:* the same tag text
   and colour as the table, the rule name, and the extracted values — with
   anything sensitive shown as redacted, never raw.
6. **Add extraction from an event.** In that inspector, use **Add extraction
   from this event**. *Expected:* it opens the rule that matched (or asks
   which one, if several did), on the extraction step, with suggestions
   measured on your own events. Add one, **Test**, **Save**, re-run Search,
   and confirm the new value appears in the inspector.
7. **Portability.** Export the rule pack, delete the rule, import the pack
   back, re-run Search. *Expected:* tag, colour and extractions all return.

Record what you observed (including anything that differs) in the PR before
merging.

## 6. Honest limitations

- **Windows and macOS desktop packaging were not run on this host** (Linux).
  Both workflows trigger on this PR because it touches `backend/**` and
  `frontend/**`; their result is CI evidence, not a local claim. `BLOCKED`
  until those runs finish.
- **Real Docker / OpenShift sources were not exercised.** Every automated
  check ran against the deterministic Fixture source through the same
  `LogSource` abstraction; the sample collector is source-neutral by
  construction, but the owner's own Windows + Docker re-check (§5) is what
  closes that gap.
- **Row-height parity is asserted structurally in unit tests** (jsdom has no
  layout engine) and visually in the E2E suite's existing geometry
  assertions.
- **Colour is a v1 controlled palette.** No custom colours, no per-tag
  overrides beyond the rule's own choice, and no dark theme yet — the tokens
  are defined for the light theme the product ships today.
