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

## 9. Validation

| Check | Result |
|---|---|
| Backend compile (`./mvnw -q -o compile`) | `PASS` |
| Backend full test suite (`./mvnw -q -o test`) | `PASS` — exit 0, 0 failures, full suite (967+ pre-existing tests plus 26 new: 15 `OpenShiftApiClientLiveStreamTest` + 11 `OpenShiftLiveTailProviderTest`) |
| Frontend typecheck (`npm run typecheck`) | `PASS` |
| Frontend production build (`npm run build`) | `PASS` |
| Frontend unit suite (`npx vitest run`) | `PASS` — 767/767, incl. 7 new OS-1E tests in `useLiveTail.test.ts`/`LiveTailPanel.test.tsx` |
| Real running backend (`SPRING_PROFILES_ACTIVE=dev`) `/api/v1/sources` | `PASS` — confirmed `openshift.capabilities.liveTail == true` from a live, freshly-rebuilt process, not merely from source |
| Playwright — `os-1a-openshift-connection.spec.ts` + `phase-j-live-tail.spec.ts` (targeted, real browser) | `PASS` — 24/24, incl. the updated capability pin |
| Playwright — full suite | See §9a |
| `TEST-INFRA-1` PNG restoration after every E2E run | `PASS` — verified empty PNG diff after each run |

### 9a. Full Playwright E2E suite

Full-suite result recorded once the background run completes; see the
final mission response for the authoritative PASS/FAIL count and any
findings, plus confirmation that `TEST-INFRA-1`'s PNG-restoration
mitigation was applied afterward.

## 10. Files changed (backend)

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

## 11. Files changed (frontend)

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
