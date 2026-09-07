# Log Explorer — Execution Plan for Claude Code

**Repository:** `https://github.com/afawzy70/Log-explorer`
**Execution environment:** Google Cloud VM, `gh` installed and authenticated
**Source of truth for requirements:** `LOG_EXPLORER_CLAUDE_CODE_HANDOVER.md` (referred to below as *the handover*)
**Status of this document:** the plan the handover asked for. Claude Code executes it; it does not need to re-derive it.

---

## 0. How to use this plan

1. Read `CLAUDE.md` (repo operating rules) and the handover in full.
2. Execute **Phase A** (audit). Phase A can change the plan — if repo reality contradicts an assumption here, record the contradiction in `docs/AUDIT.md` and adjust the affected phase before starting it. Do not silently drift.
3. Execute phases in order. One branch and one PR per phase.
4. Each phase ends with a committed verification report using the PASS / FAIL / BLOCKED / DEFERRED taxonomy. No phase is "done" on a green compile.
5. If a phase fails verification, run its **Recovery** procedure (in the phase) rather than starting the next phase.

The handover's §34 checklist is mapped item-by-item to phases in `REQUIREMENTS_TRACEABILITY.md`. Nothing in that checklist may be dropped without an explicit written determination.

---

## 1. Environment and access constraints

| Constraint | Implication for the plan |
|---|---|
| Repo is not publicly readable | Every statement about current code in this plan is a *hypothesis*. Phase A replaces hypotheses with evidence. |
| Work happens on a headless GCP VM | Browser/geometry verification runs Playwright headless Chromium. Install OS deps once (`npx playwright install --with-deps chromium`). Screenshots are the evidence artifact instead of human eyes. |
| Corporate Docker daemon / OpenShift are **not** reachable from this VM | All routine verification must run against local, deterministic fixtures. Real-source checks are reported `BLOCKED`, never `PASS`. |
| Docker is available locally on the VM (verify in Phase A) | The local Docker socket is the realistic Docker source under test. Remote Docker (TCP) is exercised against a locally published, throwaway endpoint or a stub — never by asking anyone to open port 2375. |
| `gh` is authenticated | Use PRs for phase review; attach evidence in the PR body. |

**Non-negotiable environment rule:** unavailability of an external system never converts into a passing check. See `CLAUDE.md` §"Verification honesty".

---

## 2. Conflict resolution — decisions that supersede earlier ones

Applied throughout this plan (handover §29). Claude Code must not "restore" the superseded column.

| Area | Superseded assumption | Governing decision |
|---|---|---|
| Remote Docker reachability | Point Log Explorer at `tcp://HOST_IP:2375` and it works | External Docker TCP is **optional and unreliable**. Never a prerequisite. Portable Compose is the primary deployment path. |
| Remote Docker TLS | TLS required | TLS is an **optional connection mode**; cert fields only shown/required when TLS is on. Optional-TLS ≠ trust-all TLS. Trust-all is still forbidden. |
| Remote Docker port | Hardcoded port | Sensible **default, prefilled, overridable**. |
| OpenShift verification | Live cluster check gates the release | Live OpenShift is **DEFERRED BY SCOPE** when unavailable; adapter correctness is proven against a mock Loki. |
| Packaging | Dev-only split backend/frontend | **One deployable image** + portable Compose is a first-class deliverable. |
| Raw LogQL | Prominent UI capability | Off by default, config-gated, Loki-only, and must not dominate the UI as a large disabled control. |
| Table layout | Header and body styled independently | One semantic `<table>`, one `<colgroup>`, `table-layout: fixed`, shared geometry, ≤2px verified. |
| Time range | Generic "Custom range" label | Committed interval is displayed literally, in the display zone, converted to UTC exactly once. |

---

## 3. Target end state (architecture)

### 3.1 Backend — one modular Spring Boot application

```
backend/src/main/java/<base>/
  api/            # WebFlux handlers/controllers, request+response DTOs, ProblemDetail mapping
  api/dto/        # ONLY masked, browser-safe types leave through here
  core/model/     # CanonicalLogEvent, SourceCapabilities, SearchRequest/Result, ResultCounts
  core/parse/     # canonical JSON parser, raw-fallback builder, timestamp normalizer
  core/mask/      # MaskingService + field policies (the single masking boundary)
  core/query/     # tokenizer, parser, AST, semantic validator, predicate compiler, plan explainer
  core/guard/     # limits, timeouts, concurrency semaphore, cancellation, truncation accounting
  source/         # LogSource SPI + LogSourceRegistry
  source/docker/  # Docker Engine adapter (read-only), connection modes, diagnostics
  source/loki/    # OpenShift Loki adapter, LogQL planner, gateway path/tenant config
  source/fixture/ # deterministic fixture source — dev/test profiles ONLY
  config/         # typed @ConfigurationProperties, SPA fallback routing, actuator wiring
```

**Ports (HTTP contract):**

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/sources` | list sources + explicit capabilities |
| GET | `/api/v1/sources/{id}/health` | health + diagnostics (sanitized) |
| GET | `/api/v1/sources/{id}/services` | discovered services + running/container counts |
| POST | `/api/v1/logs/search` | bounded historical search |
| GET | `/api/v1/logs/context` | ±N seconds around an event |
| GET | `/api/v1/logs/live` (SSE) | bounded live tail |
| GET | `/actuator/health`, `/actuator/info` | ops |

`SourceCapabilities` is returned by the backend and is the **only** thing the frontend may use to decide what to show: `historicalSearch`, `liveTail`, `rawLogQL`, `serviceDiscovery`, `queryStatistics`, `contextView`.

### 3.2 Frontend — React + TypeScript + Vite (strict)

```
frontend/src/
  app/            # shell, routing, error boundary
  features/search/    # toolbar, service multi-select, severity, universal search, advanced filters
  features/timerange/ # presets + custom range popover (draft/apply/cancel)
  features/results/   # semantic table, states, counts, pagination
  features/inspector/ # event details panel
  features/journey/   # trace/correlation/journey workspace + context view
  features/live/      # SSE lifecycle, bounded buffer
  shared/api/     # typed client, cancellation, error normalization
  shared/time/    # single-conversion time utilities (the only place zone math lives)
  shared/ui/      # tokens + primitives (no ad-hoc inline colors)
