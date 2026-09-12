package com.logexplorer.core.model;

import reactor.core.publisher.Flux;

/**
 * OS-1E — the result of starting one live tail: the event stream itself,
 * plus a correlated, request-scoped runtime-status channel truthfully
 * surfacing the CURRENT partial-live-state condition (which targets are
 * active/reconnecting/permanently stopped, and why) — mirrors the {@link
 * SourceSearchOutcome} precedent ("carried entirely by this call's own
 * return value, never a shared/mutable field") one layer up for an
 * ongoing stream rather than a single-shot result.
 *
 * <p><b>OS-1E review recovery</b> — {@link #status()} replaces the
 * original {@code Flux<List<String>>} "warnings" channel, which could
 * only ever report the single most recently emitted warning string,
 * silently losing an earlier still-true condition (target A stopped,
 * then target B also stopped — the channel used to report only B).
 * {@link LiveSourceStatus} is a full CURRENT snapshot on every emission,
 * so a caller sampling only the latest value (exactly what {@code
 * LiveTailService}'s own heartbeat does) always sees every target's
 * current condition.
 *
 * <p>Both {@link #events()} and {@link #status()} are built from the SAME
 * underlying live-session construction (one atomic snapshot capture, one
 * target resolution) inside {@link
 * com.logexplorer.source.LogSource#followWithStatus}, so a caller that
 * subscribes to both together (as {@code LiveTailService} does) observes
 * status that genuinely belongs to the exact stream it is watching —
 * never a second, independently-started live session that happens to
 * share nothing but a source id.
 *
 * <p>The default {@link
 * com.logexplorer.source.LogSource#followWithStatus} wraps {@link
 * com.logexplorer.source.LogSource#follow} with a {@link
 * #status()} of {@link LiveSourceStatus#NOMINAL}, which is exactly
 * correct for every source that has no partial-live-state concept at all
 * (Docker, Fixture, Loki) — only {@code source.openshift.OpenShiftLogSource}
 * overrides this.
 */
public record LiveFollowResult(Flux<CanonicalLogEvent> events, Flux<LiveSourceStatus> status) {
}
