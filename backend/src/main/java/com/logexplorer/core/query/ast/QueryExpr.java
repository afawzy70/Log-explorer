package com.logexplorer.core.query.ast;

/**
 * Typed AST for the DSL (HANDOVER.md §9). Deliberately a closed, tiny
 * algebra — {@link Comparison}, {@link And}, {@link Or} — evaluated only by
 * {@code core.query.QueryEvaluator}'s direct field comparisons against
 * {@code CanonicalLogEvent}. There is no "evaluate as code" node of any
 * kind: no function calls, no arbitrary expressions — by construction, not
 * by a runtime check (IMPLEMENTATION_PLAN.md "Phase E" scope item 7: "no
 * SpEL, eval, SQL evaluation, or reflection-based execution — anywhere").
 */
public sealed interface QueryExpr permits Comparison, And, Or {
}
