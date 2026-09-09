# Audit 15 — Missing / Broken Capabilities in OLD

**Scope:** Every capability the OLD app intends to have but is missing, broken, deferred, or only half-wired, with severity and the implementation evidence.

> **Provenance status:** OLD = verified from source (this repo). NEW = **UNVERIFIED** (NEW app unreachable). Severity: 🔴 High / 🟠 Medium / 🟡 Low.

---

## 1. Raw LogQL — 🚫 DEAD PATH (🔴)

- UI: Raw LogQL tab exists (`MoreFilters`), sets `rawLogQlMode=true`.
- Backend: `LogSearchRequest` constructor **force-sets `rawLogQlMode=false`** (`LogSearchRequest.java:70-73`) — the controller branch can never run.
- No source advertises `RAW_LOGQL`; `logexplorer.query.rawLogQl.enabled=false`.
- **Result:** Raw LogQL is visible in the UI but cannot execute end-to-end.

## 2. OpenShift / Loki connectivity — ⚠️ DEFERRED BY SCOPE (🔴 if needed)

- `OPENSHIFT_LOKI_BASE_URL` empty by default → source reports `unavailable("OpenShift Loki base URL not configured")`.
- No OpenShift environment/credentials in this workspace; not tested (`INTEGRATION_REPORT`: "DEFERRED BY SCOPE – no access currently available").
- **OpenShift live tail is a stub:** `streamLive()` returns `Flux.empty()`; `LIVE_TAIL` not advertised.

## 3. Cursor pagination — ⚠️ MISSING (🟡)

- `LogSearchResponse.nextCursor` is **always `null`**; no client-supplied cursor in request.
- "Load next page" is a re-query with a larger limit (default 100 → +100), not server-side cursor paging → can be slow/dup-prone on huge result sets.

## 4. True query persistence ("last-query") — ⚠️ HALF-WIRED (🟡)

- `App.tsx` loads `prefs.loadNonSensitive('last-query')` at init.
- Nothing calls `saveNonSensitive(...)`, so the value is **never written** → a reload cannot reliably restore the last advanced simple query. The `saveNonSensitive` helper is dead.

## 5. Live source descriptor integration — ⚠️ STALE (🟡)

- `api.getSources()`/`api.getSystemInfo()` exist and are tested but **unused**; UI uses static `KNOWN_SOURCES` (`models/sources.ts`).
- If backend descriptors/capabilities change, the UI's `hasCapability` checks won't track them (capability drift risk).

## 6. Docker project-filter / exclusion-label UI — ❌ MISSING (🟡)

- Backend supports `logexplorer.docker.project-filter` and `exclusion-label-key` (yml).
- Frontend `DockerConnectionPanel` exposes only mode/host/port/TLS; **no project-filter or exclusion-label fields** (confirmed: none anywhere in `frontend/src`).

## 7. Remote TLS profiles — ❌ NOT CONFIGURED HERE (🟠)

- `tls-profiles` commented out in `application.yml` → `availableTlsProfiles` empty → REMOTE+TLS rejected as `tls-profile-unknown` in this environment (workable only when profiles are configured or default private CIDR allowlist is used).

## 8. Span follow — ❌ NOT WIRED (🟡)

- `spanId` is a real field, but there is **no backend/render span-follow handler** (`onSearch*` for span not provided) → inspector shows Span copy but no Find.

## 9. Durable audit logging — ❌ IN-MEMORY ONLY (🟠)

- `MaskingAuditService` and `DockerConnectionAuditService` are in-memory lists, explicitly "not a production persistence layer".
- No durable record of user queries / masking changes / connection changes.

## 10. Authentication / RBAC — ❌ NOT IMPLEMENTED (🔴 for prod)

- No application-level auth; `UnmaskCapabilityService` documents unmask disabled in production for this reason (`NO_AUTH_REASON`).
- Deployment relies on external access control (Route auth, network policies). Documented outside MVP scope.

## 11. Search-result / timeline export — ❌ MISSING (🟡)

- No CSV/JSON/PDF export of search results or timeline.

## 12. Saved custom query presets (beyond time) — ❌ MISSING (🟡)

- Only structural preferences (`sourceId/timePreset/levels/queryMode`) and table prefs persist; no user-defined filter/query presets.

## 13. Deep-link / shareable URLs — ❌ BY DESIGN (🟡)

- Queries deliberately never placed in URL (security). No share links.

## 14. Historical boundedness (Docker) — ⚠️ LIMITATION (🟠)

- Docker historical search reads only the most recent **200 lines per container** (`MAX_LOG_TAIL`), global `MAX_SCAN_LINES=100_000`. Deep-range historical queries on busy containers are inherently bounded/inexact.

## 15. Causal/timeline ordering — ⚠️ LIMITATION (🟡)

- Timeline is timestamp-chronological, **not causal** (documented). No backend journey/causal tracing endpoint; grouping is client-side.

## 16. Performance headline gaps (OLD)

- Raw CSS/JS above original Phase-1 raw targets (56.21 kB CSS, ~233 kB raw JS) though gzip budgets met (9.8/71 kB). Subjective visual QA (zoom 125/200%, reduced motion) has no automated screenshot harness.

---

## Severity summary

| Severity | Items |
|----------|-------|
| 🔴 High | Raw LogQL dead, OpenShift deferred, No auth/RBAC (prod). |
| 🟠 Medium | Remote TLS unconfigured, durable audit missing, Docker historical boundedness. |
| 🟡 Low | cursor pagination stub, last-query not saved, stale source descriptors, project-filter UI missing, span follow, export, saved presets, deep links, causal ordering. |

For each item, the fix/backlog entry is in **Audit 17 (Migration Backlog)**.
