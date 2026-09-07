# CLAUDE.md — Operating rules for the Log Explorer repository

Read this before every work session. These rules override convenience, speed, and any instinct to simplify.

Companion documents: `LOG_EXPLORER_CLAUDE_CODE_HANDOVER.md` (requirements), `IMPLEMENTATION_PLAN.md` (phases), `REQUIREMENTS_TRACEABILITY.md` (coverage), `PHASE_PROMPTS.md` (per-phase kickoff and recovery prompts).

---

## 1. What this project is

A Seq-like investigation UI for structured Spring Boot JSON logs, over two logical sources: local Docker Compose (Docker Engine API) and OpenShift Loki. Java 21 / Spring Boot 3.x / WebFlux / Maven backend; React + TypeScript + Vite frontend; one deployable image; no application database.

Neutral identity only: "Log Explorer" or "Multi-Source Log Explorer". Never invent bank branding, logos, affiliation claims, or production-readiness claims.

---

## 2. Non-negotiable security rules

1. **Sensitive fields are `cif`, `UserName`, `CustomerId`, `deviceId`, `deviceIp`.** They are masked server-side before browser serialization, at a single masking boundary. Adapters may hold raw values for source-side filtering; raw values never leave in a response.
2. **Never log** search values, bearer tokens, raw customer identifiers, full log events, raw sensitive filters, or secrets — including via `toString`, exception messages, `ProblemDetail`, query-plan explanations, request/access logs, or test output.
3. **No `dangerouslySetInnerHTML`.** Log content renders as text, always.
4. **Nothing sensitive in URLs or localStorage.** Query contents stay out of the URL. localStorage holds only safe non-sensitive UI preferences. Never persist raw search values or log events.
5. **No reveal action** for masked values. Non-sensitive trace/correlation/journey/event IDs may be copied.
6. **Credentials** come from environment variables or uncommitted local config. Never committed, never printed. `.env.example` holds variable names and harmless defaults only.
7. **TLS verification stays on** for OpenShift/Loki. Never add trust-all TLS. For *remote Docker*, TLS is an optional connection **mode** — that is not the same as disabling verification on a TLS connection.
8. **Docker access is strictly read-only:** list, inspect, read logs, follow logs. Never expose start, stop, create, remove, exec, or any mutation.
9. **OpenShift access is strictly read-only.** Never change operators, routes, cluster RBAC, Loki configuration, or cluster-wide roles. No `ClusterRole`/`ClusterRoleBinding` in this repo.
10. **Never mount `/var/run/docker.sock` silently.** Only behind an explicit Compose profile, read-only, with a documented privilege warning.

---

## 3. Verification honesty

Use exactly four outcomes, and use them literally:

- **PASS** — you ran the check and it succeeded. Include the command and the relevant output.
- **FAIL** — you ran the check and it failed. Say what failed.
- **BLOCKED** — you could not run the check (external system unreachable, missing credential, missing environment capability). Name the check, the reason, and what would unblock it.
- **DEFERRED** — out of scope for now by explicit decision (e.g. live OpenShift verification).

Rules:

- Never convert BLOCKED into PASS because "the code looks right".
- Never claim external Docker or OpenShift behavior was verified unless you actually connected.
- **Compilation is not evidence.** A green build proves nothing about masking, layout, counts, or portability.
- Do not weaken, skip, or delete a test to get a green build. If a test is wrong, fix the test deliberately and say so in the report.
- Report the commands you actually ran, not the commands you intended to run.

---

## 4. Behavioral invariants that came from real bugs

Treat these as product requirements, not cosmetic details. Each one came from an observed failure.

**Results table**
- Exactly seven columns, in order: Time, Level, Service, What happened, User/Customer, Correlation/Trace, Actions.
- `What happened` = **message only**. Message never renders under Service.
- Missing values render `—`. Never omit a cell.
- One semantic `<table>`, one `<colgroup>`, `table-layout: fixed`. Header and body share one geometry system — never separate grid/flex layouts.
- One event = one `<tr>`. Actions `…` is the seventh cell of that same row. No second row, no blank line.
- Header/cell `getBoundingClientRect()` left and width must match within **2 CSS pixels**. If that assertion fails, the table is not fixed — do not say it is.
- Time shows date + time + milliseconds.
- Newest first. No dropped or duplicated rows.
- One pagination model only. Never two competing controls.
- Counts stay distinct: total/estimated, returned, visible, page, truncation. No contradictory copy.
- Horizontal scroll wraps the table; the page never overflows horizontally.

