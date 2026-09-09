# Audit 18 — Second-Pass Findings & Final Summary

**Scope:** Results of the second-pass probes (tests, keyboard handlers, feature flags, CSS hints, dead code) performed across the OLD app, plus the final audit summary and document index.

> **Provenance status:** OLD = verified from source (this repo). **NEW = UNVERIFIED** (NEW app unreachable).

---

## 1. Second-pass probe results

### 1.1 Tests / regression gates
- Frontend test surface is healthy and broad: per-component suites, `App*.test.tsx` (phase2/7/9/postSearch/base), 10 `utils/__probe__*.test.ts` suites mirroring production units, `A11y.integration.test.tsx`, axe gates.
- **No disabled tests** per `UX_ACCEPTANCE_REPORT.md` §3.6 (grep for `.skip(`/`.todo(`/`xtest`/`xdescribe` → 0).
- **Backend** suite green in the specs: Docker live 9/9; full suite 345–347 (counts vary across specs written at different times; recompute).
- `DockerConnectionTest`/integration cover the per-user connection security.

### 1.2 Keyboard handlers (frontend)
- Global **Ctrl/Cmd+Enter** run (`App.tsx`).
- UniversalSearch **Enter** submit; Escape dismisses suggestions.
- Table rows: ArrowUp/Down move, **Enter** open inspector, **Escape** return.
- Column reorder via **keyboard** (not just drag).
- Inspector: focus trap, **Escape** close, focus restored to originating row.
- MoreFilters / dialog: focus trap + inert background + Escape.
- Correlation timeline rows activatable via **Enter/Space**.
- Live: start via confirmation dialog (keyboard), pause/resume/stop reachable.
- `focusTrap.ts` provides `trapTab`/`focusableElements`.

### 1.3 Feature flags / config gating (backend)
| Flag | Default | Effect |
|------|---------|--------|
| `logexplorer.docker.enabled` | true | enables Docker source. |
| `logexplorer.openshift.enabled` | true | enables Loki source (but unconfigured without base URL). |
| `logexplorer.query.rawLogQl.enabled` | false | raw LogQL off. |
| `logexplorer.masking.enabled` | true | masking on. |
| `logexplorer.security.unmask.enabled` | false | session unmask off. |
| `logexplorer.tail.*` (max-concurrent/heartbeat/timeout) | 10/15/0 | live tail. |
| `logexplorer.verify.*` | n/a | dormant TEMP-VERIFY instrumentation. |
| Spring profile `dev|test` | n/a | enables Fixture source. |

### 1.4 CSS / responsive hints (`index.css`)
- Tokens for spacing/typography/color/severity/focus-ring.
- Responsive breakpoints: ≥1440 / 1024–1439 / 768–1023 / <768.
- `html,body overflow-x:hidden` guard; contained `overflow-x:auto` scrollers.
- `@media (prefers-reduced-motion: reduce)` disables animation/spinners.
- Severity/connection conveyed by text+icon+colour (not colour-only); `.et-row` flex class was removed in favour of `.et-*` semantic table classes (commit `f5670fd`).

### 1.5 Dead-code findings (see Audit 00 for full table)
- **Frontend orphans:** `LogList`, `LogRow`, `GuidedFilters`, `QueryInput`, `QueryModeSelector`, `LevelSelector`, dev-only `UiLab`. `QueryInput`/`QueryModeSelector`/`LevelSelector` have zero production imports.
- **Dead props:** `RunCancelControls.queryError`, `SearchEmpty.onNarrow`, `AdvancedFilterField.autoFocus`.
- **Dead exports:** `eventTable.primaryId`, `format.formatTimestamp`, `queryBuilder.impliesEmpty`, `client.getSources()`, `client.getSystemInfo()`, `preferences.saveNonSensitive` (load-only usage).
- **Dead backend:** `LogTailRequest`, `SimpleQueryField.knownFieldNames()`, `LogTailManager.registerSubscription`, `LogEventParser.resolveCorrelationId(Map)`, `SimpleQueryToken.UNKNOWN`, empty `MaskingService.configureExtraFieldRules`, read-not-applied `MaskingProperties.fieldRules`, `LokiStreamEntry`.

