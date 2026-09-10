# Slice 8 — Frontend Delivery Performance Report

Legacy Remediation Slice 8: Productivity, Safe Preferences & Frontend Delivery
Performance. Evidence for §7–§16 of that mission. All numbers below are from
real `npm run build` output (`vite build`), not estimates.

Base commit: `c140f3eb3d1885a1e1ef0a5d332210d06184dcf8` (post-Slice-7 main HEAD).

## Bundle size — before / after

"Before" = the production build at the base commit, before any Slice 8
change. "After" = the production build at the tip of
`phase/legacy-slice8-productivity-performance`.

### Before (base commit, no code splitting)

```
dist/index.html                   0.39 kB │ gzip:  0.26 kB
dist/assets/index-CWuThC8W.css   42.82 kB │ gzip:  6.80 kB
dist/assets/index-17AL90Jj.js   291.20 kB │ gzip: 86.86 kB
```

One JS chunk, one CSS chunk. 123 modules transformed.

### After (JourneyView/LiveTailPanel split via `React.lazy`)

```
dist/index.html                             0.39 kB │ gzip:  0.26 kB
dist/assets/JourneyEntryRow-mh5razt9.css    1.11 kB │ gzip:  0.44 kB
dist/assets/JourneyView-8TjrAEXg.css        1.84 kB │ gzip:  0.60 kB
dist/assets/LiveTailPanel-BAGwB39Y.css      2.34 kB │ gzip:  0.76 kB
dist/assets/index-JiOYIsqb.css             37.62 kB │ gzip:  6.14 kB
dist/assets/JourneyEntryRow-Co9QYvAc.js     1.74 kB │ gzip:  0.75 kB
dist/assets/JourneyView-Dasdf6VN.js         3.22 kB │ gzip:  1.33 kB
dist/assets/LiveTailPanel-BZS1ETh1.js       4.84 kB │ gzip:  1.89 kB
dist/assets/index-COjG9iHT.js             283.90 kB │ gzip: 85.49 kB
```

124 modules transformed (one net-new module: the shared shortcut registry).

### Summary table

| Metric | Before | After | Delta |
|---|---|---|---|
| Initial critical JS (`index-*.js`) | 291.20 kB (86.86 kB gzip) | 283.90 kB (85.49 kB gzip) | **−7.30 kB raw / −1.37 kB gzip (−2.5% / −1.6%)** |
| Initial critical CSS (`index-*.css`) | 42.82 kB (6.80 kB gzip) | 37.62 kB (6.14 kB gzip) | **−5.20 kB raw / −0.66 kB gzip (−12.1% / −9.7%)** |
| Lazy JS chunks (not in initial load) | 0 | 9.80 kB raw / 3.97 kB gzip (JourneyView + its JourneyEntryRow dep + LiveTailPanel) | new, deferred |
| Lazy CSS chunks | 0 | 5.29 kB raw / 1.80 kB gzip | new, deferred |
| Total shipped JS (initial + all lazy) | 291.20 kB | 293.70 kB | +2.50 kB (module-boundary overhead) |
| JS chunk count | 1 | 4 | — |
| CSS chunk count | 1 | 4 | — |

