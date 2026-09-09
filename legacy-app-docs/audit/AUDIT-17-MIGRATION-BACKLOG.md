# Audit 17 — Migration Backlog

**Scope:** A prioritized, actionable backlog to (a) finish the within-OLD gaps, (b) protect behaviour when migrating to the NEW app, and (c) verify the NEW app. Items are ordered by priority within each phase.

> **Provenance status:** OLD = verified from source (this repo). **NEW = UNVERIFIED** — the NEW app could not be reached; backlog items referencing NEW are verification tasks until the NEW app is reachable.

**Priority:** P0 = must-fix / gate · P1 = should-fix · P2 = nice-to-have · P-VERIFY = verify against NEW before deciding.

---

## Phase 1 — Within-OLD corrective work (P0/P1)

| # | Area | Item | Evidence | Priority |
|---|------|------|----------|----------|
| 1 | Raw LogQL | Decide: implement or remove. Currently dead — backend force-sets `rawLogQlMode=false` (`LogSearchRequest.java:70-73`), no source advertises `RAW_LOGQL`, yml off. Either wire it fully (needs a real LogQL-capable source + config enabled) or strip the UI tab. | Audit 15 §1 | P0 (decision) |
| 2 | OpenShift/Loki | If OpenShift is in scope, configure `OPENSHIFT_LOKI_BASE_URL`/token in a real env and re-run health/search/service-discovery; decide on live tail (currently `Flux.empty()`). | Audit 15 §2 | P1 (if in scope) |
| 3 | Auth/RBAC | For any prod deployment, implement SSO + RBAC, and re-enable `unmask.enabled` only under auth. | Audit 15 §10, SECURITY_NOTES §Rec | P0 (prod gate) |
| 4 | Durable audit | Replace in-memory `MaskingAuditService`/`DockerConnectionAuditService` with durable persistence if audit is required. | Audit 15 §9 | P1 |
| 5 | `last-query` | Wire `saveNonSensitive('last-query')` (currently never called) so restore works, or remove the one-way load. | Audit 15 §4 | P1 |
| 6 | Live source descriptors | Wire `getSources()`/`getSystemInfo()` into the UI (currently static `KNOWN_SOURCES`) to prevent capability drift, or drop the dead API methods. | Audit 15 §5 | P1 |
| 7 | Cursor pagination | Implement real cursor `nextCursor`, or document the +limit re-query limitation. | Audit 15 §3 | P1 |

## Phase 2 — Within-OLD UI/UX work (P1/P2)

| # | Item | Priority |
|---|------|----------|
| 8 | Add Docker project-filter / exclusion-label to `DockerConnectionPanel` (backend already supports via yml). | P1 |
| 9 | Configure/validate remote TLS profiles (currently commented out → `tls-profile-unknown`). | P1 |
| 10 | Decide on inspector prev/next in live/context (currently search-only). | P2 |
| 11 | Optional: result/timeline export (CSV/JSON). | P2 |
| 12 | Optional: saved custom query presets beyond time presets. | P2 |
| 13 | Optional: span-follow Find (add span handler). | P2 |
| 14 | Remove dead/orphaned components: `LogList`, `LogRow`, `GuidedFilters`, `QueryInput`, `QueryModeSelector`, `LevelSelector`, dev-only `UiLab`, unused `LogTailRequest`, and dead exports (`primaryId`, `formatTimestamp`, `impliesEmpty`, `getSources`, `getSystemInfo`, `saveNonSensitive`). | P2 (cleanliness) |
| 15 | Document Docker `MAX_LOG_TAIL=200`/`MAX_SCAN_LINES=100000` historical boundedness to users. | P2 |

## Phase 3 — NEW-app verification (P-VERIFY)

The NEW app was **unreachable**; before relying on NEW mapping, complete:

| # | Verify against NEW |
|---|--------------------|
| 16 | All six stakeholder workflows (audit 03). |
| 17 | Results workbench contract (§3.2) and accessibility (WCAG 2.2 AA). |
| 18 | Responsive + performance budgets (§3.4/3.5). |
| 19 | Data model / masking rules / capability flags parity (audit 11/14). |
| 20 | Whether the within-OLD P0/P1 gaps above are already solved in NEW (raw LogQL, OpenShift live tail, auth/RBAC, durable audit, pagination, source descriptors, project-filter UI). |

## Phase 4 — Regression safety (P1)

| # | Item |
|---|------|
| 21 | Keep the `__probe__*` unit suites as regression coverage when porting logic to NEW (they mirror the production units). |
| 22 | Re-run `DockerLiveIntegrationTest` (9 tests) against real Docker after any backend change. |
| 23 | Confirm no `dangerouslySetInnerHTML`, no sensitive value in URL/localStorage, bounded buffers in NEW. |

---

## Suggested owner / sequencing

1. Gate on P0: resolve Raw LogQL decision + auth/RBAC-for-prod.
2. Then P1 correctness items (audit, pagination, last-query, source descriptors, project-filter UI, TLS).
3. In parallel start P-VERIFY once NEW is reachable.
4. Cleanup P2 item #14 anytime before/after migration (pure dead code removal).
