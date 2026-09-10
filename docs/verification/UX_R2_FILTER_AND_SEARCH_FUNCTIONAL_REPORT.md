# UX-R2 — Filter & Search Functional Verification — Report

Using `log-explorer-professional-ux-reviewer` [LERUX-1] and this repository's
own testing/diagnostic practices. The `Skill` tool still reports "Unknown
skill" for this project-local skill — a recurring, real tooling limitation
across every mission this session. Per the skill's own committed fallback
instruction, `SKILL.md` was read directly (again) and its protocol
followed manually: real running app/backend evidence first, five-layer
trace for anything claiming to "work," never a PASS asserted from source
alone.

## Scope

UX-R2 only: (1) prove every supported filter works end-to-end with real
included/excluded evidence, (2) reproduce and fix the owner's repeated-
search/new-Docker-log defect, (3) verify Refresh semantics, (4) verify
stale-request/cursor/boundary behavior, (5) preserve security/performance.
No UX-R3/R4/R5/R6 work is included.

## Method

Real dev-profile backend (`SPRING_PROFILES_ACTIVE=dev`, port 3434) and real
frontend dev server (port 3435). Two sources exercised for real: **Fixture**
(deterministic, the exhaustive per-field matrix) and **real local Docker**
(via a throwaway Docker Compose project created specifically for this
mission's own mandatory freshness test, torn down afterward — never an
unrelated host container). **Loki/OpenShift**: no reachable cluster in this
environment — marked `BLOCKED` for live verification, consistent with
every prior phase's honest treatment of this same constraint (adapter/unit
tests remain the evidence for Loki's own correctness, unaffected by this).

---

## SEARCH_FRESHNESS_DEFECT

```
OWNER_REPRODUCED=YES (real Docker, not Fixture-only)
ROOT_CAUSE=frontend time-range model — a relative preset commits an absolute
  start/end at selection time; every later Search/Refresh reused it unchanged
FIX=recompute the relative window (same preset, same duration, end advanced
  to "now") on every explicit fresh Search/Refresh; never on Load more;
  never for a CUSTOM absolute range
REAL_DOCKER_TEST=PASS
SEARCH_AFTER_NEW_LOG=PASS
REFRESH_AFTER_NEW_LOG=PASS
CURSOR_RESET=PASS (unaffected - a fresh Search never carried a cursor before or after this fix)
RELATIVE_RANGE_RECOMPUTED=PASS
CUSTOM_RANGE_PRESERVED=PASS
```

### Reproduction (before the fix — real Docker, real backend, real UI)

A throwaway Docker Compose project (`uxr2freshness`, one `busybox` service
`uxr2-freshness-svc` tailing a host-mounted file so new lines could be
appended on demand from the host and picked up by the container's own
`stdout`, i.e. real `docker logs` output) was created, started, and later
torn down cleanly (`docker compose ... down` — no other container on the
host touched). A Playwright script drove the real app end to end:

1. Selected the real `local-docker` source, selected the `uxr2-freshness-svc`
   service, selected the **"Last 1 hour"** relative preset explicitly.
2. Search #1 — captured the real wire request:
   ```json
   {"sourceId":"local-docker","start":"2026-09-10T12:13:00.818Z","end":"2026-09-10T13:13:00.818Z","services":["uxr2-freshness-svc"],"levels":["INFO","WARN","ERROR"]}
   ```
3. Emitted a real, unique marker line into the container (`UXR2-FRESHNESS-1789045983291-68573`), independently confirmed present in the real `docker logs` output at `2026-09-10T13:13:03.291Z` — **after** Search #1's committed `end`.
4. Search #2 — same visible criteria, no filter re-selection. Wire request:
   ```json
   {"sourceId":"local-docker","start":"2026-09-10T12:13:00.818Z","end":"2026-09-10T13:13:00.818Z","services":["uxr2-freshness-svc"],"levels":["INFO","WARN","ERROR"]}
   ```
   **Identical `start`/`end` to Search #1.** `MARKER_VISIBLE_IN_TABLE_AFTER_SEARCH=false`. Row count unchanged (3 → 3).
