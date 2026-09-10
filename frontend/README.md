# Frontend developer guide

React 19 + TypeScript (strict) + Vite. This is the developer-facing
companion to the root [`README.md`](../README.md) and
[`docs/development/ARCHITECTURE.md`](../docs/development/ARCHITECTURE.md) —
read those first for the product picture; this document is "I'm changing
frontend code, where do I look."

## Stack and bootstrap

- React 19, TypeScript strict mode, Vite 8. No routing library (there is
  exactly one screen) and no global state library — application state is
  plain React state, owned by one hook (`useSearchState`, below).
- Dev server on port **3435**, proxying `/api`/`/actuator` to the backend
  on **3434** (`vite.config.ts`) — production has no separate frontend
  server at all; Spring Boot serves the built static assets directly (see
  the Dockerfile and the root README's "Production vs. development" table).
- Entry: `src/main.tsx` → `src/app/App.tsx`, which wraps everything in
  `ShortcutRegistryProvider` (see "Keyboard shortcuts registry" below) and
  renders `AppContent` — the actual shell, toolbar, results/journey/live
  panel, and inspector.

## Project structure

```
src/app/            Shell, toolbar, top-level state (useSearchState), keyboard shortcuts, environment/health badges
src/features/
  search/            Universal search, More Filters drawer, guided Query builder, time range
  results/           Results table, column/density preferences, gap detection
  inspector/         Event inspector (overview/actor/request-flow/business/all-fields), resizable panel
  journey/           Trace/correlation journey timeline
  live/              Live tail state machine + panel
  settings/          Docker connection settings panel
  timerange/         Time-range presets/custom popover
src/shared/
  api/               Fetch client, wire types (client.ts, types.ts)
  keyboard/           The shared shortcut registry
  ui/                Small reusable primitives (Button, popover/dismissable-layer hooks, VisuallyHidden)
  time/               Time-preset/formatting helpers
  browser/            Clipboard and other thin browser-API wrappers
e2e/                 Playwright specs (one file per phase/slice) + shared helpers
```

## API layer (`src/shared/api/`)

`client.ts` is the only place `fetch()` is called — every feature imports
a typed function from here (`fetchSources`, `runSearch`, `fetchContext`,
`openLiveTail`, …), never calls `fetch` directly. `types.ts` mirrors the
backend's DTOs field-for-field; when a backend DTO changes, this is the
first file to update, followed by whatever feature consumes the new/
changed field. See
[`docs/development/BACKEND_FRONTEND_INTEGRATION.md`](../docs/development/BACKEND_FRONTEND_INTEGRATION.md)
for the exact request/response shape of every endpoint.

## State ownership (`src/app/useSearchState.ts`)

One hook owns essentially all application state: selected source/services/
severity, the committed time range, universal search text, advanced
filter values, guided-query state, the current search result (+ loading/
error), the selected event (for the inspector), the context/journey
breadcrumb, and Live's own connection object is composed alongside it in
`AppContent`. This is deliberate, not an oversight — there is exactly one
investigation workflow, not a set of independently-navigable pages, so one
cohesive state owner is simpler than prop-drilling or a state-management
library would be. **Nothing here is ever persisted** (see "Persistence
rules" below) — it is in-memory for the life of the page.

## Toolbar / filters (`src/app/Toolbar.tsx`, `src/features/search/`)

- `Toolbar.tsx` — source select, service multi-select, time range trigger,
  severity toggle, universal search box, Search/Query/Live buttons.
- `AdvancedFilters.tsx` (the "More Filters" drawer) — a draft/Apply/Cancel/
  Reset panel for the advanced/protected filter fields
  (`advancedFilterFields.ts`), grouped by investigation question. Applying
  never fires a search on its own — the toolbar's own Search button does.
- `QueryBuilder.tsx` — the guided query authoring surface (and, where the
  source supports it, raw LogQL mode) — see `queryAuthoring.ts` for the
  guided-condition → DSL text translation.

## Results table (`src/features/results/`)

`ResultsTable.tsx` renders the fixed seven-column layout (Time, Level,
Service, What happened, User/Customer, Correlation/Trace, Actions) from
`columnRegistry.ts`'s single authoritative column definition list — a
column's visibility/order/density comes from `tablePreferences.ts` (see
"Safe preferences" below). `gapDetection.ts` computes missing-time-range
markers between consecutive **already-fetched** rows entirely client-side
— there is no backend concept of a "gap" (see the backend guide's own
note on this).

## Event inspector (`src/features/inspector/`)

`EventInspector.tsx` composes five sections (`OverviewSection`,
`ActorClientSection`, `RequestFlowSection`, `BusinessErrorSection`,
`AllFieldsSection`) plus a raw-JSON disclosure. It is always mounted (so
its keyboard shortcuts are always registered — see below) but renders
`null` when nothing is selected. `useResizablePanel.ts` owns the panel's
width, in memory only.

## Context (`RequestFlowSection` → `useSearchState#showContext`)

"Show ±30 seconds" is a confirm-then-run action (`ContextAction.tsx` shows
the exact bounded window before it runs) when driven by mouse; the `X`
keyboard shortcut runs it directly, by design, trading the confirm step
for speed. Either way it replaces the results with the bounded context
window and sets a breadcrumb (`state.breadcrumbLabel`) so "Back to
original search" can restore the prior results.

## Journey/correlation (`src/features/journey/`)

`JourneyView.tsx` renders the ascending, cross-service timeline for a
selected trace/correlation/journey ID, opened via `state.openJourney`.
Code-split (`React.lazy`, `App.tsx`) since it only ever mounts after that
explicit user action — see "Lazy loading / code splitting" below.

## Live state machine (`src/features/live/`)

`useLiveTail.ts` owns the whole connection lifecycle (idle → connecting →
live ⇄ paused → reconnecting → stopped/failed) over Server-Sent Events,
with a **bounded 1,000-event display cap**, batched state updates (never
one `setState` per incoming event — see
`useLiveTail.performance.test.ts`), and a bounded/cancellable reconnect
with backoff. `LiveTailPanel.tsx` (also code-split) is the presentation
layer; `useLiveKeyboardShortcuts.ts` wires P/S/C/F through the shared
registry. Changing a source mid-tail exits Live (`App.tsx`'s own
`useEffect` on `selectedSourceId`) — Live and historical search are
otherwise fully independent of each other.

## Source health (`src/app/SourceHealthBadge.tsx`)

Renders exactly what `GET /api/v1/sources/{id}/health` reports — never
inferred or guessed client-side. A retry action re-fetches; nothing about
health is polled continuously today.

## Keyboard shortcuts registry (`src/shared/keyboard/ShortcutRegistry.tsx`)

One `document`-level `keydown` listener for the whole app
(`ShortcutRegistryProvider`, wrapping `App.tsx`'s content). Every shortcut
owner calls `useShortcut(def)` once; registration happens for the owning
component's **mount lifetime** (so the shortcuts-help popover —
`KeyboardShortcutsHelp.tsx` — can always list it, even when not currently
actionable), while a separate `test(event)` predicate decides at keypress
time whether it actually fires. Shortcuts are suppressed while a text
input/textarea/contenteditable has focus (`isTypingTarget.ts`) unless a
shortcut explicitly opts in via `allowWhileTyping: true` (used only by
Escape-closes-inspector, which must work even while a search box inside
the inspector has focus). See that file's own doc comment for the full
design rationale, including the "registration vs. applicability" split and
why two real bugs were caught by the tests during Slice 8's migration.

**Adding a shortcut**: call `useShortcut({ id, keys, description, group,
test, onTrigger })` from the component that owns the behavior — never add
a new standalone `document.addEventListener`. `id` must be unique
app-wide; `group` controls which section of the help popover it appears
under.

## Safe preferences (`src/features/results/tablePreferences.ts`)

The **only** browser-persistence call site in the whole frontend
(`localStorage`, key `logexplorer.tablePreferences.v1`) — column order,
hidden-column ids, and density. Versioned and defensively validated on
every load (`sanitizeTablePreferences`): a missing/wrong version, non-
object input, malformed JSON, unknown/duplicate column ids, or an
"everything hidden" result all fail safely back to the seven-column
default rather than ever breaking startup or silently corrupting the
table. **Never add a second persistence store without very good reason**
— if you need a new safe, non-sensitive UI preference, prefer extending
this schema (bump `SCHEMA_VERSION` if the shape changes) over creating a
new `localStorage` key.

## Persistence rules (read before touching anything storage-related)

- **Allowed**: table column order/visibility/density (above). That's it,
  today.
- **Forbidden, always**: raw query text (universal search, guided query,
  raw LogQL), any advanced/protected filter value, returned log
  events/event payloads, source/service/time-range/severity selection,
  journey/context breadcrumb state, Docker connection candidates/
  credentials. None of this ever reaches `localStorage`, `sessionStorage`,
  or the URL (`frontend/src/app/persistence.test.tsx` asserts this with a
  full real interaction sequence, including sensitive-looking sentinel
  values, and is the test to extend if you add a new form of search
  state).
- This is enforced by convention (one call site, above) plus tests, not by
  a framework-level guard — if you're about to call `localStorage`/
  `sessionStorage`/`history.pushState` anywhere else in this codebase,
  stop and re-read this section.

## Lazy loading / code splitting (`src/app/App.tsx`)

`JourneyView` and `LiveTailPanel` are `React.lazy` — both are genuinely
conditional (never mounted at startup, mutually exclusive with each other
and with the eager `ResultsPanel`), so splitting them costs nothing on the
primary Search → scan → inspect path. `DockerSettingsPanel` and
`KeyboardShortcutsHelp` are deliberately **not** split — both are always
mounted in `Shell`'s header regardless of their own popover's open state,
so lazy-loading the component itself would not defer anything (the import
would start at the exact same moment it does today). See
`docs/verification/SLICE_8_FRONTEND_PERFORMANCE_REPORT.md` for the
reasoning and real bundle-size evidence before adding a new split
boundary — code splitting here is evidence-driven, not decorative.

## Accessibility & responsive behavior

WCAG 2.2 AA target: semantic HTML, labeled controls, full keyboard
workflows (see the shortcuts registry above, plus `ResultsTable`'s own
row-level Arrow/Enter/Space handling and the inspector resize handle's
Arrow keys — both deliberately element-scoped, outside the shared
registry), visible focus, screen-reader labels, non-color severity
meaning, logical focus restoration on dialog/drawer close. `jest-axe` runs
against every non-trivial component. Layout targets 1920/1440/1280 and
stays usable down to 390px — every feature with a fixed-width concern has
its own 390px Playwright assertion (`assertNoHorizontalOverflow` in
`e2e/helpers.ts`).

## Testing

```bash
npm ci
npm run typecheck   # tsc -b --noEmit
npm run test        # Vitest + Testing Library + jest-axe, 604 tests
npm run build        # production build (tsc -b && vite build)
npm run test:e2e     # Playwright, 171 tests, against a real backend + dev server
```

Identical on Windows PowerShell and Linux/macOS Bash — these are plain
`npm` scripts with no OS-specific behavior.

## Where do I change X?

| I want to... | Look at |
|---|---|
| Add a new filter | `src/features/search/advancedFilterFields.ts` (the field definition) + the matching backend query field (`core/query/QueryFields.java`) |
| Add/reorder a table column | `src/features/results/columnRegistry.ts` — the one authoritative column list |
| Add an inspector field | The relevant section in `src/features/inspector/` (`OverviewSection`/`ActorClientSection`/etc.) + `shared/api/types.ts` if it's a new wire field |
| Add a keyboard shortcut | Call `useShortcut(...)` from the owning component — see "Keyboard shortcuts registry" above; never add a new `document.addEventListener` |
| Change Live UI/behavior | `src/features/live/useLiveTail.ts` (state machine/batching) or `LiveTailPanel.tsx` (presentation) |
| Add an API call | `src/shared/api/client.ts` (the function) + `types.ts` (the shape) — never call `fetch` from a component directly |
| Add a safe preference | Extend `tablePreferences.ts`'s schema (bump `SCHEMA_VERSION`) rather than creating a new `localStorage` key |
| Add an E2E scenario | `frontend/e2e/` — one file per phase/slice, reusing `e2e/helpers.ts`; run against the real dev-profile backend, never a mocked response, unless the existing convention for that spec already mocks (e.g. `persistence.test.tsx`'s own Vitest-level fetch stubs) |
| Add a new top-level view | `src/app/App.tsx`'s `AppContent` — decide eagerly-mounted vs. `React.lazy` per "Lazy loading" above based on whether it's genuinely conditional |

## Server-owned vs. frontend-owned

**Server-owned, never duplicated client-side**: sensitive-field masking,
free-text redaction, source connectivity/read-only enforcement, query
plan construction, pagination cursor signing. The frontend only ever
*displays* what the backend already decided — there is no client-side
redaction, no client-side re-derivation of a masked value, and no
client-side trust decision about what a source is allowed to do.

**Frontend-owned**: all presentation logic, including things that sound
backend-ish at first (gap-between-events detection, the "not causality"
journey disclaimer, time-zone display formatting) — these are derived
from data the backend already returned, not security or correctness
decisions the backend needs to make.
