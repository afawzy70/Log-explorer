# Legacy Remediation Slice 8 — Productivity, Safe Preferences & Frontend Delivery Performance

Base: `c140f3eb3d1885a1e1ef0a5d332210d06184dcf8` (post-Slice-7 `main` HEAD, PR
#27). Branch: `phase/legacy-slice8-productivity-performance`.

This slice is a polish/performance pass, not a redesign. Its scope: (1)
centralize keyboard shortcuts into one registry, adding a small number of
high-value new bindings; (2) make the shortcuts-help popover derive its
content from that registry instead of a hand-maintained list; (3) audit
browser persistence and confirm nothing beyond the existing, Slice-4 table
preferences is ever persisted; (4) audit and, where genuinely justified,
reduce initial-bundle weight via code splitting; (5) audit dependencies,
startup network behavior, and render performance. Detailed bundle/network/
render numbers live in the companion
[`SLICE_8_FRONTEND_PERFORMANCE_REPORT.md`](./SLICE_8_FRONTEND_PERFORMANCE_REPORT.md);
this report covers the rest.

## 1. Persistence inventory (§1–§3)

Every call site that touches `localStorage`/`sessionStorage`/`indexedDB` in
the frontend was located and inspected:

| File | What it does |
|---|---|
| `frontend/src/features/results/tablePreferences.ts` | The **only** real read/write call site in the app. Persists column order, hidden-column ids, and density under `logexplorer.tablePreferences.v1`. |
| `frontend/src/features/inspector/useResizablePanel.ts` | Inspector panel width — kept in memory only, never persisted (own doc comment cites CLAUDE.md §2 rule 4). |
| `frontend/src/features/settings/DockerSettingsPanel.tsx` | The Test Connection candidate form — local component state only, discarded on close. |
| `frontend/src/app/useSearchState.ts` | Every piece of search state (source, time range, severity, query, advanced filters, search text) — in memory for the page's lifetime only. |
| `frontend/src/shared/api/types.ts` | Type-level doc comments only; no runtime storage access. |

**Finding: `tablePreferences.ts` is the one persistence store in the whole
frontend.** No new store was introduced, and none was needed — this
confirms the mission's own instruction ("the existing Slice 4
table-preference model remains authoritative. Do not duplicate preference
stores unnecessarily").

### Safe / forbidden persistence policy (as enforced today)

**Allowed (persisted, via `tablePreferences.ts`):** table column order,
hidden-column ids, density (`comfortable`/`compact`).

**Forbidden (never persisted, confirmed by test):** raw query text
(universal search, guided query, raw LogQL), any advanced/protected filter
value (CIF, username, customerId, deviceId, deviceIp, and the rest of
`AdvancedFilterValues`), returned raw log events, event payloads, source
selection, service selection, time range, severity selection, journey/
context breadcrumb state, Docker connection candidate/credentials.

### Regression coverage

- `frontend/src/app/persistence.test.tsx` (pre-existing, re-verified green
  this slice) — a full interaction sequence (source select, time range,
  severity, universal search with a sensitive-looking sentinel, advanced
  filters with a real protected field, guided query authoring, and viewing
  an already-redacted event in the inspector) asserts **zero** calls to
  `localStorage.setItem`/`sessionStorage.setItem`/`history.pushState`/
  `history.replaceState`, and an empty `location.search`/`location.hash`,
  throughout.
- `frontend/src/features/results/tablePreferences.test.ts` (pre-existing,
  re-verified green this slice) — covers §3's schema requirements in full:
  version check (missing/wrong version → full default), null/non-object/
  malformed-JSON input → default, unknown column ids dropped, duplicate
  ids deduplicated, missing known columns appended with their registry
  default-hidden posture (never silently promoted visible), "never all
  columns hidden" safety invariant, invalid density → `comfortable`
  fallback, and a dedicated test that the persisted object's keys are
  exactly `{version, columnOrder, hiddenColumnIds, density}` — nothing
  else ever reaches storage.
- `frontend/src/app/startupNetwork.test.tsx` (new this slice) — confirms
  the Docker settings panel's own connection-summary fetch never fires
  before the panel is explicitly opened (see the performance report's
  §16 for the full startup-request audit).
- `phase-legacy-slice8-productivity-performance.spec.ts` scenarios 10–12
  (new this slice, real backend) — reload survives only the density
  preference, never search/query state; a sensitive-looking universal
  search value and CIF filter value never reach `localStorage`/
  `sessionStorage`/the URL and do not survive a reload; a corrupted
  `logexplorer.tablePreferences.v1` value never breaks app startup.

No new persistence code was written. §1–§3 were an audit-and-confirm pass;
the existing Slice 4 model already satisfies every requirement.

## 2. Keyboard shortcut registry (§4–§6)

### Before

Four independent `document.addEventListener('keydown', ...)` call sites
(one each in `useGlobalShortcuts.ts`, `KeyboardShortcutsHelp.tsx`,
`useLiveKeyboardShortcuts.ts`, `EventInspector.tsx`), each with its own
mount/unmount lifecycle and its own `isTypingTarget` guard, plus a
hand-maintained array in `KeyboardShortcutsHelp.tsx` that had to be kept in
sync with all four by hand.

### After

One `ShortcutRegistryProvider` (`frontend/src/shared/keyboard/
ShortcutRegistry.tsx`), wrapping the whole app in `App.tsx`, owning exactly
one `document` `keydown` listener for the app's entire lifetime. Every
shortcut owner calls one hook, `useShortcut(def)`, to register.

**Registration vs. applicability are deliberately decoupled**: a shortcut
registers for its owning component's *mount* lifetime (so it is always
listed in the help popover, even when not currently actionable — e.g.
Live's P/S/C/F are always registered since `useLiveKeyboardShortcuts` is
called unconditionally in `AppContent`, even while viewing historical
search), while a separate `test(event)` predicate, checked at keypress
time, decides whether a given keydown actually fires it right now. This
is what lets "help content is always derived from the real registry"
coexist with "help stays discoverable even for contextually-inactive
shortcuts" — the same tension the pre-Slice-8 help list solved with
static "(while Live is the active view)" caveat text.

