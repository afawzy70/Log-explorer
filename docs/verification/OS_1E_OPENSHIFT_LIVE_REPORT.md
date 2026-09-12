# OS-1E — OpenShift Live Tail

## 0. Stacked execution — relationship to PR #42

This slice was explicitly authorized as a **stacked continuation** while
PR #42 (OS-1D) remained blocked purely on an external Windows Desktop CI
NuGet-restore infrastructure failure (`WINDOWS_DESKTOP_GATE=BLOCKED_EXTERNAL_CI`,
confirmed zero `desktop/**` diff, confirmed the immediately-preceding
commit on the same branch passed the identical workflow). Branch
`os/1e-openshift-live-tail` was created from PR #42's exact approved HEAD
(`2d49a3aed6fc3b517625bb053e1c8e91023d76d1`), **not** from `main`. This
slice:

- Made **zero** commits on `os/1d-openshift-context-correlation`.
- Made **zero** changes to PR #42's own diff.
- Must **not** be merged before PR #42 merges, post-main CI/Windows
  validate, and (if the base has moved) this branch is rebased onto the
  updated `main`.

## 1. Scope

Direct, professional, bounded OpenShift live log tailing — real
Kubernetes/OpenShift pod-log `follow=true` streaming, **no** `oc logs -f`,
**no** shell, **no** exec/attach/port-forward, **no** runtime `oc`
dependency — reusing the **existing generic Live architecture** end to
end (`LiveTailController`/`LiveTailService`/`LiveTailGuard`/
`LiveTailProperties` on the backend; `useLiveTail`/`LiveTailPanel` on the
frontend), rather than building a separate OpenShift-specific product.

Builds directly on:

- **OS-1B** — scope resolution (Selected Pod+Container / Pod+Container=All
  / Pod=All+Workload / Pod=All+Workload=All).
- **OS-1C** — bounded fan-out (`maxPods`/`maxTargets`/`maxConcurrency`),
  the hardened `BaseSubscriber`/cancellation-bridge/DataBuffer-release
  pattern.
- **OS-1D** — the atomic `OpenShiftSession#operationSnapshot()` one-read
  discipline, reused verbatim for the live-session start capture.

## 2. Design decision — reuse, not a parallel architecture

An audit of the existing generic Live stack (`LogSource#follow`,
`FollowRequest`, `LiveTailController`, `LiveTailService`, `LiveTailGuard`,
`LiveTailProperties`, `DockerLogSource#follow` as the concrete
multi-target reference, and the frontend's `useLiveTail.ts`/
`LiveTailPanel.tsx`) found the entire transport/reconnect/lifecycle/
masking/buffering architecture **already mature and reusable as-is**:

- SSE transport, heartbeat/status channel, server-side backpressure
  buffer with a dropped-count notice, the exact same `EventMapper`
  masking boundary every endpoint uses, `LiveTailGuard`'s
  `maxConcurrentTails` cap — all untouched.
- The frontend `useLiveTail.ts` hook's bounded exponential-backoff
  reconnect with jitter, session-id race guard, explicit finite
  `LiveConnectionState` model, Stop-never-reconnects, terminal `'failed'`
  state with manual `retry()` — **zero changes needed**: a backend `Flux`
  error drives the exact same generic reconnect/failed-state behavior
  regardless of source.

OS-1E's real new work is therefore almost entirely:

1. A correct, genuinely streaming line decoder for `follow=true` over
   `Flux<DataBuffer>` (§3).
2. A multi-target orchestration layer producing `CanonicalLogEvent`s from
   OpenShift's pod-log API, reusing OS-1B/1C/1D's target-resolution and
   atomic-snapshot patterns (§4).
3. A small, additive warnings side-channel so partial-live-state
   truthfulness reaches the existing generic status surface (§5).

No duplicate Live state machine, no OpenShift-specific SSE endpoint, no
`OpenShiftLiveTailPanel`.

## 3. Streaming primitive — `OpenShiftApiClient`

New public method `followPodLog(server, token, caPath, namespace,
podName, containerName, initialTailLines, maxLineBytes): Flux<String>`:
builds the pod-log URI with `container`, `timestamps=true`, `follow=true`,
`tailLines=initialTailLines` (small, bounded — mission §14: never
replays a large slice of history on Start), issues the request via
`bodyToFlux(DataBuffer.class)` (never `bodyToMono(String.class)` — never
materializes the unbounded body), pipes through a new package-private
`decodeLines` operator, and reuses the exact same `classify()` error
mapping OS-1C's `fetchPodLog` uses.

`decodeLines`/`LineDecodingSubscriber` mirror OS-1C's own hardened
`readBounded`/`BoundedBodyCollector` pattern exactly, adapted from a
single-bounded-result `Mono` shape to a potentially-infinite `Flux<String>`
shape: pull-style `request(1)` backpressure, a downstream cancel bridged
via `FluxSink#onCancel` to the subscriber's own `cancel()`, every
`DataBuffer` released in a `finally` block regardless of path.

`LiveLineDecoder` is the pure, non-reactive, byte-level `\n`-splitting
state machine: a bounded `ByteArrayOutputStream` buffer, a
`maxLineBytes` safety valve for a pathologically long unterminated line,
defensive `\r\n` handling, and reuse of OS-1C's own `trimIncompleteUtf8Suffix`
helper for the only case that can end mid-character — a forced cutoff
before a `\n` was ever seen. Splitting on raw byte `0x0A` is otherwise
always UTF-8-safe (every continuation/lead byte of a multi-byte sequence
has its high bit set, so `0x0A` can never occur inside one).

**Tests** — `OpenShiftApiClientLiveStreamTest` (15 tests, two layers):

- Pure decoder (`LiveLineDecoder`, no reactive machinery): one complete
  line in one chunk; multiple lines in one chunk; a line split across
  many chunks; a chunk boundary inside a JSON field; a chunk boundary
  inside a multi-byte UTF-8 character; CRLF; a malformed non-JSON line
  passed through verbatim (the decoder never parses content); a line
  exceeding the max bound forcibly emitted (ASCII and UTF-8-boundary
  cases — trimmed, never garbled, nothing silently dropped); an empty
  chunk.
- Reactive (`decodeLines`, real pooled `NettyDataBuffer`s via
  `PooledByteBufAllocator`, reusing `OpenShiftApiClientByteBoundTest`'s
  own `pooled()`/`nettyRefCount()` conventions): every line emitted from
  a finite source; every consumed buffer's Netty ref-count reaches zero
  (real release proof, not an assumption); downstream cancellation
  cancels the underlying upstream subscription (a `Flux.never()` source
  proving the cancel actually propagates); no line is emitted after
  downstream cancellation; a transport error propagates and still
  releases what was already buffered.

## 4. Multi-target orchestration — `OpenShiftLiveTailProvider`

New `@Component`. `follow(): LiveFollowResult` is deferred so the atomic
snapshot capture happens at subscribe time (when `LiveTailService`
actually starts the SSE connection).

**One atomic snapshot** (mission §6): `session.operationSnapshot()` is
called exactly once per live session; `generation`/`server`/`token`/
`caPath`/`namespace`/`scope` are all projected from that one read and
never re-obtained independently for the life of the session — the exact
`OpenShiftSession#operationSnapshot()` OS-1D's atomicity recovery
introduced, reused verbatim rather than re-implemented.

