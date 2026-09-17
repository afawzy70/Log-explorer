# OpenShift HTTP response-buffer lifecycle bug — root cause and fix

Mission: `MERGE_PERFORMANCE_FIXES_THEN_FIX_OPENSHIFT_HTTP_BUFFER_BUG` (Part 2).
Branch: `fix/openshift-http-response-buffer-lifecycle`, based on `main` after
PR #63 and PR #62 merged (`5d223d6`).

## Symptom (as reported)

- `curl https://<openshift-api>:6443/version` — and every other basic
  connectivity check (direct connection, `--noproxy`) — succeeds with a
  valid 200 response. DNS/TCP/TLS/certificate trust/direct connectivity are
  all confirmed working; not the bug.
- The Log Explorer UI shows: **"The cluster returned an unexpected
  response (HTTP 200)."**
- The backend logs an `IllegalReferenceCountException: refCnt: 0,
  decrement: 1`.

## Phase A — call-path map

| File | Class/Method | Responsibility |
|---|---|---|
| `OpenShiftConnectionController.java` | `connect(OpenShiftConnectRequestDto)` | HTTP boundary for `POST /api/v1/sources/openshift/connect` |
| `OpenShiftConnectionService.java` | `connect(String, String)` | Parses the pasted `oc login` command, validates against the real cluster (project/namespace discovery doubles as validation), then resolves username — **only on success** is the session stored |
| `OpenShiftConnectionService.java` | `discoverProjectsOrNamespaces` → `OpenShiftApiClient#fetchProjects`/`fetchNamespaces` | The actual cluster round-trip that validates the connection |
| `OpenShiftApiClient.java` | `get(URI, RawToken, String, String)` | **The one shared HTTP call** every JSON-returning OpenShift API call (`fetchProjects`, `fetchNamespaces`, `fetchUsername`, `fetchWorkloads`, `fetchPods`, ...) routes through — builds a fresh `WebClient`, issues the `GET`, decodes the JSON body |
| `OpenShiftApiClient.java` | `build(URI, String)` | Constructs the `WebClient`/`HttpClient` (TLS, proxy, timeout) for one call |
| `OpenShiftApiClient.java` | `classify(Throwable, boolean)` | Maps any transport/decode failure to a user-safe `OpenShiftApiException` — **this is where the exact user-visible message is produced** |

`"The cluster returned an unexpected response (HTTP <status>)."` has
exactly one source: `classify()`'s `WebClientResponseException` branch,
reached only for a status the client doesn't give its own `Kind`
(401/403/404 already have their own branches).

## Phase B — proving the buffer/lifecycle bug

**No existing automated test for `OpenShiftApiClient` ever ran over real
TLS** — every one (`OpenShiftApiClientTest`, `...ByteBoundTest`,
`...LiveStreamTest`) uses `MockOpenShiftServer`, a plain JDK `HttpServer`
over HTTP. A real OpenShift API is always HTTPS (port 6443). This gap is
exactly where the bug lived, invisible to the existing suite.

Built `MockOpenShiftHttpsServer` (self-signed cert via `keytool`, no new
dependency — see its own javadoc) to close that gap, and reproduced the
failure directly:

```
java.lang.IllegalStateException: The client response body has been released already due to cancellation.
	at org.springframework.http.client.reactive.ReactorClientHttpResponse.lambda$getBody$0(...)
	...
	at reactor.core.publisher.FluxRetryWhen$RetryWhenMainSubscriber.onNext(FluxRetryWhen.java:178)
	at reactor.netty.http.client.HttpClientConnect$HttpIOHandlerObserver.onStateChange(HttpClientConnect.java:457)
	at reactor.netty.http.client.HttpClientOperations.onInboundNext(...)
	...
```

