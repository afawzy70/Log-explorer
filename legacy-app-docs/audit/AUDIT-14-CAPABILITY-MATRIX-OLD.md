# Audit 14 — Capability Matrix (OLD)

**Scope:** Consolidated matrix of every capability of the OLD app across all audit areas, each with its OLD status and a `Putative NEW` column.

> **Provenance status:** OLD = verified from source (live spec-verified; WORKING/PARTIAL/NOT-PRESENT). **NEW = UNVERIFIED** — the NEW app was unreachable, so the `Putative NEW` column is **speculative only** and marked `UNVERIFIED`. Do not treat NEW entries as fact.

**OLD status legend:** ✅ WORKING · ⚠️ PARTIAL (works but limited) · ❌ NOT PRESENT · 🚫 DEAD PATH (present in UI but non-functional end-to-end)

---

## A. Sources

| Capability | OLD | Putative NEW (UNVERIFIED) |
|------------|-----|--------------------------|
| Docker Compose source | ✅ | UNVERIFIED |
| OpenShift/Loki source (search) | ⚠️ deferred (unconfigured, no access) | UNVERIFIED |
| Fixture source (dev/test) | ✅ | UNVERIFIED |
| Per-user/session Docker connection (local/remote/TLS) | ✅ | UNVERIFIED |
| Service discovery | ✅ | UNVERIFIED |
| Source health + retry | ✅ | UNVERIFIED |

## B. Search & query

| Capability | OLD | Putative NEW (UNVERIFIED) |
|------------|-----|--------------------------|
| Historical search | ✅ | UNVERIFIED |
| Time presets (5m/15m/30m/60m/24h) + custom | ✅ | UNVERIFIED |
| Severity/level filtering | ✅ | UNVERIFIED |
| Service filtering (multi-select) | ✅ | UNVERIFIED |
| Free-text search | ✅ | UNVERIFIED |
| Identifier detection + scope suggestion | ✅ | UNVERIFIED |
| Guided query builder (and/or groups) | ✅ | UNVERIFIED |
| Text simple-query | ✅ | UNVERIFIED |
| Advanced "who" sensitive filters (masked) | ✅ | UNVERIFIED |
| Advanced request-flow/what/client filters | ✅ | UNVERIFIED |
| Raw LogQL | 🚫 dead path (backend force-off) | UNVERIFIED |
| Search statistics/estimate | ✅ | UNVERIFIED |
| Generated LogQL display | ✅ | UNVERIFIED |
| Push-down vs post-filter reporting | ✅ | UNVERIFIED |

## C. Results & inspection

| Capability | OLD | Putative NEW (UNVERIFIED) |
|------------|-----|--------------------------|
| Semantic results table (named columns) | ✅ | UNVERIFIED |
| Required + optional columns | ✅ | UNVERIFIED |
| Column reorder (drag + keyboard) | ✅ | UNVERIFIED |
| Sort (newest/oldest) | ✅ | UNVERIFIED |
| Density (comfortable/compact) | ✅ | UNVERIFIED |
| Row keyboard nav + selection | ✅ | UNVERIFIED |
| Malformed-row handling | ✅ | UNVERIFIED |
| Load next page (+100, deduped) | ✅ (⚠️ not true cursor pagination) | UNVERIFIED |
| Refresh | ✅ | UNVERIFIED |
| Event inspector (5 tabs, resizable) | ✅ | UNVERIFIED |
| Inspector prev/next (search-only) | ✅ | UNVERIFIED |
| Copy non-sensitive / Protected sensitive | ✅ | UNVERIFIED |
| Find-same-ID from inspector | ✅ | UNVERIFIED |
| ±30s surrounding context | ✅ | UNVERIFIED |

## D. Investigation

| Capability | OLD | Putative NEW (UNVERIFIED) |
|------------|-----|--------------------------|
| Correlation timeline (chronological) | ✅ | UNVERIFIED |
| Multi-trace journey | ✅ | UNVERIFIED |
| Service sequence / gap markers / errors | ✅ | UNVERIFIED |
| Business-step markers | ✅ | UNVERIFIED |
| Timeline filters (service/severity/errors) | ✅ | UNVERIFIED |
| Return to search | ✅ | UNVERIFIED |
| Span follow | ❌ (no handler wired) | UNVERIFIED |

## E. Live tail

| Capability | OLD | Putative NEW (UNVERIFIED) |
|------------|-----|--------------------------|
| Live tail start (confirm dialog) | ✅ | UNVERIFIED |
| Pause / resume / follow-newest / clear / stop | ✅ | UNVERIFIED |
| Bounded display (1000) / pause buffer (100) | ✅ | UNVERIFIED |
| Reconnect + retry (bounded backoff) | ✅ | UNVERIFIED |
| Tail filters | ✅ | UNVERIFIED |
| Live tail for Docker | ✅ | UNVERIFIED |
| Live tail for OpenShift/Loki | ❌ (`Flux.empty()`) | UNVERIFIED |

## F. Masking & security

| Capability | OLD | Putative NEW (UNVERIFIED) |
|------------|-----|--------------------------|
| Server-side sensitive masking | ✅ | UNVERIFIED |
| Per-field masking toggles | ✅ | UNVERIFIED |
| Session unmask (dev-only, gated) | ⚠️ | UNVERIFIED |
| Sensitive never persisted/URL'd/logged | ✅ | UNVERIFIED |
| HMAC-sensitive query matching | ✅ | UNVERIFIED |
| SSRF/DNS-rebinding + allowlist security | ✅ | UNVERIFIED |
| TLS verification | ✅ | UNVERIFIED |
| Auth / RBAC | ❌ (external only) | UNVERIFIED |
| Durable audit logging | ❌ (in-memory only) | UNVERIFIED |

## G. Settings & admin

| Capability | OLD | Putative NEW (UNVERIFIED) |
|------------|-----|--------------------------|
| Masking settings UI | ✅ | UNVERIFIED |
| Docker connection UI (mode/host/port/TLS) | ✅ | UNVERIFIED |
| Docker connection test | ✅ | UNVERIFIED |
| Docker project-filter / exclusion-label UI | ❌ (backend-only config) | UNVERIFIED |
| System info endpoint | ✅ (no source count) | UNVERIFIED |

## H. Productivity & robustness

| Capability | OLD | Putative NEW (UNVERIFIED) |
|------------|-----|--------------------------|
| Keyboard workflows (WCAG 2.2 AA) | ✅ | UNVERIFIED |
| Responsive (1440/1024/768/<768) | ✅ | UNVERIFIED |
| Reduced motion | ✅ | UNVERIFIED |
| Zero innerHTML / text-only rendering | ✅ | UNVERIFIED |
| Lazy-loading + size budgets | ✅ | UNVERIFIED |
| abort/cancel stale requests | ✅ | UNVERIFIED |
| last-query restore | ⚠️ (one-way, never saved) | UNVERIFIED |
| Search-result / timeline export | ❌ | UNVERIFIED |
| Shareable deep links | ❌ (by design) | UNVERIFIED |
| Custom saved queries/presets (beyond time) | ❌ | UNVERIFIED |

---

## Notes on usage

- Use the OLD column as the authoritative capability statement for this (OLD) app.
- The `Putative NEW` column is **entirely UNVERIFIED** because the NEW app could not be reached; confirm against the NEW app before relying on it.
- For each `❌`/`🚫`/`⚠️` in OLD, see Audit 15 (missing capabilities in OLD) and Audit 17 (migration backlog).
