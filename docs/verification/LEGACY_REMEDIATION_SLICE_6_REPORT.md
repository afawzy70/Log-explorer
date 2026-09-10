# Legacy Remediation Slice 6 — Investigation Depth, Gap Visibility & Richer Source Health

Verification report for the owner-authorized **LEGACY REMEDIATION SLICE 6** mission.
Base SHA `e520bab` / `e520bab22285bdc1d917600e391d1c8bf3963e9d` (`main`, PR #25
merged — UI Gap Closure Pass). Branch `phase/legacy-slice6-investigation-depth`.

This slice does not redesign the application. It improves investigation quality and
operational trust: richer source health diagnostics, bounded investigation-gap
detection/visibility for context and journey views, more useful context/journey
summaries, and honest uncertainty about incomplete data — all without introducing
speculative causality or inferred dependency graphs.

---

## 1. Non-negotiable principle — chronological order is not causality

Enforced throughout, not just stated:

- `gapDetection.ts`'s own doc comment states the principle directly and every place
  a gap is rendered uses "gap detected" / "no observed events" wording, never
  "missing" or "broken".
- `ContextSummary.tsx`'s disclaimer: "A detected gap means no event was observed in
  that interval - it is not evidence that anything failed."
- `JourneyView.tsx`'s disclaimer carries the identical sentence.
- No code in this slice infers service dependency direction, a causal chain, or a
  root cause from event ordering or gaps. `GapReason` is a closed union with exactly
  one member (`'large_interval'`) — an observed discontinuity, nothing more.
- Verified by dedicated tests asserting the disclaimer text is present and that gap
  copy never contains "missing"/"broken"/"failed"/"error" (`ResultsTable.test.tsx`,
  `JourneyView.test.tsx`).

---

## 2. Source health model

### Backend (`core.model.SourceHealth` + `api.dto.SourceHealthDto`)

`SourceHealth` (domain, constructed by each `LogSource#health()`) gained one field:

```java
public record SourceHealth(Status status, String message, Instant checkedAt, List<String> warnings) {
  public enum Status { UP, DOWN, DEGRADED }
}
```

A 3-arg auxiliary constructor (`warnings = List.of()`) keeps every pre-existing call
site (Loki, Fixture, `DockerDiagnostics.toHealth`, `DockerSettingsController#testConnection`)
unchanged. `DEGRADED` — declared in the enum since Phase B but never produced by any
adapter until this slice — now has one real, honest producer:

**`DockerLogSource#health()`**: reachable (`ping()` succeeds) but the daemon's real
container list, filtered through the exact same `relevantContainers(...)` every
other operation (`search`/`discoverServices`/`follow`) already goes through, is
empty. This is a genuine, observable "any search against this source will silently
return nothing" condition — not speculative. It does **not** attempt to detect "some
containers unreadable" (the mission's other example): that would mean actually
reading logs from every relevant container on every health check, as expensive as a
real search — deliberately out of scope; that class of failure is already handled
the way it always has been (skip-and-log per container, see `readContainerLogs`).

**Loki and Fixture stay UP/DOWN only** — there is no cheap, honest DEGRADED signal
available from a trivial 1-row/5-second reachability probe for either; adding one
would mean fabricating a distinction the adapter cannot actually observe.

`api.dto.SourceHealthDto` (the wire shape, `GET /api/v1/sources/{id}/health`) is a
small, explicit, stable DTO — never a leaked internal adapter object:

```java
public record SourceHealthDto(
    SourceHealth.Status status, String message, Instant checkedAt,
    Long latencyMs, List<String> warnings, SourceCapabilities capabilities)
```

`latencyMs` is measured **generically, once, in `SourcesController`** via
`Mono#elapsed()` around `source.health()` — the actual wall-clock time from
subscription to result (includes the real `ping()`/`queryRange()` call) — rather
than every adapter self-instrumenting. `capabilities` is the exact same
`SourceCapabilities` `GET /api/v1/sources` already returns for that source, attached
here too so one fetch carries the complete picture the mission's "capability
availability: historical/live/service discovery/raw query/context/stats" asks for.
Unsupported/not-yet-measured values stay `null` (e.g. the ephemeral Docker Test
Connection probe still returns the plain 4-field `SourceHealth`, no capabilities to
attach to a not-yet-registered candidate) — never a fabricated zero or false.

