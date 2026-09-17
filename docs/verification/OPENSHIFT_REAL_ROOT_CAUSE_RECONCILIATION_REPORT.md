# OpenShift connection bug — real root cause and reconciliation

Mission: `OPENSHIFT_REAL_ROOT_CAUSE_RECONCILIATION_AND_PR64_CLOSURE`.
Branch: `fix/openshift-http-response-buffer-lifecycle` (PR #64). Builds on
and **corrects** `docs/verification/OPENSHIFT_HTTP_BUFFER_LIFECYCLE_REPORT.md`
and `docs/verification/OPENSHIFT_HTTP_BUFFER_LIFECYCLE_RECOVERY_2_REPORT.md`
— read this file for the authoritative, real-cluster-confirmed root cause;
the two earlier reports document a real, worthwhile hardening (Reactor Netty
buffer-cancellation-race secondary hardening + permanent diagnostics) that
turned out **not** to be the primary cause of the reported failure.

## Proven real root cause

```
REAL_PROJECTS_RESPONSE_BYTES=~342,197 (real corporate cluster GET /apis/project.openshift.io/v1/projects)
OLD_EFFECTIVE_CODEC_LIMIT_BYTES=262,144 (Spring WebFlux's default spring.codec.max-in-memory-size, 256 KiB — OpenShiftApiClient#build never configured a custom ExchangeStrategies before this reconciliation, so every JSON call used this default)
```

`OpenShiftApiClient#get` (the one shared call underneath `fetchProjects`,
`fetchNamespaces`, `fetchUsername`, `fetchWorkloads`, `fetchPods`,
`fetchWorkloadSelector`) uses `.retrieve().bodyToMono(JsonNode.class)`.
Without a custom `ExchangeStrategies`, Spring WebFlux enforces its own
default 256 KiB in-memory aggregation limit on that decode. A real
corporate cluster's project list — 342,197 bytes — exceeds that default,
throwing `DataBufferLimitException`. **The owner independently confirmed,
on the real corporate cluster**: adding a bounded codec limit alone made
the connection succeed. This is not a hypothesis — it is an observed,
real-environment before/after result, superseding both of this branch's
earlier reports' conclusions.

```
ROOT_CAUSE_CONFIRMED=YES
ROOT_CAUSE=Real OpenShift project-list JSON response (~342,197 bytes) exceeded Spring WebFlux's default 256 KiB in-memory codec aggregation limit, which OpenShiftApiClient never overrode before this reconciliation.
```

### Why the two earlier reports did not find this

Both earlier investigations correctly found and fixed a **real** secondary
hazard: a redundant Reactor-Core `.timeout()` (recovery 1) and Reactor
Netty's own stale-pooled-connection retry racing a still-streaming
response (recovery 2) — both in the exact same exception family
(`DataBufferLimitException` and `io.netty.util.IllegalReferenceCountException`
both extend `IllegalStateException`), which is why the symptom looked
identical and why fixing the wrong thing first was a reasonable, evidence-
following mistake, not a careless one. Neither investigation's local HTTPS
test harness ever sent a response anywhere near 256 KiB before this
reconciliation added `VERY_LARGE_PROJECTS_LIST` — the largest prior test
body (`LARGE_PROJECTS_LIST`, 2000 items) was empirically only ~176 KB,
comfortably under the 256 KiB default, so the actual bug was structurally
unreachable by every test written so far.

## Reconciliation with PR #64 (HEAD before this session: `22c1d69`)

Nothing from `22c1d69` was discarded. All of it was kept and, where the
new evidence changes the story, re-documented honestly:

```
TIMEOUT_HYPOTHESIS_STATUS=VALID_IMPROVEMENT, NOT the real-cluster root cause. Removing the redundant Reactor-Core .timeout() (kept) is correct hardening on its own merits — a single, framework-coordinated HttpClient#responseTimeout is simpler and no worse than two overlapping timeout mechanisms — but the real cluster failure persisted after it, on its own, per the owner's earlier real-environment test.
POOLING_HYPOTHESIS_STATUS=SUPERSEDED. HttpClient.newConnection() (no pooling) was disabled as a plausible, evidence-motivated hardening step during recovery 2, based on a captured stack trace showing Reactor Netty's own stale-pooled-connection-retry machinery in the same exception family. Re-tested this session WITH the proven codec fix in place: 5 repeated runs of the original race-reproduction test show IDENTICAL behavior (an occasional, harmless Operators.onErrorDropped log line, NEVER an application-visible failure) under BOTH HttpClient.create() (pooled) and HttpClient.newConnection() (not pooled). No local evidence ties pooling itself to a real correctness cost once the actual root cause (codec limit) is fixed.
HTTP_CONNECTION_POOLING=PRESERVED
```

`HttpClient.create()` (pooled) is restored in `OpenShiftApiClient#build`.
Full backend suite (125 OpenShift-scoped tests, then the full 1454-test
suite) passes identically with pooling restored — see Tests below.

## JSON response codec limit

```
JSON_RESPONSE_LIMIT_BOUNDED=YES
JSON_RESPONSE_LIMIT_BYTES=16777216 (16 * 1024 * 1024 = 16 MiB)
JSON_RESPONSE_LIMIT_RATIONALE=Bounded (never Integer.MAX_VALUE/unlimited, never a negative "no limit" sentinel). The real observed response was already ~342 KB with a modest project count; a larger corporate cluster (more projects/namespaces, or a workload/pod list for a namespace with many Deployments) could plausibly reach several MB. 16 MiB is ~48x the real observed failure size - generous headroom without being unlimited. Consistent with this codebase's existing bounded-but-generous philosophy for OpenShift response handling (DirectPodLogProperties#maxBytesPerTarget defaults to 2 MB per pod-log target - a smaller bound because each pod-log fetch is a much smaller, more frequent unit of work than one aggregate JSON metadata response). Memory impact is bounded and transient: each OpenShift JSON call is synchronous/request-scoped (decoded, used, then eligible for GC - never cached or retained), and this client's own calls are not fanned out unboundedly (one Connect/refresh/scope action at a time in normal use) - even several concurrent metadata calls each briefly holding up to 16 MiB is an acceptable desktop-app memory footprint, not a pathological one. A response actually exceeding 16 MiB fails safely (DataBufferLimitException -> an honest, specific message) rather than exhausting memory.
```

## Error classification

`DataBufferLimitException` (`extends IllegalStateException`) can surface
in **three** different wrapping shapes, all now handled by one bounded
cause-chain walk (`isDataBufferLimitFailure`, applied to `error` itself at
the very start of `classify()`, before any other branch):

1. **Bare**, at the top level (observed for some decode-failure timings).
2. **Wrapped inside `WebClientRequestException`** (transport-stage
   failures).
3. **Wrapped inside `WebClientResponseException`** — a genuinely new
   finding this session: Spring WebFlux 6.2.x's own error message reads
   *`"200 OK from GET ..., but response failed with cause:
   DataBufferLimitException: Exceeded limit on max bytes to buffer :
   16777216"`* — i.e. the framework itself already knows the real status
   (200) and the real cause, but the PREVIOUS (pre-reconciliation)
   `classify()` code only ever read the status off `WebClientResponseException`
   and produced the misleading `"The cluster returned an unexpected
   response (HTTP 200)."`. This is the single largest, most direct reason
   the OLD message kept appearing even after earlier fixes.

All three now resolve to the same honest message:
`"OpenShift returned a response larger than Log Explorer's configured
buffer limit."` — never mentions "unexpected response" or a status code
(unlike the generic `WebClientResponseException` branch's own message,
which is intentionally left correctly scoped: a genuine 4xx/5xx/other
unusual status still legitimately says "(HTTP <status>)").

## Regression tests

```
OLD_DEFAULT_LIMIT_REPRODUCED=YES — a plain WebClient with NO custom ExchangeStrategies (Spring's own 256 KiB default), hitting the same ~800 KB VERY_LARGE_PROJECTS_LIST mock response, independently and deliberately bypassing OpenShiftApiClient entirely, throws DataBufferLimitException — proves the OLD configuration genuinely fails this way, not just "the new one happens to pass."
DATBUFFER_LIMIT_REGRESSION_TEST=PASS (veryLargeProjectsListOverRealTlsSucceedsWithTheBoundedCodecLimit - the SAME ~800 KB body succeeds through the real, reconciled OpenShiftApiClient)
ABOVE_NEW_LIMIT_TEST=PASS (aResponseLargerThanTheConfiguredJsonLimitFailsSafelyWithAnHonestMessage - a ~18 MB body, deliberately over the 16 MiB bound, fails safely with the new honest message, never "unexpected response (HTTP 200)")
```

New mock scenarios: `VERY_LARGE_PROJECTS_LIST` (~9000 items, ~800 KB —
over the OLD 256 KiB default, well under the NEW 16 MiB bound) and
`OVER_CONFIGURED_JSON_LIMIT` (~9000 heavily-padded items, ~18 MB — over
the NEW bound).

Every pre-existing scenario from both earlier reports remains covered and
passing: 200 valid JSON, 401, 403, 404/namespaces-fallback, 5xx, malformed
JSON, empty body (both valid-empty-list and genuinely-zero-byte), chunked/
large TLS response, timeout behavior (a genuinely hanging server still
times out), proxy behavior (unreachable proxy classified distinctly from
an unreachable cluster), TLS/private CA (every test in this suite runs
over a real self-signed-CA TLS handshake), repeated sequential requests
(10x, cross-feature Live-Tail-cancel-then-discovery 20x).

## Diagnostic logging — preserved, unchanged

Every piece of the permanent diagnostic system added in recovery 2 is
kept exactly as built: `OpenShiftConnectDiagnostics` (connection-attempt
correlation via Reactor `Context`, HTTP-operation correlation, INFO
lifecycle logs, DEBUG reactive-signal logs), the bounded TRACE-gated
per-buffer diagnostics in `LineDecodingSubscriber`/`BoundedBodyCollector`,
and the compact sanitized exception-chain logging on
`OPENSHIFT_CONNECT_FAILED`. Nothing here needed to change for the codec
fix — this reconciliation only touched `build()` (pooling +
`ExchangeStrategies`) and `classify()` (the new `DataBufferLimitException`
branches). `OpenShiftConnectLogSecurityTest`'s 6 scenarios still pass
unchanged.

```
DIAGNOSTIC_LOGGING_PRESERVED=YES
TOKEN_LOGGED=NO (LOG_SECRET_LEAK_TEST re-run, still PASS)
TLS_SECURITY_REDUCED=NO (buildSslContext/CompositeX509TrustManager untouched - never trust-all, never skip verification)
```

## Real-cluster status

```
DIRECT_CONNECTION=CONFIRMED BY OWNER (independently, before this reconciliation session — the owner's own OpenCode-based fix, functionally identical to what is now reconciled into this PR, was validated against the real corporate cluster)
PROJECT_DISCOVERY=CONFIRMED BY OWNER (same validation — Connect succeeded, meaning project/namespace discovery, the exact call that was failing, now works)
OPENSHIFT_SEARCH=NOT INDEPENDENTLY CONFIRMED THIS SESSION — the owner's report covered Connect specifically; a log search against the connected cluster was not separately reported. Recommended as part of final owner validation before merge.
ILLEGAL_REFERENCE_COUNT_EXCEPTION=Not expected to recur (the connection-pool-retry hazard that could theoretically still trigger this exception family is now understood to be a secondary, non-root-cause hazard neither proven necessary to disable nor observed to cause application-visible failures with pooling restored) — not independently re-confirmed on the real cluster this session.
POST_TERMINATION_BUFFER_ERROR=Same status as above — not independently re-confirmed on the real cluster this session with THIS reconciled build specifically (pooling restored + codec fix). The owner's own successful validation used a codec fix but the exact pooling configuration in THAT validated build is not established with certainty this session (see "Why not auto-merge" below).
```

## Why this session does not merge automatically

The mission's own gate (#11): *"If the reconciled implementation
materially differs from the exact build the owner successfully tested, DO
NOT merge before requesting one final owner validation."* The **core fix**
(bounded `ExchangeStrategies`, `MAX_JSON_RESPONSE_BYTES = 16 * 1024 *
1024`, the exact API shape described) is implemented identically to what
the owner validated. The **connection-pooling decision** (`HttpClient.create()`
restored) is this session's own re-evaluation, backed by solid local
evidence but **not** independently re-confirmed against the real cluster
in this exact combination (pooled + codec fix together) — the owner's
validated build's pooling configuration was not stated with certainty in
the evidence provided to this session. Rather than assume the two
configurations are equivalent for the REAL cluster (a real corporate
network's stale-connection behavior is exactly the condition a sandboxed
session cannot reproduce - established fact from the earlier recovery
report), one more real-cluster validation of this EXACT reconciled build
is the responsible final step before merge.

## Tests

Full backend suite: see the final report's `BACKEND_TESTS` field. All
OpenShift-scoped tests (125) plus the 3 new codec-limit regression tests
(128 total in that scope) pass with pooling restored.