`useRegisteredShortcuts()` exposes the live list reactively, so
`KeyboardShortcutsHelp` renders whatever is actually registered, grouped
and ordered by a fixed `GROUP_ORDER`, instead of a hand-maintained array
that could silently drift out of sync.

### Two real bugs found and fixed during the migration

1. **Infinite render loop.** `ShortcutRegistryProvider`'s context value was
   originally a fresh `{register, unregister}` object literal on every
   render. Since `useShortcut`'s own registration effect depends on that
   object's identity (`[ctx, def.id]`), and `register`/`unregister`
   themselves trigger a re-render (via `setList`), every registration
   caused a new context object, which re-ran the effect, which registered
   again — an infinite loop, caught immediately (before any test could
   even collect) via a hung `vitest run`. Fixed with `useMemo` around the
   context value.
2. **Live shortcuts matched every keydown, not just their own letter.**
   `useLiveKeyboardShortcuts.ts`'s original `test()` functions checked only
   connection state, never `event.key` — so with P registered first, any
   keydown while Live was live/paused (including S, C, F, and even a
   Ctrl/Cmd/Alt-held P) matched P's `test()` and fired pause/resume,
   silently swallowing S/C/F and firing on modifier-held presses. Caught by
   the migrated unit tests (`S`/`C`/`F` assertions failing, and the
   dedicated "never fires while a modifier key is held" test catching 3
   unwanted calls). Fixed by adding an explicit `isBareLetter(event, letter)`
   check (no Ctrl/Cmd/Alt, case-insensitive) to all four `test()` functions.

Both were pre-existing-pattern bugs introduced by *this slice's own new
code*, not carried over from before — caught before merge by the mission's
own required regression tests, exactly as intended.

### Registry guarantees (§6)

- Exactly one `document` `keydown` listener for the provider's entire
  lifetime — never re-added on a re-render (`useShortcut.test.ts`-style
  coverage lives in `useLiveKeyboardShortcuts.test.ts`'s "reads fresh live
  state ... without the registry ever re-adding its one document listener
  on a re-render" test, asserting `document.addEventListener` is called
  exactly once total, even across multiple re-renders with fresh prop
  objects).
- Unregisters cleanly on unmount (own test: a keypress after unmount does
  nothing).
- A shortcut whose `test()` returns `false` does nothing — verified for
  every new shortcut (idle Live state, no-previous/no-next bound, no
  breadcrumb/journey for B, no `searchResult` for R).
- Shortcuts are suppressed while a text input/textarea/contenteditable has
  focus (`isTypingTarget`, checked inside the registry's own dispatch
  loop), **except** where a shortcut explicitly opts in via
  `allowWhileTyping: true` — used only by `inspector.close` (Escape), which
  needs to work even while the inspector's own All Fields search box has
  focus, matching the pre-Slice-8 behavior exactly (Escape was never
  guarded before this slice either).
