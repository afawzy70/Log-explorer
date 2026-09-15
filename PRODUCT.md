# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Developers, support engineers, and incident investigators who need to
find and understand what happened in a running system, fast. They work
against structured (Spring Boot JSON) application logs from one of
several possible sources at a time — a local Docker Compose stack, a
remote Docker host, an OpenShift cluster's pods directly, or that same
cluster's Loki gateway — and their job is investigation under time
pressure: find the relevant events, understand the sequence around a
failure, and follow a request across services, without needing to know
how the product itself is built.

## Product Purpose

Log Explorer is a Seq-like investigation workstation for structured
application logs. It exists so an investigator can search, inspect,
correlate, and (where the source supports it) live-tail logs from one
source at a time through one consistent interface, instead of juggling
`kubectl logs`/`oc logs`, `docker logs`, and ad hoc grep. Success is
measured in time-to-answer for a real investigation: find the failing
event, see what happened immediately around it, follow it across
services, and confirm or rule out a hypothesis — not in dashboard
aesthetics or feature count.

## Positioning

Unlike a generic log-viewer or a SaaS observability dashboard, Log
Explorer:

- Never assumes uniform capability across sources — the backend
  declares exactly what each source (Fixture/Docker/OpenShift/Loki)
  supports (`SourceCapabilities`), and the frontend only ever shows a
  control when the connected source actually reports support for it.
  A competing product that infers capability from source *type* rather
  than an explicit backend contract could not make this claim
  truthfully.
- Masks the five protected fields (CIF, Username, Customer ID, Device
  ID, Device IP) server-side, before serialization, according to one
  global per-field policy (fresh installations start unmasked — register
  SSMP-6 — and the owner can mask any field), with no client-side
  reconstruction and no per-row "reveal" action anywhere in the product.
  Server-side enforcement and the absence of any reveal action are
  security invariants, not configurable niceties.
- Ships as one deployable artifact with no application database — no
  log storage, no SIEM, no alerting, no saved/team queries. It is a
  read-only investigation lens over live sources, not a logging
  platform.

## Operating Context

- Runs as a desktop app (Windows/macOS, unsigned/unnotarized in the
  current release) or via Docker Compose; opens in the user's default
  browser either way.
- The investigator picks exactly one data source per session (Fixture,
  Docker, OpenShift, or OpenShift Loki) and works within it — there is
  no cross-source query.
- Real investigation sessions are time-pressured: an incident in
  progress, a support ticket needing root-cause evidence, a developer
  chasing a bug through a request's full path across services.
- OpenShift credentials come from an `oc login` command pasted by the
  user — Log Explorer parses it (server/token/CA) but never executes
  `oc` itself and never requires it installed.
- Enterprise network realities apply: proxied OpenShift/Loki access
  (System/Direct/Custom modes honoring `HTTPS_PROXY`/`HTTP_PROXY`/
  `NO_PROXY`), optional TLS for remote Docker, and OpenShift's own TLS
  verification are all first-class, not edge cases.

## Capabilities and Constraints

**Implemented and verified today (latest `main`, `3f6b1b4` — the design
baseline for UX v2; PR #54's frozen baseline `ed6dbf5` is no longer the
functional reference):** search with time
range/service/severity/text/advanced filters (correlation, trace, span,
journey, event ID, error code, business step, UI identifier, logger,
device platform, language, and protected/sensitive fields); a results
table with per-column sort compatible with a single Newest/Oldest sort
state, configurable/reorderable/resettable columns; a five-tab Event
Inspector (Overview / Actor & client / Request flow / Business & error /
Technical-all-fields) that never conditionally hides a tab; "Show
surrounding logs" (a true ±30-second, same-execution-context window,
distinct from correlation); Trace/Correlation/Journey/Event-ID
"Find this…" follow-up; Live tail with Start/Pause/Resume/Stop/Clear and
honest partial-connectivity reporting for multi-replica OpenShift
workloads; global Privacy & Masking settings, separate from
Docker-specific and OpenShift-specific settings. Added since the frozen
baseline: a Log Schema & Field Mapping Verification workspace (Quick
Schema Scan over real source samples, discovered schema, per-field map →
validate → save → verify / needs change, owner-approved defaults trusted
as Verified, Journey ID and UI Identifier deliberately unmapped, scoped
per source and project, search gated until an edited mapping is saved);
a root-anchored Investigation workspace (Trace, Span, Correlation,
Journey, Event) with Show Surroundings per entry and a contextual Back;
service Include/Exclude filtering where excluded Docker services are
never read; bounded-parallel Docker historical search.