**Target resolution reuse** (mission §5): `DirectPodLogProvider#resolveTargets`
was widened from `private` to package-private and is called directly, so
live targets resolve through the *exact same* Selected Pod+Container /
Pod+Container=All / Pod=All+Workload / Pod=All+Workload=All logic search
already uses — never a second, parallel notion of scope. Deduplicated and
capped at `DirectPodLogProperties.maxTargets` exactly like
`resolveTargetPlan` does for search (`maxPods` already applied inside
`resolveTargets`) — `DirectPodLogProperties`'s `maxPods`/`maxTargets`/
`maxConcurrency` are reused directly, per the mission's own instruction,
rather than duplicated into the new `OpenShiftLiveProperties`.

**Per-target bounded reconnect** (mission §18/§39), independent per (pod,
container) target — one target's failure never stops the others:

| Failure | Behavior |
|---|---|
| `UNAUTHORIZED` (401) | Permanent stop for this target. Generation-guarded exactly like `DirectPodLogProvider`'s own 401 handling: `session.markExpired()` is called only if `session.generation() == <the generation captured at live-session start>` — never a stale re-read, never expires a connection this target's own stale 401 no longer belongs to. |
| `FORBIDDEN` (403) / `NOT_FOUND` (404) | Permanent stop for this target — the permission/existence truth is already established; reconnecting cannot change it. |
| A clean stream end, or any other transient failure (network/timeout/TLS/proxy/malformed-response) | Bounded exponential-backoff reconnect, up to `OpenShiftLiveProperties.maxReconnectAttempts`, then also a permanent stop. |

The reconnect attempt budget **resets to 0 the moment an attempt actually
delivers at least one real event** — a target that has streamed healthily
for an hour and then hits one fresh disconnect gets a fresh budget for
that new outage, rather than inheriting an already-exhausted count from
reconnects that happened long before (bounded-reconnect-*per-outage*, not
bounded-reconnects-for-the-whole-session).