The initial-load numbers are the ones that matter for §15 ("meaningful
reduction in initial critical JS where real splitting candidates exist"):
every investigator who never opens a journey or starts Live now pays about
7.3 kB less JS and 5.2 kB less CSS to reach the primary search screen. The
total-shipped-bytes figure is very slightly *larger* than before (expected —
splitting a module boundary always adds a small amount of per-chunk
overhead), which is the correct trade-off per §15: total bytes is not the
goal, initial critical-path bytes is.

This is a modest, honest number, not a dramatic one — the whole app was
already small (291 kB raw / 87 kB gzip for the *entire* investigation UI
before this slice), so there was limited room for a large win without
touching the primary Search → scan → inspect path, which this slice was
explicitly told not to do.

## Code-splitting boundaries introduced (§8)

| Component | Boundary | Why |
|---|---|---|
| `JourneyView` | `React.lazy(() => import('../features/journey/JourneyView'))` in `App.tsx` | Only mounts after the investigator clicks a "Find this Trace/Correlation/Journey ID" action. Never mounted at startup. |
| `LiveTailPanel` | `React.lazy(() => import('../features/live/LiveTailPanel'))` in `App.tsx` | Only mounts after the investigator clicks Live. Never mounted at startup. `JourneyView` and `LiveTailPanel` are mutually exclusive with each other and with the eager `ResultsPanel` (`AppContent`'s own three-way branch), so at most one of the three chunks is ever loaded per session. |

Each has a small `<Suspense>` boundary with a local, non-blocking fallback
(`SectionLoadingFallback` — a single `role="status"` paragraph inside the
existing results column, styled to match `ResultsPanel`'s own pre-existing
`.loading` convention), per §9: no full-screen spinner, no layout jump, no
blocking of the rest of the app (the header/toolbar/inspector stay
interactive while a lazy chunk loads).

### Considered and declined

`DockerSettingsPanel` and `KeyboardShortcutsHelp` (the mission's own named
examples, "rarely-opened settings, keyboard help") were evaluated and
deliberately **not** split. Both are rendered unconditionally in `Shell`'s
header on every page load — each owns its own popover-open state
internally, so the *component* is always mounted even though its *popover
content* is not. `React.lazy`/`Suspense` defers the **import**, not the
render; since both are already rendered (with an initial closed-popover
state) on the very first paint, wrapping either in `React.lazy` would start
the network fetch for their code at exactly the same moment as today — the
only change would be an extra render-blocking `Suspense` fallback flash on
first paint, a straightforward regression under §9/§15 ("a smaller bundle
that makes interaction worse is NOT success") for zero deferral benefit.
Splitting only their *popover content* (keeping an eager trigger button)
was considered but declined for this slice: both panels are small (123 and
242 lines) and mounted at startup regardless, so the payoff is marginal,
while restructuring two already-tested, already-accessible popovers (focus
management, `useDismissableLayer`, in `KeyboardShortcutsHelp`'s case the
"?" shortcut registration itself) carries real regression risk under this
mission's own "polish/performance slice, NOT a redesign" instruction.

`QueryBuilder` (the mission's other named example, "advanced/raw query
editing") was also evaluated and declined: its trigger lives directly in
the always-rendered `Toolbar`, on the primary search path, and — like the
two panels above — is unconditionally mounted at startup; the same
"lazy-loading an always-mounted component doesn't defer anything" reasoning
applies.

## Dependency audit (§10)

Frontend production `dependencies` (from `package.json`):

```json
"dependencies": {
  "react": "19.2.8",
  "react-dom": "19.2.8"
}
```

That is the complete list. Every other package in `package.json` is a
`devDependency` (Vite, TypeScript, Vitest, Playwright, Testing Library,
jest-axe, `@types/*`) — build/test tooling that Vite's production build
never bundles, confirmed by the chunk list above containing no test-only or
dev-only code. **Finding: nothing to remove.** There is no unused package,
no duplicate-functionality package, and no accidentally-production-bundled
dev dependency to clean up. `DEPENDENCIES_REMOVED=none (audit found nothing
eligible)`.

## Render performance audit (§11)

Reviewed the five named high-frequency surfaces for obvious unnecessary
re-renders:

- **`ResultsTable`** — a single flat component (not decomposed into a
  per-row subcomponent), so `React.memo` per row isn't directly
  applicable without a structural refactor this "polish, not a redesign"
  slice was told to avoid. It re-renders only when its props
  (`events`/`columnOrder`/`density`/selection) actually change — i.e. on a
  new search result or an explicit preference change — not on a timer or
  a high-frequency event stream. Already covered by
  `ResultsTable.performance.test.tsx` (100/1,000/5,000-row bounded-time
  assertions), re-run in this slice with no change in behavior.
- **`EventInspector`** — re-renders on selection change only (not
  high-frequency); its three Slice 8 shortcuts read fresh state via a
  `ref` (`stateRef`) precisely so `useShortcut`'s own registration effect
  never has to re-run on every keystroke elsewhere in the app.
- **`AdvancedFilters`** — a form with fully local draft state; re-renders
  are bounded to the popover's own open/typing interactions, not a hot
  path.
- **`LiveTailPanel`** — already uses `useMemo` for its filtered-event
  derivation (pre-existing, from an earlier slice); the real
  high-frequency work is one layer down in `useLiveTail`'s own batching,
  unchanged by this slice and re-verified by
  `useLiveTail.performance.test.ts` (burst/sustained-load profiles, all
  green — see §12 below).
- **`SourceHealthBadge`** — updates on an explicit poll/retry, not a
  frequent interaction.

One render-performance risk specific to this slice's own new code was
checked directly: whether `ShortcutRegistryProvider`'s `list` state
(updated on every shortcut mount/unmount) could cascade re-renders through
the whole app tree. It cannot — `AppContent` is passed to the provider as
a pre-built `children` element (`<ShortcutRegistryProvider><AppContent
/></ShortcutRegistryProvider>`), so a `list` state change only re-renders
components that actually call `useRegisteredShortcuts()`
(`KeyboardShortcutsHelp` alone); every `useShortcut` caller subscribes only
to the separate, `useMemo`-stabilized `register`/`unregister` API object,
which never changes identity. **Finding: no demonstrated hot path
requiring new memoization.** Per §11's own instruction ("do not add
memoization everywhere blindly — only demonstrated hot paths"), no new
`React.memo`/`useMemo`/`useCallback` was added to any of the five
components; all five already had the level of memoization their actual
render frequency warrants.

## Live / redaction performance invariants (§12/§13)

Re-ran the two existing dedicated performance suites unchanged, to confirm
Slice 8 introduced no regression:

```
npx vitest run src/features/results/ResultsTable.performance.test.tsx \
  src/features/live/useLiveTail.performance.test.ts
```

Result: **10/10 passed** — retention bounded at `VISIBLE_CAP`, DOM-bound
`visibleEvents` never exceeds the cap mid-burst, batching keeps React state
commits far below the raw event count, reconnect/pause/resume/clear/stop
all still work correctly mid-load. No changes were made to `useLiveTail.ts`
or any redaction code in this slice (Slice 7's `TextRedactor` and its
frontend display components were untouched — verified by `git diff` showing
zero changes to `backend/.../TextRedactor*` or the inspector's redaction
display tests, all of which are re-run green in the full suite below).

## Initial load performance (§14)

Measured (real, `vite build` output, see the bundle table above):

- Initial critical JS: 291.20 kB → 283.90 kB (raw), 86.86 kB → 85.49 kB
  (gzip).
- Initial critical CSS: 42.82 kB → 37.62 kB (raw), 6.80 kB → 6.14 kB
  (gzip).
- Lazy chunk count: 0 → 3 (JourneyView + its JourneyEntryRow dependency,
  LiveTailPanel), each with its own small CSS chunk.

**First render / interaction readiness: NOT_MEASURED.** This sandbox has no
browser performance-timeline tooling (Lighthouse, Web Vitals collection, a
real Chrome DevTools trace) available to produce a trustworthy
first-contentful-paint or time-to-interactive number, and CLAUDE.md's
verification-honesty rule ("never invent values... use BLOCKED, not a
guess") applies here: rather than fabricate a plausible-looking millisecond
figure, this is reported as not measured. The bundle-size deltas above are
the real, reproducible evidence for this section.

## Performance target (§15)

- No bundle regression without justification: the total-shipped-bytes
  figure grew by 2.50 kB (module-boundary overhead from introducing two
  new chunk boundaries) — justified and expected, not a regression of the
  metric that matters (initial critical JS, which went down).
- Meaningful reduction in initial critical JS where real splitting
  candidates existed: yes, for the two components that were genuinely
  conditional (`JourneyView`, `LiveTailPanel`).
- No noticeable delay added to Search → results → inspector: confirmed —
  `ResultsPanel` and `EventInspector` were never wrapped in `Suspense` and
  remain in the initial bundle; Playwright scenario 14
  (`phase-legacy-slice8-productivity-performance.spec.ts`) exercises this
  exact path end to end against the real backend and passes.
- Secondary features load lazily: `JourneyView`/`LiveTailPanel`, confirmed
  by Playwright scenario 13 (opens both on first use successfully).

## Network behavior audit (§16)

Startup fires exactly four requests, one each, with no duplicates:
`/api/v1/sources`, `/actuator/info` (`EnvironmentBadge`), `/api/v1/sources/
<id>/services` (service discovery, capability-gated), and `/api/v1/sources/
<id>/health`. Locked in by a new regression test,
`frontend/src/app/startupNetwork.test.tsx`. `DockerSettingsPanel`'s own
connection-summary fetch fires only when its settings popover is explicitly
opened (`open()`, not a mount effect) — confirmed by reading the component
and by the startup test's own explicit `expect(calls).toHaveLength(4)`
assertion, which would fail if that fetch fired eagerly. Nothing in Slice 8
touches any of this fetching logic — `useSearchState.ts`,
`DockerSettingsPanel.tsx`, and `EnvironmentBadge.tsx` all have zero diff
from the base commit (`git diff c140f3e..HEAD` for each is empty). Per
mission scope, the unrelated Issue #19 was not touched.

## Known limitations

- First-paint/interaction-readiness timing is `NOT_MEASURED` (§14) — no
  browser performance-tracing tool was available in this environment.
- The render-performance audit (§11) is a manual code review plus the two
  pre-existing performance test suites, not a new profiler trace — this
  matches the mission's own "profiling evidence **or** deterministic
  render-count tests where practical" allowance, and no new hot path was
  found that would justify writing a new render-count test.
