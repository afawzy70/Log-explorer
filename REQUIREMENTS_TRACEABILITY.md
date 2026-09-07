# Requirements Traceability

Every item in handover §34 maps to at least one owning phase. Claude Code updates **Status** and **Evidence** in every phase; Phase M cannot pass while any row is `Not assessed` or has an unexplained gap.

**Status values:** `Not assessed` · `Present` · `Partial` · `Missing` · `Broken` · `Done` · `Deferred (reason)`
**Evidence:** file path + line, test name, or report path. Never "assumed" or "looks fine".

| # | Requirement | Handover § | Owning phase | Status | Evidence |
|---:|---|---|---|---|---|
| 1 | Problem statement understood and preserved | 1–2 | A | Not assessed | |
| 2 | Two logical sources (Docker, OpenShift Loki) | 1 | C, D | Not assessed | |
| 3 | Portable Docker Compose delivery | 20 | K | Not assessed | |
| 4 | Remote Docker default port prefilled | 11, 20.2 | C | Not assessed | |
| 5 | Remote Docker custom port supported | 11, 24.3 | C | Not assessed | |
| 6 | Remote Docker TLS optional | 11.1, 24.2 | C | Not assessed | |
| 7 | Remote Docker reachability lesson honored (no 2375 prerequisite) | 11.2, 24.1 | C, K | Not assessed | |
| 8 | Java 21 / Spring Boot 3.x / WebFlux | 4.1 | A, B | Not assessed | |
| 9 | React / TypeScript / Vite, strict TS | 4.2 | A, F | Not assessed | |
| 10 | No MVP database; safe localStorage only | 4.4 | B, F | Not assessed | |
| 11 | Single deployable image, SPA fallback excludes /api and actuator | 4.3 | K | Not assessed | |
| 12 | Canonical top-level fields mapped | 5, 5.1 | B | Not assessed | |
| 13 | All expected MDC fields handled | 5 | B | Not assessed | |
| 14 | Literal dotted key `event.correlationId` read safely | 5.1 | B | Not assessed | |
| 15 | Correlation precedence (X-Correlation-id → event.correlationId) | 5.1 | B | Not assessed | |
| 16 | Unknown JSON/MDC fields preserved | 5.3 | B | Not assessed | |
| 17 | Malformed lines become raw fallback events | 5.4 | B | Not assessed | |
| 18 | Timestamp normalization to Instant, no double conversion | 5.5 | B | Not assessed | |
| 19 | Sensitive field masking before browser serialization | 6.1 | B | Not assessed | |
| 20 | Never log search values, tokens, raw identifiers, events | 6.2 | B + every phase | Not assessed | |
| 21 | Safe text rendering; no dangerouslySetInnerHTML | 6.3 | G, H | Not assessed | |
| 22 | Explicit source capability model | 7 | B | Not assessed | |
| 23 | Source registry and API endpoints | 7 | B | Not assessed | |
| 24 | Bounded query guardrails | 8.1 | B | Not assessed | |
| 25 | Per-source maximum time range | 8.1 | B | Not assessed | |
| 26 | Result limit with configurable max (≤ 5,000) | 8.1 | B | Not assessed | |
| 27 | Bounded concurrency | 8.1 | B | Not assessed | |
| 28 | Cancellation propagated | 8.1, 18.2 | B, J | Not assessed | |
| 29 | Simple deterministic query DSL (no eval/SpEL/reflection) | 9 | E | Not assessed | |
| 30 | Raw LogQL gated: Loki-only, off by default, config-enabled, bounded | 9.1 | E | Not assessed | |
| 31 | Docker Compose label discovery + service counts | 10 | C | Not assessed | |
| 32 | Docker stream framing decoded correctly (incl. tty) | 10 | C | Not assessed | |
| 33 | Docker operations strictly read-only | 10 | C | Not assessed | |
| 34 | OpenShift Loki gateway adapter, query_range semantics | 12 | D | Not assessed | |
| 35 | Gateway prefix / tenant / namespace + service label keys configurable | 12 | D | Not assessed | |
| 36 | TLS verification enabled for Loki; no trust-all | 6.5, 12 | D | Not assessed | |
| 37 | Compact professional shell, one title, health + retry | 13.1 | F | Not assessed | |
| 38 | Accessible searchable service multi-select | 13.3 | F | Not assessed | |
| 39 | Severity default INFO/WARN/ERROR; not color-only | 13.4 | F | Not assessed | |
| 40 | Universal search with confirmable ID detection | 13.5 | F | Not assessed | |
| 41 | Advanced filters grouped by question, draft/apply/cancel, protected wording | 13.6 | F | Not assessed | |
| 42 | Time presets include Last 1 day | 14.1 | F | Not assessed | |
| 43 | Zero-result one-click "Search last 1 day" | 14.1 | F, G | Not assessed | |
| 44 | Custom range popover: prefill, Apply/Cancel, close, focus restore, real interval label | 14.2 | F | Not assessed | |
| 45 | Display zone shown (e.g. Asia/Kuwait UTC+03:00) | 14.2 | F | Not assessed | |
| 46 | Display zone → UTC converted exactly once | 14.2, 24.9 | F | Not assessed | |
| 47 | Time validation distinguishes all four error classes | 14.2 | F | Not assessed | |
| 48 | Exactly seven columns in exact order | 15.1 | G | Not assessed | |
| 49 | Missing values render `—`; no omitted cells | 15.1, 24.5 | G | Not assessed | |
| 50 | One semantic table, one colgroup, fixed layout, shared geometry | 15.2, 24.4 | G | Not assessed | |
| 51 | Actions is the seventh cell of the same row | 15.3, 24.7 | G | Not assessed | |
| 52 | Message renders under "What happened", not Service | 15.1, 24.6 | G | Not assessed | |
| 53 | Newest-first sort; no dropped or duplicated rows | 15.6 | G | Not assessed | |
| 54 | One pagination model only | 15.7 | G | Not assessed | |
| 55 | Truthful, non-contradictory counts | 15.8, 24.10 | G | Not assessed | |
| 56 | ≤2px header/cell geometry verification at all viewports and zoom | 15.9 | G | Not assessed | |
| 57 | Loading state | 27.6 | G | Not assessed | |
| 58 | Error state | 27.6 | G | Not assessed | |
| 59 | Empty state | 27.6 | G | Not assessed | |
| 60 | Cancelled state | 27.6 | G | Not assessed | |
| 61 | Partial / truncated state | 8.1, 27.6 | G | Not assessed | |
| 62 | Event inspector layout, resize, prev/next/close, focus | 16 | H | Not assessed | |
| 63 | Local timestamp with ms + named zone, plus UTC | 16.2 | H | Not assessed | |
| 64 | Protected actor & client section, no reveal action | 16.3 | H | Not assessed | |
| 65 | Request-flow section with safe copy and related-log actions | 16.4 | H | Not assessed | |
| 66 | Business/error section with formatted exception | 16.5 | H | Not assessed | |
| 67 | All-fields view with raw JSON behind disclosure | 16.6 | H | Not assessed | |
| 68 | Show ±30 seconds context, scoped, bounded, with breadcrumb | 16.7 | H | Not assessed | |
| 69 | Trace investigation | 17 | I | Not assessed | |
| 70 | Correlation investigation | 17 | I | Not assessed | |
| 71 | Journey investigation across multiple traces | 17 | I | Not assessed | |
| 72 | JMS / event correlation metadata displayed | 17 | I | Not assessed | |
| 73 | Timestamp order stated as not guaranteed causality | 17 | I | Not assessed | |
| 74 | Previous search state preserved and restorable | 17 | I | Not assessed | |
| 75 | SSE live transport; no tokens or sensitive filters in URL | 18.1 | J | Not assessed | |
| 76 | Docker upstream cancellation on disconnect | 18.2 | J | Not assessed | |
| 77 | Loki live capability gated honestly; no faking | 18.3, 24.14 | D, J | Not assessed | |
| 78 | Bounded backend buffer, heartbeat, timeout, max concurrent tails | 18.4 | J | Not assessed | |
| 79 | Bounded frontend buffer | 18.4 | J | Not assessed | |
| 80 | Initial displayed-live cap of 1,000 events | 18.4 | J | Not assessed | |
| 81 | Start / pause / resume / stop lifecycle, unmount closes stream | 18.4 | J | Not assessed | |
| 82 | Dropped and buffered counts visible | 18.4 | J | Not assessed | |
| 83 | Responsive at 1920/1440/1280/1024/768/390 | 19.2, 28 | F–H, M | Not assessed | |
| 84 | Accessibility to WCAG 2.2 AA principles | 19.4 | F–J | Not assessed | |
| 85 | Zoom/reflow at 125% / 200% and targeted high zoom | 28 | F, G | Not assessed | |
| 86 | No page-level horizontal overflow | 15.2, 19.4 | G | Not assessed | |
| 87 | Centralized design tokens; restrained visual language | 19.3 | F | Not assessed | |
| 88 | No fabricated branding or production-readiness claims | 3 | F, M | Not assessed | |
| 89 | Non-root runtime image, multi-stage, no build secrets | 4.3, 21 | K | Not assessed | |
| 90 | Docker socket mount only behind explicit Compose profile | 20.1 | K | Not assessed | |
| 91 | Docker socket privilege warning documented | 20.1 | K | Not assessed | |
| 92 | `.env.example` with names and harmless defaults only | 6.4 | K | Not assessed | |
| 93 | Portable run/requirements guide matching real commands | 20 | K | Not assessed | |
| 94 | Deterministic smoke tests (build→start→health→discover→search→UI→stop→cleanup) | 20 | K | Not assessed | |
| 95 | OpenShift manifests (Deployment, Service, Route, ConfigMap, ServiceAccount) | 21 | L | Not assessed | |
| 96 | No cluster-wide RBAC; namespace-scoped binding documented only | 21 | L | Not assessed | |
| 97 | Secret references only; no committed secrets | 21 | L | Not assessed | |
| 98 | Independent verification per phase, not compilation | 22 | all, M | Not assessed | |
| 99 | Recovery process after verification failure | 22.2 | all | Not assessed | |
| 100 | PASS / FAIL / BLOCKED / DEFERRED honesty | 22.1, 24.15 | all | Not assessed | |
| 101 | Final stakeholder acceptance tasks 1–6 | 27 | M | Not assessed | |
| 102 | Deferred items and non-goals preserved, not implemented | 25 | M | Not assessed | |

---

## Superseded decisions — confirm each was applied, not reverted

| Decision | Applied? | Evidence |
|---|---|---|
| Remote Docker TCP is optional, never a prerequisite | | |
| Remote Docker TLS optional (but never trust-all) | | |
| Remote Docker default port prefilled and overridable | | |
| Portable Compose is a first-class deployment mode | | |
| Live OpenShift verification is DEFERRED, not a release blocker | | |
| Raw LogQL is off by default and not a dominant disabled control | | |
| One deployable image with SPA fallback excluding /api and actuator | | |
| Committed custom time interval is displayed literally | | |

---

## Out-of-scope confirmation (Phase M)

Confirm none of the following were implemented, and record where any pre-existing instance was found during Phase A:

SSO / per-user OAuth · long-term log storage · SIEM · alerting · full APM · log mutation · cross-source single query · application database · cluster-wide permissions · query audit persistence · HA / horizontal scale · saved or team queries · retention / DR · scheduled queries · tracing-backend integration · pseudonymized lookup service · multi-cluster queries · penetration testing / production approval · AI root-cause diagnosis · analytics · production identity features.