### Frontend

`SourceHealth`/`SourceHealthDetail` (`shared/api/types.ts`) mirror the backend
shapes field-for-field. `SourceHealthBadge.tsx` renders the compact
Healthy/Degraded/Unhealthy state (text-based, never color-alone — the dot is a
secondary, non-color-alone cue) plus a progressive-disclosure popover (message,
latency, warnings, capabilities, checked-at) — opened from the `health` prop already
in memory, **never a new network request** (verified by a dedicated test spying on
`fetch`). No periodic polling was added: health is checked once per source switch
(pre-existing behavior) plus the pre-existing manual Retry — the simplest way to
guarantee zero "noisy repeated backend requests" is to add zero interval-based
network calls, which is the choice this slice made.

---

## 3. Gap detection

`features/results/gapDetection.ts` — a single shared utility used by both the
context view (`ResultsTable.tsx`'s `gaps` prop) and the journey view
(`JourneyView.tsx`).

```ts
export interface GapMarker {
  afterIndex: number;       // render immediately after this event's index
  fromTimestamp: string;
  toTimestamp: string;
  durationMs: number;
  reason: 'large_interval';
  confidence: 'observed';
}
export function detectGaps(events: LogEvent[], thresholdMs = 5_000): GapMarker[]
```

**O(n), single pass**, over already-ascending-sorted events (a precondition, never
re-sorted here — the context view is sorted by `sortByTimestampAscending` (UI Gap
Closure Pass), the journey view is sorted server-side). Events with a missing or
unparseable timestamp are skipped — a gap is never guessed across an unknown
boundary. Purely a function of timestamps: severity/service mix never affects
computation (dedicated test).

**Threshold — Option A ("configurable bounded threshold with a sensible default")**,
chosen over an adaptive/window-relative rule for simplicity and exact-boundary
testability. Default: **5,000 ms**. Reasoning (documented in the module itself):
within a bounded ±30s context window (60s total), a 5+ second silence between two
*adjacent observed* events is unusual enough to flag without drowning the view in
noise from ordinary sub-second log cadences; for a journey view (which can span much
longer real durations), the same fixed threshold still gives a meaningful signal,
since a multi-second quiet stretch between two events already known to be part of
the same correlated request flow is itself notable regardless of the journey's own
overall span. The threshold is a function parameter, never hardcoded inline — a
future caller can pass a different one without touching this file. The threshold
never depends on sensitive data (it is a function of two ISO timestamps only).

**Exact boundary** (dedicated tests): a delta of exactly 5,000 ms is **not** a gap
(`>`, strictly greater than); 5,001 ms **is**.

**"Do not insert fake events"**: gap markers are a distinct row/list-item type,
never a `LogEvent`. `ResultsTable.tsx`'s gap row keeps one real `<td>` per visible
column (message in the first, "—" in the rest — the table's own "never omit a cell"
convention), deliberately never a merged/`colSpan` cell, specifically so the table's
`table-layout: fixed` per-column geometry invariant (CLAUDE.md §4) holds for a gap
row exactly like any other — `assertTableGeometry` would pass against this table
even with gap rows present. `JourneyView.tsx`'s gap marker is a real sibling `<li>`
inside the same `<ol>`, never nested inside `JourneyEntryRow`'s own `<li>` (valid
markup, verified by counting `listitem` roles in a test).

---

## 4. Filtering semantics (mission §8) — the model chosen, and why

**Model: gaps are computed against the underlying bounded investigation sequence.**
For context and journey views specifically, this is equivalent to "visible sequence
gaps" — there is no separate filtering-related hidden-event distinction to make,
because neither view has any local post-fetch filtering of its own. Verified by
reading (not assumed) `useSearchState.ts#showContext`/`#openJourney`: the toolbar's
committed severity/service filters are never carried into `ContextRequestBody`
(`sourceId, timestamp, service, containerId, pod` only) or `JourneyRequestBody`
(`sourceId, start, end, field, value` only) — both always fetch their own full
bounded window/correlation set, independent of whatever the toolbar happened to be
filtering when the investigator clicked "Show ±30 seconds" / "Find this X". The full
fetched event set for both views **is** the visible set.

