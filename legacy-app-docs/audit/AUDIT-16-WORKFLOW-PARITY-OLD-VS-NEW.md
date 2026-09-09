# Audit 16 — Workflow Parity: OLD vs NEW

**Scope:** A parity map of the end-to-end workflows defined in the OLD specs against the OLD implementation, with the NEW app's state left **UNVERIFIED** because the NEW app was unreachable.

> **Provenance status:** OLD = verified from source (this repo). **NEW = UNVERIFIED** — do not treat any NEW entry as fact; it must be confirmed against the NEW app.

Workflow IDs match **Audit 03** and `UX_ACCEPTANCE_REPORT.md` §2.

---

## Parity table

| Workflow | OLD implementation | OLD status | NEW status (UNVERIFIED) |
|----------|--------------------|------------|--------------------------|
| **W1** What failed recently? (service + last 30m + errors) | Toolbar → EventTable | ✅ WORKING | UNVERIFIED |
| **W2** What happened for a user/customer? (masked actor) | MoreFilters → masked chips → inspector Protected | ✅ WORKING | UNVERIFIED |
| **W3** Follow a request (paste ID → timeline) | UniversalSearch → EventTimeline | ✅ WORKING | UNVERIFIED |
| **W4** Explain one event (±30s context) | EventTable → EventInspector → ContextView | ✅ WORKING | UNVERIFIED |
| **W5** Monitor live logs (start/pause/resume/stop) | LiveConfirmDialog → LiveTail | ✅ WORKING | UNVERIFIED |
| **W6** Failure states (all share one language) | SearchLoading/Empty + inline validation | ✅ WORKING | UNVERIFIED |
| **W7** Switch sources + connectivity | SourceSelector + HealthIndicator + Retry | ⚠️ PARTIAL (OpenShift deferred) | UNVERIFIED |
| **W8** Settings (masking + docker connection) | SettingsPage + DockerConnectionPanel | ✅ WORKING | UNVERIFIED |
| **W9** Correlation timeline deep-dive | EventTimeline (sequence/gaps/business steps) | ✅ WORKING | UNVERIFIED |
| **W10** Search variants (24h/custom/guided/text/advanced) | Toolbar + MoreFilters | ✅ WORKING | UNVERIFIED |

---

## Parity by requirement layer (from `UX_ACCEPTANCE_REPORT.md` §3)

### 3.1 Task flows (§4)
| Requirement | OLD impl | OLD status | NEW |
|-------------|----------|------------|-----|
| 4.1 Recent errors for one service | App toolbar + EventTable | PASS | UNVERIFIED |
| 4.2 Masked user/customer journey | MoreFilters + advancedFilters + eventTable + EventInspector | PASS | UNVERIFIED |
| 4.3 Paste ID → cross-service timeline | UniversalSearch + EventTimeline (lazy) | PASS | UNVERIFIED |
| 4.4 Inspect event + context | EventTable + EventInspector | PASS | UNVERIFIED |
| 4.5 Live tail start/pause/resume/stop | LiveTail + LiveConfirmDialog + App | PASS | UNVERIFIED |

### 3.2 Results workbench contract (§5.6)
| Requirement | OLD status | NEW |
|-------------|------------|-----|
| Semantic table sticky named headers | PASS | UNVERIFIED |
| Columns: Time/Level/Service/What/User-Customer/Correlation (+ optional) | PASS | UNVERIFIED |
| Time exact date+tz (title/aria) | PASS | UNVERIFIED |
| Severity icon+text+colour (not colour-only) | PASS | UNVERIFIED |
| Masked actor, never raw, never copyable | PASS | UNVERIFIED |
| Correlation shortened visually, full for copy/search | PASS | UNVERIFIED |
| Row select click/Arrow/Escape | PASS | UNVERIFIED |
| ⋯ action menu only when IDs present | PASS | UNVERIFIED |
| Refresh + bounded load-more never silently drops | PASS | UNVERIFIED |
| States initial/skeleton/empty/cancelled/partial/source-error/malformed | PASS | UNVERIFIED |

### 3.3 Accessibility (§8, WCAG 2.2 AA) — OLD PASS
Not color-only, contrast ≥4.5/3:1, aria-label icon-only, 200% resize no overflow, reduced motion, visible focus, no native Ctrl multi-select, focus trap/return/Escape + inert, real buttons/checkbox, rows keyboard-activatable, landmarks/tables, target ≥24×24, `<th scope>` no innerHTML — all **PASS** in OLD. | NEW: UNVERIFIED.

### 3.4 Responsive (§6) — OLD PASS (1440/1024/768/<768, no overflow). | NEW: UNVERIFIED.

### 3.5 Performance (§9)
| Metric | OLD | NEW |
|--------|-----|-----|
| Initial JS ≤75 kB gzip | PASS (~71 kB) | UNVERIFIED |
| Initial CSS ≤12 kB gzip | PASS (~9.8 kB) | UNVERIFIED |
| Bounded rendering (100/page, 1000/100 live) | PASS | UNVERIFIED |
| Abort stale searches on run/source change | PASS | UNVERIFIED |
| Debounce only lookups | PASS | UNVERIFIED |
| No unmeasurable/unbounded DOM | PASS | UNVERIFIED |

### 3.6 Final inspection checklist — OLD PASS
Single h1, no native multi-select (orphan removed), no advanced-query form dominating initial view, labelled columns, no protected raw value, zero `dangerouslySetInnerHTML`, no sensitive value in URL/localStorage, no overflow, bounded buffers, no disabled tests, no Docker/OpenShift architecture regression. | NEW: UNVERIFIED.

---

## Cross-cutting parity conclusions

1. **The OLD app satisfies all six stakeholder workflows** and the full §3 requirement/implementation/verification mapping (documented PASS in `UX_ACCEPTANCE_REPORT.md)`.
2. **Parity with the NEW app cannot be asserted** — the NEW app was unreachable from this environment. Every NEW column is UNVERIFIED.
3. **Areas where OLD is known to diverge from any modern/full spec** (and should be checked in NEW): raw LogQL, OpenShift/Loki live tail, cursor pagination, durable audit, auth/RBAC, project-filter/exclusion-label UI, export, saved presets, deep links (see Audit 15).

---

## How to complete this parity check

To turn the UNVERIFIED NEW columns into facts:
1. Get the NEW app running and reachable.
2. Re-run audits 03, 05, 06, 07, 08 workflows against it.
3. Re-check the §3 mapping table area-by-area.
4. Update this doc: replace `UNVERIFIED` with ✅/⚠️/❌ per NEW observation.
