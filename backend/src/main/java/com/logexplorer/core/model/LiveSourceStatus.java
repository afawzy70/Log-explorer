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
 * <p><b>OS-1E final implementation</b> — {@code connectingTargets} and
 * {@link State#CONNECTING} close a real defect the review-recovery pass
 * left open: a target waiting for connect-admission (bounded by {@code
 * maxConcurrency}) or with a request issued but not yet proven successful
 * has nowhere truthful to be counted without this field — it was
 * previously indistinguishable from {@code activeTargets} (the original
 * defect) or from nothing at all. The invariant below always holds for a
 * session with at least one resolved target.
 *
 * @param state the single, top-level truth this session's caller should
 *     act on first — see {@link State}'s own javadoc for the exact
 *     derivation rule
 * @param resolvedTargets how many (pod, container) targets this session
 *     resolved and is/was attempting to tail — {@code 0} for every
 *     source with no target concept at all (Docker/Fixture/Loki use
 *     {@link #NOMINAL} and never populate this). Invariant: {@code
 *     resolvedTargets == connectingTargets + activeTargets +
 *     reconnectingTargets + stoppedTargets}.
 * @param connectingTargets targets that have not yet proven themselves
 *     either way this attempt — waiting for a connect-admission permit,
 *     or a follow request is in flight with no {@code 2xx} response yet.
 *     Never conflated with {@code activeTargets} (evidence required) or
 *     with {@code reconnectingTargets} (which specifically means "has
 *     already proven it can fail this outage").
 * @param activeTargets targets whose current follow request received a
 *     successful ({@code 2xx}) response — a genuinely evidence-backed
 *     "this target is live" truth, independent of whether any log line
 *     has arrived yet (a quiet pod is still a successfully connected live
 *     stream).
 * @param reconnectingTargets targets currently in a bounded backoff
 *     reconnect attempt, having already proven at least one failure this
 *     outage
 * @param stoppedTargets targets that have permanently stopped (401/403/
 *     404, or exhausted their bounded reconnect budget)
 * @param warnings human-readable, already-safe (pod/container identity
 *     and reason codes only, never a raw response body or credential)
 *     CURRENT reasons — one entry per condition still true right now
 *     (or, for a repeating condition such as an overlong/unterminated/
 *     dropped line, one bounded growing COUNT, never one new string per
 *     occurrence) — never an ever-growing history of every condition
 *     that was ever true
 */
public record LiveSourceStatus(
    State state, int resolvedTargets, int connectingTargets, int activeTargets, int reconnectingTargets,
    int stoppedTargets, List<String> warnings) {

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
  public static final LiveSourceStatus NOMINAL = new LiveSourceStatus(State.RUNNING, 0, 0, 0, 0, 0, List.of());

  /**
   * OS-1E final implementation — the exact states a live session's
   * runtime health can honestly be in, derived from target counts (never
   * inferred from string warning text alone). Let {@code R}=resolved,
   * {@code C}=connecting, {@code A}=active, {@code Rc}=reconnecting,
   * {@code S}=stopped (always {@code R = C+A+Rc+S}). Evaluated in this
   * exact priority order — first match wins:
   *
   * <ol>
   *   <li>{@link #STALE} — a generation or scope change was detected;
   *   overrides everything else (deliberate teardown, unrelated to
   *   target health).</li>
   *   <li>{@link #EXPIRED} — a 401 was observed while this session's own
   *   captured connection generation was still current; overrides the
   *   count-derived states below since a lost token affects every target
   *   identically.</li>
   *   <li>{@link #RUNNING} — {@code R>0 AND A==R}: every resolved target
   *   is currently active.</li>
   *   <li>{@link #DEGRADED} — {@code A>0 AND A<R}: at least one target is
   *   active, but not every resolved target is (some connecting,
   *   reconnecting, and/or permanently stopped) — deliberately ONE
   *   bucket regardless of which — the session is genuinely still
   *   following logs, just not the complete resolved scope; {@code
   *   warnings} carries the "why."</li>
   *   <li>{@link #RECONNECTING} — {@code A==0 AND Rc>0}: no logs are
   *   flowing right now, but at least one target has already proven it
   *   can fail this outage and is actively retrying.</li>
   *   <li>{@link #CONNECTING} — {@code A==0 AND Rc==0 AND C>0}: every
   *   target still active in this outcome is on its first-ever attempt
   *   (this outage) — no target has proven either success or failure
   *   yet. (Also covers the narrower case where some targets have
   *   already permanently stopped while others are still connecting —
   *   the session outcome is not yet fully known either way, so
   *   {@code CONNECTING} remains the truthful label until every target
   *   has resolved one way or the other.)</li>
   *   <li>{@link #NO_ACTIVE_TARGETS} — {@code A==0 AND Rc==0 AND C==0}:
   *   every resolved target has permanently stopped, or zero targets
   *   were ever resolved ({@code R==0}) — a genuinely final state for
   *   this session; the frontend must not display this as plain LIVE.</li>
   * </ol>
   */
  public enum State {
    RUNNING, CONNECTING, DEGRADED, RECONNECTING, NO_ACTIVE_TARGETS, EXPIRED, STALE;

    /**
     * OS-1E final implementation (mission §18/§19) — a state from which
     * this Live session can never recover on its own: no future target
     * activity is possible without an explicit new {@code follow()} call
     * (Restart). Drives both the backend's terminal-SSE grace-close
     * ({@code LiveTailService}) and the frontend's suppression of the
     * generic automatic {@code EventSource} reconnect ({@code
     * useLiveTail.ts}) — the two ends of the same truth.
     */
    public boolean isTerminal() {
      return this == NO_ACTIVE_TARGETS || this == EXPIRED || this == STALE;
    }
  }
}