Every permanent stop is reported once, truthfully, on the warnings
channel (§5) — never silently. When every target has permanently
stopped, the merged event stream **completes** (mission §22 — "a
zero-target session moves to an explicit non-LIVE state, never a quiet
LIVE"); `LiveTailService`'s existing heartbeat/status channel keeps the
SSE connection itself alive so the frontend can render that truth rather
than the connection simply vanishing.

**Event parsing** (mission §32 "WHERE"): each raw line is parsed via the
same `LogLineParser#parse(content, serviceHint)` + timestamp-extraction
logic `DirectPodLogProvider#parseFilterAndMerge` already uses (those two
helper methods were widened to package-private and reused directly, not
duplicated), with full `sourceId`/`namespace`/`pod`/`containerName` set
on every event. Filtering/masking is fully reused from the existing
canonical pipeline — `LiveTailService`'s own `EventMapper` masking
boundary, server-side only; this class never applies `SearchRequest`-
shaped filters at all, since `FollowRequest` deliberately carries none
(mirroring OS-1C/1D's own choice to read `OpenShiftSession#scope()`
directly rather than trust caller-supplied target identity).

**New config** — `OpenShiftLiveProperties`
(`logexplorer.openshift.live.*`): `initialTailLines=5`,
`maxLineBytes=65536` (64 KB), `maxReconnectAttempts=5`,
`initialReconnectDelay=1s`, `maxReconnectDelay=30s`. Deliberately does
**not** duplicate `maxPods`/`maxTargets`/`maxConcurrency`.

**New replicas are not auto-attached** (mission §21,
`LIVE_TARGET_SNAPSHOT=IMMUTABLE`): the resolved target list is captured
once, at session start, from the one atomic snapshot, and never
re-resolved for the life of the session. A rolling deployment's new pods
are simply not part of the running session; restarting Live is required
to pick them up. Automatic Kubernetes Watch-based re-resolution is
explicitly deferred, not introduced.

**Tests** — `OpenShiftLiveTailProviderTest` (11 tests, `OpenShiftApiClient`
mocked — the wire-level streaming/decoding contract is already covered by
`OpenShiftApiClientLiveStreamTest`; this class's own job is the
orchestration layer above it):

- One target normal follow emits fully enriched `CanonicalLogEvent`s
  (`sourceId`/`namespace`/`pod`/`containerName`/`message` all correct).
- Multiple targets merge into one event stream, never joined or dropped.
- One target permanently failing (403) never stops a healthy sibling
  target, and is reported on `warnings`.
- `TARGET_CAP_REACHED` is reported truthfully when the resolved scope
  exceeds `maxTargets`.
- Zero resolved targets completes the stream (never hangs) and reports
  `NO_LIVE_TARGETS`.
- A 401 expires the session only when the captured generation still
  matches the session's current generation — and, symmetrically, a 401
  that arrives after a **real interleaved reconnect** (a genuine second
  `session.connect(...)` call between snapshot capture and the 401)
  never collaterally expires the new connection (mirrors
  `ConnectionOperationSnapshotTest`'s own real-interleaving technique one
  layer up — generation isolation, mission §38).
- 403/404 stop permanently with **zero** reconnect attempts (verified via
  `Mockito.verify(times(1))` on the mocked client).
- A transient failure (network) reconnects and can succeed on a later
  attempt.
- A persistent transient failure (timeout) gives up after exactly
  `maxReconnectAttempts` and warns.

## 5. Truthful partial-live-state disclosure — the warnings channel

New `com.logexplorer.core.model.LiveFollowResult(Flux<CanonicalLogEvent>
events, Flux<List<String>> warnings)` and a new `LogSource` default
method `followWithWarnings(FollowRequest): Mono<LiveFollowResult>`
(default: wraps `follow()` with an always-empty warnings channel — every
source but OpenShift is unaffected and needs no override).

This is deliberately **not** a second, independent call to
`OpenShiftLiveTailProvider#follow()` — both the event stream and the
warnings stream returned by `OpenShiftLogSource#followWithWarnings` come
from **one** `liveTailProvider.follow()` call, so a caller that
subscribes to both (as `LiveTailService` now does) observes warnings that
genuinely belong to the exact live session it is watching, never a second
independently-started cluster connection that happens to share a source
id.

`LiveTailService.follow()` now calls `source.followWithWarnings(request)`
once, samples the warnings `Flux`'s most recent value into an
`AtomicReference` (updated as a side effect, subscribed alongside the
event/heartbeat flux so its lifecycle — cancellation on disconnect/Stop
included — is the same lifecycle as the rest of the SSE connection), and
threads it into the existing periodic `StatusPayload`, which gained one
new field: `warnings: List<String>` (always `[]`, never `null`, for every
source that doesn't override `followWithWarnings`).

Frontend: `LiveStatusPayload.warnings: string[]` (new field);
`useLiveTail.ts` gained one new piece of state, `sourceWarnings: string[]`,
populated from each `status` SSE event, reset on `start()`/`exit()`, and
exposed on the hook's return value; `LiveTailPanel.tsx` renders it as a
`role="status"` list, reusing the exact same warning-tone visual pattern
(`--color-severity-warn`) `SourceHealthBadge.module.css`'s own
`.warningsList` already established for source-reported warnings
elsewhere in the app — no new visual language invented.

## 6. Capability truthfulness (mission §34)

`OpenShiftLogSource#capabilities().liveTail()` flips `true` **only in
this commit**, after the full implementation above and its full test
matrix (§3, §4) passed — never earlier. `pagination`/`rawLogQL` remain
`false`; `historicalSearch`/`contextView` remain as already approved by
OS-1C/OS-1D, unchanged.

Updated (real, previously-`false`-asserting) pins, with an explicit
`CORRECTED (OS-1E)` note explaining why the old assertion was true then
and is not now:

- `OpenShiftSecurityBoundariesTest#openShiftAdvertisesExactlyTheCapabilitiesItCanDeliver`
  (backend unit test).
- `frontend/e2e/os-1a-openshift-connection.spec.ts` — "OpenShift appears
  as a source and advertises exactly the search/live capability it can
  deliver" (real rendered-browser evidence against the real running
  backend — re-run and reconfirmed passing against a freshly rebuilt dev
  server, §9).

## 7. Explicitly not implemented in this slice (assessed, deferred)

- **Automatic re-attachment of new pods from a rolling deployment**
  (Kubernetes Watch-based live target re-resolution) — deliberately
  deferred (mission §21); the immutable-snapshot decision above is the
  intentional behavior, not a gap.
- **Cross-target ordering guarantees.** `LIVE_ORDERING != HISTORICAL_GLOBAL_ORDER` —
  events from different targets are merged in arrival order via
  `Flux.merge`, exactly like `DockerLogSource#follow` already does; no
  causality is fabricated from that ordering.
- **Multiline log reconstruction.** OS-1C's own multiline/escaped-newline
  handling lives in `LogLineParser`, applied per already-framed line
  exactly as search already does; this slice added no new multiline
  buffering beyond the line-framing `LiveLineDecoder` itself performs
  (one buffered *line*, not one buffered *logical multi-line event*).
- **Real OpenShift cluster verification** — `REAL_OPENSHIFT_1E=BLOCKED_CREDENTIALS`,
  consistent with every prior OS-1x slice's own honest `BLOCKED_CREDENTIALS`
  status; nothing here fabricates cluster behavior never observed.

## 8. `TEST-INFRA-1` (historical evidence PNG mutation)

Re-confirmed present and unchanged in behavior this slice (running the
full Playwright E2E suite rewrites historical evidence PNGs under
`docs/verification/**` via `helpers.ts#captureScreenshot`). Mitigated the
same way as every prior slice — `git checkout -- <touched paths>` after
every E2E run, verified via an empty diff — and **not** fixed
opportunistically here, per the standing registered decision
(`APPROVED_PENDING_HARDENING`, unchanged).

## 9. Validation (original OS-1E implementation pass)

| Check | Result |
|---|---|
| Backend compile (`./mvnw -q -o compile`) | `PASS` |
| Backend full test suite (`./mvnw -q -o test`) | `PASS` — exit 0, 0 failures, full suite (967+ pre-existing tests plus 26 new: 15 `OpenShiftApiClientLiveStreamTest` + 11 `OpenShiftLiveTailProviderTest`) |
| Frontend typecheck (`npm run typecheck`) | `PASS` |
| Frontend production build (`npm run build`) | `PASS` |
| Frontend unit suite (`npx vitest run`) | `PASS` — 767/767, incl. 7 new OS-1E tests in `useLiveTail.test.ts`/`LiveTailPanel.test.tsx` |
| Real running backend (`SPRING_PROFILES_ACTIVE=dev`) `/api/v1/sources` | `PASS` — confirmed `openshift.capabilities.liveTail == true` from a live, freshly-rebuilt process, not merely from source |
| Playwright — `os-1a-openshift-connection.spec.ts` + `phase-j-live-tail.spec.ts` (targeted, real browser) | `PASS` — 24/24, incl. the updated capability pin |
| Playwright — full suite | `PASS` — 287/287 |
| `TEST-INFRA-1` PNG restoration after every E2E run | `PASS` — verified empty PNG diff after each run |

## 10. Files changed (backend, original implementation pass)

- `backend/src/main/java/com/logexplorer/config/OpenShiftLiveProperties.java` (new)
- `backend/src/main/java/com/logexplorer/core/model/LiveFollowResult.java` (new)
- `backend/src/main/java/com/logexplorer/source/LogSource.java` (`followWithWarnings` default method)
- `backend/src/main/java/com/logexplorer/source/openshift/OpenShiftApiClient.java` (`followPodLog`/`decodeLines`/`LineDecodingSubscriber`/`LiveLineDecoder`)
- `backend/src/main/java/com/logexplorer/source/openshift/OpenShiftLiveTailProvider.java` (new)
- `backend/src/main/java/com/logexplorer/source/openshift/OpenShiftLogSource.java` (`follow`/`followWithWarnings` overrides, `liveTail` capability flip)
- `backend/src/main/java/com/logexplorer/source/openshift/DirectPodLogProvider.java` (`resolveTargets`/`extractTimestamp`/`stripTimestamp`/`requireConnectedWithSelectedProject` widened to package-private for reuse)
- `backend/src/main/java/com/logexplorer/api/live/LiveTailService.java` (`followWithWarnings` wiring, `StatusPayload.warnings`)
- New tests: `OpenShiftApiClientLiveStreamTest`, `OpenShiftLiveTailProviderTest`
- Updated tests: `OpenShiftSecurityBoundariesTest` (capability pin + constructor)

## 11. Files changed (frontend, original implementation pass)

- `frontend/src/features/live/liveTailTypes.ts` (`LiveStatusPayload.warnings`)
- `frontend/src/features/live/useLiveTail.ts` (`sourceWarnings` state)
- `frontend/src/features/live/LiveTailPanel.tsx` / `.module.css` (warnings render surface)
- Updated tests: `useLiveTail.test.ts`, `LiveTailPanel.test.tsx`, `useLiveKeyboardShortcuts.test.ts` (mock handle field)
- `frontend/e2e/os-1a-openshift-connection.spec.ts` (capability pin)

## 12. Deferred requirement registered (not implemented) — REL-1 / CI toolchain

See `docs/governance/OWNER_REQUIREMENTS_REGISTER.md` §7c for the new
`REL-1`-scoped, `APPROVED_PENDING` "Reproducible Windows .NET / NuGet
Toolchain" row, registered per this slice's own mission but explicitly
**not implemented** here.

---

## 13. OS-1E REVIEW RECOVERY — live stream truthfulness, bounded reconnect, long-line integrity & active-stream state

An independent review of the implementation above (§1-12) found six real
defects that had to be corrected before OS-1E could be approved. None of
them touch `ContextTargetProofCodec`/`ConnectionOperationSnapshot`/
`resolveTargetPlan` (OS-1D's own mechanisms, reused verbatim), and none
reopen any OS-1B/OS-1C/OS-1D `VERIFIED` requirement.

### 13.1 Findings and fixes

**1. Reconnect budget could be reset forever by replayed initial-tail
rows.** The original `followTarget` called `client.followPodLog(...)`
with `liveProperties.getInitialTailLines()` on *every* attempt, including
every reconnect. If a target's pod already had historical log lines,
Kubernetes' `tailLines=N` would keep returning the same N lines on every
reconnect, `receivedAnyEvent` would be `true` every time, and the bounded
reconnect budget would reset to 0 on every single reconnect — making
`maxReconnectAttempts` not a real bound at all, and duplicating the same
historical line(s) into the event stream on every reconnect besides.
**Fix:** `tailLines` is now a genuine per-call parameter — `attempt == 0`
uses the configured `initialTailLines`; every `attempt > 0` uses
`tailLines=0`, the well-established `kubectl logs -f --tail=0` idiom
("follow new lines only, replay nothing"). Because a reconnect can now
never replay history, **any event received during a reconnect attempt is
definitionally genuine, non-replayed data** — this is `OpenShiftLiveTailProvider`'s
own explicit `REAL_RECOVERY` definition (`budgetBasis`), and it is the
*only* thing the reconnect budget resets on. An attempt-0 historical event
never resets anything (there is no budget to reset at attempt 0 in the
first place). Tests: `reconnectA`-`reconnectF` in
`OpenShiftLiveTailProviderTest` (initial-tail-vs-reconnect tailLines
values, historical-data-cannot-reset-budget, persistent-failure-still-
exhausts, genuine-recovery-does-reset, exhaustion-is-deterministic,
Stop-during-backoff-cancels-the-retry).

**2. One oversized physical line could fragment into several fake
events.** The original `LiveLineDecoder` called `finishLine()` every time
`maxLineBytes` was reached, even mid-physical-line, then kept
accumulating the *same* physical line's remaining bytes into a fresh
buffer — one real 200 KB line with a 64 KB cap could become three
synthetic `CanonicalLogEvent`s, none of which the upstream ever actually
sent as separate lines. **Fix:** `LiveLineDecoder` now returns
`DecodedLine(content, truncated)`, and once the cap is hit before a real
`\n`, it emits exactly ONE `DecodedLine` (`truncated=true`, content safely
UTF-8-trimmed) and enters a `discardingOverlong` mode that discards
(never buffers, never emits) every further byte of that same physical
line until the real terminating `\n` arrives — guaranteeing at most one
event per physical line, always. Tests: `OpenShiftApiClientLiveStreamTest`
gained 3 new dedicated tests (`aPhysicalOverlongLineProducesExactlyOneEventNeverMultipleFakeOnes`
with a 200,000-byte line, `overlongLineDiscardsEveryFurtherByteOfThatPhysicalLineUntilTheRealNewline`,
`afterOverlongDiscardTheNextRealPhysicalLineParsesNormally`), plus the
existing UTF-8-boundary test was corrected to the new semantics
(`utf8SafeAtOverlongTruncationBoundary_noReplacementCharacterNoFakeContinuationEvent`).
The truncation is also now surfaced to the live runtime status as one
bounded, growing count ("N overlong log lines truncated") rather than a
new warning string per occurrence — `SessionRuntimeState#incrementOverlong`;
`OpenShiftLiveTailProviderTest#overlongLineTruncationReachesRuntimeStatusAsABoundedCount`.

**3. `maxConcurrency` was claimed reused but never actually enforced for
live connect/reconnect.** The original `OpenShiftLiveTailProvider` built
one `Flux` per target and merged them with plain `Flux.merge` — no
admission bound of any kind. The mission and the original report's own
`MAXPODS_MAXTARGETS_MAXCONCURRENCY_REUSED_FROM=DirectPodLogProperties`
claim was therefore false for the `maxConcurrency` third. **Fix:** a
non-blocking, per-session connect-admission permit gate
(`gatedFollow`/`acquirePermit`), deliberately distinct from `maxTargets`
(the active-stream cap): up to `maxConcurrency` targets may simultaneously
be in the "opening a connection" phase; a target's permit releases on its
first data/error/completion signal, or after
`OpenShiftLiveProperties#getConnectPermitTimeout()` elapses, whichever is
first (so a connection that is genuinely established but simply idle
never starves a later target). Deliberately **not**
`flatMap(..., maxConcurrency)`: that operator only releases a concurrency
slot when its inner sequence *terminates*, and a healthy live stream is
intentionally infinite — the first `maxConcurrency` targets would run
forever and every later target would never start. Implemented as a
non-blocking bounded poll (`Mono.defer` + `retryWhen`) rather than a
blocking `Semaphore.acquire()` on a worker thread, specifically to avoid
hand-rolling interrupt-vs-cancellation correctness around a raw blocking
call. Tests: 4 new dedicated concurrency tests in
`OpenShiftLiveTailProviderTest` proving the bound holds with 5 targets
and `maxConcurrency=2`, that one long-lived active stream never starves
later targets, that cancellation while queued does not strand a permit,
and that a failed (permanently-stopped) connect releases its permit for
the next queued target.

**4. A zero-active-target session could remain visually labeled plain
LIVE.** The backend already completed the event `Flux` correctly once
every target permanently stopped, and `LiveTailService`'s own heartbeat
correctly kept the SSE transport connection open to deliver that truth
(this part of the design was already right, and is preserved) — but the
*frontend* had no distinct representation for "the transport is healthy
but the source has nothing active," so the badge kept reading "LIVE".
**Fix:** a new backend `core.model.LiveSourceStatus` (state +
resolved/active/reconnecting/stopped counts + current warnings) is pushed
to the frontend via extended `StatusPayload` fields; `LiveTailPanel.tsx`'s
new `sourceStatusBadge` overrides the badge to "NO ACTIVE STREAMS" /
"SESSION EXPIRED" / "SCOPE CHANGED — RESTART LIVE" whenever
`connectionState` reads `'live'`/`'paused'` but the source's own state is
`NO_ACTIVE_TARGETS`/`EXPIRED`/`STALE`; `DEGRADED` still reads "LIVE", with
an appended `N/M active` count — the session genuinely *is* still live,
just incomplete. Tests: 5 new dedicated override tests in
`LiveTailPanel.test.tsx`.

**5. Per-target warning state retained only the single most-recently-
emitted warning.** The original design used
`Sinks.many().multicast().onBackpressureBuffer()` emitting a bare
`List<String>` each time — target A stopping, then target B also
stopping, meant the channel's latest value contained only B's warning;
A's still-true condition was silently lost from any *new* read of the
channel (though not from ones already delivered). **Fix:** the channel
now carries `LiveSourceStatus` — a full CURRENT snapshot recomputed from
a live `SessionRuntimeState` (a bounded `ConcurrentHashMap<targetKey,
TargetPhase>` plus stop reasons, overlong count, expired/stale flags) on
every mutating event, so the *latest* emission always reflects every
target's current phase, never only whichever one most recently changed.
Tests: `statusRetainsEveryCurrentlyStoppedTargetsTruth_notOnlyTheLastOneToFail`
plus the full `statusRunning_*`/`statusDegraded_*`/`statusReconnecting_*`/
`statusNoActiveTargets_*`/`statusExpired_*` matrix in
`OpenShiftLiveTailProviderTest`.

**6. Connection-generation and scope changes during an immutable live
snapshot were not actively surfaced.** The "old session never migrates
onto new credentials" invariant held throughout (this was never a
security gap) — but there was also no mechanism that noticed a
generation or scope change and did anything about it; an old, healthy
HTTP stream would just keep running against data that no longer reflected
the user's current connection/selection. **Fix:** a bounded, in-memory-
only periodic check (`OpenShiftLiveProperties#getStalenessCheckInterval()`,
reading only already-captured `OpenShiftSession` state — never a
cluster/Watch call) detects either condition and marks the session
`STALE`, which `takeUntilOther(staleSignal)` uses to terminate every
target stream. Tests:
`generationChangeMarksTheOldSessionStaleAndStopsIt_neverMigratesCredentials`,
`scopeChangeWhileImmutableSnapshotActiveIsSurfacedAsStale`.

### 13.2 Validation (review recovery pass)

| Check | Result |
|---|---|
| Backend compile (`./mvnw -q -o clean compile`) | `PASS` |
| Backend full test suite (`./mvnw -q -o clean test`) | `PASS` — exit 0, 0 failures/errors, run 3 times consecutively with no flakiness (incl. the new timing-sensitive concurrency/staleness tests) |
| `OpenShiftLiveTailProviderTest` alone | `PASS` — 31/31, run 3 times consecutively |
| `OpenShiftApiClientLiveStreamTest` alone | `PASS` — all decoder/streaming tests green under the new `DecodedLine` shape |
| Frontend typecheck (`npm run typecheck`) | `PASS` |
| Frontend production build (`npm run build`) | `PASS` |
| Frontend unit suite (`npx vitest run`) | `PASS` — 773/773 |
| Real running backend (`SPRING_PROFILES_ACTIVE=dev`, freshly rebuilt) `/api/v1/sources` | `PASS` — confirmed `openshift.capabilities.liveTail == true` from the reworked code |
| Playwright — `os-1a-openshift-connection.spec.ts` + `phase-j-live-tail.spec.ts` (targeted, real browser) | `PASS` — 24/24, no regression from the recovery pass |
| Playwright — full suite | `PASS` — 287/287 |
| `TEST-INFRA-1` PNG restoration after every E2E run | `PASS` — verified empty PNG diff after each of the two full-suite runs this session |

### 13.3 Files changed (review recovery pass, in addition to §10/§11)

Backend:
- `backend/src/main/java/com/logexplorer/core/model/LiveSourceStatus.java` (new)
- `backend/src/main/java/com/logexplorer/core/model/LiveFollowResult.java` (`warnings: Flux<List<String>>` → `status: Flux<LiveSourceStatus>`)
- `backend/src/main/java/com/logexplorer/source/LogSource.java` (`followWithWarnings` → `followWithStatus`)
- `backend/src/main/java/com/logexplorer/source/openshift/OpenShiftApiClient.java` (`DecodedLine`; `LiveLineDecoder`'s `discardingOverlong` mode; `followPodLog`'s `tailLines` now a real per-call parameter)
- `backend/src/main/java/com/logexplorer/source/openshift/OpenShiftLiveTailProvider.java` (rewritten: tailLines-per-attempt, `budgetBasis`, `gatedFollow`/`acquirePermit`, `SessionRuntimeState`, staleness monitor)
- `backend/src/main/java/com/logexplorer/source/openshift/OpenShiftLogSource.java` (`followWithStatus` override)
- `backend/src/main/java/com/logexplorer/api/live/LiveTailService.java` (`followWithStatus` wiring; `StatusPayload` gained `liveSourceState`/`resolvedTargets`/`activeTargets`/`reconnectingTargets`/`stoppedTargets`)
- `backend/src/main/java/com/logexplorer/config/OpenShiftLiveProperties.java` (`connectPermitTimeout`, `stalenessCheckInterval`)
- Rewritten tests: `OpenShiftApiClientLiveStreamTest` (DecodedLine shape, corrected overlong-line semantics), `OpenShiftLiveTailProviderTest` (31 tests, largely new)

Frontend:
- `frontend/src/features/live/liveTailTypes.ts` (`LiveSourceState`, `LiveSourceStatusView`, `NOMINAL_SOURCE_STATUS`; `LiveStatusPayload` extended)
- `frontend/src/features/live/useLiveTail.ts` (`sourceWarnings` → `sourceStatus`)
- `frontend/src/features/live/LiveTailPanel.tsx` (`sourceStatusBadge` override; DEGRADED active/resolved count)
- Updated tests: `useLiveTail.test.ts`, `LiveTailPanel.test.tsx` (5 new override tests), `useLiveKeyboardShortcuts.test.ts` (mock handle field)

No `frontend/e2e/*.spec.ts` changes were needed this pass — the existing
capability pin from the original implementation pass required no update.

## 14. OS-1E FINAL IMPLEMENTATION — approved live contract (exchangeToFlux establishment, exact long-line boundary, partial-final-line contract, CONNECTING state, terminal-SSE grace-close)

A separate, owner-authorized text-only design-closure pass treated §13's
own implementation as INPUT, not authority, and found it still contained
one real defect the review-recovery pass had not caught, plus five
genuine design gaps. This section records the resulting FINAL
implementation, executed exactly per the approved contract (no redesign
during implementation). None of the six items touch
`ContextTargetProofCodec`/`ConnectionOperationSnapshot`/`resolveTargetPlan`,
and none reopen any OS-1B/OS-1C/OS-1D/§13 `VERIFIED` requirement.

### 14.1 Findings and fixes

**1. A target was marked `ACTIVE` at `followTarget()` entry, before any
HTTP response.** The review-recovery pass (§13) correctly bounded connect
admission by `maxConcurrency`, but a target was still flagged `ACTIVE` the
moment `followTarget()` began, not when the upstream actually established
a connection. A target queued behind `maxConcurrency` admission (waiting
for a permit) could therefore be displayed as active before it had even
attempted to connect — the worked example that surfaced this:
`resolvedTargets=10, maxConcurrency=2` could show `activeTargets=10,
state=RUNNING`. **Fix:** `OpenShiftApiClient#followPodLog` now uses
WebClient `exchangeToFlux` instead of `.retrieve().bodyToFlux(...)`. An
HTTP `2xx` response invokes a caller-supplied `onEstablished` callback
exactly once, before the response body is ever subscribed to; a non-2xx
response routes through `response.createException().flatMapMany(Flux::error)`,
reproducing `.retrieve()`'s own exception behavior exactly (all existing
`classify()`-based `OpenShiftApiException.Kind` mapping — 401/403/404/TLS/
network/timeout — is unchanged). `followTarget` now marks the target
`CONNECTING` at entry and only transitions it to `ACTIVE` via
`onEstablished`. Tests: `OpenShiftLiveTailProviderTest` CONNECT-1 through
CONNECT-6 (`connect1_targetIsConnectingNotActiveUntilEstablished` ..
`connect6_permitTimeoutReleasesConcurrencyCapacityButNeverMarksActive`).