E2E scenario 11 verifies this directly: the toolbar is narrowed to "Errors only"
*before* opening context; the resulting context view shows both an INFO and an ERROR
event (the toolbar filter never reached the context fetch) and the gap count is
computed correctly over that full, unfiltered set.

---

## 5. Context view enrichment

`ContextSummary.tsx` gained (all computed once per render in `ResultsPanel.tsx` and
passed down, `gaps` shared with `ResultsTable.tsx`'s own markers so the two can never
disagree):

- **Warnings** — WARN-severity count, alongside the pre-existing Errors.
- **Observed span** — the actual duration between the first and last *event*
  timestamp, distinct from the fixed "Window" (±30s/60s request bound) — a
  completeness signal in its own right (sparse data yields a smaller observed span
  than the requested window).
- **Source** — the active source's display name.
- **Gaps** — a count, plus (when non-zero) a compact descriptive list ("12.4s with
  no observed events between HH:MM:SS and HH:MM:SS").
- **Incomplete-results notice** — "⚠ Results may be incomplete — this source
  returned a bounded subset (limit reached)" whenever `counts.truncated` is true
  (the backend already computed this truthfully; the frontend simply was not
  reading/showing it before).

The selected/root event marker (`aria-current="location"` + visually-hidden label,
UI Gap Closure Pass) is unchanged and unaffected by any of the above.

## 6. Journey/correlation summary

`JourneyView.tsx` gained an Errors/Warnings/First→Last-timestamp/Gaps stat block
(same visual language as `ContextSummary.tsx`, no new abstraction/library), gap
markers between timeline entries, and the same honest "results may be incomplete"
notice driven by `journeyResult.counts.truncated` (previously fetched but never
read). No service-dependency graph, no causal-chain language — the existing
non-causality disclaimer was extended with the same gap-honesty sentence
`ContextSummary` uses.

---

## 7. Incomplete/truncated data visibility

`ResultCounts.truncated`/`estimatedTotal` were already computed correctly by the
backend for `/search`, `/context`, and `/journey` alike (all three share
`SearchService#toResult`) — verified, not assumed, by two new HTTP-level integration
tests (`ContextApiIntegrationTest`, `JourneyApiIntegrationTest`) that feed 201
events through a stub source and assert `counts.truncated: true`/`counts.limit: 200`
in the real response. The gap this slice closed was **frontend visibility**: neither
`ContextSummary` nor `JourneyView` read `counts.truncated` before. Both now do, with
truthful, non-alarmist wording ("may be incomplete", "bounded subset") — never
silently presenting a partial window as complete.

---

## 8. Performance

- `detectGaps` is O(n) over the already-bounded context/journey result set — no
  repeated full-array scans, no per-row computation during render (computed once in
  `ResultsPanel.tsx`/`JourneyView.tsx`, passed down as a prop/local `Map` lookup by
  `afterIndex`).
- No per-event network calls anywhere in this slice.
- Source health: `latencyMs` measurement is a single `Mono#elapsed()` wrap around an
  existing call, not an extra request. No polling was added (§2).
- Docker's new DEGRADED check reuses the existing `client.listContainers(true)` call
  already present in the class (via `relevantContainers`) — one additional Docker
  API call per health check, bounded and infrequent (health checks are not polled).
- No charting/visualization library was added; every new summary is a plain `<dl>`,
  matching the existing `ContextSummary.tsx` pattern.
- Preserved Slice 5's own invariants untouched — no Live/reconnect/buffering code
  was modified in this slice; E2E scenario 14 re-verifies existing Live keyboard
  shortcuts still work end-to-end after the health-model change.
- **PERFORMANCE_REGRESSION: NO.**

## 9. Security considerations

- `SourceHealthDto`'s new fields (`latencyMs`, `warnings`, `capabilities`) carry no
  sensitive data: `latencyMs` is a number, `capabilities` is the same
  already-public-and-safe `SourceCapabilities` shape, and `warnings` is populated
  only from fixed, sanitized, pre-written strings (the exact same discipline
  `DockerDiagnostics` already uses for `message` — never a raw exception, credential,
  or environment-specific path/hostname fragment).
- New `SourceHealthLeakTest` (backend) asserts a raw `ConnectException` message
  sentinel never reaches the serialized `SourceHealthDto`, and that a DEGRADED
  warning is the fixed generic string, never the real configured Compose project
  filter value or any other environment-specific detail.
- Gap markers/context/journey enrichment expose no new data — `GapMarker` is derived
  purely from already-fetched, already-masked event timestamps; no protected field
  is read or displayed by any of this slice's new code.
- `ProblemDetail`/error responses are unchanged by this slice.
- **SECURITY_REGRESSION: NO.**

## 10. Accessibility

- Health badge: status text is the primary signal (never color-alone); the details
  popover uses `role="dialog"`, the disclosure trigger has an explicit
  `aria-label="Source health details"`, and the popover is reachable/dismissible the
  same way every other popover in this app already is (`usePopoverTrigger`/
  `useDismissableLayer` — Escape closes, focus returns to the trigger). Verified with
  `jest-axe` across every health state, closed and open.
- Gap markers: real text content in a real table cell / list item — screen-reader
  navigable like any other row/item, never color-alone (background tint is a
  secondary cue; the cell text itself says "Gap detected"). `jest-axe` verified with
  a gap row/marker present.
- The selected/root event's own accessibility contract (`aria-current="location"` +
  visually-hidden label, UI Gap Closure Pass) is unchanged.
