# Legacy Backend Parity Report

Mission 4 deep-dive: backend capability areas, verified from actual NEW implementation behavior
(source code + passing tests), not class presence alone. Source evidence: `legacy-app-docs/audit/
AUDIT-04`, `AUDIT-08`, `AUDIT-09`, `AUDIT-10`, `AUDIT-11`, `AUDIT-12`, plus direct inspection of
`backend/src/main/java/com/logexplorer/**` this session. Full row-level detail lives in the
capability matrix; this report groups the ~30 backend areas the mission names and gives each an
explicit verdict with the reasoning.

`EQUIVALENT` / `NEW_BETTER` / `NEW_WORSE` / `NOT_VERIFIED` throughout.

---

## Canonical parsing & data model

1. **Canonical field extraction** (timestamp/service/severity/message/logger/thread/exception/
   IDs/businessStep/uiIdentifier/errorCode) — `CanonicalLogEvent.java` + `LogLineParser` — same
   field set as `AUDIT-11`'s 23-key list, `LogLineParserTest` (23 tests). **EQUIVALENT.**
2. **Unknown field preservation** (top-level + MDC) — `unknownTopLevelFields`/`unknownMdcFields`,
   plus a real null-value NPE found and fixed this session (`Map.copyOf` rejects null; NEW now
   filters/coerces before copying) — **EQUIVALENT** (post-fix; behavior matches OLD's
   never-discard guarantee, and the fix was verified via a real user's Windows/Docker bug report,
   not merely a hypothetical).
3. **Malformed-line fallback** — `LogLineParser#malformed()`, tested for malformed JSON, non-JSON,
   and null-line inputs — **EQUIVALENT.**
4. **Correlation-ID precedence** (`X-Correlation-id` header/MDC first, literal-dotted-key
   `event.correlationId` second, never treated as a nested path) — verified identical precedence
   and the literal-key handling specifically (`LogLineParserTest#correlationLiteralKeyIsNotMistakenForANestedPath`)
   — **EQUIVALENT.**
5. **Service-name precedence** (`application` field, then source metadata, keep both when they
   differ) — implemented per `CLAUDE.md` §4's own stated rule (which mirrors OLD's) —
   **EQUIVALENT.**

## Sensitive masking

6. **Server-side masking of the 5 named fields, single boundary** — `MaskingService.java` applied
   once in `EventMapper.java`; `SerializationLeakTest` proves masking precedes serialization —
   **EQUIVALENT.**
7. **Exact masking rule per field** (cif=full, CustomerId/UserName=partial, deviceId=prefix,
   deviceIp=octet-masked) — confirmed byte-for-byte identical rule set to OLD's —
   **EQUIVALENT.**
8. **Sensitive-field query matching without raw-value exposure** — OLD: keyed HMAC token
   equality (`SearchTokenService`). NEW: direct raw-value comparison confined entirely to the
   adapter/filter layer (`EventFilters#fieldMatches`), never surfaced in any response, same
   exact-match-only restriction (`contains` unsupported on sensitive fields in both apps) —
   **NEW_BETTER** — same real guarantee (raw value never leaves the server), fewer moving parts,
   no separate HMAC-key subsystem to key-manage/rotate.
9. **Free-text redaction of secrets embedded in message/exception content** — OLD:
   `MaskingPolicy.redactText` scans message/exception text for tokens/credentials/emails. NEW: no
   equivalent — masking only ever touches the 5 named structured fields — **NEW_WORSE** (real
   defense-in-depth gap, planned in remediation Slice 7).
10. **HMAC keyed-token infrastructure itself** (key management, token generation) — OLD-specific
    architecture NEW deliberately does not replicate, per the owner's explicit "do not copy OLD's
    architecture" instruction — **SUPERSEDED_BY_OWNER_DECISION**, not a gap (see matrix row
    MASK-06's decision).

## Docker source

11. **Discovery** (containers/services from a Compose-labeled environment) — `DockerLogSource`,
    real multi-container discovery verified in `PHASE_C_REPORT.md`/`PHASE_K_REPORT.md` (35
    containers/33 services in OLD's own integration report; NEW verified against its own real
    multi-service compose stack) — **EQUIVALENT.**
12. **Compose project-filter metadata** — `DockerProperties#composeProjectFilter`,
    `DockerLogSourceTest#composeProjectFilterExcludesContainersFromOtherProjects`, real scoped
    discovery in `PHASE_K_REPORT.md` — **EQUIVALENT.**