**2. A physical line of exactly `maxLineBytes` bytes followed by a real
newline was falsely reported truncated.** `LiveLineDecoder#onChunk` wrote
each incoming byte to the buffer first, then checked `buffer.size() >=
maxLineBytes` — so a line of exactly `maxLineBytes` content bytes reached
the overflow branch one byte before its own terminating newline could
ever be seen. **Fix:** the check is now pre-write and newline-first: `if
(b == '\n') { emit untruncated }`, `else if (buffer.size() ==
maxLineBytes) { emit truncated; enter discardingOverlong }`, `else {
buffer.write(b) }` — a newline is always checked before the overflow
branch, so a line of exactly `maxLineBytes` bytes followed by a real
newline never reaches the overflow branch at all. Tests:
`OpenShiftApiClientLiveStreamTest#lineBoundary1_exactlyMaxLineBytesFollowedByNewlineIsNotTruncated`,
`#lineBoundary2_oneByteOverMaxLineBytesIsTruncatedAtExactlyMaxLineBytes`,
`#lineBoundary3_...` (the pre-existing overlong-line tests from §13 were
re-verified passing unchanged against the new logic).

**3. No final-partial-line flush existed for any termination cause.** A
clean EOF, an error, or an explicit Stop/cancellation with a
buffered-but-unterminated trailing fragment all silently discarded that
fragment — no code path ever flushed it. **Fix:** three distinct, tested
outcomes for three distinct termination causes: (a) clean EOF —
`LineDecodingSubscriber#hookOnComplete` calls the new pure
`LiveLineDecoder#flushPartial()` and emits exactly one final `DecodedLine`
marked `unterminated=true`, surfaced as a bounded `UNTERMINATED_LIVE_LINE`
count; (b) error/transport-failure — `hookOnError` discards the fragment
silently but invokes the new `onPartialDroppedByError` callback exactly
once if content was buffered, surfaced as a bounded `PARTIAL_LINE_DROPPED`
count; (c) explicit Stop/cancellation — `hookOnCancel` silently discards
with no warning at all, deliberately never invoking
`onPartialDroppedByError` (a user-initiated Stop is not a data-loss
condition worth warning about). `DecodedLine` gained a third field:
`record DecodedLine(String content, boolean truncated, boolean
unterminated)`. Tests: `OpenShiftApiClientLiveStreamTest`
(`flushPartial_*` pure-decoder tests; `partialLineA_*` through
`partialLineD_*` reactive tests covering clean EOF, error, and
cancellation); `OpenShiftLiveTailProviderTest#unterminatedFinalLineBecomesAnEventAndReachesRuntimeStatusAsABoundedCount`,
`#partialLineDroppedByErrorReachesRuntimeStatusAsABoundedCount`.

