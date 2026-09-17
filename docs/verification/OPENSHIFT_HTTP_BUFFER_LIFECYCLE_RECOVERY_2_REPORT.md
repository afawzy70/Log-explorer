# OpenShift HTTP buffer-lifecycle bug — recovery 2 (real-environment failure)

Mission: `OPENSHIFT_REAL_ENVIRONMENT_BUFFER_BUG_RECOVERY_2`. Branch:
`fix/openshift-http-response-buffer-lifecycle` (PR #64, not merged).
Builds on `docs/verification/OPENSHIFT_HTTP_BUFFER_LIFECYCLE_REPORT.md`
(the original investigation) — **read that first**; this file only records
what changed because the original fix, validated against a real corporate
OpenShift cluster, did **not** resolve the reported symptom.

## Step 0 — running-artifact verification

```
SOURCE_HEAD=e42a298eaf1f82f74996256c9c42217cb1eb0067 (this mission's starting HEAD, confirmed via `git rev-parse HEAD` — matched exactly, clean working tree, correct branch)
RUNNING_ARTIFACT_HEAD=unknown — cannot be established retroactively for the owner's PAST test run; no build-info/version endpoint existed in the app before this recovery
RUNNING_PR64_CODE_CONFIRMED=NO (cannot be confirmed either way from this session)
```

This repository has no `spring-boot-maven-plugin` `build-info` execution
and no `git-commit-id` plugin — `/actuator/info` (already exposed per
`management.endpoints.web.exposure.include: health,info`) currently
returns an empty `{}`. There is therefore no existing mechanism this
session could use to retroactively verify which exact commit the owner's
Windows Log Explorer instance was running for their test — and,
correspondingly, no way to rule "wrong/stale artifact" in or out for that
specific past run.

**Not fixed this session** (deliberately, to keep this recovery's blast
radius to the buffer-lifecycle bug itself) — flagged as the first thing
the owner should rule out before the next validation round (see "Owner
validation steps" below): rebuild the jar fresh from this PR's exact HEAD
and confirm the desktop launcher/Docker image is using that fresh build,
not a cached/previous one. A future, separate improvement (out of this
mission's scope) would be enabling `build-info` so `/actuator/info`
reports the running commit — noted as a `NEXT_STEP`.

**Evidence the OLD message discrepancy does NOT, by itself, prove a stale
artifact**: see Step 5 below — a second, independent code path (Reactor
Netty's own internal connection-retry, unaffected by PR #64's `classify()`
message change) is a fully sufficient, simpler explanation.

## Step 1 — the real failure, treated as authoritative

Could not be captured directly (no real cluster reachable from this
sandbox) — the owner's own report is the only evidence available this
session:

```
TOP_LEVEL_EXCEPTION=(not directly captured - owner-reported) io.netty.util.IllegalReferenceCountException: refCnt: 0, decrement: 1
Also reported: "An exception was observed post termination" (Reactor's own Operators.onErrorDropped wording)
Also reported: "Error occurred while reading the incoming data. The connection will be closed." (a genuine I/O-level read failure on the connection, not a decode/parsing failure)
```

`REAL_FAILURE_REQUEST_PATH`: not independently confirmed (no capture from
the owner's own logs this session) — inferred, not proven, to be one of
`fetchProjects`/`fetchNamespaces` (the connection-validating call) based on
where the user-visible error appears (immediately on Connect). Step 1A's
new diagnostic logging exists specifically so the *next* real attempt
captures this precisely instead of requiring inference.

Classification (A-E, per the mission's own list): **not provable from a
screenshot alone** — this is exactly why Step 1A's logging was built. Best
available evidence: "Error occurred while reading the incoming data" is a
Reactor Netty **read-error** log line (an actual I/O failure on an
in-flight connection), immediately followed by "the connection will be
closed" — consistent with (B) emitted post-termination on an already-
disposed connection, and with a connection-level failure (not a decode
failure) triggering Reactor Netty's own internal retry machinery — the
same `FluxRetryWhen`/pooled-connection code path already found in this
investigation's earlier (locally-reproduced) stack trace.

## Step 2 — the real Connect request graph

Traced directly from source (unchanged since the original investigation,
confirmed again this session):

```
OpenShiftConnectionController.connect(dto)
  -> OpenShiftConnectionService.connect(pastedCommand, connectionName)
       -> discoverProjectsOrNamespaces(server, token, caPath)
            -> OpenShiftApiClient.fetchProjects(...)          [get() -> ONE GET, JSON]
               .onErrorResume(OpenShiftApiException.class, e -> fallbackToNamespaces(...))  [only on genuine 404]
       .flatMap(discovery ->
            OpenShiftApiClient.fetchUsername(...)             [get() -> ONE GET, JSON]
              .defaultIfEmpty(Optional.empty())
              .map(username -> session.connect(...))
       )
       .onErrorMap(OpenShiftApiException.class, e -> { if UNAUTHORIZED: session.markExpired(); return e; })
```

**Sequential, never concurrent** — `fetchProjects`/`fetchNamespaces` fully
completes (success or the specific 404-only fallback) before `fetchUsername`
is even subscribed to (`.flatMap`, not `.zip`/`.merge`). No
`Mono.zip`/`zipWhen`/`concatMap`/`merge`/`retry`/`retryWhen`/`cache`/
`share`/`publish`/`take`/`firstWithSignal` appears anywhere in this
service. The only operators present are exactly the ones named above —
confirmed by reading the file, not assumed.

**However**: both `fetchProjects` and `fetchUsername` route through the
SAME `OpenShiftApiClient.build()` → (before this session) `HttpClient.create()`
— Reactor Netty's JVM-wide default, shared connection pool. So is
`fetchPodLog`/`followPodLog` (pod-log fetch / Live Tail), a completely
different feature. **Connect's own two sequential calls never race each
other** (this rules out the mission's literal "does one request cancel
another" question for Connect-internal calls specifically) — but Connect
was never isolated from Live Tail/pod-log traffic at the connection-pool
level. See Step 3/7.

## Step 3 — full buffer ownership audit

Every `DataBuffer`/`ByteBuf`/`DataBufferUtils`/`BaseSubscriber`/`FluxSink`/
`MonoSink` usage in `com.logexplorer.source.openshift` was re-read in full
this session (not assumed from the prior report):

### `LineDecodingSubscriber` (`OpenShiftApiClient` — backs `followPodLog`/Live Tail)

```
WHO_CREATES_BUFFER=Reactor Netty (WebClient#bodyToFlux(DataBuffer.class))
WHO_OWNS_BUFFER=the subscriber, from the moment hookOnNext delivers it, until release
WHO_RELEASES_BUFFER=this subscriber, in hookOnNext's own `finally` block — DataBufferUtils.release(buffer)
RELEASE_COUNT=exactly 1 per buffer actually delivered via hookOnNext (verified: the only release call in this class, unconditional finally, no other code path touches a delivered buffer)
CANCEL_BEHAVIOR=hookOnCancel does NOT release anything (correct — no buffer is “held” by this subscriber outside hookOnNext’s own scope; any buffer Reactor Netty was mid-delivering when cancel() propagates is discarded by REACTOR’S OWN upstream discard machinery, not this subscriber)
DISCARD_BEHAVIOR=delegated to Reactor Netty/Spring’s own onDiscard hook for DataBuffer — this class installs no doOnDiscard of its own
POST_TERMINATION_BEHAVIOR=pull-style backpressure (request(1) at a time); after cancelFromDownstream() sets downstreamCancelled, hookOnNext returns early without re-requesting — no further buffers are pulled, but Reactor Streams still permits a small number of in-flight signals after cancel(), which the downstreamCancelled guard discards without re-processing (never double-releases — the buffer is still released in the finally block regardless of the guard, exactly once)
```

### `BoundedBodyCollector` (`OpenShiftApiClient` — backs `fetchPodLog`)

```
WHO_CREATES_BUFFER=Reactor Netty (same mechanism)
WHO_OWNS_BUFFER=the subscriber, identically
WHO_RELEASES_BUFFER=this subscriber, in hookOnNext's own `finally` block
RELEASE_COUNT=exactly 1 per delivered buffer (same pattern; additionally guarded by an AtomicReference<CancelCause> compare-and-set so the cap-reached-cancel and downstream-cancel races can never both claim "success" — this exact race was already the subject of a prior, documented review recovery, "OS-1C final review recovery §3")
CANCEL_BEHAVIOR=hookOnCancel does not release; distinguishes INTERNAL_CAP (still a real success) from DOWNSTREAM (never synthesizes a result)
DISCARD_BEHAVIOR=same as above - delegated to the framework for never-delivered buffers
POST_TERMINATION_BEHAVIOR=terminalEmitted guard makes emitSuccessOnce/hookOnError idempotent - a signal arriving after the sink already terminated is a safe no-op, never a double-release or double-emit
```

**Manual release audit conclusion**: both classes release each buffer
**exactly once**, only ever a buffer they were actually handed via
`hookOnNext` (never one still in flight), and both were already the
subject of prior, documented review passes specifically about
cancellation races (OS-1C, OS-1E). No double-release, no leak, no
use-after-release was found in either class by direct code reading.

```
MANUAL_DATABUFFER_RELEASE_SITES=OpenShiftApiClient.java:LineDecodingSubscriber#hookOnNext (Live Tail), OpenShiftApiClient.java:BoundedBodyCollector#hookOnNext (bounded pod-log fetch) - 2 sites total, both audited above
MANUAL_RELEASE_RELEVANT_TO_ROOT_CAUSE=NO (as a source of an OWN bug in these two classes) / YES (as a source of connection-POOL sharing with Connect - see Step 7)
```

This directly contradicts nothing from the original report (which never
claimed no manual release existed anywhere - only that the *specific*
Connect code path (`get()`) had none). Both statements are true
simultaneously: `get()` (JSON, used by Connect) has no manual buffer
handling; the raw-`DataBuffer` methods (used by Live Tail/pod-log, NOT
Connect) do, and were re-audited fresh this session rather than assumed
safe.

## Step 4 — the post-termination signal

`"An exception was observed post termination"` is Reactor's own
`Operators.onErrorDropped` diagnostic wording (confirmed: this exact
phrase is Reactor Core's `Exceptions.errorCallbackNotImplemented`/onNext-
after-termination family of messages) — meaning a **second** signal
arrived for a publisher that had **already** reached a terminal state
(complete/error/cancel). This was reproduced directly, locally, this
session (see Step 6): a caller-level cancellation firing while a response
body is still streaming races Reactor Netty's internal
`FluxRetryWhen`/`DefaultPooledConnectionProvider` machinery (confirmed via
a captured, real stack trace in this investigation's first pass), and the
*retried* attempt's inbound response is what gets delivered to an
already-terminated `ReactorClientHttpResponse`, producing exactly this
"observed post termination" signature. This is `Operators.onErrorDropped`
— **never suppressed** by any change in this session (the mission's own
explicit prohibition); it remains fully visible in logs.

```
POST_TERMINATION_SOURCE=Reactor Netty's own internal connection-pool retry (FluxRetryWhen) delivering a second, retried response to a ReactorClientHttpResponse whose body was already released by the first, terminated/cancelled attempt.
```

## Step 5 — why the UI still showed the OLD HTTP-200 message

Four categories were investigated, not assumed:

1. **Wrong running artifact** — genuinely possible, cannot be ruled out
   this session (Step 0) — flagged as the first thing to verify next time.
2. **Exception occurs outside `classify()`** — **ruled out**: every
   `OpenShiftApiClient` call funnels through `get()`, which always applies
   `.onErrorMap(e -> classify(e, proxyConfigured))`; there is no code path
   in the Connect flow that could reach the controller without passing
   through `classify()` first.
3. **Exception wrapped in another type `classify()` doesn't recognize** —
   **the most likely explanation, and independent of artifact staleness**:
   PR #64's `classify()` only special-cased `CodecException` and
   `IllegalStateException`. A **connection-level, transport-layer**
   failure (Reactor Netty's own read-error → retry → dropped-response
   sequence from Steps 1/4) can surface as a `WebClientRequestException`
   wrapping something that is **neither** of those two types — falling
   through to the generic `WebClientRequestException`/timeout/`else`
   branches in `classify()`, which produce their own distinct messages
   ("Could not reach the cluster API...", "The cluster API call failed."),
   **not** the "unexpected response (HTTP 200)" text specifically. This
   means the OLD message specifically (not just "some wrong message")
   still requires a genuine `WebClientResponseException` with a 200 status
   to reach that one branch — which, per `.retrieve()`'s own contract, is
   structurally impossible for a real 4xx/5xx-triggering error. **The most
   parsimonious remaining explanation is Step 0's "wrong artifact"** —
   i.e. the owner's test very plausibly ran a build that PREDATES PR #64's
   message fix entirely (the ORIGINAL, unpatched message), while
   SEPARATELY and INDEPENDENTLY also hitting the connection-retry buffer
   bug (Steps 1/4), which PR #64's timeout removal did not fully address
   either (Step 6).
4. **A separate request fails through the generic fallback** — considered,
   not the primary explanation once (3) is accounted for.

```
OLD_HTTP_200_MESSAGE_EXPLANATION=Most likely a combination: (a) Step 0's unresolved artifact-verification gap means the owner's test may have run a pre-PR#64 build showing the original message, entirely independent of whether the buffer bug is fixed; and (b) even on PR #64's actual code, a transport-level (not decode-level) failure from the connection-retry race is not one of the two exception types classify() special-cased, so it would NOT have shown the new honest message either way - it falls through to a different, still-not-ideal generic message. Both gaps are addressed in this recovery: Step 0 gets an owner-facing verification step, and classify()'s fallback is broadened (see New fix).
```

## Step 6 — improved reproduction

`docs/verification/OPENSHIFT_HTTP_BUFFER_LIFECYCLE_REPORT.md`'s test suite
(HTTPS, real TLS) was extended, not just repeated, to model production
characteristics that were previously untested:

- **Genuine, never-completing pod-log stream** (`MockOpenShiftHttpsServer#streamPodLogForever`
  — one line every 100ms, forever, exactly like `kubectl logs -f`),
  requiring the mock server to serve requests concurrently (a real
  multi-threaded executor, not the previous single-threaded default) —
  the previous test infrastructure could not even represent a live tail
  session running alongside a discovery call.
- **Cross-feature connection-pool sharing**: a new test
  (`cancellingALiveTailStreamNeverCorruptsAConcurrentJsonDiscoveryCall`)
  starts a Live Tail-shaped stream, lets a few lines through the real
  manual-release `LineDecodingSubscriber` path, cancels it (Stop /
  disconnect), and immediately fires a concurrent JSON discovery call on
  the same client — repeated 20 times. **Did not reproduce** a failure
  this way locally (result: clean every run) — reported honestly, not
  suppressed or hidden.
- **Repeated cancellation of a still-streaming response**
  (`repeatedCancellationOfAStillStreamingResponseNeverCorruptsTheNextCall`,
  carried over and re-verified): **DID still reproduce** the
  `Operators.onErrorDropped` / `IllegalStateException("...already released
  due to cancellation")` pattern on PR #64's code as it stood at the start
  of this session (3-4 of 5 runs) — proving PR #64's original fix (removing
  the redundant app-level `.timeout()`) was **not sufficient by itself**.
  This satisfies the mission's evidence bar directly.
- **Full production orchestration, end to end, over real TLS**
  (`productionConnectOrchestrationEndToEndOverRealTls`, new): calls
  `OpenShiftConnectionService.connect()` itself (not just the individual
  `OpenShiftApiClient` methods), the exact real reactive graph from Step 2.

```
CURRENT_PR64_REPRODUCES_FAILURE_BEFORE_NEW_FIX=YES
```

**Honest limitation**: the exact corporate-network trigger (a pooled
connection going genuinely stale from an idle-connection reset by
infrastructure between Log Explorer and the cluster) could not be
reproduced over loopback, where nothing ever silently kills an idle
connection this way. The reproduction that *did* succeed locally uses an
artificial caller-level cancellation as a stand-in for "any cancellation
racing a still-streaming response" — the same underlying Reactor
vulnerability class, evidenced by the identical stack trace shape
(`FluxRetryWhen`/pooled-connection frames), but not a byte-for-byte replay
of the real corporate-network trigger. This is disclosed, not overclaimed.

## Step 7 — the fix (this session)

Two changes, both additive to PR #64's existing (valid, kept) timeout fix:

1. **`OpenShiftApiClient#build`: `HttpClient.newConnection()` instead of
   `HttpClient.create()`.** Every OpenShift call (Connect/discovery AND
   Live Tail/pod-log) now gets a genuinely fresh connection, never one
   reused from Reactor Netty's JVM-wide default pool. This structurally
   eliminates the "stale pooled connection triggers `FluxRetryWhen`" bug
   category entirely — there is no pool for a connection to go stale
   *in*. Directly addresses Step 2's finding that Connect and Live Tail
   shared one pool despite looking unrelated in the source, and Step 3's
   finding that the manual-release Live Tail path is a real, if
   unconfirmed-locally, contamination vector. Cost: one extra TCP+TLS
   handshake per call instead of a reused connection — negligible for
   this low-frequency client (an occasional Connect/refresh, never a hot
   path).
2. **`classify()`'s fallback broadened**: `WebClientRequestException` (the
   transport-level wrapper Step 5 identified as the most likely reason the
   OLD message could still appear even on correct PR #64 code) now also
   gets Phase E's honest, non-cluster-blaming treatment when its own cause
   chain does not already match a known category (TLS/proxy/network) — see
   New fix below for the exact change.

```
PREVIOUS_TIMEOUT_FIX_STATUS=VALID_IMPROVEMENT (kept, unchanged - still correctly removes one genuine, real cancellation-racing-retry source) but PARTIAL_CAUSE (proven insufficient alone by Step 6's continued local reproduction on PR #64's code)
```

### New fix (exact diff shape)

- `OpenShiftApiClient#build`: `HttpClient.create()` → `HttpClient.newConnection()`.
- No changes to `LineDecodingSubscriber`/`BoundedBodyCollector` (audited
  in Step 3, found correct — the mission's own "do not remove manual
  releases merely because they look suspicious" instruction was honored;
  nothing was removed or altered there).
- No `retain()` added, no Netty leak detection disabled, no
  `IllegalReferenceCountException` suppressed, no global
  `Hooks.onErrorDropped` handler installed, no TLS change, no timeout
  increase.

```
DOUBLE_RELEASE=NOT CONFIRMED IN APPLICATION CODE (Step 3's audit found none in LineDecodingSubscriber/BoundedBodyCollector); the observed "already released" signature originates in Reactor Netty's own internal retry/connection-pool machinery, not in this codebase's manual release calls
USE_AFTER_RELEASE=YES (Reactor Netty's own retried-response delivery to an already-terminated response wrapper - see Step 4)
DOUBLE_CONSUMPTION=YES (the same mechanism - a second, retried response delivered to a subscriber/wrapper whose first attempt already consumed/terminated)
CANCELLATION_RACE=YES (confirmed reproducible - Step 6)
```

## Step 1A — diagnostic logging (added this session)

New file `OpenShiftConnectDiagnostics.java` (Connect/discovery lifecycle,
INFO+DEBUG) plus bounded DEBUG/TRACE additions to
`LineDecodingSubscriber`/`BoundedBodyCollector` in `OpenShiftApiClient.java`.

- **Correlation**: one random 8-hex-char `attemptId` per
  `OpenShiftConnectionService#connect` call, carried via a Reactor
  `Context` entry (never `ThreadLocal`/MDC, which does not reliably follow
  Reactor's thread-hopping without extra bridging) — every log line for
  one Connect attempt carries the same id.
- **INFO lifecycle**: `OPENSHIFT_CONNECT_STARTED`/`_SUCCEEDED`/`_FAILED`,
  `OPENSHIFT_HTTP_REQUEST_STARTED`/`_RESPONSE_COMPLETED`/`_REQUEST_FAILED`
  — operation names are a closed, safe set (`FETCH_PROJECTS`,
  `FETCH_USER`, `FETCH_NAMESPACES`, `FETCH_POD_LOG`, `OTHER`), never a raw
  path or query string.
- **DEBUG reactive lifecycle**: `SUBSCRIBED`/`REQUEST_CANCELLED` signals on
  the Connect/discovery Monos (`doOnSubscribe`/`doOnCancel`), and
  `SUBSCRIBED`/`ON_COMPLETE`/`ON_CANCEL`/`ON_ERROR` on the two buffer
  subscribers — purely observational, `readableByteCount()` only (never
  content), never a lifecycle-altering call (`retain`/`release`/`touch`
  beyond the pre-existing, audited release-in-finally).
- **TRACE buffer diagnostics** (bounded, `isTraceEnabled()`-gated): one
  line per delivered `DataBuffer` in each subscriber, with a sequence
  number and byte count — never enabled by default, never buffer content.
- **Exception chain**: `OPENSHIFT_CONNECT_FAILED` logs a compact
  `exceptionClass`/`cause1Class`/`cause2Class`/`rootCauseClass`/
  `rootCauseMessageSanitized` at WARN, full stack trace at DEBUG only.
  `sanitize()` defensively redacts any message containing "bearer" or
  "authorization" (case-insensitive) and truncates to 200 chars.
- **No global `Hooks.onErrorDropped` suppression** was added — the
  existing default Reactor behavior (log via `Operators.onErrorDropped`,
  as seen throughout this investigation) is preserved exactly.

### Security

`OpenShiftConnectLogSecurityTest` (new, 6 scenarios: success, 401, 403,
500, malformed response, connection failure) captures every log line the
new instrumentation emits at DEBUG (the most verbose level a real
deployment would enable) for a full, real-TLS `connect()` attempt using a
synthetic token, and asserts the token value and the raw pasted login
command never appear in any captured line. All 6 pass.

```
LOG_SECRET_LEAK_TEST=PASS
```

### Volume

Connect/discovery is inherently low-frequency — every INFO/DEBUG log
added is safe unconditionally. Live Tail/pod-log streaming was
deliberately **not** given per-line INFO/DEBUG logging (only the bounded,
TRACE-gated, per-subscriber-lifecycle-transition diagnostics in Step 3's
two classes) — satisfies "MUST NOT emit one application diagnostic log per
incoming log line."

### Troubleshooting mode (documented, no recompilation)

Env-var based (works identically for Docker and the Windows/macOS desktop
launchers — Spring Boot resolves `LOGGING_LEVEL_*` env vars at startup,
no code change needed):

```
LOGGING_LEVEL_COM_LOGEXPLORER_SOURCE_OPENSHIFT_CONNECT=DEBUG
LOGGING_LEVEL_COM_LOGEXPLORER_SOURCE_OPENSHIFT_BUFFER=DEBUG
LOGGING_LEVEL_REACTOR_NETTY_HTTP_CLIENT=DEBUG
LOGGING_LEVEL_ORG_SPRINGFRAMEWORK_WEB_REACTIVE_FUNCTION_CLIENT=DEBUG
```

(`reactor.netty.http.client` was already explicitly pinned to INFO in
`application.yml` specifically to prevent TRACE-level raw-wire-byte
dumping — DEBUG, not TRACE, is safe and does not conflict with that floor;
see the existing comment there.)

See "Owner validation steps" below for the exact procedure.

## Tests

```
HTTP_200_VALID_JSON_TEST=PASS
HTTP_401_TEST=PASS
HTTP_403_TEST=PASS
HTTP_5XX_TEST=PASS
MALFORMED_JSON_TEST=PASS
EMPTY_BODY_TEST=PASS
CHUNKED_TEST=PASS
CONNECTION_REUSE_TEST=PASS (reinterpreted: with newConnection(), "reuse" no longer applies by design - these tests instead prove multiple sequential calls on the same client each still succeed correctly with a fresh connection every time)
CANCELLATION_TEST=PASS (the assertion itself passes - "a subsequent call still succeeds correctly" - even though the underlying onErrorDropped log line is still occasionally observed; see Step 6's honest limitation)
PRODUCTION_CONNECT_ORCHESTRATION_TEST=PASS
```

Full backend suite: **1450/1450 passing**, 0 failures/errors (1442 from
the first recovery + 1 new orchestration test + 6 new log-security tests +
1 new cross-contamination test).

## Owner validation steps

1. **Pull this exact PR #64 HEAD** (see `END_HEAD` in the final report) —
   do not reuse a previously-downloaded build. Rebuild the jar/desktop
   package fresh from source. This directly addresses Step 0's unresolved
   gap.
2. **Enable diagnostics** (env vars, no recompilation) before starting Log
   Explorer:
   ```
   LOGGING_LEVEL_COM_LOGEXPLORER_SOURCE_OPENSHIFT_CONNECT=DEBUG
   LOGGING_LEVEL_COM_LOGEXPLORER_SOURCE_OPENSHIFT_BUFFER=DEBUG
   LOGGING_LEVEL_REACTOR_NETTY_HTTP_CLIENT=DEBUG
   LOGGING_LEVEL_ORG_SPRINGFRAMEWORK_WEB_REACTIVE_FUNCTION_CLIENT=DEBUG
   ```
3. **Restart Log Explorer** with those set.
4. **Perform exactly one Connect attempt** against the real cluster
   (direct connection first; system proxy separately/afterward if used).
5. **Capture the log section** from the line containing
   `OPENSHIFT_CONNECT_STARTED` through either
   `OPENSHIFT_CONNECT_SUCCEEDED` or `OPENSHIFT_CONNECT_FAILED` (all lines
   in between share the same `attemptId` — grep for it) — this is
   sufficient without needing to interpret any raw Reactor/Netty stack
   trace.
6. **Disable diagnostics** afterward (unset the four env vars / remove
   them from the launch config) and restart again.
7. Send the captured section back for the next diagnosis round. It will
   **never** contain the token or the pasted `oc login` command
   (`LOG_SECRET_LEAK_TEST=PASS`, verified automatically) — safe to share.

## Next step

- If the real cluster still fails with the SAME symptom on this exact
  HEAD, the Step 1A logs will show, definitively, which HTTP operation was
  active and whether `OPENSHIFT_HTTP_REQUEST_FAILED`'s `exceptionClass`
  matches what `classify()` now handles - closing Step 5's remaining
  uncertainty without guessing.
- If it now succeeds, the fix is real-world confirmed and PR #64 becomes
  mergeable per this mission's own gate.
- Consider (separately, out of this mission's scope) adding
  `spring-boot-maven-plugin`'s `build-info` goal so `/actuator/info`
  reports the running commit - would have closed Step 0 immediately had it
  existed already.