- Warnings are not announced excessively — the health badge's own `role="status"`
  live-region semantics are unchanged from before this slice (no new `aria-live`
  region was added; the details popover is opened explicitly by the user, not
  auto-announced).
- **ACCESSIBILITY: PASS.**

## 11. Responsiveness

Verified at 1440px and 390px (E2E scenarios 16-17), plus the full pre-existing
narrow/zoom regression suites across every other spec file remain green. The health
details popover and gap markers/context summary all remain usable and
non-overflowing at 390px.

- **MOBILE_REGRESSION: NO.**

---

## 12. Visible UI parity

**Unchanged: 97% (34/35).** None of this slice's work maps to an existing row in
the UI Parity Acceleration Pass's own 35-row OLD-vs-CURRENT rubric — richer source
health, gap detection, and context/journey enrichment are **new investigation-depth
capabilities** this mission explicitly scoped as their own initiative, not
restorations of a previously-identified OLD-vs-CURRENT visible gap. The one
remaining non-`FULL` row in that rubric (row 13, row-click-to-inspect) is untouched
and was not implemented in this slice either, per the mission's own exclusion.
`docs/LEGACY_TO_NEW_VERIFIED_CAPABILITY_MATRIX.md` (the separate, broader
OLD-vs-CURRENT capability matrix, not the visible-UI-only rubric) **was** updated
for the rows this slice genuinely affects (`ERR-04`, `SRC-06`, `INV-05`, `INSP-07` —
see that file).

---

## 13. Tests

### Backend — `./mvnw --batch-mode verify`

```
[INFO] Tests run: 508, Failures: 0, Errors: 0, Skipped: 0
[INFO] BUILD SUCCESS
```

Baseline (UI Gap Closure Pass merge) was 500; 500 + 8 = 508. New: `SourceHealthLeakTest`
(2), `DockerLogSourceTest` (+2 — DEGRADED, unmanaged-container-ignored), `SourcesApiIntegrationTest`
(+2 — capabilities/latency in health response, a DEGRADED stub source), `ContextApiIntegrationTest`
(+1 — real truncation via HTTP), `JourneyApiIntegrationTest` (+1 — real truncation via HTTP).

### Frontend — `npm run typecheck && npm run test -- --run && npm run build`

```
tsc -b --noEmit             -> clean
Test Files  56 passed (56)
Tests       595 passed (595)
vite build                  -> ✓ built in 411ms (dist/assets/index-AkCFDSKj.js 287.74 kB / gzip 86.00 kB)
```

Baseline was 550; 550 + 45 = 595. New: `gapDetection.test.ts` (new, 12 — incl. exact
boundary cases, zero/single/multi-gap, missing-timestamp skip, custom threshold),
`SourceHealthBadge.test.tsx` (+9 — DEGRADED distinct from DOWN, progressive
disclosure open/close/Escape/focus-return, latency/warnings/capabilities rendering,
no-network-request-on-open, axe), `ContextSummary.test.tsx` (+11 — warnings, span,
source, truncation notice, gap count/list, causality-safe wording, axe),
`ResultsTable.test.tsx` (+7 — gap row rendering/geometry/ArrowKey-skip/axe),
`JourneyView.test.tsx` (+6 — stats, gap marker, no-gap case, truncation notice,
causality-safe wording, axe).