5. Refresh — same result: `REFRESH_BODY` carried the same frozen window; `MARKER_VISIBLE_IN_TABLE_AFTER_REFRESH=false`.

This is the owner's exact reproduction, confirmed end to end with a real
Docker container, real new log lines, and real captured wire requests — not
inferred from source reading.

### Fix verification (after — same script, same real Docker project, re-run)

```
SEARCH_1_BODY end=2026-09-10T13:13:56.727Z
EMITTED_MARKER  (independently confirmed in real docker logs)
SEARCH_2_BODY end=2026-09-10T13:14:00.044Z   <- advanced, not frozen
MARKER_VISIBLE_IN_TABLE_AFTER_SEARCH=true
REFRESH_BODY end=2026-09-10T13:14:02.193Z    <- advanced again
MARKER_VISIBLE_IN_TABLE_AFTER_REFRESH=true
```

Both the Search-triggered and the Refresh-triggered re-run now genuinely
advance the window and surface the new log line. The fix (`useSearchState.ts`
`recomputeRelativeRange`) was deliberately not committed to the permanent
E2E suite — the throwaway Compose project it depends on doesn't exist in
CI (CI's E2E job is Fixture-only, same constraint every prior phase's Docker
work has honestly noted) — but the exact behavior is covered by six fast,
deterministic hook-level tests that need no real Docker:
`frontend/src/app/useSearchState.test.ts`, describe block
`"UX-R2 — search-freshness defect (owner-reported, real-Docker-reproduced)"`:

1. A relative preset's `end` strictly advances between two explicit Search calls.
2. `refresh()` (the same function as Search) advances it identically.
3. A CUSTOM absolute range never auto-advances — repeated Search sends the exact same `start`/`end`.
4. `loadMore` never recomputes mid-pagination — its own request still carries the cursor, and the committed `timeRange` is untouched by it.
5. A fresh Search issued *after* a `loadMore` still advances the relative range and never carries the old cursor forward.
6. An identical explicit repeated Search (custom range, so genuinely identical criteria) still issues a fresh network request — never suppressed as a duplicate.

All six pass; see `FRONTEND_TESTS` below for the full-suite run.

---

## Stale response protection / cursor / boundary behavior