**Root cause**: `OpenShiftApiClient#get` applied a Reactor-Core `.timeout(TIMEOUT)`
operator *downstream* of `.retrieve().bodyToMono(JsonNode.class)`, **in
addition to** `HttpClient#responseTimeout(TIMEOUT)` already configured in
`#build`. Two independent, uncoordinated cancellation mechanisms bounding
the same call. When the downstream Reactor-Core timeout fires while a
response body is still being read (a slow/laggy real network — this
investigation forced it deterministically with a chunked, delayed mock
response), it races Reactor Netty's own internal
**retry-on-stale-pooled-connection** logic (`FluxRetryWhen`, visible in the
captured stack trace, confirmed by the `HttpClientConnect`/`onInboundNext`
frames): a *retried* inbound response gets delivered to a
`ReactorClientHttpResponse` whose body was already released by the first
(cancelled) attempt. In this Spring/Reactor version that surfaces as the
`IllegalStateException` above; the reported `IllegalReferenceCountException`
(`io.netty.util.IllegalReferenceCountException extends IllegalStateException`)
is the same buffer-lifecycle-violation family, one layer lower.

```
DOUBLE_RELEASE_CONFIRMED=YES (indirectly - the SECOND, retried response
  delivery accesses a body the FIRST, cancelled attempt already released;
  Spring's own defensive check in this version intercepts it as
  IllegalStateException before it reaches raw ByteBuf.release(), which is
  exactly the "already released" signature the reported
  IllegalReferenceCountException shares)
DOUBLE_CONSUMPTION_CONFIRMED=YES (a second, framework-internal
  retry-driven response delivery attempts to consume/access a body a first,
  cancelled attempt already released — "framework-owned buffer manually
  released" was ruled out by code inspection first: no manual
  DataBufferUtils.release/ByteBuf.release/ReferenceCountUtil.release exists
  anywhere in this call path; the double-touch is entirely internal to
  Reactor Netty's own retry mechanism racing Reactor Core's cancellation)
```

Reproduced reliably (3-5 of 5 runs) against the *old* code; confirmed to
**not** be caused by connection pooling alone (switching to
`HttpClient.newConnection()`, i.e. no pooling, reduced but did not
eliminate it) or by `.retrieve()` specifically (switching to
`.exchangeToMono()` did not eliminate it either) — isolating the redundant
`.timeout()` operator itself as the actual fix target, not a proxy for it.

## Phase C — reproduction tests (`OpenShiftApiClientHttpsBufferLifecycleTest`, over real TLS)

```
HTTP_200_VALID_JSON_TEST=PASS
HTTP_401_TEST=PASS
HTTP_403_TEST=PASS
HTTP_5XX_TEST=PASS
MALFORMED_JSON_TEST=PASS (also verifies the Phase E message, see below)
EMPTY_BODY_TEST=PASS (both a valid-but-empty {"items":[]} AND a genuinely zero-byte body)
```

Plus the root-cause regression tests: 15 repeated cancel-while-streaming
cycles never corrupt a subsequent normal call
(`repeatedCancellationOfAStillStreamingResponseNeverCorruptsTheNextCall`),
10 sequential real-TLS connect flows never throw, a large (2000-item)
multi-TLS-record response decodes correctly, and a genuinely hanging
response still times out rather than hanging forever
(`aGenuinelyHangingServerStillTimesOutRatherThanHangingForever` — proves
removing the redundant timeout did not remove timeout protection).

## Phase D — the fix (smallest correct change)

`backend/src/main/java/com/logexplorer/source/openshift/OpenShiftApiClient.java`,
~38 lines changed, all in `get()`/`classify()`:

1. **Removed** the redundant Reactor-Core `.timeout(TIMEOUT)` from `get()`.
   The single source of truth for the response-time bound is now
   `HttpClient#responseTimeout(TIMEOUT)` alone (unchanged, already in
   `#build`) — a framework-managed mechanism Reactor Netty implements with
   full awareness of its own connection pooling/retry internals, unlike a
   bolted-on Reactor Core operator.
2. **Added** `.switchIfEmpty(...)` so a genuinely empty 2xx body (Jackson's
   decoder completes an empty `Mono` for zero bytes, never an error)
   becomes an explicit, honest `OpenShiftApiException` instead of a silent
   `null` a caller would NPE on.