### E2E — `npx playwright test`

```
144 passed (4.9m)
```

New file `frontend/e2e/phase-legacy-slice6-investigation-depth.spec.ts` (14 tests,
covering all 17 mission-listed browser scenarios — several combined where they
naturally chain, e.g. items 4-5-9-13). Run against the real backend
(`SPRING_PROFILES_ACTIVE=dev`, Fixture + openshift-loki sources). Baseline (UI Gap
Closure Pass merge) was 130; 130 + 14 = 144.

Health states: Healthy (fixture, real) and Unavailable (openshift-loki, real — no
gateway configured in this dev environment, genuinely `DOWN`) are exercised against
the real backend; DEGRADED and the exact gap sequences (one/multiple/zero gaps, a
truncated result) use `page.route` to mock the health/context response JSON with
fully controlled, deterministic values — the same established pattern
`phase-legacy-slice2-query-transparency.spec.ts` already uses for a
capability-enabled mock source (the real fixture corpus's own live-clock-based
timestamps cannot guarantee an exact, reproducible gap boundary).

**A real regression was found and fixed while adding this suite**: the pre-existing
`phase-ui-gap-closure.spec.ts` test that compares the context view's rendered row
order against a sorted copy of the real server response iterated every `tbody tr`
assuming each was an event row. Against real fixture data for that test's own
±30-second window, an actual observed gap of >5s exists between two real events —
this slice's own new gap-marker row (correctly) appeared in that table, and the
test's blind per-row column-3 read picked up the marker's "—" placeholder cell,
breaking the message-order comparison. Fixed by excluding
`tbody tr:not([data-testid="gap-row"])` in that pre-existing test — gap rows were
never meant to be compared as if they were events. This is a legitimate consequence
of Slice 6's own new capability appearing against real data, not a bug in either the
new or the pre-existing test.

Screenshots: `docs/verification/legacy-slice6/health-healthy-details.png`,
`health-degraded-details.png`, `health-unavailable-details.png`,
`context-summary-enriched.png`, `journey-summary-enriched.png`,
`desktop-1440px-gap-context.png`, `narrow-390px-gap-context.png`.

---

## 14. Commands run

```
cd backend && ./mvnw --batch-mode verify                                  # 508 passed, BUILD SUCCESS
cd frontend && npm run typecheck                                           # clean
cd frontend && npm run test -- --run                                       # 595 passed
cd frontend && npm run build                                               # succeeded
SPRING_PROFILES_ACTIVE=dev ./mvnw --batch-mode --quiet spring-boot:run &   # real backend for E2E
cd frontend && npx playwright test                                         # 144 passed
```

---

## 15. Regressions

None uncaught. One real interaction with a pre-existing test was found (§13, "A real
regression was found and fixed") and fixed as part of this slice's own delivery -
every pre-existing backend test (500 baseline), frontend test (550 baseline, all
still passing unmodified), and Playwright spec (130 baseline, 129 unmodified + 1
deliberately adjusted for the reason above) continues to pass.

## 16. Scope discipline

Not touched: Slice 7 (message/exception redaction), Slice 8 (code
splitting/productivity), Slice 9 (packaging/export), row-click-to-inspect, the
inspector's own layout/design, Live buffering/reconnect architecture (Slice 5's own
engine — untouched; E2E scenario 14 re-confirms it still works). No service
dependency graph, no AI root-cause analysis, no causal-chain language anywhere in
this slice's own code or copy. No auto-merge was performed. Phase M was not started.

---

## 17. Owner decisions — explicitly verified untouched

- **Live pre-start confirmation dialog** — still absent; this slice touched no Live
  UI code.
- **Table density / seven-column default** — unchanged; the gap-row's own cell count
  always equals the current visible-column count (including a Slice-4-customized
  set), never a fixed seven.
- **No raw sensitive values exposed** — verified (§9); gap markers/context/journey
  enrichment read only already-masked event data and timestamps.
- **Frontend-only Docker project filtering** — not reintroduced; the new Docker
  DEGRADED check reuses the existing, unchanged `relevantContainers` server-side
  filter.
- **Fake Loki Live capability** — not reintroduced; Loki's health/capabilities logic
  is otherwise unchanged.