**4. No `connectingTargets` count/state existed in `LiveSourceStatus`.**
§13's `LiveSourceStatus` tracked resolved/active/reconnecting/stopped
counts, but a target admitted-but-not-yet-established had no distinct
representation, and the very first status snapshot of a session (before
any target had even started its first connect attempt) could read as
all-zero counts, which the derivation formula would misread as
`NO_ACTIVE_TARGETS`. **Fix:** `LiveSourceStatus.State` gains `CONNECTING`;
`LiveSourceStatus` gains a `connectingTargets` count satisfying the
invariant `resolvedTargets = connectingTargets + activeTargets +
reconnectingTargets + stoppedTargets` for every snapshot. Session state is
derived by exact priority `STALE > EXPIRED > RUNNING > CONNECTING >
DEGRADED > RECONNECTING > NO_ACTIVE_TARGETS` — one documented, tested
completion of a genuine gap in the literal owner formula (some targets
still connecting, some already permanently stopped, none active/
reconnecting → `CONNECTING`, not `NO_ACTIVE_TARGETS`; this closes the gap
without changing any owner-specified worked example's outcome).
`SessionRuntimeState`'s constructor now takes the full target list and
seeds every target's phase to `CONNECTING` synchronously before the
session's first status push, closing the false-initial-`NO_ACTIVE_TARGETS`
reading. Tests: `OpenShiftLiveTailProviderTest` state-derivation matrix
(incl. `stateConnecting_evenWithSomeAlreadyPermanentlyStopped_untilTheOutcomeIsFullyKnown`)
and initial-snapshot tests.

**5. Establishment becoming its own signal risked conflating
`STREAM_ACTIVE` with `OUTAGE_RECOVERY_BUDGET_RESET`.** Once a `2xx`
response alone could mark a target `ACTIVE`, there was a risk that the
same signal would also be used to reset the bounded reconnect-attempt
budget — which would be wrong, since establishment proves nothing about
whether real data actually resumed flowing. **Fix:** explicitly separated
— `receivedRealDataThisAttempt` (the sole input to `budgetBasis`, §13's
own `REAL_RECOVERY` mechanism) is set only by `.doOnNext` on the decoded
line stream, never by the `onEstablished` callback. A reconnect attempt
that establishes a `2xx` connection but never receives a line (e.g. an
idle pod) still counts fully against `maxReconnectAttempts` on its next
failure. Test:
`OpenShiftLiveTailProviderTest#establishmentAloneWithoutGenuineDataDoesNotResetTheReconnectBudget`
(a dedicated regression proving establishment-only attempts still exhaust
the budget deterministically).

**6. A terminal SSE session had no bounded grace-close, and the
frontend's generic `EventSource` auto-reconnect could not distinguish a
deliberate terminal close from an ordinary transport failure.** A session
that reached `NO_ACTIVE_TARGETS`/`EXPIRED`/`STALE` correctly stopped
producing new log/status events, but the SSE connection itself rode the
full `connectionTimeout` on the wire — and if the server ever did close
it, the browser's `EventSource` API gives no way to distinguish that from
a network blip, so the frontend's existing bounded generic reconnect logic
could keep trying to reconnect to a session that will never resume.
**Fix (backend, generic — `LiveTailService`, not OpenShift-specific):** a
new `LiveSourceStatus.State#isTerminal()` method; a bounded, one-shot,
CAS-guarded grace-close timer (`terminalGrace = min(2×heartbeatInterval,
10s)`) starts the first time a terminal state is observed in the status
stream, firing a `Sinks.Empty<Void> terminalCloseSignal` that
`Flux.merge(logEvents, statusTracker, status).takeUntilOther(...)`
consumes to close the *entire* SSE response (heartbeat included); an
explicit Stop may still close immediately, unaffected. **Fix (frontend —
`useLiveTail.ts`):** a new `sourceStatusRef` mirrors `sourceStatus` state
synchronously (read inside the async `onerror` EventSource callback to
avoid a stale-closure read); `onerror` now checks
`isTerminalSourceState(sourceStatusRef.current.state)` (exported from
`liveTailTypes.ts`) *before* the existing generic bounded-reconnect logic
— if terminal, it transitions straight to `'stopped'` (events retained, no
reconnect timer armed) instead of scheduling a reconnect; ordinary
non-terminal transport failures are entirely unaffected and continue to
use the existing bounded generic reconnect. `LiveTailPanel.tsx`'s
`sourceStatusBadge` guard is widened to include `connectionState ===
'stopped'` so the specific terminal reason (SESSION EXPIRED / SCOPE
CHANGED — RESTART LIVE / NO ACTIVE STREAMS) stays visible after this new
path fires, while an ordinary user-initiated Stop (source state still
RUNNING/DEGRADED/CONNECTING/RECONNECTING) is unaffected and still shows
the plain "STOPPED" label; a new `CONNECTING` badge case was also added.
Docker/Fixture (always NOMINAL/RUNNING, never terminal) are unaffected by
construction. Tests: `useLiveTail.test.ts` (new terminal-suppresses-
reconnect describe block, 5 tests, incl. one using
`MockEventSource.instances.length` before/after `vi.advanceTimersByTime`
to prove no new `EventSource` is created after a terminal stop — the
initial `.url`-comparison approach was rejected during authoring because a
new `EventSource` would carry an identical URL and the comparison would
trivially pass regardless); `LiveTailPanel.test.tsx` (3 new tests: the
CONNECTING badge, terminal-reason-preserved-after-stop, ordinary-Stop-
unaffected).

### 14.2 Validation (final implementation pass)

| Check | Result |
|---|---|
| Backend compile (`./mvnw -q -o clean compile`) | `PASS` |
| Backend full test suite (`./mvnw -q -o clean test`) | `PASS` — exit 0, 0 `ERROR]` matches |
| `OpenShiftLiveTailProviderTest` + `OpenShiftApiClientLiveStreamTest` (targeted) | `PASS` — 69/69 (41 + 28), `Tests run: 69, Failures: 0, Errors: 0, Skipped: 0` |
| Frontend typecheck (`npm run typecheck`) | `PASS` |
| Frontend production build (`npm run build`) | `PASS` |
| `useLiveTail.test.ts` + `LiveTailPanel.test.tsx` (targeted) | `PASS` — 92/92 |
| Frontend full unit suite (`npx vitest run`) | `PASS` — 782/782, 67/67 test files |
| Playwright — full suite | `PASS` — 287/287 |
| `TEST-INFRA-1` PNG restoration after the full E2E run | `PASS` — `git checkout --` applied to every touched historical PNG under `docs/verification/`; empty PNG diff confirmed afterward |
| `git status --porcelain` (unrelated-change audit) | `PASS` — exactly the 13 OS-1E-final-implementation files (6 backend main/test, 5 frontend main/test, 2 docs), no unrelated diff, no binary diff |

### 14.3 Files changed (final implementation pass, in addition to §10/§11/§13.3)

Backend:
- `backend/src/main/java/com/logexplorer/source/openshift/OpenShiftApiClient.java` (`exchangeToFlux`; `DecodedLine` gains `unterminated`; `LiveLineDecoder` pre-write overflow reorder; `hasPartialContent`/`flushPartial`; `LineDecodingSubscriber` gains `onPartialDroppedByError` and distinct `hookOnComplete`/`hookOnError`/`hookOnCancel` semantics)
- `backend/src/main/java/com/logexplorer/core/model/LiveSourceStatus.java` (`connectingTargets`; `State.CONNECTING`; `State#isTerminal()`)
- `backend/src/main/java/com/logexplorer/source/openshift/OpenShiftLiveTailProvider.java` (rewritten: `markConnecting`/`onEstablished` wiring, `gatedFollow`'s permit-timeout never calls `onEstablished`, `receivedRealDataThisAttempt` driven only by `.doOnNext`, `SessionRuntimeState` seeds `CONNECTING` phases from the full target list, widened `snapshot()` derivation formula, `incrementUnterminated`/`incrementPartialDropped`, `appendBoundedCount` helper)
- `backend/src/main/java/com/logexplorer/api/live/LiveTailService.java` (`StatusPayload` gains `connectingTargets`; terminal-SSE grace-close: `terminalGrace`, `terminalCloseSignal`, `terminalTimerStarted`, `takeUntilOther`)
- Rewritten tests: `OpenShiftApiClientLiveStreamTest` (69 total with `OpenShiftLiveTailProviderTest` — new line-boundary and partial-line tests), `OpenShiftLiveTailProviderTest` (41 tests: `ScriptedAttempt` harness, CONNECT-1..6, state-derivation matrix, budget-separation regression)

Frontend:
- `frontend/src/features/live/liveTailTypes.ts` (`LiveSourceState` gains `'CONNECTING'`; new `isTerminalSourceState`; `connectingTargets` field)
- `frontend/src/features/live/useLiveTail.ts` (`sourceStatusRef`; terminal-state check inside `onerror` before the generic reconnect path)
- `frontend/src/features/live/LiveTailPanel.tsx` (badge guard widened to `'stopped'`; new `CONNECTING` case)
- Updated tests: `useLiveTail.test.ts` (terminal-reconnect-suppression describe block), `LiveTailPanel.test.tsx` (CONNECTING + terminal-reason tests)

Documentation:
- `docs/governance/OWNER_REQUIREMENTS_REGISTER.md` (new `### 12m.` section, OS-1E-23..32, new §14 narrative paragraph)
- `docs/architecture/OPENSHIFT_DIRECT_LOGGING_ARCHITECTURE_ASSESSMENT.md` (new `[EVIDENCE, established by the OS-1E FINAL IMPLEMENTATION]` note in §20)

No `frontend/e2e/*.spec.ts` changes were needed this pass — the existing
capability pin required no update, and the full E2E suite passed
unchanged (287/287).

**Stacked-PR CI note.** PR #43's base is `os/1d-openshift-context-correlation`,
not `main`; `.github/workflows/ci.yml` only triggers on `pull_request`/
`push` to `main`, so PR #43 structurally never receives automatic CI. All
validation above was performed and is reported locally. This establishes
`IMPLEMENTATION_COMPLETE`, not `MERGE_AUTHORIZED` — merge authorization
remains an explicit owner decision, unchanged from every prior OS-1x
slice's own stacked-PR posture.

## 15. OS-1E FINAL TERMINAL STATUS DELIVERY FIX — the periodic heartbeat alone could not guarantee terminal-state delivery before SSE close

An independent review of §14's own terminal-SSE grace-close found one
remaining contract defect: the periodic heartbeat, by itself, was NOT
sufficient to guarantee the browser ever learned a terminal source state
before the SSE connection closed.

### 15.1 The defect

`LiveTailProperties`' default `heartbeatInterval` is 15 seconds.
`terminalGrace` is `min(2×heartbeatInterval, 10s)`, so with the default
`heartbeatInterval` the formula's `10s` branch is always taken —
`terminalGrace` defaults to exactly 10 seconds, strictly **less** than the
15-second heartbeat. §14's `LiveTailService` delivered a terminal
`LiveSourceStatus` to the browser only through `statusTracker`, which
updated an in-memory `latestStatus` reference but emitted no SSE event of
its own — the browser only ever learned the CURRENT status via the next
periodic heartbeat tick (`Flux.interval(heartbeatInterval)`). The
resulting race, exactly as this review found it:

```
t=0   normal heartbeat sends RUNNING
t=1   source becomes STALE / EXPIRED / NO_ACTIVE_TARGETS
t=1   terminal grace timer starts
t=11  SSE closes (terminalGrace elapsed)
t=15  the next heartbeat WOULD have carried the terminal state, but the
      connection is already closed
```

The frontend's `onerror` handler (`useLiveTail.ts`) therefore still read
`sourceStatusRef.current.state` as the LAST status it actually received —
`RUNNING` — and incorrectly scheduled the generic bounded reconnect,
violating the contract §14 itself established: `STALE`/`EXPIRED`/
`NO_ACTIVE_TARGETS` must suppress the automatic `EventSource` reconnect.
The frontend code, and the terminal-suppression logic itself, were never
wrong — the backend simply never delivered the terminal truth in time for
that logic to see it.

### 15.2 The fix

`LiveTailService`'s `statusTracker` now enforces the invariant
`TERMINAL_STATUS_DELIVERED_BEFORE_SSE_CLOSE = ALWAYS`:

- The first time `result.status()` emits a terminal
  `LiveSourceStatus` (`state().isTerminal()`), `statusTracker` now emits
  ONE immediate `"status"` SSE event carrying that exact terminal
  snapshot — never waiting for the next periodic heartbeat tick — and
  only THEN starts the (unchanged) `terminalGrace` timer. A single
  `AtomicBoolean` CAS guard (`terminalEmitted`) ensures this fires at
  most once per session, so a session whose status flux emits several
  terminal-adjacent updates never floods the client with duplicate
  terminal events.
- Non-terminal statuses are unaffected — they continue to reach the
  browser only via the existing periodic heartbeat, exactly as before;
  this fix does not turn every source-status mutation into its own SSE
  event, only the one that matters for connection-close safety.
- The grace timer itself (previously a detached
  `Mono.delay(terminalGrace).subscribe(tick -> ...)` — a fire-and-forget
  subscription with its OWN lifecycle, independent of the SSE
  connection's own cancellation) is now returned as part of the very
  `Flux` `statusTracker` produces (`Flux.concat(immediateTerminalStatus,
  graceThenClose)`), which is itself only ever subscribed to as one arm
  of the top-level `Flux.merge(...)`. It therefore shares that merge's
  exact subscription lifecycle and is unconditionally disposed the moment
  that subscription is cancelled for ANY reason — client disconnect,
  explicit Stop (observed at this layer as the same HTTP-connection
  cancellation), or the outer `connectionTimeout`. No orphan timer.

Required ordering (now guaranteed): terminal source snapshot observed →
terminal status SSE emitted → grace timer starts/runs → SSE closes after
grace. No frontend code changed — `useLiveTail.ts`'s terminal-suppression
logic (§14) was already correct; it simply never had the terminal status
it needed, in time, until now.

### 15.3 Tests

`LiveTailServiceTest` (backend), using the REAL default
`heartbeatInterval` (15s, never overridden, specifically so the defect's
own exact numeric relationship — 15s heartbeat &gt; 10s grace — is what's
actually verified, not a scaled-down stand-in):

- `terminalStatusA_staleIsDeliveredImmediatelyNotOnTheNextHeartbeat`,
  `terminalStatusB_expiredIsDeliveredImmediatelyNotOnTheNextHeartbeat`,
  `terminalStatusC_noActiveTargetsIsDeliveredImmediatelyNotOnTheNextHeartbeat`
  — one per terminal state (mission tests A/B/C): the very first SSE
  event received (via `StepVerifier.withVirtualTime`) is the terminal
  `"status"` event, with `expectNoEvent(terminalGrace - 200ms)` proving
  nothing else (not a heartbeat, not the close) arrives before grace
  elapses, and `verifyComplete()` proving the connection completes
  exactly at grace — well before the 15s heartbeat would ever have fired
  (mission test D, folded into the same assertion chain).
- `terminalStatusE_cancellationDuringGraceCancelsTheTerminalTimerNoOrphanWork`
  (mission test E): disposes the subscription while still inside the
  grace window and asserts the underlying status source itself observes
  `cancel()` — the standard, idiomatic proof in this codebase that
  Reactor's own cancellation propagation reached the grace timer's
  hosting operator, so no orphan timer keeps running after teardown.

Frontend tests F and G (mission §6) required no new test: the existing
`useLiveTail.test.ts` "terminal source state suppresses the generic
automatic reconnect" describe block (§14) already drives the exact
sequence these ask for — `latestMockEventSource().emit('status', {...
terminal...})` (a real terminal `"status"` SSE event, exactly what this
fix now guarantees the backend sends immediately) followed by
`latestMockEventSource().emitError()` (the connection closing) — and
already asserts `connectionState` becomes `'stopped'` with no new
`EventSource` created (test F), while the sibling
"NON-terminal source state... still uses the ordinary generic reconnect"
test already asserts the generic reconnect still fires for an ordinary
transport failure (test G). Since no frontend production code changed in
this pass, this existing coverage is the valid, sufficient proof for F/G;
re-running it (unchanged) confirms no regression.

### 15.4 Validation

| Check | Result |
|---|---|
| Backend compile (`./mvnw -q -o clean compile`) | `PASS` |
| `LiveTailServiceTest` (targeted, 13 tests: 9 pre-existing + 4 new) | `PASS` — 13/13, run 4 times consecutively with no flakiness |
| Backend full test suite (`./mvnw -q -o clean test`) | `PASS` — exit 0, 0 `ERROR]` matches, run twice |
| `useLiveTail.test.ts` + `LiveTailPanel.test.tsx` (targeted) | `PASS` — 92/92, unchanged (no frontend production code touched) |
| Frontend typecheck (`npm run typecheck`) | `PASS` |
| Frontend production build (`npm run build`) | `PASS` |
| Frontend full unit suite (`npx vitest run`) | `PASS` — 782/782, unchanged |
| Playwright — full suite | see final mission response |
| `TEST-INFRA-1` PNG restoration after the full E2E run | see final mission response |

### 15.5 Files changed (terminal status delivery fix)

Backend:
- `backend/src/main/java/com/logexplorer/api/live/LiveTailService.java` (`statusTracker` now emits one immediate terminal `"status"` SSE event before arming the grace timer; the grace timer is now part of `statusTracker`'s own `Flux` rather than a detached `Mono.delay(...).subscribe(...)`)
- `backend/src/test/java/com/logexplorer/source/StubLogSource.java` (new `withStatusFlux`, `followWithStatus` override — lets tests script a `LiveSourceStatus` sequence without a real OpenShift adapter)
- `backend/src/test/java/com/logexplorer/api/live/LiveTailServiceTest.java` (4 new tests, §15.3 above)

No frontend files changed — the frontend's terminal-reconnect-suppression
logic (§14) was already correct; only the backend's delivery timing
needed to change.

**Correction recorded, history preserved.** §14's own "terminal-SSE
grace-close" and "frontend terminal-state reconnect suppression" rows
(`OWNER_REQUIREMENTS_REGISTER.md` OS-1E-31/OS-1E-32) are neither reopened
nor silently rewritten — both mechanisms are unchanged and remain
correct. This section records a genuine, narrow, additional correction:
the periodic heartbeat alone was insufficient to guarantee terminal-state
delivery, because the default heartbeat interval (15s) exceeds the
default terminal grace (10s). The final invariant going forward is
`TERMINAL_STATUS_IMMEDIATE_DELIVERY_BEFORE_CLOSE`. `UNTRACKED_OWNER_REQUIREMENTS=0`.
slice's own stacked-PR posture.