- Modifier behavior is deterministic: every single-letter global shortcut
  explicitly rejects `ctrlKey`/`metaKey`/`altKey`, so it never fights a
  browser/system shortcut.

### Keyboard bindings (complete list)

| Key | Action | Scope | New in Slice 8? |
|---|---|---|---|
| `Ctrl/Cmd + Enter` | Run the current search | anywhere | No (migrated) |
| `/` | Focus the universal search box | anywhere, not while typing | No (migrated) |
| `M` | Open/close More Filters | anywhere, not while typing | **Yes** |
| `R` | Refresh (only while results are shown) | anywhere, not while typing | **Yes** |
| `X` | Show ±30s surrounding context (only while an event with a timestamp is selected) | anywhere, not while typing | **Yes** |
| `B` | Back to the original search (context) / back to search results (journey) | anywhere, not while typing | **Yes** |
| `Esc` | Close the inspector | while inspector open, even while typing | No (migrated) |
| `[` | Previous event | while inspector open and a previous event exists | No (migrated) |
| `]` | Next event | while inspector open and a next event exists | No (migrated) |
| `P` | Pause/resume Live | while Live is the active view | No (migrated, from UI Gap Closure Pass) |
| `S` | Stop Live | while Live is the active view | No (migrated) |
| `C` | Clear Live events | while Live is the active view and events exist | No (migrated) |
| `F` | Toggle Follow newest | while Live is the active view | No (migrated) |
| `?` | Open the shortcuts help | anywhere, not while typing | No (migrated) |
| `↑` / `↓` | Move between result rows | row has focus (element-scoped, outside the registry) | No |
| `Enter` / `Space` | Open the focused row's Actions menu | row has focus (element-scoped) | No |
| `←` / `→` | Resize the inspector panel | resize handle has focus (element-scoped) | No |

The three element-scoped rows stay outside the registry deliberately — they
are `onKeyDown` on one specific DOM element (a table row, a resize handle),
not a `document`-level concern the registry's single global listener model
fits. They are still listed in the help popover via a small, explicitly
documented static supplement (`SCOPED_SHORTCUTS` in
`KeyboardShortcutsHelp.tsx`) since they cannot be derived from the
registry.

M reuses the pre-existing `data-shortcut="..."` + `.click()` convention (a
`data-shortcut="more-filters-trigger"` attribute added to `AdvancedFilters`'
own trigger button) rather than lifting its self-contained popover state
into a parent — zero change to `AdvancedFilters`' internal architecture.

## 3. Code splitting (§7–§9)

See the performance report for the full bundle-size before/after table,
the two components split (`JourneyView`, `LiveTailPanel`), and the
reasoning for declining to split `DockerSettingsPanel`,
`KeyboardShortcutsHelp`, and `QueryBuilder` (all three are always mounted
at startup regardless of popover-open state, so lazy-loading the component
itself would not defer anything).

## 4. Dependency audit (§10)

Production `dependencies`: `react`, `react-dom` only. Nothing to remove —
see the performance report §10 for the full finding.

## 5. Render performance (§11)

Manual audit of the five named high-frequency surfaces plus a direct check
of the new registry's own re-render behavior — no demonstrated hot path,
no new memoization added. Full writeup in the performance report §11.

## 6. Live / redaction invariants (§12/§13)

Zero changes to `useLiveTail.ts`, the backend `TextRedactor`, or any
redaction-display component. Re-ran `ResultsTable.performance.test.tsx` and
`useLiveTail.performance.test.ts` (10/10 passed) to confirm no regression.

## 7. Bundle / network evidence (§14–§16)

Full numeric evidence in
[`SLICE_8_FRONTEND_PERFORMANCE_REPORT.md`](./SLICE_8_FRONTEND_PERFORMANCE_REPORT.md).

## 8. Accessibility (§17)