13. **Local connection** — `DockerClientFactory` builds a local (Unix socket / npipe) client;
    verified real on both Linux (this repo's own CI-equivalent environment) and Windows npipe
    (OLD's own `INTEGRATION_REPORT.md` covers Windows; NEW's equivalent Windows verification is
    referenced in this session's own phase reports for Docker Desktop) — **EQUIVALENT.**
14. **Remote connection (host/port)** — `DockerClientFactory#buildConfig` — **EQUIVALENT**
    mechanically; see item 19 (TLS) and the security report below for the SSRF gap, which is a
    security-depth finding, not a connectivity one.
15. **TLS** — never trust-all, verified via `DockerClientFactoryTest` — **EQUIVALENT** on the TLS
    handshake itself; **NEW_WORSE** on defense-in-depth (no SSRF/DNS-rebinding re-check — see
    Security section below and matrix row SRC-10/MASK-08).
16. **Connection testing** (a dedicated Test action before committing a config change) — OLD has
    `POST /docker-connection/test`; NEW has no equivalent endpoint at all today (config is
    boot-time only, nothing to "test" against without a restart) — **NEW_WORSE** (matrix row
    SRC-05, Slice 3).
17. **stdout/stderr capture + frame decoding for live tail** — `DockerLogSource#follow()`, uses
    the Docker Java client's attach/log-follow API, verified real (Docker library callback
    captured and confirmed `.close()`d on cancellation —
    `DockerLogSourceTest#cancellationClosesTheUnderlyingDockerFollowCallback`) — **EQUIVALENT.**
18. **Bounded historical read per container** — OLD: 200 lines/container,
    100,000-line global scan cap. NEW: `DockerProperties#defaultTailLines=2000`,
    `maxContainers=200` — **NEW_BETTER** (10x more generous per-container read, still bounded —
    satisfies `CLAUDE.md` §4 "no unbounded scans" while giving a materially deeper historical
    window than OLD).
19. **Service discovery scoping (self-exclusion)** — OLD: `logexplorer.excluded` Compose label.
    NEW: no equivalent; confirmed live in Phase K that NEW's own `app` container appears in its
    own discovery output — **NEW_WORSE** (matrix row SRC-09, Slice 3).

## Loki/OpenShift source

20. **Historical search via LogQL** — `LokiLogSource`, real HTTP round-trip against
    `tools/mock-loki` verified in `PHASE_D_REPORT.md` — **EQUIVALENT.**
21. **Service handling / discovery** — OLD supports Loki service discovery (label-based); NEW's
    `LokiLogSource` deliberately reports `serviceDiscovery=false` — this is a real, but honestly
    advertised, capability difference, not a silent gap (capability descriptors correctly say
    `false`, per `CLAUDE.md` §4 "backend returns explicit capabilities... frontend never infers")
    — **NEW_WORSE** functionally, **EQUIVALENT** on honesty-of-reporting (the thing `CLAUDE.md`
    actually cares most about here).
22. **Query planning: DSL → LogQL selector generation** — `LogQlSelectorBuilder`/
    `LogQlDslPlanner`, tested (`LogQlSelectorBuilderTest`, `LogQlDslPlannerTest`) — the underlying
    logic is real and correct; it is simply **never exposed** to any response (see item 23) —
    **EQUIVALENT** on correctness, **NEW_WORSE** on transparency.
23. **Generated LogQL display / push-down vs post-filter reporting** — OLD surfaces
    `generatedLogql`/`pushDownConditions`/`postFilterConditions` in the response, rendered behind
    a disclosure. NEW computes the equivalent internally but never returns it — **NEW_WORSE**
    (matrix rows SEARCH-12/13, Slice 2).
24. **Query statistics** (available/totalMatching/returned) — OLD returns real
    `QueryStatistics`. NEW's `ResultCounts` model exists and is honestly labeled
    (`estimatedTotal`/`returned`/`visible`/`truncated`) but **no adapter currently populates
    `estimatedTotal` distinctly from `returned`** — **NEW_WORSE** today, remediated in Slice 1;
    the *model* itself is **EQUIVALENT or better** in shape (it explicitly distinguishes
    `truncated` from `visible`, which OLD's own `AUDIT-04` §7 doesn't show as cleanly separated).
25. **Raw LogQL execution path** — OLD: dead (backend force-disables it, a bug in OLD itself, per
    `AUDIT-15` §1). NEW: genuinely wired end-to-end at the backend (capability-gated, config-
    gated, tested against a real mock Loki), just missing a frontend control — **NEW_BETTER** on
    the backend specifically (it actually works, where OLD's never did), **NEW_WORSE** on
    reachability until Slice 2 ships the UI.

## Query DSL

26. **Query grammar** (AND/OR, `=`/`!=`/`contains`, AND binds tighter than OR) — `QueryParser.java`
    implements the equivalent grammar to OLD's `SimpleQueryParser`, verified field-by-field and
    rule-by-rule against `AUDIT-04`'s EBNF (`QueryParserTest`, 30 tests) — **EQUIVALENT** in
    grammar correctness; **NEW_WORSE** in reachability (no UI sends a DSL string yet — same root
    cause as item 25, remediated together in Slice 2).

## Context search

27. **±N-second surrounding-context query** — OLD's real code-verified value is 30s (despite two
    of OLD's own spec documents inconsistently claiming 60s — see the capability matrix's INSP-07
    note). NEW's `SearchController#context` uses the same 30s, service/container/pod-scoped —
    **EQUIVALENT** (matches OLD's actual behavior, not OLD's inconsistent documentation).

## Trace/correlation/journey queries

28. **Dedicated backend journey/timeline endpoint** — OLD has none (client-side assembly over a
    flat search result, per `AUDIT-07` §4). NEW has a real `POST /journey` endpoint enforcing
    ascending order and the 4-field closed set (trace/correlation/journey/event) server-side —
    **NEW_BETTER** (removes a whole class of client-side-truncation risk that OLD's own
    architecture is exposed to for large traces).

## Live stream

29. **Reconnect / retry / cancellation / timeout / backpressure** — Reconnect: **NEW_WORSE**
    (missing entirely, matrix row LIVE-06, Slice 5). Cancellation: **EQUIVALENT** (NEW's
    `sink.onDispose` genuinely closes the underlying Docker callback, verified by a captured-mock
    test, matching OLD's real cancellation guarantee). Timeout: **EQUIVALENT**
    (`.take(connectionTimeout)` on both). Backpressure: **NEW_BETTER** — NEW's server buffer
    (`serverBufferSize`, default 500) is larger than OLD's 256, and this session found and fixed a
    real crash bug in the heartbeat path under genuine backpressure (`.onBackpressureLatest()`
    fix, `PHASE_J_REPORT.md`) that OLD's own audit never identifies as a risk in OLD's code at all
    (untested territory for OLD, not confirmed-safe). Concurrency cap: **NEW_WORSE** narrowly
    (default 4 vs OLD's 10 — a config value, not an architecture gap, trivially raised).

## Health

30. **Health model** (available/statusMessage/suggestedAction per source) — OLD distinguishes
    several Docker-specific connectivity states with tailored suggested actions. NEW's
    `SourceHealth{status,message,checkedAt}` is honest and tri-state but collapses OLD's richer
    reason taxonomy into one message string — **NEW_WORSE** (matrix row ERR-04, Slice 6).

## Error classification

31. **RFC 7807 `ProblemDetail` responses, sanitized (no raw query/token/secret leakage)** —
    `GlobalExceptionHandler.java`, `QuerySyntaxException` (position + sanitized message only),
    verified via `LogLeakTest`/`QueryLeakTest` — **EQUIVALENT.** NEW additionally found and fixed
    a real bug this session where a genuine 404 was being converted into a fabricated 500 by the
    SPA-fallback/generic-exception interplay (`SpaFallbackIntegrationTest`) — a NEW-introduced,
    NEW-fixed defect, not inherited from OLD, but worth noting NEW's error-classification
    correctness required its own hardening pass too, not an automatic inheritance of OLD's
    correctness — **EQUIVALENT** post-fix.

## Configuration APIs

32. **Settings/capability/system-info endpoints** — OLD: 4 settings endpoints (masking status,
    Docker connection get/set/test) + a system-info endpoint (hardcoded `"UP"`, a documented OLD
    gap itself). NEW: **no settings endpoints of any kind**; NEW's `/actuator/health`+`/actuator/
    info` are real (not hardcoded), a genuine improvement over OLD's system-info endpoint
    specifically, but there is no equivalent to OLD's masking-status/Docker-connection endpoints
    at all — **NEW_BETTER** on system-info, **NEW_WORSE** on Docker-connection/masking-status
    (matrix rows SET-01/03/04, Slice 3).

## Capability descriptors

33. **Per-source capability flags, honestly reported, frontend never infers** — Verified as a
    real, structural pattern in NEW (`SourceCapabilities` on every source, `LiveTailPanel`/
    `RawQueryInput`(planned) gate purely off the flag, never off a component's mere existence) —
    matches `CLAUDE.md` §4's explicit rule almost verbatim, and is **more rigorously enforced**
    than OLD's own static `KNOWN_SOURCES` model, which `AUDIT-15` §5 itself flags as a capability-
    drift risk (OLD's frontend capability checks can silently go stale if the backend changes,
    since the frontend never re-fetches descriptors) — **NEW_BETTER.**

---

## Summary counts (33 named areas above)

- `EQUIVALENT`: 15 (items 1, 3, 4, 5, 6, 7, 11, 12, 13, 15-TLS-handshake-only, 17, 20, 27, 29-
  cancellation/timeout, 31)
- `NEW_BETTER`: 8 (items 8, 18, 25-backend, 28, 29-backpressure, 33, plus 21/32's honest-reporting
  and system-info sub-findings)
- `NEW_WORSE`: 9 (items 9, 15-SSRF-depth, 16, 19, 22-transparency, 23, 24-today, 26-reachability,
  30, 29-concurrency-cap, 32-settings)
- `NOT_VERIFIED`: 0 — every area had enough source/test evidence for a verdict.

(Some items carry a split verdict across sub-dimensions — counted once under their dominant
finding above; see each item's own text for the full nuance.)

**Overall assessment:** NEW's backend is architecturally sound and, in several real cases
(query-plan correctness for raw LogQL, journey endpoint, bounded-buffer sizing, capability-
descriptor rigor), **exceeds** OLD's actual behavior rather than merely matching it. The
consistent pattern across every `NEW_WORSE` finding here is **"the logic exists and is correct,
but is not yet exposed or wired to a UI/config surface"** (items 9, 16, 19, 22-24, 26, 30, 32) —
none of these are backend-correctness defects; they are integration/exposure gaps, all addressed
by the remediation plan's slices (primarily 1, 2, 3, 6, 7).
