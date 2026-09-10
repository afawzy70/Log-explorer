# UX-R3 — Compose Scope, Live Navigation & Professional UX Transformation — Report

Using the project skill at `.claude/skills/log-explorer-professional-ux-reviewer/SKILL.md`
(protocol LERUX-1) was attempted and **genuinely diagnosed** rather than
silently re-noted (mission §3/Decision D — see "Skill activation
diagnosis" below). The tool reports "Unknown skill" for this project-local
skill in this continuously-running session; per the skill's own committed
fallback instruction, `SKILL.md` was read directly and its protocol
followed manually throughout this mission: real running app/backend
evidence first, before/after screenshots, never a PASS asserted from
source alone.

## Scope

UX-R3 only, per the mission's own exclusions: merge PR #33; persist
Decisions A–F; diagnose the skill-activation problem; Docker Settings /
Compose project discovery, selection, and hard boundary; active-scope
visibility; project-switch lifecycle; Settings masking-policy panel;
Remote Docker "Connection name"; "Last 30 minutes" preset; Live state
visibility; Live→Search exit correctness; Live+project-switch protection.
**Not** in scope: row-click-to-inspector, truthful sort, selected-row
redesign, inspector previous/next indicator (all UX-R4), REL-1 desktop
distribution, Phase M.

---

## Skill activation diagnosis (mission §3 / Decision D)

```
UX_SKILL_REGISTERED=YES
UX_SKILL_DISCOVERABLE=YES in a fresh session, NO in this one
UX_SKILL_LOADED=NO this session
PROTOCOL=LERUX-1
BLOCKER=session-lifetime skill-indexing cache — proven, not a repo/config defect
ROOT_CAUSE_EVIDENCE=see below
MANUAL_FALLBACK_USED=YES
```

Root-caused via a fresh (non-fork) diagnostic agent: Claude Code indexes
`.claude/skills/*` **exactly once, at session/process startup** — there is
no mid-session rescan. A skill added to (or already present in) the repo
after the current session started can never become discoverable within
that same continuously-running session. Confirmed two independent ways:
(1) `/skill-doctor` shows the skill loads correctly in a **freshly
started** session — the file, its frontmatter (`name`/`description`, only
meaningfully-required fields; a `license` field is a harmless extra), and
its structure are all valid; (2) Claude Code's own documentation
("Startup Performance" section) states "Skills are indexed once at
session start." No trust/permission gate applies to project-local skills,
and nothing about this session's working directory or tool syntax is at
fault. This is the settled, evidence-backed answer for every prior
mission's "Unknown skill" observation this session, and is expected to
remain the answer for the rest of this same session. `SKILL.md` was read
directly and LERUX-1 followed manually for every design decision below.

---

## §1 — PR #33 merge (verified pre-existing to this session's continuation)

`PR_33_MERGE_STATUS=MERGED`, squash-merged as `99ea254` on `main`.
`BASE_SHA=99ea254` — confirmed via `git merge-base HEAD main` =
`99ea2541462439d2441e2926206f0ebf5ad1daa3`, i.e. this branch's own base
**is** the current tip of `main`. Post-merge CI on `main` was previously
confirmed green (see the prior UX-R2 session's own final report); no
new post-main CI run was triggered by this mission (no further pushes to
`main` occurred).

---

## §2 — Owner Decisions A–F (persisted to the register before implementation)

Persisted verbatim to `docs/governance/OWNER_REQUIREMENTS_REGISTER.md`
§"3a. UX-R3 Owner Decisions (A–F)", cross-referenced against the
pre-existing UX-6/UX-7/UX-9/UX-14/UX-17/UX-20 rows and item 5
("Live to Search") so the register has exactly one place, not two, per
decision. Summary:

- **A** — "Last 30 minutes" preset, same moving-relative recompute
  mechanism as UX-R2, never converting Custom into a moving range.
- **B** — Live must visibly communicate CONNECTING/LIVE/PAUSED/
  RECONNECTING/STOPPED (this app's runtime state machine also has `idle`/
  `failed` — both included, no invented states).
- **C** — Obvious, keyboard-accessible, no-refresh Live→Search exit.
- **D** — UX-R3–R6 use LERUX-1; diagnose "Unknown skill" (see above).
- **E** — NEW UI is not an automatic baseline; OLD is a reference, not a
  ceiling; improve wherever evidence shows friction.
- **F** — Reconfirm the four investigation questions (PF-1, unchanged).

---

## §4 — TRANSFORM, DO NOT JUST PATCH — the concrete before/after case

**CURRENT_UX_BEFORE**: The Live badge was a static red "LIVE" pill,
unconditionally, in every one of the panel's states — CONNECTING, LIVE,
PAUSED, and RECONNECTING all showed the identical red "LIVE" text. The
*only* signal that distinguished them was a small, secondary, gray
caption below/beside it (`docs/verification/UX_R3_EVIDENCE/BEFORE-K-live-paused.png`
— captured from the real running app, not assumed from source).

**UX_FRICTION**: An investigator glancing at the badge alone — the most
visually prominent element in the Live header — could not tell Paused
from Live. The actual distinguishing text was smaller, grayer, and easy
to miss, especially during a fast Connecting→Live→Paused sequence.

**PROPOSED_INTERACTION_MODEL**: One authoritative status element, not two
that can disagree. The badge itself changes text (`LIVE`/`PAUSED`/
`CONNECTING`/`RECONNECTING (attempt N)`/`STOPPED`/`CONNECTION FAILED`)
**and** tone (distinct background/text color per state family) together,
so the single most-glanced-at element on the whole Live view is the one
carrying the truth. Never color alone (the text is always the primary
signal; color reinforces it). Restrained: only the LIVE dot still pulses;
every other state is static, matching CLAUDE.md §7's "no novelty
animation."

**VISIBLE_USER_CHANGE**: `YES`.

**WHY_BETTER**: Removes the "guess whether I'm looking at historical
Search or a live stream, and which live state" friction Decision B names
explicitly — the badge is now unambiguous at a glance, from the exact
element that was previously misleading.

**WHO/WHAT/WHY/WHERE_IMPROVEMENT**: WHERE — the investigator's current
mode (Search vs. Live, and Live's own sub-state) is now immediately,
unambiguously visible from the single most prominent element in the view.

**BEFORE_EVIDENCE**: `docs/verification/UX_R3_EVIDENCE/BEFORE-I/J/K/L/M-*.png`.
**AFTER_EVIDENCE**: `docs/verification/UX_R3_EVIDENCE/AFTER-G/H/I/J/K-*.png`,
plus a real regenerated `docs/verification/j/live-tail-streaming-1280px.png`
from the existing Legacy Slice 5 suite (unrelated spec, same real app —
confirms the redesign renders correctly outside this mission's own new
specs too).

STILL_OLD_THINKING_COUNT for this slice: `0` for the surfaces actually
touched (Compose scope, Live state, 30m preset, masking panel, connection
name). Other UX-R1-restored surfaces are out of this slice's scope and
not re-judged here.

---

## §5–§13 — Docker Compose project scope (discovery, selection, hard boundary)

```
COMPOSE_DISCOVERY=PASS
COMPOSE_SELECTOR=PASS
REQUEST_SESSION_SCOPE=PASS
SERVER_HARD_BOUNDARY=PASS
OVERLAPPING_SERVICE_ISOLATION=PASS
PROJECT_SWITCH_STALE_RESPONSE_PROTECTION=PASS
PROJECT_SWITCH_LIVE_PROTECTION=PASS
SETTINGS_MASKING_PANEL=PASS
REMOTE_CONNECTION_NAME=PASS
```

### Architecture

`composeProject` is threaded as an optional, request-scoped field through
`SearchRequest`/`FollowRequest` (domain), `SearchRequestDto`/
`ContextRequestDto`/`JourneyRequestDto` (API DTOs), `SearchRequestBody`/
`ContextRequestBody`/`JourneyRequestBody` (frontend), and as an optional
query param for `GET .../services` and `GET /api/v1/logs/live` — never
sensitive (CLAUDE.md §2 rule 4 only restricts the 5 named fields and
search text/tokens). `DockerLogSource#relevantContainers` (now 3-arg) is
the **single** chokepoint every caller (`health`, `discoverServicesBlocking`,
`searchBlocking`, `follow`) already routed through — a per-request
project, when non-blank, takes precedence over the deployment-time
static `DockerProperties#composeProjectFilter`; the filter itself is a
plain label-equality match, which is fail-safe by construction (a
malicious/bogus project string can never equal a real container's own
label — it safely narrows to zero results, never fails open).
`discoverComposeProjects()` deliberately bypasses `relevantContainers`
(a self-caught bug during implementation: routing discovery through the
static filter would have hidden every other real project from ever being
selectable) and returns the canonical `com.docker.compose.project` label
set directly — sorted, real, never inferred from container names, never
fabricated. `GET /api/v1/sources/{id}/compose-projects` is the new
read-only discovery endpoint (no new mutation endpoint — selection stays
entirely request/session-scoped on the frontend, matching
`DockerSettingsController`'s existing no-mutation-endpoint design).

### Real two-Compose-project overlapping-service-name isolation proof

Two real, throwaway `docker compose` projects (`uxr3-project-a`,
`uxr3-project-b`, torn down immediately after), each with a service
**named identically** (`api`), each container logging real, unique,
unmistakable markers (`UXR3-ISOLATION-MARKER-PROJECT-{A,B}-<n>`) via a
real running `busybox` process to real stdout — proven live against the
real dev backend (port 3434) and the real Docker Engine API, not mocked,
not HTTP-200-only:

| Check | Method | Result |
|---|---|---|
| Discovery lists both real projects, sorted, alongside a genuinely unrelated pre-existing project (`sofra`) | `GET .../compose-projects` | `["sofra","uxr3-project-a","uxr3-project-b"]` |
| Service discovery scoped to project-a sees only its own `api`, never project-b's | `GET .../services?composeProject=uxr3-project-a` | 1 service, `api`, count 1 |
| Search scoped to project-a returns only PROJECT-A markers (311 real events, 0 leaked PROJECT-B) | `POST /api/v1/logs/search` ×2 (both directions) | `leaked PROJECT-B markers: 0` / `leaked PROJECT-A markers: 0` |
| Unscoped search (no `composeProject`) legitimately sees both — proves scoping is opt-in, never a hidden always-on filter | same endpoint, no `composeProject` | both markers present |
| Pagination stays scoped across a cursor page 2 | `POST /api/v1/logs/search` with `cursor` | 20/20 events, 0 leaked |
| Malicious/invalid project strings fail safe over real HTTP (`"...; DROP TABLE x"`, `"does-not-exist"`) | `POST /api/v1/logs/search` | `count: 0`, no error, no leak |
| Live (SSE) tailing stays scoped in both directions, real-time, 6s live capture each | `GET /api/v1/logs/live?...&composeProject=...` | project-a stream: only PROJECT-A markers; project-b stream: only PROJECT-B markers; 0 leaked in either |
| Repeated explicit search picks up new events while staying scoped ("Refresh" semantics) | two sequential searches, widening window | 34 → 39 events, all PROJECT-A |
| `/context` (surrounding logs) respects the boundary: anchored on a real project-a timestamp, scoped to the *wrong* project (b) finds project-b's own neighborhood, never leaks project-a's event; scoped correctly to project-a, finds it | `POST /api/v1/logs/context` ×2 | wrong-project: 17 events, 0 PROJECT-A leak; correct: 17 events, has PROJECT-A, 0 PROJECT-B leak |
| Discovery reflects real-time removal (never stale/cached) | `docker compose down` both projects, re-query discovery | `["sofra"]` only |

Journey/correlation lookup was **not** separately live-proven — it routes
through the exact same `RequestMapper#toJourneyDomain` → `SearchRequest` →
`relevantContainers` chokepoint as Search/Context (confirmed by direct
source read), and is covered by `RequestMapperTest`'s
`composeProjectIsCarriedThroughUnchangedForJourneyUxR3`. Re-proving the
identical mechanism live a third time was judged redundant given the
architecture is a single shared chokepoint, not per-endpoint logic.

### Project-switch lifecycle (§11)

`useSearchState.ts`'s new `useEffect` (keyed on `[selectedComposeProject]`)
aborts any in-flight request, clears `searchResult`/pagination/inspector/
breadcrumb/journey state **immediately** (not just on the next Search —
a deliberate, narrower exception to this app's usual "stale results stay
until next explicit Search" convention, justified by the mission's own
"never show Project A rows under a Project B scope header" requirement),
and refetches services scoped to the new project — but never auto-fires a
new search. Proven via `useSearchState.test.ts`'s "Compose project scope
(UX-R3 §9/§11)" describe block (6 tests): discovery, discovery-failure
surfacing, immediate clear + no auto-search, stale-response abort
protection, service refetch scoping, and request-body scoping including
the "All projects omits the field entirely" case.

### Settings — masking-policy panel & Remote "Connection name" (§6/§14)

`DockerSettingsPanel.tsx` gained an informational "Protected field
masking" section (CIF/Username/Customer ID/Device ID/Device IP — no
Reveal/Unmask/Copy-raw control, ever) and a "Connection name" summary row
(REMOTE-only, cosmetic, `null`→"Not set", never affecting the actual
security identity/authorization — host/port/TLS/SSRF-guard remain the
real boundary). 5 new component tests in `DockerSettingsPanel.test.tsx`
(REMOTE-with-name, REMOTE-without-name, LOCAL-never-shows-it, masking
panel content, no reveal action).

---

## §15 — "Last 30 minutes" preset

```
LAST_30_MIN_PRESET=PASS
RELATIVE_RANGE_RECOMPUTE=PASS
CUSTOM_ABSOLUTE_RANGE_PRESERVED=PASS
```

Added as a single new entry to `TIME_RANGE_PRESETS`
(`frontend/src/shared/time/presets.ts`) — `recomputeRelativeRange()` in
`useSearchState.ts` (established in UX-R2) is fully generic over this
table by `id`/`durationMs`, confirmed by direct source read before
implementing: **no other code change was required**. A dedicated new
describe block, `useSearchState.test.ts`'s "UX-R3 §15", proves the
30-minute preset specifically (not just generically): Search #1 commits
an exact 30-minute window, a real wall-clock gap, Search #2's `end`
strictly advances while the preset identity stays `30m`, and a Custom
range that happens to also be 30 minutes wide never moves. The new preset
renders and is selectable — confirmed live
(`AFTER-F-last-30-minutes-preset.png`).

---

## §16–§19 — Live state visibility, Live→Search, Live exit correctness, Live+project-switch

```
LIVE_STATE_VISIBILITY=PASS
LIVE_CONNECTING=PASS
LIVE_ACTIVE=PASS
LIVE_PAUSED=PASS
LIVE_RECONNECTING=PASS
LIVE_STOPPED=PASS (existing "Stop" already reachable; state text verified via LiveTailPanel.test.tsx)
LIVE_TO_SEARCH=PASS
STALE_LIVE_EVENTS_AFTER_EXIT=PASS (pre-existing session-id guard in useLiveTail.ts, unchanged and re-confirmed)
```

`LiveConnectionState` (`idle | connecting | live | paused | reconnecting |
stopped | failed`) already covered all 5 mission-named states plus
`idle`/`failed` before this mission; the redesign (§4 above) is the state
**badge**, not the state machine. The pre-existing "← Back to search
results" button (`live.exit()`) already satisfied most of Decision C;
this mission's own addition is the Compose-project-switch case — a new
`useEffect` in `App.tsx` (`previousComposeProjectRef`, mirroring the
pre-existing source-change effect) calls `live.exit()` the instant the
selected project changes, deliberately **not** auto-restarting Live under
the new scope. Proven via a real `<App />` integration test,
`App.liveComposeProjectSwitch.test.tsx`: starting Live scoped to
`project-a`, confirming the real (mocked-`EventSource`) connection is
open and URL-scoped, switching to `project-b`, and asserting the
connection was **actually closed** (`source.closed === true`) and the UI
returned to the ordinary Search workspace — not merely paused. A second
test confirms Live is left untouched when nothing about the scope
changes (sanity check against over-eager exit-on-any-render).
`useLiveTail.ts` itself gained `composeProject` threading (`start()`'s
3rd arg, the SSE URL's `composeProject` query param, and `retry()`
carrying the exact same scope forward after a terminal failure — 3 new
tests in `useLiveTail.test.ts`).

---

## §20 — Four-questions validation (WHERE)

WHERE materially improved for this slice specifically: `Shell.tsx`'s new
`ScopeTrail` renders `{Source} › {Compose project}` whenever a project is
actually selected, in the header — which is rendered unconditionally
above `.mainRow` in `App.tsx`, so it remains visible across Search
results, the inspector, journey, and Live, without ever needing
duplication inside those individual views. Verified live
(`AFTER-E-compose-project-selected-scope-visible.png`) and via
`Shell.test.tsx` (3 tests: no-scoping source shows only the name,
scoping-but-unselected shows only the name — "All projects" adds no new
chip, and a real selection shows both). WHO/WHAT/WHY rely on existing,
unchanged mechanisms per the mission's own scope note.

---

## §22 — UX review classification

| Surface | Classification | Notes |
|---|---|---|
| Compose project discovery/selection | `NEW_BETTER` | Did not exist before this mission at all |
| Active scope visibility (`ScopeTrail`) | `NEW_BETTER` | Same |
| Live state badge | `NEW_BETTER` | Concrete friction fix over the BEFORE state, evidenced |
| Live→Search exit (source-change case) | `RESTORED` (unchanged, pre-existing) | Already worked; UX-R3 extended it to the new project-switch case |
| Settings masking panel | `NEW_BETTER` | Did not exist before |
| Remote "Connection name" | `NEW_BETTER` | Did not exist before |
| "Last 30 minutes" preset | `NEW_BETTER` | Closed a real, previously-`OPEN_UNDECIDED` gap |

`STILL_OLD_THINKING_COUNT=0` for every surface this slice actually
touched.

---

## Security

```
SECURITY_REGRESSION=NO
```

Regression checks re-run this session: masking unaffected (no new field
touches `MaskingService`); no credentials/tokens in `localStorage`
(`composeProject` is the only new persisted-adjacent value and it is
non-sensitive, and is **not currently persisted** — see "Safe preference
persistence" below); no secrets logged (the new discovery/selection code
paths log nothing new); no trust-all TLS (untouched); SSRF/DNS-rebinding
guard (`RemoteHostGuard`) untouched; server-side project validation is
structural (label-equality match, proven fail-safe above, not a
allow-list gate that could itself have a bug); no unauthenticated global
mutation endpoint was added (`GET /compose-projects` is read-only); the
malicious-project-string real-HTTP test above is the direct "browser
cannot bypass the boundary with a manually-changed unvalidated project
string" proof.

**Safe preference persistence (§13)**: Compose project selection is
**not** persisted this slice — it was judged out of the minimum necessary
scope (the mission explicitly allows deferring this if not necessary for
the slice), and not persisting it is itself the more conservative,
zero-new-attack-surface choice. If a future slice adds it, `UX-17`'s
existing allow-list mechanism (`tablePreferences.ts`-style, versioned,
validated, safely-reset-on-malformed) is the documented place to extend.

---

## Performance

```
PERFORMANCE_REGRESSION=NO
```

No new continuous polling was added — Compose-project discovery fires
exactly once per source selection (piggybacking on the existing
services-fetch pattern), never on an interval. Bundle delta (production
build, `vite build`, gzip sizes), UX-R3 branch vs. `main` @ `99ea254`:

| Chunk | main (post-PR33) | UX-R3 | Δ raw | Δ gzip |
|---|---|---|---|---|
| `index.js` (main bundle) | 287.68 kB / gzip 86.47 kB | 291.37 kB / gzip 87.34 kB | +3.69 kB | +0.87 kB |
| `index.css` | 38.53 kB / gzip 6.30 kB | 39.67 kB / gzip 6.43 kB | +1.14 kB | +0.13 kB |
| `LiveTailPanel.js` (lazy chunk) | 4.84 kB / gzip 1.89 kB | 5.16 kB / gzip 2.00 kB | +0.32 kB | +0.11 kB |
| `LiveTailPanel.css` (lazy chunk) | 2.34 kB / gzip 0.76 kB | 2.71 kB / gzip 0.84 kB | +0.37 kB | +0.08 kB |
| `JourneyView`/`JourneyEntryRow` | unchanged | unchanged | 0 | 0 |

Modest, expected growth (one new toolbar control, one new header trail,
one new Settings section, one redesigned badge) — no code-splitting
regression (`LiveTailPanel`/`JourneyView` remain lazy-loaded, unchanged
from UX-R2).

---

## Accessibility

No regression found. `ComposeProjectSelect` has a real associated
`<label>` (not visually-hidden, since it is a materially scope-changing
control the investigator should be able to locate by sighted scanning
too) and is included in `jest-axe` coverage
(`ComposeProjectSelect.test.tsx`). The Live badge's state text is the
primary signal (never color-only), and remains inside a `role="status"`
element (a live region, unchanged mechanism, now carrying more
information). `DockerSettingsPanel`'s new sections are plain headed
`<h3>`/`<ul>`/`<dl>` content, keyboard-reachable exactly like the
existing sections around them. Narrow (390px) rendering verified live for
both Settings and Search (`AFTER-L`/`AFTER-M-narrow-*.png`) with no
horizontal overflow (also asserted structurally across the full 197-test
E2E suite's own narrow-viewport specs, all passing).

---

## Test results

```
BACKEND_TESTS=PASS (606 tests, 0 failures, 0 errors, 0 skipped — full `./mvnw test`, 56/56 test classes, including DockerLogSourceTest's new overlapping-service-name/discovery/malicious-project/backward-compat coverage)
FRONTEND_TESTS=PASS (662 tests, 60/60 files — `npx vitest run`)
E2E_TESTS=PASS (197/197 — full `npx playwright test`, Fixture-only CI-safe suite; one pre-existing spec, phase-legacy-slice5-live-resilience.spec.ts, needed its expected Live-badge text pattern updated for the redesign, fixed and re-verified green)
REAL_DOCKER_TESTS=PASS (see the isolation-proof table above; real dev backend, real Docker Engine, real two-project overlapping-service-name rig, torn down cleanly afterward)
TYPECHECK=PASS (`npm run typecheck`, `tsc -b --noEmit`, clean)
PRODUCTION_BUILD=PASS (`npm run build`, clean, see bundle table above)
WINDOWS_DESKTOP_CI=NOT_TRIGGERED (no Windows-packaging-relevant files touched this slice)
```

No test was skipped or disabled to obtain a green build (CLAUDE.md §3).

---

## Remaining scope (explicitly not touched this slice)

```
REMAINING_UX_R4_R6=NOT_STARTED (row-click-to-inspector, truthful sort, selected-row redesign, inspector prev/next indicator, "surrounding logs from every tab")
REL_1_STATUS=TRACKED_NOT_STARTED
```

---

## Requirements register

`REQUIREMENTS_REGISTER_PATH=docs/governance/OWNER_REQUIREMENTS_REGISTER.md`.
Updated this session: new §"3a. UX-R3 Owner Decisions (A–F)"; UX-6, UX-7,
UX-9 (+ its own §3 detail section), UX-14, UX-20, and DEC-A/DEC-B moved
to `VERIFIED` with concrete evidence citations (backend/frontend unit
tests, component tests, the real two-project isolation proof, and live
screenshots — never marked `VERIFIED` on source presence alone). Item 5
("Live to Search") and DEC-C stay `IN_PROGRESS`, honestly: the
Compose-project-switch exit case is now proven (real `<App />`
integration test), but keyboard-only-activation re-verification of the
pre-existing exit button was not re-performed this session, so it is not
claimed as newly verified. Compose-project persisted-safe-scope (UX-17)
was deliberately left untouched this slice (§13) — not marked done.
`UNTRACKED_OWNER_REQUIREMENTS=0` — every requirement this mission's own
message named has a corresponding register row; no new finding surfaced
during this pass that isn't already captured above or in the register
itself.