---

## 2. Final audit summary

**Objective:** Produce an exhaustive capability catalog of the OLD app so behaviour can be verified and migrated. The NEW app was unreachable, so every NEW-facing statement is marked **UNVERIFIED**; no NEW guesses were asserted as fact.

### Headline conclusions
1. **The OLD app is feature-complete and spec-satisfying** for its documented MVP scope: all six stakeholder workflows (W1–W6) pass in `UX_ACCEPTANCE_REPORT.md`, with full §3 requirement→implementation→verification mapping, WCAG 2.2 AA a11y, responsive, performance budgets, and real-Docker evidence.
2. **The actionable core is the within-OLD gaps** (see Audit 15), the most important being:
   - **Raw LogQL is a dead path** (UI present, backend force-disables the flag).
   - **OpenShift/Loki is deferred** and has no live tail.
   - **No auth/RBAC** and **in-memory-only audit** (prod gaps by design).
   - **No cursor pagination**, **one-way last-query restore**, **stale static source descriptors**, **no project-filter/exclusion-label UI**, **remote TLS unconfigured here**.
3. **Dead/orphaned code should be pruned** before or during migration (Audit 00 §3.1, Audit 17 item #14).
4. **Parity with NEW is unestablished** until the NEW app is reachable; Audit 16 and backlog Phase 3 list the exact verification steps.

### Coverage map (17 risks/capability + this doc)
| Area | Detail doc |
|------|-----------|
| Source inventory | `AUDIT-00-SOURCE-INVENTORY.md` |
| Frontend surface | `AUDIT-01-FRONTEND-SURFACE.md` |
| Core actions | `AUDIT-02-CORE-ACTIONS.md` |
| Workflows | `AUDIT-03-WORKFLOWS.md` |
| Filter/search/query | `AUDIT-04-FILTER-SEARCH-QUERY.md` |
| Event table | `AUDIT-05-EVENT-TABLE.md` |
| Event inspector | `AUDIT-06-EVENT-INSPECTOR.md` |
| Investigation workflows | `AUDIT-07-INVESTIGATION-WORKFLOWS.md` |
| Live tail | `AUDIT-08-LIVE-TAIL.md` |
| Settings | `AUDIT-09-SETTINGS.md` |
| Backend services/API | `AUDIT-10-BACKEND-SERVICES-API.md` |
| Data fields | `AUDIT-11-DATA-FIELDS.md` |
| Error/health | `AUDIT-12-ERROR-HEALTH.md` |
| Productivity | `AUDIT-13-PRODUCTIVITY.md` |
| Capability matrix (OLD) | `AUDIT-14-CAPABILITY-MATRIX-OLD.md` |
| Missing capabilities in OLD | `AUDIT-15-MISSING-CAPABILITIES-OLD.md` |
| Workflow parity OLD vs NEW | `AUDIT-16-WORKFLOW-PARITY-OLD-VS-NEW.md` |
| Migration backlog | `AUDIT-17-MIGRATION-BACKLOG.md` |
| Second-pass + final summary | `AUDIT-18-SECOND-PASS-SUMMARY.md` (this file) |

---

## 3. Recommended next steps

1. **Resolve P0 decisions** (Audit 17 §Phase 1 #1 Raw LogQL, #3 auth/RBAC-for-prod) if OLD is to ship anywhere.
2. **Get the NEW app reachable**, then run Audit 16 / backlog Phase 3 verification and replace every `UNVERIFIED` with a confirmed status.
3. **Prune dead code** (Audit 17 #14) after deciding raw LogQL fate (some dead code is coupled to the raw path).
4. **Keep the `__probe__` unit suites** as migration regression coverage.
