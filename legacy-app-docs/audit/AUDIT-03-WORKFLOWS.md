# Audit 03 — Workflows

**Scope:** End-to-end workflows a user can complete in the OLD app, mapped to the stakeholder tasks documented in `UX_ACCEPTANCE_REPORT.md` §2, with the implementation path and verification status.

> **Provenance status:** OLD = verified from source (this repo). NEW = **UNVERIFIED** (NEW app unreachable).

Workflow IDs below match the UX Phase 9 stakeholder tasks where applicable.

---

## W1 — "What failed recently?" (recent errors for one service)

**Path:** select service → time `Last 30 min` → severity `Errors only` → Run.

**Implementation:** `App.tsx` toolbar (SourceSelector + SearchableServiceCombo + TimeRangeSelector + SeveritySelector) → `EventTable` columns Time/Level/Service/Message.

**Evidence:** `SeveritySelector.test`, `TimeRangeSelector.test`, `ResultsToolbar.test`, `EventTable.test` (columns, exact ms timestamps + timezone, dominant message column). Manual: default 30m preset, ERROR chips, `et-th` named columns, `title`/`aria-label` exact time.

**OLD status: WORKING** (verified). | **NEW: UNVERIFIED.**

## W2 — "What happened for a user/customer?" (masked actor journey)

**Path:** More filters → anonymized user/customer → Apply → confirm only masked actor.

**Implementation:** `MoreFilters.tsx` (who section: userName/customerId/cif/deviceId/deviceIp) → `maskSensitiveValue` → masked chips → `resolveActor` in `eventTable.ts` → `EventInspector` Protected label.

**Security:** sensitive values staged as draft, strictly masked, raw value never persisted/URL'd/logged; inspector shows Protected with **no reveal/copy**.

**Evidence:** `MoreFilters.test` (masked fields, apply, no persist), `EventInspector.test` (protected, no reveal/copy), `EventTable.test` (actor mask), `App.phase2`/`App.phase9` (no `cif` in localStorage).

**OLD status: WORKING.** | **NEW: UNVERIFIED.**

## W3 — "Follow a request" (paste ID → cross-service timeline)

**Path:** paste trace/correlation/journey ID → confirm suggestion → open timeline → read service sequence / errors / gaps / business steps.

**Implementation:** `UniversalSearch.tsx` (identifier suggestions, confirmable scope — never silently misclassifies) → `EventTimeline.tsx` (lazy) investigation workspace: type, identifier, source, counts, service-flow sequence, error/gap markers, business step, ±30s context.

**Evidence:** `UniversalSearch.test` (suggestion/scope), `App.phase9.test` (cross-service, journey multi-trace, correlation fallback, ascending order), `EventTimeline.phase6.test` (sequence, errors, gaps, business step, service filter).

**OLD status: WORKING.** | **NEW: UNVERIFIED.**

## W4 — "Explain one event" (inspect event + context)

**Path:** mouse+keyboard select → inspector answers what/when/where/who/IDs → ±30s context → return to results.

**Implementation:** `EventTable` (click/Arrow/Enter/Escape) → `EventInspector` (title/time/where/actor/flow/business, ±30s context `CONTEXT_WINDOW_SECONDS=30`) → return restores results.

**Evidence:** `EventTable.test`, `EventInspector.test`, `App.phase9` (context source-only, return restores results).

**OLD status: WORKING.** | **NEW: UNVERIFIED.**

## W5 — "Monitor live logs" (start/pause/resume/stop/cleanup)

**Path:** start bounded session (confirmation dialog) → pause/resume → follow-newest → stop.

**Implementation:** `LiveConfirmDialog` → `LiveTail` SSE; states Connecting/Live/Paused/Reconnecting/Stopped/Error; displayed ≤1000, buffered ≤100, dropped warning; follow-newest + new-event indicator; stop/source-change/unmount closes SSE.

**Evidence:** `App.phase7.test` (confirmation flow), `LiveTail.test` (state transitions, bounds, pause-buffer overflow, clear, stop/unmount cleanup, reconnect, filters, follow).

**OLD status: WORKING.** | **NEW: UNVERIFIED.**

## W6 — "Failure states" (source unavailable / no services / no results / invalid time / invalid advanced / truncated / malformed)

**Path:** all states share one visual language.

**Implementation:** skeleton (`SearchLoading`), empty w/ suggestions (`SearchEmpty`), source error + retry (`App.test`), time validation inline (`TimeRangeSelector.test`), advanced Apply blocked on invalid (`MoreFilters.test`), truncation warning + bounded next page (`ResultsToolbar.test`), malformed row indicator (`EventTable.test`).

**OLD status: WORKING.** | **NEW: UNVERIFIED.**

---

## Additional workflows (beyond the six stakeholder tasks)

### W7 — Switch sources & connectivity
- SourceSelector switch aborts in-flight + clears results; health indicator green/red with Retry; service list populates from discovery.
- Backend: `DockerComposeLogSource.healthStatus` via gateway connectivity + project-filter misconfig check; OpenShift reported unavailable when `OPENSHIFT_LOKI_BASE_URL` empty.
- **OpenShift connectivity is DEFERRED BY SCOPE** (no env; unconfigured → `unavailable`).

### W8 — Settings: masking & docker connection
- View masking status; toggle per-field masking; toggle session unmask (gated by `unmask.enabled`, default off); configure local/remote Docker engine (mode/host/port/TLS) with Test/Save/Reset and security validation (SSRF/DNS-rebinding allowlist, port range).

### W9 — Correlation timeline deep-dive
- Timeline grouped by service (left-border colour), chronological (not causal), multiple trace IDs shown for one journey, filters (service/severity/errors-only), business-step markers, gap/delta markers, context buttons, Return to search.

### W10 — Search variants
- Last 24h one-click; custom range; guided query builder; text query; advanced filters; free-text with scope suggestions.

---

## Workflow verification confidence

| Workflow | Automated | Real-data evidence | OLD status | NEW |
|----------|-----------|--------------------|------------|-----|
| W1 Recent errors | Yes | Live Docker (`DockerLiveIntegrationTest` 9/9) | WORKING | UNVERIFIED |
| W2 Masked actor | Yes | Unit/UI fixtures | WORKING (no live sensitive data triggered) | UNVERIFIED |
| W3 Follow request | Yes | Unit/UI fixtures | WORKING | UNVERIFIED |
| W4 Explain event | Yes | Unit/UI fixtures | WORKING | UNVERIFIED |
| W5 Monitor live | Yes | Live Docker stream (19+ events / 8s) | WORKING | UNVERIFIED |
| W6 Failure states | Yes | Unit/UI fixtures | WORKING | UNVERIFIED |
| W7 Switch sources | Yes | Live Docker only (OpenShift deferred) | PARTIAL (Docker yes, OS deferred) | UNVERIFIED |
| W8 Settings | Yes | Unit/UI fixtures | WORKING | UNVERIFIED |
| W9 Timeline | Yes | Unit/UI fixtures | WORKING | UNVERIFIED |
| W10 Search variants | Yes | Unit/UI fixtures | WORKING | UNVERIFIED |

---

## Workflow-level gaps in OLD

1. **OpenShift** workflows (Docker-only evidence; Loki source unconfigured, no live tail).
2. **Raw LogQL** workflow is present in UI but cannot execute (backend dead path).
3. **True pagination/cursor** missing (Load-more = larger limit re-query).
4. **Live-tail historical completeness** intentionally limited (near-real-time disclosure only).
