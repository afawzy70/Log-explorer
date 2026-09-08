package com.logexplorer.core.query;

import com.logexplorer.core.query.ast.And;
import com.logexplorer.core.query.ast.Comparison;
import com.logexplorer.core.query.ast.Or;
import com.logexplorer.core.query.ast.QueryExpr;

/**
 * Renders a parsed query as a human-readable string for diagnostics
 * (IMPLEMENTATION_PLAN.md "Phase E" scope item 5: "query-plan explanation
 * with sensitive literals redacted"). Every literal value is unconditionally
 * replaced with a fixed placeholder — not just the three DSL aliases
 * {@code core.query.QueryFields} flags as sensitive — matching the same
 * "never log search values" rule {@code SearchRequest#text} already
 * follows for free text. Field names and operators are safe, fixed grammar
 * vocabulary and are shown as-is.
 */
public final class QueryPlanExplainer {

  private QueryPlanExplainer() {
  }

  public static String explain(QueryExpr expr) {
    if (expr == null) {
      return "(no query)";
    }
    return switch (expr) {
      case Comparison comparison -> comparison.field() + " " + symbol(comparison.operator()) + " ***";
      case And and -> "(" + explain(and.left()) + " AND " + explain(and.right()) + ")";
      case Or or -> "(" + explain(or.left()) + " OR " + explain(or.right()) + ")";
    };
  }

  private static String symbol(com.logexplorer.core.query.ast.Operator operator) {
    return switch (operator) {
      case EQ -> "=";
      case NE -> "!=";
      case CONTAINS -> "contains";
    };
  }
}