**Explicitly out of scope** (do not design toward these): SSO, per-user
OAuth, log storage, SIEM, alerting, APM, log mutation, a cross-source
single query, an application database, cluster-wide permissions, audit
persistence, HA, saved/team queries, retention/DR, scheduled queries,
tracing-backend integration, pseudonymized lookup, multi-cluster,
AI root-cause diagnosis, analytics, production identity features.

**Source capability truth (do not homogenize in the redesign):** exact,
current matrix lives in `docs/user-guide/CAPABILITY_MATRIX.md`. Live tail
and surrounding-logs context are NOT available on OpenShift Loki today;
real-Loki-gateway verification remains unavailable in this project's own
environment (implemented/tested against a fake gateway only) — direct
OpenShift connectivity, by contrast, has been verified against a real
cluster.

**Terminology:** "surrounding logs"/"context" (same execution scope,
chronological) is a *distinct* concept from "correlation"/"trace"/
"journey" (same request, possibly different scope/service, order-only —
never causally implied). Do not conflate them for visual simplicity.

## Evidence on Hand

- `docs/ux-reference/old-ui/old-01.jpg` … `old-19.jpg` — 19 real
  screenshots of a prior UI generation, the UX-quality reference for
  information hierarchy, investigation workflow, density, and
  discoverability (not a pixel template, and not authoritative for
  current functionality/architecture/security).
- `docs/ux-reference/old-ui/README.md`,
  `docs/verification/OLD_UX_RESTORATION_AUDIT.md` — the existing textual
  audit of that OLD UI.
- `docs/user-guide/screenshots/01–06*.png` — six real screenshots of the
  current, frozen functional baseline (Fixture source, generic fixture
  data): search results, Inspector (Overview and Request flow tabs),
  surrounding logs with a detected gap, Live tail, and Privacy & masking
  settings.
- `docs/user-guide/USER_GUIDE_EN.md`, `CAPABILITY_MATRIX.md` — the
  authoritative, code-verified description of every current-baseline
  behavior a redesign must preserve.
- `docs/ux-v2-modern-developer-console/baseline/` — 31 real screenshots
  of latest `main` (`3f6b1b4`) plus layout measurements: the BEFORE
  baseline for the Modern Developer Console redesign.
- No customer testimonials, case studies, press, pricing, or usage
  benchmarks exist for this product — none should be fabricated.

## Product Principles

1. Truthful capability, always — never imply a source can do something
   it cannot; never homogenize Fixture/Docker/OpenShift/Loki.
2. Investigation speed over decoration — every surface exists to get an
   investigator from "something's wrong" to "here's why" faster.
3. Security and correctness are load-bearing, not stylistic — masking,
   context/correlation distinctness, and never-fabricated-causality are
   product truth, not choices a visual redesign gets to soften.
4. The OLD UI's workflow wisdom and the CURRENT baseline's functional
   correctness are both real assets; a redesign must exceed both, never
   trade one for the other.
5. Built for daily, expert, keyboard-driven use — not a first-time
   visitor's landing experience.

## Accessibility & Inclusion

WCAG 2.2 AA is an established, non-negotiable requirement (CLAUDE.md §7):
semantic HTML, labeled controls, full keyboard workflows, visible focus,
screen-reader labels, contrast, non-color-only meaning, logical focus
restoration, reduced motion, helpful live announcements, zoom and reflow
(usable down to 1024/768 widths, optimized for 1920/1440/1280).
