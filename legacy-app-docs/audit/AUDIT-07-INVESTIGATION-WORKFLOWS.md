# Audit 07 — Investigation Workflows

**Scope:** The OLD app's investigation/correlation capabilities: the Event Timeline workspace and the ±30s context view, plus the find-same-ID flows.

> **Provenance status:** OLD = verified from source (this repo). NEW = **UNVERIFIED** (NEW app unreachable).

---

## 1. Entry points into investigation

| Trigger | How | Handler |
|---------|-----|---------|
| Trace ID | inspector "Find" / row ⋯ menu / universal-search scope | `handleSearchTraceId` (`App.tsx:675`) |
| Correlation ID | same | `handleSearchCorrelationId` (`App.tsx:...`) |
| Journey ID | same | `handleSearchJourneyId` |
| Event ID | same | `handleSearchEventId` |
| Show context (±30s) | inspector / table / timeline | `handleShowContext` (`App.tsx:710`) |
| Generic find | input suggestion confirm | `handleFind` (`App.tsx:703`) |

`enterTimeline` (`App.tsx:617`) switches the app to timeline mode; `exitTimeline` (`App.tsx:623`) is the "Return to search" that restores the prior result set.

## 2. Event Timeline (`EventTimeline.tsx`, lazy-loaded)

- **Chronological** ordering across services (timestamp-based; **not causal** — documented disclosure).
- **Grouped rows by service** with per-service left-border colour coding.
- **Multi-trace journeys**: multiple trace IDs shown when they belong to one journey (`journeyId`).
- **Hero stats**: type, identifier, source, counts.
- **Filters:** service, severity, errors-only.
- **Observed service sequence** (service-flow ordering).
- **Error / gap markers**: error indicators and inter-service gap/delta markers between lines.
- **Business-step markers** (businessStep values inline).
- **Context buttons** per row (±30s).
- `OriginBadge` shows Docker container / K8s pod+namespace origin.
- Typing/definition: `InvestigationType` = trace/correlation/journey/event.

**Evidence:** `EventTimeline.phase6.test` (sequence, errors, gaps, business step, service filter), `App.phase9.test` (cross-service, journey multi-trace, correlation fallback, ascending order), `EventTimeline.test`.

**Accessibility:** rows activatable with Enter/Space, not only click.

## 3. Context View (`ContextView.tsx`, lazy-loaded)

- Thin wrapper that renders `EventTimeline` with a **context title** for the ±30s window.
- Used when `contextAnchor` is set; range = anchor timestamp ± `CONTEXT_WINDOW_SECONDS` (30s).
- **Scoped to the selected source only** (`App.phase9`: "context source-only").
- Return restores the original results.

## 4. Investigation data flow (backend)

- Structured fields (`traceId/correlationId/journeyId/eventId/errorCode/businessStep`) are sent as **exact request fields**.
- The **Docker source** matches these via `matchesStructuredFields` (in-memory post-filter on the bounded read).
- The **Loki source** pushes `traceId`/`spanId` down (json filters) and post-filters high-cardinality/level.
- Timeline is assembled **client-side** from the returned events (grouped/sorted in `EventTimeline`); there is no dedicated backend timeline endpoint.

## 5. Deliberate scope disclosures (design intent)

- Timeline order is timestamp-chronological, **not causal**.
- **±30s context is intentionally bounded and source-only** (not unlimited surrounding history).
- Live tail is **not** a historical search; investigation actions exit live mode first.

---

## Gaps / notes (OLD)

1. **No causal/journey graph** — linear chronological ordering only.
2. **No backend timeline/correlation endpoint** — all grouping is client-side over a flat search result.
3. **Context bounded to ±30s and source-only** (intentional, but a limitation for deep investigation).
4. **Span ID find is not wired** (no span handler) — span cannot be followed like trace/correlation/journey.
5. **OpenShift cross-service timeline unverified** (Loki unconfigured in this environment).