- `KeyboardShortcutsHelp`'s dialog: `role="dialog"`, `aria-labelledby`,
  closes on Escape, restores focus to the trigger on close
  (`usePopoverTrigger`'s existing behavior, unchanged), reachable and
  fully usable keyboard-only. Verified by `jest-axe` (`has no detectable
  accessibility violations, closed or open`) and by the Playwright scenario
  7/18.
- No shortcut traps focus or keyboard-only use: every new shortcut (M, R,
  X, B) either opens an existing, already-accessible drawer/dialog
  (`AdvancedFilters`) or calls a state transition with no modal side
  effect of its own.
- Lazy-loaded content (`JourneyView`, `LiveTailPanel`): the `Suspense`
  fallback is a plain `role="status"` paragraph (announced to assistive
  tech via the existing live-region convention `ResultsPanel` already
  uses for its own loading state), and focus is never moved away from the
  triggering control while a chunk loads — Playwright scenario 13
  confirms both chunks load and render usable content on first use.
- `EventInspector`'s `has no detectable accessibility violations` test
  (pre-existing, `jest-axe`) re-verified green after the shortcut
  migration.

## 9. Responsive / mobile regression (§18)

Playwright scenario 18 (390px): the shortcuts-help dialog opens, is fully
readable, and the page has zero horizontal overflow
(`assertNoHorizontalOverflow`); the primary inspector flow at 390px is
unaffected. Screenshot evidence: `docs/verification/legacy-slice8/
narrow-390px-shortcut-help.png`. The full existing Playwright suite's own
390px scenarios (Slices 4/5/6/7, UI Gap Closure, UI Parity Acceleration)
were all re-run and remain green — see §10 below.

## 10. Tests

### Backend

```
./mvnw --batch-mode verify
```

**PASS.** `Tests run: 595, Failures: 0, Errors: 0, Skipped: 0`, `BUILD
SUCCESS`. Zero backend production files were touched by this slice (`git
diff c140f3e..HEAD -- backend/` is empty) — this run confirms the existing
suite still passes against the unchanged backend, exactly as the mission
expected ("Slice 8 should require little/no backend production change").

### Frontend unit/component

```
npm ci && npm run typecheck && npm run test -- --run && npm run build
```

**PASS.** Typecheck clean. `56 test files, 604 tests, all passed`
(including the new `startupNetwork.test.tsx`, the rewritten
`KeyboardShortcutsHelp.test.tsx`/`useLiveKeyboardShortcuts.test.ts`/
`EventInspector.test.tsx` keyboard coverage, and every pre-existing test
file, including `persistence.test.tsx`, `tablePreferences.test.ts`, both
performance suites, and every Slice 5/6/7 component test). Production
build succeeds (`npm run build`), numbers reported in the performance
report.

### Playwright / E2E

Real dev-profile backend (`SPRING_PROFILES_ACTIVE=dev`), real frontend dev
server, Fixture source — no mocked responses for this slice's own spec,
matching every prior slice's convention.

`frontend/e2e/phase-legacy-slice8-productivity-performance.spec.ts` — all
18 mission-required scenarios, **18/18 PASS**.

Full existing suite (`npx playwright test`, 171 tests across every prior
phase's spec plus this slice's new one): **170/171 PASS.** The one failure
(`phase-m-ux-acceptance.spec.ts` Task 1) is a pre-existing,
environment-specific issue on this particular sandbox, unrelated to Slice
8: this machine has an unrelated local Docker Compose stack running
(containers named `web`/`caddy`/`db`, confirmed via `docker ps`), which
races the (unmodified-by-this-slice) service-discovery fetch in
`useSearchState.ts` — the service list intermittently reflects the "Local
Docker Compose" source's real containers instead of the just-selected
"Fixture" source's own known services (`payments-api` etc.), a latent race
condition with no request-cancellation for the services fetch. Evidence
this is unrelated to Slice 8: (1) `git diff c140f3e..HEAD --
frontend/src/app/useSearchState.ts` is empty — this slice never touched
that file; (2) hosted CI for the base commit (`c140f3eb3d1885a1e1ef0a5d332210d06184dcf8`)
is green (`gh run list` shows `"conclusion":"success"`), and CI's clean
environment has no such stray Docker stack to race against. Not fixed in
this slice, per its own scope exclusions (an unrelated, pre-existing,
out-of-scope issue).

## 11. Capability matrix

`docs/LEGACY_TO_NEW_VERIFIED_CAPABILITY_MATRIX.md` updated — see that
file's diff for the specific rows touched (keyboard shortcuts, shortcuts
help, table preferences persistence-safety note).

## 12. Scope adherence

No changes to: query DSL semantics, pagination, Docker security posture,
redaction logic, authentication/RBAC, service workers/offline caching,
production dependency versions (`react`/`react-dom` untouched), or Issue
#19. Slice 9 was not started. No auto-merge was performed.