**Time range**
- Presets include **Last 1 day**; zero results offers one-click "Search last 1 day".
- Custom is a temporary popover with Start/End labels, Apply and Cancel — never a permanently expanded form.
- Prefill: End = now, Start = end − previous preset, 30-minute fallback.
- On Apply: commit, close immediately, restore focus to the Time Range control, show the **actual interval** (both dates when they differ) and the zone (e.g. `Asia/Kuwait (UTC+03:00)`), and mirror it in active filters. Never a generic "Custom range" label.
- Cancel / Escape / outside click closes without mutating the committed range. Reopen restores committed values. Selecting a preset closes the editor and restores the preset label.
- Validation distinguishes missing start/end, start ≥ end, future end, and max-range violation.
- **Convert display-zone values to UTC exactly once.**
- The editor must not overlap severity. Fields stack at narrow widths.

**Sources and capabilities**
- The backend returns explicit capabilities. The frontend never infers what a source can do.
- Never show raw LogQL or Live for a source that cannot support them.
- Raw LogQL: Loki only, separate explicit mode, off by default, config-enabled, still bounded — and never a huge disabled control dominating the UI.

**Remote Docker**
- Do not assume `HOST_IP:2375` is reachable just because `localhost:2375` works.
- Never make exposing Docker TCP a prerequisite, and never tell users to reconfigure their daemon or firewall in order to run Log Explorer.
- Default port prefilled, custom port supported, TLS optional; certificate fields appear only when TLS is on.

**Parsing**
- Correlation precedence: `mdc.X-Correlation-id`, then the **literal** key `mdc["event.correlationId"]` — it is a key containing a dot, not a nested path.
- Service precedence: top-level `application`, then source metadata; keep both when they differ.
- Never discard unknown JSON or MDC fields.
- Malformed lines become raw fallback events. Never silently dropped. One bad field must not discard the whole event.
- Empty `message` is preserved; the UI shows a display fallback like `(empty message)`. The backend never invents a message.
- Multiline/escaped-newline exceptions stay one logical event.

**Bounds**
- No unbounded scans, arrays, buffers, or DOM rows anywhere. Live display cap starts at 1,000 events, with dropped/buffered counts shown.

---

## 5. How to work

- **Audit before editing.** Read the actual code; never assume a historical phase number reflects current state.
- **Preserve unrelated changes.** If the working tree is dirty at phase start, stop and report.
- **Do not jump ahead.** Finish and verify a phase before starting the next.
- One branch and one PR per phase: `phase/<letter>-<slug>`. Commit a verification report at `docs/verification/PHASE_<letter>_REPORT.md`.
- Keep `REQUIREMENTS_TRACEABILITY.md` current in every phase.
- When an older requirement conflicts with a later decision, **name the conflict explicitly and apply the later decision** (see `IMPLEMENTATION_PLAN.md` §2).
- Blocking Docker client calls run on `Schedulers.boundedElastic()`, never on the WebFlux event loop.

---

## 6. Visual bug debugging sequence

Never declare a visual fix without walking this path:

1. Reproduce.
2. Capture a baseline screenshot.
3. Inspect the network payload.
4. Inspect the DOM and computed layout.
5. Define the invariant in words.
6. Implement the smallest fix.
7. Add a permanent regression test.
8. Verify the rendered result at the tested viewports and zoom levels.

Debug path is always: real API response → normalized frontend model → React state → DOM → computed layout. A working backend search proves nothing about the UI.

---

## 7. Design direction

Calm, precise, information-dense, fast, consistent, accessible — a credible enterprise engineering tool. Neutral canvas, one restrained accent, semantic severity colors (never color alone), 4/8px spacing, centralized tokens for typography/spacing/radius/border/shadow, monospace only for timestamps, IDs, query syntax, and stack traces.

Avoid gradients, glassmorphism, card clutter, pill overload, novelty animation, huge hero areas, and uncontrolled inline colors. Light theme required; dark theme only if complete and accessible.

Optimize for 1920 / 1440 / 1280. Remain usable at 1024 / 768 / 390. Target WCAG 2.2 AA: semantic HTML, labeled controls, keyboard workflows, visible focus, screen-reader labels, contrast, non-color meaning, logical focus restoration, reduced motion, helpful live announcements, zoom and reflow.

---

## 8. Out of scope

SSO, per-user OAuth, log storage, SIEM, alerting, APM, log mutation, cross-source single query, an application database, cluster-wide permissions, audit persistence, HA, saved/team queries, retention/DR, scheduled queries, tracing-backend integration, pseudonymized lookup, multi-cluster, pen testing, AI root-cause diagnosis, analytics, production identity features.

Do not add these. If you believe one is required, raise it in the phase report instead of implementing it.

---

## 9. The one rule behind all the others

> The biggest risk on this project is **requirement loss**, not technical difficulty.

Do not simplify the project by quietly dropping "small" behaviors. Most of the small items in this file exist because something already broke in exactly that way.
