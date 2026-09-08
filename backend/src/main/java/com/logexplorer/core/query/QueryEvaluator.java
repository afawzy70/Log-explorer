package com.logexplorer.core.query;

import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.query.ast.And;
import com.logexplorer.core.query.ast.Comparison;
import com.logexplorer.core.query.ast.Operator;
import com.logexplorer.core.query.ast.Or;
import com.logexplorer.core.query.ast.QueryExpr;
import java.util.Locale;

/**
 * The in-memory predicate compiler (IMPLEMENTATION_PLAN.md "Phase E" scope
 * item 4, "Docker path") — direct, typed field comparisons against a
 * {@link CanonicalLogEvent}, nothing else. No {@code eval}, no reflection,
 * no expression-language evaluation of any kind (scope item 7): every
 * {@link QueryExpr} node maps to one fixed Java {@code switch} branch.
 *
 * <p>Also the correctness backbone for the Loki path: {@code
 * core.search.EventFilters} calls this same evaluator for every source
 * (fixture, Docker, Loki) after each adapter's own fetch — {@code
 * source.loki.plan.LogQlDslPlanner} only ever <i>narrows</i> what Loki
 * fetches as an optimization, it never replaces this check. Because the
 * exact same evaluator runs post-fetch for every source, predicate/planner
 * result equivalence is structural, not incidental.
 */
public final class QueryEvaluator {

  private QueryEvaluator() {
  }

  public static boolean evaluate(QueryExpr expr, CanonicalLogEvent event) {
    if (expr == null) {
      return true;
    }
    return switch (expr) {
      case Comparison comparison -> evaluateComparison(comparison, event);
      case And and -> evaluate(and.left(), event) && evaluate(and.right(), event);
      case Or or -> evaluate(or.left(), event) || evaluate(or.right(), event);
    };
  }

  private static boolean evaluateComparison(Comparison comparison, CanonicalLogEvent event) {
    String actual = QueryFields.value(comparison.field(), event);
    String actualLower = actual == null ? null : actual.toLowerCase(Locale.ROOT);
    String valueLower = comparison.value().toLowerCase(Locale.ROOT);

    return switch (comparison.operator()) {
      case EQ -> actualLower != null && actualLower.equals(valueLower);
      case NE -> actualLower == null || !actualLower.equals(valueLower);
      case CONTAINS -> actualLower != null && actualLower.contains(valueLower);
    };
  }
}
