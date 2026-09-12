package com.logexplorer.core.model;

import java.util.List;

/**
 * OS-1E review recovery — the CURRENT, cumulative truth of one live
 * session's target health, not an append-only event log. Every emission
 * on {@link LiveFollowResult#status()} is a full snapshot superseding the
 * previous one — a caller (e.g. {@code LiveTailService}) that samples
 * only the most recently emitted value (exactly what its own heartbeat
 * already does) always sees every target's current condition, not merely
 * whichever target most recently changed.
 *
 * <p>Deliberately request/session-scoped — built fresh by each {@code
 * follow()} call, never a singleton/mutable field on a source bean (the
 * same discipline {@link SourceSearchOutcome} established for search,
 * extended to an ongoing stream) — so two concurrent Live sessions (e.g.
 * two browser tabs against one OpenShift connection) never see each
 * other's target health.
 *
 * @param state the single, top-level truth this session's caller should
 *     act on first — see {@link State}'s own javadoc for the exact
 *     derivation rule
 * @param resolvedTargets how many (pod, container) targets this session
 *     resolved and is/was attempting to tail — {@code 0} for every
 *     source with no target concept at all (Docker/Fixture/Loki use
 *     {@link #NOMINAL} and never populate this)
 * @param activeTargets currently streaming targets
 * @param reconnectingTargets targets currently in a bounded backoff
 *     reconnect attempt
 * @param stoppedTargets targets that have permanently stopped (401/403/
 *     404, or exhausted their bounded reconnect budget)
 * @param warnings human-readable, already-safe (pod/container identity
 *     and reason codes only, never a raw response body or credential)
 *     CURRENT reasons — one entry per condition still true right now,
 *     never an ever-growing history of every condition that was ever
 *     true
 */
public record LiveSourceStatus(
    State state, int resolvedTargets, int activeTargets, int reconnectingTargets, int stoppedTargets,
    List<String> warnings) {

  public LiveSourceStatus {
    warnings = warnings == null ? List.of() : List.copyOf(warnings);
  }

  /**
   * The trivial, unchanging status every source without a per-target
   * concept reports (the {@link LogSource#followWithStatus} default).
   * {@code state=RUNNING} is correct here precisely because such a
   * source's own {@code follow()} either streams successfully or fails
   * the whole reactive chain outright — there is no partial-target
   * condition for it to ever report otherwise.
   */
  public static final LiveSourceStatus NOMINAL = new LiveSourceStatus(State.RUNNING, 0, 0, 0, 0, List.of());

  /**
   * OS-1E review recovery mission §12/§27 — the exact states a live
   * session's runtime health can honestly be in, derived from target
   * counts (never inferred from string warning text alone):
   *
   * <ul>
   *   <li>{@link #RUNNING} — every resolved target is currently active
   *   (or {@code resolvedTargets == 0} for a source with no target
   *   concept, i.e. {@link #NOMINAL}).</li>
   *   <li>{@link #DEGRADED} — at least one target is active, but not
   *   every resolved target is (some reconnecting and/or some
   *   permanently stopped) — the session is genuinely still following
   *   logs, just not the complete resolved scope.</li>
   *   <li>{@link #RECONNECTING} — zero targets are currently active, but
   *   at least one is still within its bounded reconnect budget — no
   *   logs are flowing right now, but this is not yet a final state.</li>
   *   <li>{@link #NO_ACTIVE_TARGETS} — zero targets are active and zero
   *   are reconnecting (every resolved target permanently stopped, or
   *   zero targets were ever resolved) — a genuinely final state for
   *   this session; the frontend must not display this as plain LIVE.</li>
   *   <li>{@link #EXPIRED} — the OpenShift session itself expired (a 401
   *   was observed while this session's own captured connection
   *   generation was still current) — takes priority over the
   *   count-derived states above, since every target is affected
   *   identically by a lost token.</li>
   *   <li>{@link #STALE} — this live session no longer reflects the
   *   user's current OpenShift connection or scope (a reconnect changed
   *   the connection generation, or the selected project/workload/pod/
   *   container changed while this session's target snapshot stayed
   *   immutable) — the session has stopped itself; Live must be
   *   restarted to pick up the current state.</li>
   * </ul>
   */
  public enum State { RUNNING, DEGRADED, RECONNECTING, NO_ACTIVE_TARGETS, EXPIRED, STALE }
}