3. **Added** a `classify()` branch for `CodecException` (decode failures —
   can only ever happen on a response `.retrieve()` already accepted as
   successful) and `IllegalStateException` (defense in depth for the
   reported symptom's exact class) → the Phase E message.

No manual `DataBufferUtils`/`ByteBuf`/`ReferenceCountUtil` calls anywhere,
no Netty safety check disabled, no exception suppressed. The response body
is still consumed exactly once, entirely by Spring's own
`.retrieve().bodyToMono(...)` — framework-managed lifecycle, unchanged;
only the *redundant second timeout mechanism* that was racing it is gone.

## Phase E — honest error message

Before: `"The cluster returned an unexpected response (HTTP 200)."`
(implies the *cluster's* response was wrong — false; curl already proved
otherwise).

After: `"OpenShift returned HTTP 200, but Log Explorer could not process
the response."` — correctly blames the processing layer, not the cluster.
Every other status's message is unchanged (401/403/404/429/500/502/503/
timeout all keep their own existing, already-accurate `Kind`/message).

No token, Authorization header, response body, or certificate material is
logged or included in any message — unchanged from the pre-existing
`OpenShiftApiException`/`classify()` contract (verified: no new log
statement was added anywhere in this change).

## Phase F — real OpenShift validation

`BLOCKED` — no real OpenShift cluster is reachable from this sandboxed
development environment (no cluster credentials, no network path to one).
This is disclosed honestly rather than claimed. What **was** verified
directly:

- Real TLS (not mocked/stubbed) against a locally-generated, genuinely
  independent HTTPS server, exercising the identical `WebClient`/
  `HttpClient`/Reactor Netty code path a real cluster connection uses.
- The exact reported exception class's *family* (buffer/body released
  before/during a second access attempt) reproduced and then eliminated.
- Timeout protection against a genuinely non-responding server still
  works (see Phase C).

`REAL_OPENSHIFT_DIRECT_CONNECTION` / `REAL_OPENSHIFT_SYSTEM_PROXY_CONNECTION`
/ `TOKEN_VALIDATION_WORKS` against the user's own real cluster: **not
independently verified this session** — recommended as the next step
before merging, using the user's own machine/network (see NEXT_STEP).

## Result equivalence / security

- No search semantics touched (this file has nothing to do with log
  search).
- No TLS verification disabled, no trust-all mode added — `buildSslContext`
  (custom CA trust) is completely unchanged.
- No token persisted, printed, or logged — unchanged.
- No response body persisted or logged — unchanged.
- `Kind.UNAUTHORIZED`/`FORBIDDEN`/`NOT_FOUND`/`TIMEOUT`/`NETWORK`/`PROXY`
  classification and their messages are byte-for-byte unchanged; only the
  previously-generic `MALFORMED_RESPONSE` catch-all gained two more
  precise entry points (decode failure, empty body) with a more honest
  message, and the case that could previously (incorrectly) reach that
  catch-all via a corrupted retry is now structurally impossible (the
  race that produced it is gone).

## Tests

- New: `OpenShiftApiClientHttpsBufferLifecycleTest` — 13 tests, all
  passing, run 5+ times to confirm no flake in either direction.
- Existing, unaffected: `OpenShiftApiClientTest` (23), `...ByteBoundTest`
  (28), `...LiveStreamTest` (28), `OpenShiftConnectionServiceFallbackTest`
  (15), `OpenShiftConnectionControllerIntegrationTest` (5) — all passing
  unchanged.
- Full backend suite: **1442/1442 passing**, 0 failures/errors.
- No frontend changes: the "unexpected response"/message text is not
  duplicated in the frontend (it renders the backend's `detail` field
  directly) — confirmed via search, no frontend tests needed.
- Desktop (Windows/macOS) packaging builds and Docker Compose smoke tests
  were **not** run this session — no JVM launch flags, no packaging files,
  no startup lifecycle changed (only `OpenShiftApiClient`'s internal
  request-building logic), so packaging risk is judged low, but this is
  reasoning, not verification (`TOKEN_COST_PRIORITY=HIGH`).

## Next step

1. Validate against a real OpenShift cluster from a machine that has one
   reachable (direct connection is the mandatory check per this mission;
   system-proxy is environment-dependent and can be reported separately).
2. If real-cluster validation surfaces a *different* failure mode than the
   one reproduced here, treat that as new evidence, not a reason to revert
   this fix — the redundant-timeout race is real and independently worth
   fixing regardless.
