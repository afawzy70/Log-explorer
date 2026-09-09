# Audit 08 — Live Tail

**Scope:** The OLD app's real-time log tailing (`LiveTail`), including SSE transport, state machine, buffer bounds, pause/resume/follow, reconnection, filters, and backend semantics.

> **Provenance status:** OLD = verified from source (this repo). NEW = **UNVERIFIED** (NEW app unreachable).

---

## 1. Frontend `LiveTail.tsx` (609 lines)

### Start flow
- Requires `LiveConfirmDialog` confirmation (focus trap, inert background, Escape) before starting.
- App guarantees **historical actions exit live mode first** (`App.tsx:755-763`) — live is separate from search.

### State machine (`utils/tail.ts` `ConnectionStatus`)
`idle → connecting → live → paused → reconnecting → failed → stopped` (+ `Error`).

States: Connecting / Live / Paused / Reconnecting / Stopped / Error.

### Buffer bounds (constants in `tail.ts`)
| Bound | Value | Behaviour |
|-------|-------|-----------|
| MAX_DISPLAYED | 1000 | displayed buffer cap; overflow → dropped counter. |
| MAX_PAUSE_BUFFER | 100 | while paused, buffer cap; overflow counted as dropped. |
| MAX_RECONNECT_ATTEMPTS | 5 | max reconnect retries. |
| RECONNECT_BASE_MS | 1000 | exponential backoff base. |
| RECONNECT_MAX_MS | 15000 | backoff cap. |
| DEDUPE_CAPACITY | 300 | replay-dedup window. |
| CLOCK_SKEW_THRESHOLD_MS | 120000 | skew flag threshold. |

### Pause / resume / follow / clear / stop
- **Pause** — freezes rendering; connection stays open; buffering continues (≤100).
- **Resume** — rendering resumes; buffering continues.
- **Clear** — clears the display buffer.
- **Follow-newest** toggle — when off, shows `unseenCount` + "new-event indicator"; display reversed when follow is on.
- **Stop** — closes SSE connection; cleanup on unmount/source-change.
- Dropped-warning appears **once** (not repeated).

### Filters (tail-side)
`serviceFilter`, `severityFilter`, `textFilter` filter the live view.

### Dedup
`TailDeduper` (bounded LRU window) drops replay-duplicates after reconnect.

### Reconnection
Bounded exponential backoff with ±20% jitter, cap 15s; client owns reconnect (no EventSource auto-reconnect to avoid competing loops); watchdog force-aborts after `DEFAULT_STALE_TIMEOUT_MS=45s` of no data.

## 2. Transport / SSE (`api/client.ts tail()`)

- `GET /api/v1/logs/tail` query params: `sourceId`, repeated `services`, repeated `levels`, `text`, `limit` (default 1000), `timeoutSeconds`, `sessionId`, `liveSessionId`, `afterTimestamp` (epoch ms).
- SSE event types: `event` (a log event), `dropped`, `heartbeat`, `unsupported`, `error`.
- `Last-Event-ID` header for resume; `liveSessionId` server-side resume boundary; `afterTimestamp` prevents replay.
- No automatic browser reconnect (caller owns it); single terminal `onComplete`.

## 3. Backend SSE (`LogTailController`)

- Produces `text/event-stream`; `Flux<ServerSentEvent<Map>>`.
- Service must advertise `LIVE_TAIL`; otherwise emits `unsupported` + completes.
- **Backpressure:** `onBackpressureBuffer(SSE_BUFFER_SIZE=256)` dropping+counting overflow; slow clients get `dropped` events + `droppedSinceLastEvent` in payloads.
- **Heartbeats** from a merged `Flux.interval` (default 15s cadence) so lagging clients still receive them.
- **Live boundary:** `resolveLiveSince(liveSessionId, afterTimestamp)` keeps a server-side per-session "now" (capped `MAX_LIVE_SESSIONS=10000`), holds resume point, clamps to now.
- **Concurrency cap:** `LogTailManager` (default max 10); rejects via error flux when full.
- **Timeout:** `.take(Duration.ofSeconds(timeoutSeconds))` when >0; errors → `error` SSE then normal completion (client reconnects).
- `SseResponseFilter` sets anti-buffering headers (Cache-Control no-cache, X-Accel-Buffering no, keep-alive).
- **limit param deliberately ignored for termination** — the follow stream never ends on a fixed count; clients own display bounding.

### Docker live implementation (`DockerComposeLogSource.streamLive(since)`)
- Bounds to events at/after `sinceEpochSeconds` (clamps non-positive/future → now to prevent unbounded historical replay).
- `Flux.create(BUFFER)`; a scan runnable (`Flux.interval` every 3s) discovers containers, attaches `streamContainerLogs` per new container, detaches/cancels on stop/removal.
- Per-container `lastDeliveredSec` for resume "exactly once" from just past last delivered second.
- Cancellation disposes rescan + all stream cancel runtimes.
- Blank/malformed lines skipped.

## 4. Real-data evidence

- INTEGRATION_REPORT: `DockerLiveIntegrationTest` 9/9; live stream received **19+ real events in 8s**; cancel/disconnect releases the Docker callback.
- UX_ACCEPTANCE_REPORT: `App.phase7.test` (confirmation flow), `LiveTail.test` (state transitions, bounds, pause-buffer overflow, clear, stop/unmount cleanup, reconnect, filters, follow).

## 5. Supported sources

| Source | LIVE_TAIL? | Notes |
|--------|-----------|-------|
| Docker Compose | **Yes** | via Docker stream. |
| Fixture (dev/test) | Yes | synthetic queue; empty unless fed. |
| OpenShift Loki | **No** | `streamLive()` returns `Flux.empty()`; not advertised. |

---

## Gaps / notes (OLD)

1. **No live tail for OpenShift/Loki** (stub `Flux.empty()`).
2. **Live is intentionally not a historical search**; near-real-time disclosure limit (documented).
3. **Buffer overflows drop, never block** — count reported (dropped warning once).
4. **Client-side reconnection is manual** (bounded, watchdog-protected).
