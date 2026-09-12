package com.logexplorer.core.model;

import java.util.List;
import reactor.core.publisher.Flux;

/**
 * OS-1E — the result of starting one live tail: the event stream itself,
 * plus a correlated, request-scoped warnings channel truthfully surfacing
 * partial-live-state conditions (a target hit its permission/not-found/
 * reconnect-exhausted stop, the resolved target set was capped) — mirrors
 * the {@link SourceSearchOutcome} precedent ("carried entirely by this
 * call's own return value, never a shared/mutable field") one layer up
 * for an ongoing stream rather than a single-shot result.
 *
 * <p>Both {@link #events()} and {@link #warnings()} are built from the
 * SAME underlying live-session construction (one atomic snapshot capture,
 * one target resolution) inside {@link
 * com.logexplorer.source.LogSource#followWithWarnings}, so a caller that
 * subscribes to both together (as {@code LiveTailService} does) observes
 * warnings that genuinely belong to the exact stream it is watching —
 * never a second, independently-started live session that happens to
 * share nothing but a source id.
 *
 * <p>The default {@link
 * com.logexplorer.source.LogSource#followWithWarnings} wraps {@link
 * com.logexplorer.source.LogSource#follow} with an always-empty {@link
 * #warnings()}, which is exactly correct for every source that has no
 * partial-live-state concept at all (Docker, Fixture, Loki) — only {@code
 * source.openshift.OpenShiftLogSource} overrides this.
 */
public record LiveFollowResult(Flux<CanonicalLogEvent> events, Flux<List<String>> warnings) {
}