```

### 3.3 Packaging

One image: Vite build → static assets served by Spring Boot; SPA fallback that **excludes** `/api/**` and `/actuator/**`; multi-stage build; non-root runtime user; no secrets in layers. Compose stack with profiles (see Phase K).

---

## 4. Cross-cutting technical decisions (decide once, here)

These are chosen so Claude Code does not stall on open questions. Deviating requires a note in the phase report explaining why.

| Concern | Decision | Rationale |
|---|---|---|
| Docker client | `docker-java` (`docker-java-core` + `docker-java-transport-httpclient5`) | Java 21 compatible; supports unix socket, `tcp://`, and TLS material; **demuxes stdout/stderr frames for you** via `Frame`/`StreamType`, so no hand-rolled 8-byte header parsing. Wrap all calls on `Schedulers.boundedElastic()` — the client is blocking and the app is WebFlux. |
| Docker framing edge case | Handle `Tty=true` containers, whose output is **not** framed | Otherwise those containers produce garbled or dropped lines. |
| Loki client | Spring `WebClient` | Native to WebFlux; TLS verification stays on. |
| Loki API shape | `GET {base}{gatewayPrefix}/{tenant}/loki/api/v1/query_range` with `query`, `start`/`end` (**nanoseconds**), `limit`, `direction` | OpenShift LokiStack gateway paths and tenants differ per cluster → every segment configurable, none hardcoded. |
| Query DSL implementation | Hand-written tokenizer + recursive-descent parser → typed AST → two visitors (in-memory `Predicate`, LogQL plan) | No ANTLR build step; no SpEL/eval/reflection (explicitly forbidden). |
| JSON access | Jackson `JsonPointer` / literal `get("event.correlationId")` | The dotted MDC key is a **literal key**, not a nested path. Hyphenated keys (`X-Correlation-id`, `x-journey-trace-id`) likewise. |
| Masking boundary | A single `MaskingService` applied in the API mapping layer; canonical raw event type is never serializable by the web layer | Enforced by an ArchUnit rule + a Jackson serialization test (see Phase B). |
| Pagination | One model: descending cursor over `(timestamp, stableEventId)`. No offset paging, no second competing control. | Handover §15.7 forbids two models. |
| Counts | One shared `ResultCounts { returned, visible, estimatedTotal?, truncated, limit }` type + fixed copy strings | Prevents contradictory count text (§24.10). |
| Time | Backend: `Instant`, ISO-8601 UTC on the wire. Frontend: one `shared/time` module owns zone math; **exactly one** display-zone→UTC conversion per commit action. | §24.9. |
| Live transport | SSE with `Flux<ServerSentEvent<…>>`, heartbeat comments, `onBackpressureBuffer` with a drop counter, cancellation propagated to the Docker callback | §18. |
| Browser tests | Playwright (Chromium, headless) | Needed for real `getBoundingClientRect()` geometry; Vitest/jsdom cannot verify layout. |
| Zoom emulation | `document.documentElement.style.zoom` in `page.evaluate` for 125% / 200% / high zoom | Reproduces the reported overlap/reflow bugs headlessly. |
| Config | `@ConfigurationProperties` under `logexplorer.*` + `.env.example` with names and harmless defaults only | §6.4. |

---

## 5. The deterministic verification harness (enabler for everything)

Because the corporate Docker daemon and OpenShift are unreachable from the VM, the plan depends on a local harness. Building it early is what makes Phases C, F–K verifiable at all.

**H1 — Demo log generator container.** A tiny image that continuously emits canonical Spring Boot JSON to stdout across several fake services (`gateway`, `accounts-api`, `payments-api`, `notification-worker`), deterministic given a seed. It must emit, on purpose:

- every canonical top-level field and every MDC field listed in handover §5;
- the **literal dotted key** `event.correlationId` on some events and `X-Correlation-id` on others, so correlation precedence is actually exercised;
- events sharing a `x-journey-trace-id` across services and across multiple `traceId`s;
- sensitive fields (`cif`, `UserName`, `CustomerId`, `deviceId`, `deviceIp`) with obviously fake values;
- multiline exceptions with escaped newlines;
- empty `message` values;
- malformed / non-JSON lines;
- an unknown MDC field not in the canonical list;
- stderr as well as stdout;
- occasional bursts, for backpressure and truncation tests.

Fake values only. This is committed to the repo (`tools/demo-log-generator/`) and used by Compose, integration tests, and browser tests.

**H2 — Mock Loki server.** WireMock (or a small WebFlux stub) serving `query_range` fixtures plus 401 / 403 / 429 / timeout / 5xx scenarios, exercising the configurable gateway prefix, tenant, and label keys.

**H3 — Fixture source.** In-process deterministic `LogSource`, dev/test profiles only, clearly labelled, never presented as a production source.

**H4 — Playwright harness.** Runs against the built app + fixture/demo data; reusable helpers: `setViewport(w)`, `setZoom(z)`, `assertTableGeometry(tolerancePx = 2)`, `assertNoHorizontalOverflow()`, screenshot capture into `docs/verification/<phase>/`.

---

## 6. Working agreement (branches, PRs, evidence)

- Branch per phase: `phase/<letter>-<slug>` (e.g. `phase/c-docker-source`).
- Conventional commits; small, reviewable commits within a phase.
- PR per phase via `gh pr create`, body contains: scope, files touched, test commands **actually run** with tail of output, PASS/FAIL/BLOCKED/DEFERRED table, screenshots list, known gaps.
- Verification report committed at `docs/verification/PHASE_<letter>_REPORT.md`.
- Never force-push over review history; never merge a phase with an unexplained FAIL.
- Preserve unrelated user changes; if `git status` is dirty at phase start, stop and report.

---

# 7. Phases

Each phase: **Goal → Scope → Out of scope → Files → Automated tests → Manual/live checks → PASS/FAIL/BLOCKED → Regression → Recovery.**

---

## Phase A — Repository audit and baseline (no feature work)

**Goal.** Replace assumptions with evidence. Produce the state of the repo and a requirement-to-code traceability matrix.

**Scope.**
1. `gh repo clone afawzy70/Log-explorer`; record default branch, `git log --oneline -30`, `git status`, open branches, open PRs.
2. Inventory the tree; identify backend/frontend layout, build files, existing docs, existing tests.
3. Build baseline: `./mvnw -q verify` and `npm ci && npm run build && npm test` (or actual equivalents). Record exact commands and outcomes, including failures. **Do not fix anything yet.**
4. Read every item in handover §30 against actual code.
5. Environment probe: Docker version, Compose plugin version, Java version, Node version, free disk, whether `/var/run/docker.sock` is accessible, whether Playwright deps install.
6. Produce `docs/AUDIT.md`:
   - repo state summary;
   - build/test baseline with real output;
   - the capability matrix (`Capability | Required | Present | Partial | Missing | Broken | Evidence(file:line)`) covering all of handover §34;
   - security assessment: where masking happens today (if anywhere), whether raw events can reach the browser, any `dangerouslySetInnerHTML`, any trust-all TLS, any secrets committed, any logging of search values;
   - architecture assessment vs §3 above;
   - list of contradictions between this plan and repo reality, with proposed plan amendments.
7. Open a PR containing only `docs/AUDIT.md` and, if useful, `CLAUDE.md`.

**Out of scope.** Any behavior change, dependency bump, test fix, or refactor.

**Files.** `docs/AUDIT.md`, `CLAUDE.md`, `REQUIREMENTS_TRACEABILITY.md` (initial fill).

**Automated tests.** None added. Baseline runs recorded.

**Manual checks.** Confirm no secrets in git history (`git log -p | grep -iE 'bearer|token|password'` spot check), confirm `.env.example` contents are harmless.

**PASS.** `docs/AUDIT.md` exists, every §34 item has a determination with file-level evidence or an explicit "absent", contradictions are listed, and baseline build output is recorded verbatim.
**FAIL.** Any §34 item unaccounted for; any determination without evidence; any "assumed present".
**BLOCKED.** Clone or auth fails → report and stop.

**Regression.** N/A.

**Recovery.** Re-run the audit for the unaccounted items only; do not re-litigate the settled ones.

---

## Phase A2 — Deterministic verification harness

*Additive to the handover's suggested structure. Justification: without it, Phases C–K cannot be honestly verified on a VM with no corporate Docker or OpenShift access.*

**Goal.** Make every later phase locally provable.

**Scope.** Build H1 (demo log generator), H2 (mock Loki), H3 (fixture source, dev/test profiles only), H4 (Playwright harness + geometry/overflow helpers + screenshot capture). Wire a `make`/npm/maven entry point for each so later phases invoke one command.

**Out of scope.** Product features; any use of the fixture source outside dev/test profiles.

**Files.** `tools/demo-log-generator/**`, `tools/mock-loki/**`, `backend/.../source/fixture/**`, `frontend/e2e/**`, `frontend/playwright.config.ts`.

**Automated tests.** Generator self-test: emitted corpus contains at least one instance of each required shape (dotted key, hyphenated key, malformed line, empty message, multiline exception, unknown MDC field, stderr line, burst). Mock-Loki contract test.

**Manual checks.** `docker compose --profile demo up` produces log lines; `npx playwright test --list` resolves.

**PASS.** Each of H1–H4 runs from one documented command; generator corpus self-test green.
**FAIL.** Any harness component requires manual hand-holding to run, or the generator lacks a required edge case.
**BLOCKED.** Playwright browser deps cannot install on the VM → report, and propose a container-based Playwright runner as the fix.

**Regression.** Repo build still green.

**Recovery.** Fix only the failing harness component; re-run its self-test.

---

## Phase B — Canonical model, parser, masking, source contract, guardrails

**Goal.** Correct and safe core. Everything downstream depends on this being right.

**Scope.**
1. `CanonicalLogEvent` with the §5.1 mappings, plus preserved `Map<String,Object>` of all original/unknown fields.
2. Correlation precedence: `mdc.X-Correlation-id` → literal `mdc["event.correlationId"]`. Service precedence: top-level `application` → source metadata fallback, **both retained** when they differ.
3. Timestamps: accept offsets, normalize to `Instant`, no double conversion; keep the original string.
4. Malformed lines → raw fallback event (never dropped). One malformed field must not discard the whole event.
5. Empty message preserved; UI fallback text is a frontend concern, not a fabricated backend value.
6. Multiline/escaped-newline exceptions stay one logical event.
7. `MaskingService`: `cif` strongly masked; `CustomerId`, `UserName`, `deviceId` partially masked; `deviceIp` final portion masked (IPv4 and IPv6). Masking applied **before browser serialization**, at a single boundary.
8. Adapters may hold raw values for source-side filtering; raw values must never enter responses, logs, exceptions, `ProblemDetail`, or query explanations.
9. `LogSource` SPI + `LogSourceRegistry` with stable IDs; unknown/disabled source → 404/400 with sanitized ProblemDetail.
10. Guardrails: `start < end`; default limit; configurable max (≤ 5,000); per-source max time range; request timeout; bounded concurrency; cancellation; truthful truncation metadata.
11. `SourceCapabilities` returned from `/api/v1/sources`.

**Out of scope.** Real Docker or Loki I/O (Phases C/D); UI.

**Files.** `core/model/**`, `core/parse/**`, `core/mask/**`, `core/guard/**`, `source/LogSource.java`, `source/LogSourceRegistry.java`, `api/**`, `config/**`.

**Automated tests.**
- Parser table tests for each §5 field, both correlation precedence branches, service precedence, unknown-field preservation, malformed fallback, single-bad-field tolerance, empty message, multiline exception, offset timestamps.
- Masking tests per field, including boundary cases (short values, IPv6, null, empty).
- **ArchUnit rule:** classes in `api.dto` must not expose the raw canonical type; web layer must not reference raw MDC maps directly.
- **Serialization leak test:** serialize a fully populated event through the API mapper and assert none of the five sensitive raw values appear anywhere in the JSON.
- **Log leak test:** capture logs during a search containing sensitive filters and assert none of the raw values appear (including via `toString`, exception messages, ProblemDetail bodies).
- Guardrail tests: invalid range, over-limit, timeout, cancellation, concurrency cap, truncation flag correctness.

**Manual checks.** Hit `/api/v1/sources` with fixture source enabled; confirm capabilities JSON.

**PASS.** All above tests green; leak tests green; guardrails enforce configured limits.
**FAIL.** Any sensitive value reachable in any serialized output or log; any dropped malformed line; any double time conversion.
**BLOCKED.** N/A (no external dependency).

**Regression.** Full backend suite.

**Recovery.** Fix only failing invariants; re-run the exact failed tests plus the leak tests; never relax an assertion to pass.

---

## Phase C — Docker source (local + optional remote)

**Goal.** Read-only, bounded, correctly framed Docker log access with an ergonomic connection model that never requires exposing a daemon.

**Scope.**
1. Connection modes: local socket (default), `tcp://host:port` with **prefilled default port and override**, TLS **optional**; certificate fields only required/shown when TLS is on. No trust-all.
2. Honor `DOCKER_HOST` and standard Docker env config.
3. Discover Compose containers via `com.docker.compose.*` labels; include running and stopped-but-readable; optional project filter; unique service discovery with running/container counts.
4. Read stdout/stderr with since/until/tail; correct framing incl. `Tty=true` containers; merge across containers with deterministic ordering; bounded scans and results; truncation flag.
5. Enrich: source, Compose project, Compose service, container name/ID, stream.
6. **Strictly read-only.** No API path may start/stop/create/remove/exec/mutate. Enforce with a test that the adapter never calls mutating client methods.
7. Diagnostics/health: distinguish daemon unreachable, permission denied, unsupported logging driver, TLS misconfiguration, wrong port — each with actionable sanitized messaging. Explicitly do **not** advise users to expose port 2375 as the fix.
8. Blocking client calls isolated on `boundedElastic`; disconnect cancels the upstream callback.

**Out of scope.** Live tail UI (Phase J does the streaming lifecycle; C provides the follow primitive). Any daemon reconfiguration guidance.

**Files.** `source/docker/**`, `config/DockerProperties.java`, `.env.example`.

**Automated tests.** Adapter unit tests with a mocked Docker client (framing, tty, merge order, truncation, label parsing, stopped containers); read-only enforcement test; connection-mode resolution tests (default port applied, override honored, TLS off ⇒ no cert requirement, TLS on ⇒ verification required); diagnostics mapping tests.

**Manual/live checks.** Against the **local** socket with the demo generator stack running: list services, search, confirm merged deterministic ordering, confirm malformed lines surface as raw events. For remote mode, exercise against a locally published throwaway endpoint if and only if that is possible without changing host/daemon policy; otherwise mark `BLOCKED` with the reason.

**PASS.** Local-socket path verified end to end with real containers; remote mode logic proven by tests; diagnostics correct.
**FAIL.** Any mutating call reachable; framing errors; unbounded reads; remote TLS forced; hardcoded port.
**BLOCKED.** Remote TCP verification impossible in this environment → record as BLOCKED, never PASS (§24.15).

**Regression.** Phase B suite.

**Recovery.** Re-run only the failed adapter tests plus the read-only and framing tests.

---

## Phase D — OpenShift Loki source

**Goal.** A correct, configurable, read-only Loki adapter proven against a mock, with live cluster verification deferred honestly.

**Scope.**
1. Fully configurable: base/gateway URL, gateway prefix, tenant/application path, namespace label key, service label key, limits, timeouts, token location, TLS config. **Nothing dangerously hardcoded.**
2. `query_range` with correct start/end (nanoseconds), direction, limit, timestamp semantics.
3. Safe LogQL selector escaping; push down safe filters; exact post-filtering when pushdown is unsafe or lossy.
4. Normalize streams to canonical events; enrich with namespace/pod/container metadata; merge and sort.
5. Distinguish and sanitize 401 / 403 / 429 / timeout / 5xx.
6. TLS verification stays enabled. Token from env/secret only, never logged.
7. Read-only: no operator/route/RBAC/Loki-config changes anywhere in the codebase or docs.
8. Capability flags reflect reality (e.g. `rawLogQL` config-gated; `liveTail` only if the gateway actually supports tail).

**Out of scope.** Live cluster validation (deferred); cluster asset creation (Phase L).

**Files.** `source/loki/**`, `config/LokiProperties.java`, `tools/mock-loki/**`.

**Automated tests.** Mock-server tests for query construction (prefix/tenant/labels all vary), nanosecond conversion, selector escaping incl. quotes/backslashes/regex metacharacters, pushdown vs post-filter equivalence, each error class, sorting/merging, TLS config validation, token never logged.

**Manual/live checks.** If and only if a real cluster is reachable: a tiny bounded probe — ≤5 minute range, ≤20 results, one authorized namespace/service — with a **sanitized** report containing no raw messages or customer identifiers. Otherwise `DEFERRED BY SCOPE`.

**PASS.** All mock tests green; config surface complete; errors sanitized.
**FAIL.** Any hardcoded prefix/tenant/label key; trust-all TLS; token or raw message in logs/report.
**DEFERRED.** Live cluster check, when unavailable — recorded as DEFERRED, not PASS, and not a release blocker.

**Regression.** Phases B, C.

**Recovery.** Fix failing mock scenarios only; re-run the full mock suite plus the sanitization tests.

---

## Phase E — Query engine

**Goal.** A small deterministic, source-independent query language plus capability-gated raw LogQL.

**Scope.**
1. Tokenizer, recursive-descent parser, typed AST. Operators: `=`, `!=`, `contains`, `and`, `or`, parentheses, quoted strings with safe escaping.
2. Aliases: service, level, message, logger, traceId, spanId, correlationId, journeyId, eventId, errorCode, businessStep, uiIdentifier, device.platform, language, userName, customerId, cif.
3. Semantic validation with precise, **non-leaking** error messages (position + expected token; never echo a sensitive literal).
4. In-memory predicate compiler (Docker path) and LogQL planner (Loki path).
5. Query-plan explanation with sensitive literals redacted.
6. Structured filters are ANDed with the parsed expression.
7. **No** SpEL, `eval`, SQL evaluation, or reflection-based execution — anywhere.
8. Raw LogQL: Loki-only, separate explicit mode, disabled by default, config-enabled, still subject to time/limit/timeout/concurrency guardrails, never advertised for Docker.

**Files.** `core/query/**`, `source/loki/plan/**`.

**Automated tests.** Tokenizer/parser tables (valid + malformed + adversarial input: unbalanced parens, unterminated strings, injection-ish payloads, very deep nesting → bounded depth error); predicate/planner equivalence on the fixture corpus; redaction test asserting sensitive literals never appear in explanations or errors; raw-LogQL gating tests (disabled by default; rejected for Docker; guardrails still applied when enabled).

**Manual checks.** Run several DSL queries against the demo stack and confirm result equivalence between Docker (predicate) and mock-Loki (planner) paths for the same logical query.

**PASS.** Grammar complete, equivalence holds, redaction verified, gating verified.
**FAIL.** Any forbidden evaluation mechanism; any sensitive literal in an explanation or error; unbounded parse.

**Regression.** Phases B–D.

**Recovery.** Fix grammar/planner defects only; re-run parser tables and the equivalence suite.

---

## Phase F — Historical search UX (shell, toolbar, time range)

**Goal.** The professional investigation surface, including the screenshot-driven time-range contract.

**Scope.**
1. **Shell:** one product title (no duplicate "Multi-Source Log Explorer" + "Log Explorer"), active source/environment, compact health state, retry for unhealthy source, optional help/shortcuts. No fabricated branding.
2. **Default toolbar order:** source → service multi-select → time range → severity → universal search → Search → Live (only when capability true) → More filters + active count.
3. **Service selector:** accessible searchable checkbox multi-select — not a native Ctrl/Cmd multi-select. All services, selected count, clear, running/health metadata when available, keyboard navigation, viewport-safe dropdown.
4. **Severity:** default INFO/WARN/ERROR (no TRACE/DEBUG noise); All / Errors only / individual levels; never color-only (icon or text label required).
5. **Universal search:** label "Search messages, errors, users or paste an ID"; defaults to message + error code; detects possible trace/correlation/journey/event IDs and offers a **confirmable** suggestion (never silent classification); Enter and Ctrl/Cmd+Enter run; Escape closes suggestions without destructive clearing; never persisted.
6. **Advanced filters** grouped by user question: Who/customer (user name, customer ID, CIF, device ID, device IP — applied chips show *protected*, never the raw value); Request flow (trace, span, correlation, journey, event); What happened (error code, business step, UI identifier, logger/class, text contains); Client context (device platform, language). **Draft/apply/cancel** semantics — editing never fires queries.
7. **Time range:** presets including **Last 1 day**; zero results offers one-click "Search last 1 day". Custom opens a popover (not a permanently expanded form) prefilled End=now, Start=end−previous preset, 30-minute fallback; Start/End labels; Apply/Cancel. On valid Apply: commit, close immediately, restore focus to the Time Range control, display the **actual interval** (e.g. `13 Aug, 1:39 PM – 2:09 PM`; both dates when they differ) plus zone `Asia/Kuwait (UTC+03:00)`, and mirror it in active filters. Effective interval shown after search. Reopen restores committed values. Cancel/Escape/outside-click closes without mutating. Selecting a preset closes the editor and restores the preset label. Validation distinguishes missing start/end, start ≥ end, future end, max-range violation. **Display zone → UTC conversion happens exactly once.** Editor must not overlap severity; fields stack at narrow widths.
8. Query contents never in the URL; nothing sensitive in localStorage (safe UI prefs only).

**Files.** `features/search/**`, `features/timerange/**`, `shared/time/**`, `shared/ui/**`, `app/**`.

**Automated tests.** Component tests for each control; time-range unit tests for prefill, single conversion, each validation class, reopen-restores-committed, cancel-does-not-mutate, preset-closes-editor; a11y tests (labels, roles, focus order, focus restoration); persistence test asserting no sensitive key ever written to localStorage or URL.

**Browser checks.** Custom-range popover does not overlap severity at 1920/1440/1280/1024/768/390 and at 125%/200%/high zoom; fields stack at narrow widths; no page-level horizontal overflow. Screenshots captured for each.

**PASS.** Every §13/§14 bullet demonstrably satisfied, with screenshots for the geometry/overlap items.
**FAIL.** Generic "Custom range" label after apply; overlap at any tested width/zoom; double conversion; query text in URL; silent ID classification.

**Regression.** Backend suites + frontend unit suite.

**Recovery.** Reproduce → baseline screenshot → inspect DOM/computed layout → smallest fix → regression test → re-verify rendered result (handover §23.8).

---

## Phase G — Results table correctness and truthful states

**Goal.** The seven-column semantic contract and honest counts, verified at pixel geometry.

**Scope.**
1. Exactly seven columns, in order: Time, Level, Service, What happened, User/Customer, Correlation/Trace, Actions.
2. Service = application with Compose-service fallback. **What happened = message only** (never service).
3. Missing values render `—`. **Never omit a cell.**
4. One semantic `<table>`, one `<colgroup>`, `table-layout: fixed`, header and body share geometry. No independent grid/flex layout for header vs body.
5. One event = one `<tr>`; Actions `…` is the seventh cell of the same row. No second action row.
6. Time shows date + time + milliseconds (Last 1 day crosses date boundaries).
7. Message is the largest/flexible column with intentional wrap or ellipsis + accessible expansion.
8. Newest first for normal search; no dropped or duplicated rows.
9. **One** pagination model (bounded cursor). No competing "Load next page" + Prev/Next.
10. Counts kept distinct — total/estimated, returned, visible, page, truncation — using the shared type and fixed copy. No contradictory text.
11. States: loading, error, empty, cancelled, partial/truncated, malformed raw line rendering.
12. Horizontal scroll, when needed, belongs around the table; the page must never overflow horizontally.

**Files.** `features/results/**`, `shared/ui/table/**`.

**Automated tests.** Component tests for column order, `—` placement, single-row invariant, sort order, dedupe, count copy; state rendering tests.

**Browser checks (the gate).** For each visible header and its corresponding cell, compare `getBoundingClientRect().left` and `.width`; **tolerance ≤ 2 CSS px**. Run at 1920/1440/1280/1024/768/390, and at 125%/200% zoom. Also assert no page-level horizontal overflow, and run performance checks at 100 / 1,000 / configured-max events.

**PASS.** Geometry assertions pass at every tested viewport and zoom, with screenshots committed.
**FAIL.** Any geometry assertion failing — the table may **not** be described as fixed (§15.9). Message under Service. Extra action row. Omitted cell. Two pagination controls. Contradictory counts.

**Regression.** Phase F suite.

**Recovery.** Follow §23.8 sequence exactly; add the failing geometry case as a permanent regression test.

---

## Phase H — Event inspector

**Goal.** Explain one event completely and safely.

**Scope.** Right-side panel beside results on wide screens, sheet/overlay on narrow; safe min/max resize; result list stays present; selected row stays identifiable; Previous / Next / Close; accessible focus handling.

Sections:
- **Header:** severity, service, title derived from message/error code. **No invented diagnosis or root cause.**
- **Overview (what/when/where):** full message; local timestamp with ms and named zone; UTC; source; service; Compose project; container/pod/namespace/stream; level; logger; thread; schema version.
- **Actor & client:** masked username, customer ID, CIF, device ID, device IP, device platform, language — labelled *protected/masked*, **no reveal action**.
- **Request flow:** journeyId, correlationId, traceId, spanId, eventId, with find-related-logs, copy (non-sensitive IDs only), and surrounding-context actions.
- **Business/error:** business step, UI identifier, error code, formatted exception (readable multiline).
- **All fields:** searchable key/value view — canonical fields first, unknown fields after, raw JSON behind a further disclosure; **text rendering only**; masked values stay masked.
- **Context:** `Show ±30 seconds`, scoped to service/container/pod where possible, showing the bounded query/time range **before** execution, with breadcrumb back to the original search.

**Files.** `features/inspector/**`, `api` context endpoint.

**Automated tests.** Section rendering with full and sparse events; masked-value tests; copy-action tests asserting sensitive IDs are not copyable; no `dangerouslySetInnerHTML` anywhere (lint rule + test); keyboard open/close/prev/next and focus restoration; context request bounds.

**Browser checks.** Inspector at 1920/1280/768/390; resize bounds; no page overflow; focus visible.

**PASS.** All sections correct, protected data never revealed, keyboard path complete.
**FAIL.** Any reveal affordance for sensitive values; any HTML injection path; fabricated root cause text.

**Regression.** Phases F, G.

**Recovery.** Fix the failing section only; re-run masking and a11y tests.

---

## Phase I — Trace / correlation / journey investigation

**Goal.** The core value proposition: follow a request or journey across services.

**Scope.**
1. Click actions on non-sensitive IDs: Find this trace / correlation / journey / event. **Never** create a raw customer-identifier click-search.
2. Timeline: same active source only; bounded time window; ascending order for flow; services visually distinguished; each entry shows timestamp, service, level, business step, message, trace/span, and event/protocol metadata (incl. JMS event correlation) when available.
3. Supports multiple traces within one journey.
4. States clearly that **timestamp ordering is not guaranteed causality**.
5. Preserves and restores the original search state; handles missing identifier and no-results cleanly.

**Files.** `features/journey/**`, backend correlation query support.

**Automated tests.** Multi-trace journey assembly from the fixture corpus; ordering; service distinction; causality disclaimer present; back-to-original-search restoration; empty/missing-ID states; assertion that no sensitive field produces a click-search action.

**Manual checks.** Against the demo stack: paste a journey ID, confirm cross-service sequence, gaps, business steps, and errors are legible.

**PASS.** Journey and trace investigation work end to end on fixture and demo data with state restoration.
**FAIL.** Causality implied; sensitive click-search present; original search lost.

**Regression.** Phases F–H.

**Recovery.** Fix the failing sub-capability; re-run journey suite plus state-restoration test.

---

## Phase J — Live tail

**Goal.** Bounded, safe, clearly-distinct live mode.

**Scope.**
Backend: SSE; normalize and **mask before emit**; heartbeat; cancellation propagated to the Docker follow callback; connection timeout; max concurrent tails; bounded buffers; backpressure with a dropped-count notice. No tokens or sensitive filter values in the URL. Loki live only if the gateway genuinely supports tail — otherwise capability `false` and a clear unsupported state. **Do not fake it.**

Frontend: Start / Pause / Resume / Stop; follow behavior; visible counts and state; bounded client buffer with **initial displayed cap 1,000 events**; dropped/buffered counts shown; navigating away or unmounting closes the stream. Live mode visually distinct from historical search, and must never imply completeness of historical data.

**Files.** `features/live/**`, `api/live/**`, `source/docker` follow path.

**Automated tests.** Backend: cancellation releases the Docker callback (assert resource closed), heartbeat emitted, buffer bound respected, drop counting accurate, concurrent-tail cap enforced, masking applied on the streaming path. Frontend: lifecycle transitions, buffer cap, dropped counts, unmount closes stream, capability gating hides Live when unsupported.

**Manual checks.** Live tail against the demo generator including a burst; confirm drops are counted and reported rather than silently lost; confirm stop actually terminates the upstream read (verify no lingering Docker log stream).

**PASS.** Lifecycle correct, bounds enforced, masking on stream path, cancellation verified.
**FAIL.** Unbounded buffer or DOM growth; leaked upstream stream; unmasked stream events; Live shown for a source that cannot do it.

**Regression.** Phases B, C, G.

**Recovery.** Fix the failing lifecycle/bound; re-run cancellation and masking stream tests.

---

## Phase K — Portable Docker Compose delivery (first-class)

**Goal.** Someone with Docker and Compose can run the whole thing on another machine from documented commands.

**Scope.**
1. Multi-stage Dockerfile: Vite build → Maven build → JRE runtime; non-root user; no build secrets in layers; production React served by Spring Boot; SPA fallback that does **not** swallow `/api/**` or `/actuator/**`.
2. `docker-compose.yml` with profiles:
   - `demo` — app + demo log generator (default happy path, no host Docker access needed);
   - `docker-socket` — mounts `/var/run/docker.sock` **read-only, behind this explicit profile only**, with a prominent documented privilege warning. Never mounted silently;
   - `loki-mock` — app + mock Loki for offline Loki-path demonstration.
3. `.env.example`: variable names and harmless defaults only (ports, source toggles, remote Docker host/port/TLS flags, Loki URL/prefix/tenant/label keys, limits). No secrets.
4. Health checks, startup ordering, documented ports, volumes, network requirements.
5. `docs/RUN_GUIDE.md` (requirements + exact commands): Docker/Compose version expectations, ports, env vars, optional Docker access configuration, **security consequences of the socket mount**, remote Docker options incl. default port / custom port / optional TLS, OpenShift variables, troubleshooting. Must explicitly say remote Docker TCP exposure is **not** required.
6. Deterministic smoke test script: build → start → health → source discovery → search → UI load → stop → cleanup **limited to this stack** (no global prune).

**Files.** `Dockerfile`, `docker-compose.yml`, `.env.example`, `docs/RUN_GUIDE.md`, `scripts/smoke.sh`.

**Automated tests.** Smoke script runs in CI-like fashion on the VM and asserts each step; image runs as non-root (`id -u` ≠ 0 in container); `/api` and `/actuator` not swallowed by SPA fallback; no secret material in `docker history`.

**Manual checks.** Fresh-clone rehearsal: clone to a clean directory and follow `RUN_GUIDE.md` verbatim, changing nothing. Any step that needs undocumented knowledge is a FAIL.

**PASS.** Fresh-clone rehearsal succeeds using only documented commands; smoke script green; socket mount only under its profile.
**FAIL.** Socket mounted by default; secrets in image or `.env.example`; docs that don't match real commands; cleanup that touches unrelated Docker resources.

**Regression.** Full backend + frontend suites.

**Recovery.** Fix the failing step, then repeat the **entire** fresh-clone rehearsal — partial re-runs don't prove portability.

---

## Phase L — OpenShift deployment assets

**Goal.** Deployable manifests with a safe security posture. Only after local correctness and packaging are proven.

**Scope.** `deploy/openshift/`: Deployment, Service, Route, ConfigMap, ServiceAccount. Non-root; read-only filesystem where practical; resource requests/limits; readiness/liveness probes; Loki configuration via ConfigMap; token/credentials via **Secret references only**; no committed secret; **no cluster-wide role binding**; document (do not apply) the namespace-scoped role binding an administrator may choose to create; TLS verification enabled.

**Files.** `deploy/openshift/**`, `docs/SECURITY_NOTES.md` update.

**Automated tests.** Manifest lint/schema validation; a test asserting no `ClusterRole`/`ClusterRoleBinding` and no literal secret values anywhere under `deploy/`.

**Manual/live checks.** Applying to a real cluster is `DEFERRED BY SCOPE` unless a cluster is genuinely available. Never claim a deployment succeeded that wasn't run.

**PASS.** Manifests valid, posture correct, no cluster-wide RBAC, no secrets.
**DEFERRED.** Live apply.

**Regression.** N/A beyond repo build.

**Recovery.** Fix the failing manifest; re-lint.

---

## Phase M — Final acceptance

**Goal.** Prove the product does the jobs it exists for, and that nothing was quietly dropped.

**Scope.** Execute handover §27 as scripted task-based acceptance, recorded in `docs/UX_ACCEPTANCE_REPORT.md` with screenshots:

1. **What failed recently?** — select service, last 30 minutes, Errors only, run; count/time/service/message identifiable without raw JSON.
2. **What happened for a user/customer?** — More filters, anonymized user/customer input, search; rows and inspector remain masked.
3. **Follow a request** — paste trace/correlation/journey ID, confirm detected field, open timeline, read service sequence, errors, time gaps, business steps.
4. **Explain one event** — select by mouse **and** keyboard; answer what/when/where/who/request-flow; `Show ±30 seconds`; return to original results.
5. **Monitor live logs** — start, pause, resume, follow, stop; verify state, counts, cleanup.
6. **Failure states** — source unavailable, no services, no results, invalid custom time, invalid advanced query, truncated results, malformed raw line.

Plus the full quality gate sweep (§9 below), a security audit pass (no sensitive value in any response, log, URL, or storage; no trust-all TLS; no committed secrets; no `dangerouslySetInnerHTML`), and completion of `REQUIREMENTS_TRACEABILITY.md` with every §34 item marked Done / Deferred-with-reason.

**PASS.** All six tasks pass, all quality gates green, traceability complete with no unexplained gaps.
**FAIL.** Any task requiring undocumented knowledge, any gate failure, any unaccounted §34 item.

**Recovery.** Return to the owning phase; do not patch symptoms at the acceptance layer.

---

# 8. Documentation deliverables

Reconciled or created, and matching **actual** commands, with no secrets or real customer samples:

`docs/AUDIT.md` · `docs/MVP_SPEC.md` · `docs/UX_SPEC.md` · `docs/UX_QA.md` · `docs/MVP_ACCEPTANCE_REPORT.md` · `docs/UX_ACCEPTANCE_REPORT.md` · `docs/INTEGRATION_REPORT.md` · `docs/DEMO_SCRIPT.md` · `docs/SECURITY_NOTES.md` · `docs/RUN_GUIDE.md` · `docs/verification/PHASE_<X>_REPORT.md` · `REQUIREMENTS_TRACEABILITY.md` · `CLAUDE.md`

---

# 9. Quality gate matrix (must all be green at Phase M)

**Backend:** parser · masking · source abstraction · Docker adapter · Loki mock-server · query parser/planner · cancellation & backpressure · leak tests (serialization + logs) · ArchUnit boundary · full regression.

**Frontend:** unit/component · strict TS type-check · production build · accessibility · request/cancellation · source switching · sensitive-persistence restrictions · custom-time · semantic table · inspector · correlation workspace · live lifecycle.

**Browser/visual:** viewports 1920 / 1440 / 1280 / 1024 / 768 / 390; zoom 125% / 200% plus targeted high zoom for the time-control overlap case; table geometry ≤2px header/cell left+width mismatch; no page-level horizontal overflow; performance at 100 / 1,000 / configured-max events.

**Packaging:** fresh-clone rehearsal; smoke script; non-root container; no secrets in image layers.

---

# 10. Risks

| Risk | Mitigation |
|---|---|
| Requirement loss — the handover's stated biggest risk | `REQUIREMENTS_TRACEABILITY.md` is updated every phase; Phase M blocks on unaccounted items. |
| "It compiles" mistaken for "it works" | Geometry, leak, smoke, and task-based acceptance gates. Compilation is never evidence. |
| External unavailability quietly becoming PASS | BLOCKED/DEFERRED taxonomy enforced in `CLAUDE.md`; reports must name the command that could not run. |
| Masking bypass introduced later by a new DTO or a debug log | ArchUnit boundary rule + serialization/log leak tests run in every backend regression. |
| Table regression reappearing after unrelated CSS changes | Geometry assertions are permanent tests, not one-off checks. |
| Blocking Docker client stalling the WebFlux event loop | All Docker calls on `boundedElastic`; add a test asserting no blocking call on the event loop (BlockHound optional). |
| Scope creep from deferred ideas | §11 out-of-scope list is enforced at PR review. |
| Audit contradicts this plan | Phase A explicitly produces plan amendments before any code is written. |

---

# 11. Explicitly out of scope

Corporate SSO / per-user OpenShift OAuth · long-term log storage · SIEM · alerting platform · full APM · modifying or deleting source logs · cross-source query in one request · application database · cluster-wide production permissions · query audit persistence · HA/horizontal scale · PostgreSQL saved/team queries · retention/DR · scheduled queries · distributed tracing backend integration · pseudonymized lookup service · multi-cluster queries · penetration testing / formal production approval · AI root-cause diagnosis · analytics · production identity features.

These do not enter the plan unless Phase A finds them already intentionally implemented, in which case the audit records that fact.

---

# 12. Definition of done

1. Every handover §34 checklist item is Done, or Deferred with a written reason in `REQUIREMENTS_TRACEABILITY.md`.
2. All Phase M acceptance tasks pass with committed evidence.
3. All quality gates in §9 are green.
4. No sensitive value appears in any response, log, error, URL, localStorage, test output, or committed document.
5. A person with Docker and Compose can run the stack on a clean machine using only `docs/RUN_GUIDE.md`.
6. No fabricated PASS. Every BLOCKED or DEFERRED item names the check, the reason, and what would unblock it.