- **Supersession** (pre-existing, unaffected by this fix): `activeRequestRef`/`AbortController` in `useSearchState.ts` — a new `runSearch()` always aborts whatever request is in flight first; a stale response arriving late is a caught `AbortError`, never applied. Covered by the pre-existing `useSearchState.test.ts` test "starting a new search aborts a still-in-flight older one."
- **Identical explicit search is never suppressed**: new test (#6 above) proves two back-to-back identical-criteria Search calls both genuinely reach the network — there is no request-deduplication layer anywhere in this codebase to accidentally short-circuit an explicit user action.
- **Fresh Search vs. pagination**: `runSearch()` never carries a cursor forward (pre-existing behavior, re-confirmed); `loadMore()` is a structurally separate function that only ever adds a cursor, never touches the committed time range (new test #4/#5 above prove this holds under the new recompute logic too).

---

## Exhaustive filter matrix (Fixture source)

`docs/verification/FILTER_FUNCTIONAL_AUDIT.md`'s prior pass (PASS, with real
inclusion/exclusion evidence) already covered: `text`, `traceId`,
`errorCode`, `businessStep` (+ combined with `errorCode`), `customerId`
(sensitive), the guided Query builder, and a 3-field-at-once UI→wire
capture. This pass empirically closes every field that prior audit
explicitly left as "confirmed present in the DTO/EventFilters, not
independently tested" — all 11, against the real running Fixture backend,
real deterministic corpus values (cross-derived from
`FixtureCorpusGenerator.java`'s own formulas and independently confirmed
against real search results, e.g. a returned masked `deviceIp` of
`"10.47.129.***"` matching the raw value computed from the generator's own
formula for that event's index before it was ever used as a filter).

| Filter | Real value used | Included count | All returned events match | Bogus-value excluded count | Sensitive raw value never echoed |
|---|---|---:|:---:|---:|:---:|
| userName | `fixture.user25` | 7 | — | 0 | **yes** (0 occurrences in full response) |
| cif | `FAKE-CIF-1247` | 1 | — | 0 | **yes** |
| deviceId | `DEMO-DEVICE-247` | 1 | — | 0 | **yes** |
| deviceIp | `10.47.129.151` | 1 | — | 0 | **yes** |
| spanId | `fixture-span-000247` | 1 | yes | 0 | n/a (non-sensitive) |
| correlationId | `fixture-corr-000247` | 1 | yes | 0 | n/a |
| journeyId | `fixture-journey-0035` | 4 | yes | 0 | n/a |
| eventId | `fixture-event-000247` | 1 | yes | 0 | n/a |
| uiIdentifier | `screen.transfer.confirm` | 52 | yes | 0 | n/a |
| devicePlatform | `WEB` | 79 | yes | 0 | n/a |
| language | `ar` | 126 | yes | 0 | n/a |

`loggerContains` — genuine case-insensitive substring match confirmed: filter
value `FIXTURE.GATEWAY` (uppercase) matched 56 real events whose actual
`logger` field is lowercase (`com.logexplorer.fixture.gateway.App`) — proves
this is a real substring/case-insensitive operation, not disguised
exact-match.

**Two-field AND combination** (a field not previously exercised together
with a structured filter): `journeyId=fixture-journey-0035` alone returns 4
events across 4 services (`accounts-api`, `gateway`,
`notification-worker`, `payments-api`); adding `services=["accounts-api"]`
narrows to exactly 1 — the real intersection, proving genuine AND semantics
between the service filter and an advanced field together, not just among
advanced fields themselves.

Combined with the prior audit's 7 already-tested fields, this closes **all
17 of 17** documented advanced filter fields plus `text` and the guided
Query builder, with real included-and-excluded evidence for every one —
`docs/verification/FILTER_FUNCTIONAL_AUDIT.md` is updated accordingly (see
that file's own revised "Status" line).

### Source matrix

```
FIXTURE_FILTER_MATRIX=PASS (17/17 advanced fields + text + guided query, exhaustive)
DOCKER_FILTER_MATRIX=PASS for the freshness-defect scenario specifically (service filter,
  real container, real new-log detection); NOT independently re-exercised field-by-field
  against Docker this pass beyond what the freshness test itself required (service
  selection) - EventFilters is the one shared predicate every LogSource adapter routes
  through (confirmed in the prior FILTER_FUNCTIONAL_AUDIT.md pass and unchanged this
  session), so the Fixture-source exhaustive matrix generalizes to Docker's filtering
  logic itself; Docker's own separate push-down/optimization behavior per adapter
  remains untested here, same gap the prior audit already named
LOKI_FILTER_MATRIX=BLOCKED (no reachable OpenShift/Loki cluster in this environment;
  adapter-level/unit test coverage for Loki's own query-plan and LogQL generation is
  unaffected and unchanged - see LokiLogSourceTest, LogQlSelectorBuilderTest,
  LogQlDslPlannerTest)
```

```
FILTERS_PASS=19 (17 advanced fields + text + guided query - all with real included/excluded evidence)
FILTERS_FAIL=0
FILTERS_PARTIAL=0
FILTERS_UNVERIFIED=0 (Fixture); Docker/Loki push-down optimization specifics remain out of this pass's scope, as above
```

---

## WHO/WHAT/WHY/WHERE validation (real scenario, Fixture source)

A single real journey (`journeyId=fixture-journey-0035`) spans four
services with genuinely correlated evidence:

```
accounts-api  INFO  debit-account   ERR_UPSTREAM_5XX  "Customer profile lookup completed"
payments-api  ERROR route-request   ERR_UPSTREAM_5XX  "Payment authorization failed"
gateway       INFO  route-request   ERR_VALIDATION    (empty message)
notification-worker INFO validate-request ERR_UPSTREAM_5XX "Notification worker processed unrecognized event shape"
```

The `payments-api` event carries a real exception chain:

```
java.lang.IllegalStateException: fixture upstream failure in payments-api
	at com.logexplorer.fixture.paymentsapi.Handler.handle(Handler.java:55)
Caused by: java.util.concurrent.TimeoutException: fixture timeout after 5000ms
	... 12 more
```

- **WHO_DID_WHAT_SCENARIO**: `userName` (protected, `fi***24`), `customerId` (protected, `DE***46`), `deviceId`/`deviceIp` (protected), `uiIdentifier=screen.login`, `businessStep=route-request` — all real, all correctly masked, all filterable by their raw value without ever exposing it (proven above).
- **WHAT_IS_HAPPENING_SCENARIO**: `severity=ERROR`, `errorCode=ERR_UPSTREAM_5XX`, `message="Payment authorization failed"` — directly answered.
- **WHY_IS_IT_HAPPENING_SCENARIO**: the real exception chain above names the actual cause (`TimeoutException`, upstream call, 5000ms) — never fabricated, taken verbatim from the event's own `exception` field; the same `journeyId` connects this failure to the upstream `accounts-api` step that preceded it and the downstream `gateway`/`notification-worker` steps affected by it, via the real `/api/v1/logs/journey` endpoint.
- **WHERE_IS_IT_HAPPENING_SCENARIO**: `service=payments-api`, `logger=com.logexplorer.fixture.paymentsapi.App`, `serverHost=fixture-host-1`, `serverIp=172.21.6.228`, `sourceId=fixture` (Fixture source in this run; the identical mechanism applies to `local-docker`'s real Compose project/container metadata, per the freshness test above).

No field was invented — every value above is a real field from a real
response. Where a field is genuinely absent (e.g. the `gateway` event's
empty `message`), the UI's own existing `(empty message)` fallback
(CLAUDE.md §4 "Parsing") already states that honestly rather than fill it
with a guess.

---

## Security

No masking/redaction guarantee was weakened. Every sensitive field tested
this pass (userName, cif, deviceId, deviceIp — customerId already covered
by the prior audit) was independently re-confirmed: filterable by its raw
value, and the raw value never appears anywhere in the response body,
including when it *is* the filter that produced the match. No query or
result is persisted anywhere. Docker/OpenShift/TLS boundaries were not
touched by this slice.

## Performance

No pagination/cursor/limit safeguard was removed or weakened to solve the
freshness defect — the fix only ever adjusts what the *next fresh request's*
own `start`/`end` boundary is; bounded result limits, bounded concurrency,
and cancellation are all unchanged. `loadMore` (the one code path that
reads a large-ish existing result set) is untouched by this fix's own
`useCallback`, confirmed by its dependency array being unaffected.

## Tests

```
FRONTEND_TESTS=PASS (631/631, npx vitest run)
BACKEND_TESTS=NOT_RUN (no backend files were touched by this PR)
E2E_TESTS=PASS (186/186, npx playwright test, clean isolated run; one transient service-list-popover timing flake in `phase-m-ux-acceptance.spec.ts` reproduced as non-reproducing on re-run in isolation, unrelated to any change in this PR — same class of flake already documented in the UX-R1 report)
REAL_DOCKER_TESTS=PASS (search-freshness defect, before/after, both documented above)
TYPECHECK=PASS
PRODUCTION_BUILD=PASS
```

## Remaining UX-R3 through UX-R6

Unchanged from `docs/governance/OWNER_REQUIREMENTS_REGISTER.md` §2: UX-R3
(Settings masking panel, Remote Docker "Connection name" field, Docker
Compose project selector), UX-R4 (row click, truthful sorting), UX-R5
(Inspector position indicator), UX-R6 ("Show surrounding logs"
reachability, final polish). REL-1 (cross-platform distribution, desktop
branding) remains tracked, not started.
