package com.logexplorer.source.loki.plan;

import com.logexplorer.core.query.ast.Comparison;
import com.logexplorer.core.query.ast.Operator;
import com.logexplorer.core.query.ast.QueryExpr;
import java.util.Optional;

/**
 * The Loki-side "planner" half of the query engine (IMPLEMENTATION_PLAN.md
 * "Phase E" scope item 4: "LogQL planner (Loki path)"). Its only job is to
 * spot one narrow, provably-safe optimization: a DSL query that is
 * <i>exactly</i> a single top-level {@code service = "..."} equality can
 * also be pushed into the LogQL selector as an exact-match label (the same
 * safety rule {@code LogQlSelectorBuilder} already applies to {@code
 * SearchRequest#services()} in Phase D — only {@code =}, never a regex
 * selector).
 *
 * <p>This is an optimization only, never a correctness requirement:
 * whatever this returns, {@code core.search.EventFilters} still applies
 * the exact same {@code QueryEvaluator} the Docker/fixture path uses to
 * every fetched event afterward (see {@code LokiLogSource#search}) — so a
 * missed or overly-conservative pushdown opportunity can never produce a
 * wrong result, only a less-narrow fetch. Everything else (level, message,
 * traceId, ... — fields that live inside the JSON log body, not as Loki
 * stream labels) is deliberately never attempted here: pushing those down
 * would mean generating LogQL line/label-extraction stages from arbitrary
 * user input, a materially larger feature this phase does not build
 * (IMPLEMENTATION_PLAN.md "Phase D"'s own established rule: "push down
 * safe filters; exact post-filtering when pushdown is unsafe or lossy" —
 * everything but namespace/single-service equality is unsafe/lossy here).
 */
public final class LogQlDslPlanner {

  private LogQlDslPlanner() {
  }

  public static Optional<String> extractServiceEquality(QueryExpr expr) {
    if (expr instanceof Comparison comparison
        && "service".equals(comparison.field())
        && comparison.operator() == Operator.EQ) {
      return Optional.of(comparison.value());
    }
    return Optional.empty();
  }
}
