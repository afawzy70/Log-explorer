package com.logexplorer.source.loki.plan;

import static org.assertj.core.api.Assertions.assertThat;

import com.logexplorer.core.query.ast.And;
import com.logexplorer.core.query.ast.Comparison;
import com.logexplorer.core.query.ast.Operator;
import com.logexplorer.core.query.ast.Or;
import org.junit.jupiter.api.Test;

/**
 * The Loki-path "planner" (IMPLEMENTATION_PLAN.md "Phase E" scope item 4).
 * Only a bare top-level {@code service = "..."} equality is ever extracted
 * as a pushdown candidate — everything else deliberately returns empty,
 * never guessed at, since {@code LokiLogSource} always still applies the
 * full DSL predicate afterward regardless (see {@code EventFilters}), so a
 * missed pushdown can never cause a wrong result, only a less-narrow fetch.
 */
class LogQlDslPlannerTest {

  @Test
  void nullQueryHasNoPushdown() {
    assertThat(LogQlDslPlanner.extractServiceEquality(null)).isEmpty();
  }

  @Test
  void aBareServiceEqualityIsPushable() {
    var expr = new Comparison("service", Operator.EQ, "gateway");
    assertThat(LogQlDslPlanner.extractServiceEquality(expr)).contains("gateway");
  }

  @Test
  void aServiceNotEqualIsNeverPushedDownSinceItIsNotAnExactMatch() {
    var expr = new Comparison("service", Operator.NE, "gateway");
    assertThat(LogQlDslPlanner.extractServiceEquality(expr)).isEmpty();
  }

  @Test
  void aServiceContainsIsNeverPushedDownSinceItIsNotAnExactMatch() {
    var expr = new Comparison("service", Operator.CONTAINS, "gate");
    assertThat(LogQlDslPlanner.extractServiceEquality(expr)).isEmpty();
  }

  @Test
  void aComparisonOnAnyOtherFieldIsNeverPushedDown() {
    var expr = new Comparison("level", Operator.EQ, "ERROR");
    assertThat(LogQlDslPlanner.extractServiceEquality(expr)).isEmpty();
  }

  @Test
  void anAndExpressionIsNeverPushedDownEvenIfOneSideIsAServiceEquality() {
    // Deliberately conservative: only the single bare top-level comparison
    // is handled, never partial tree-walking - see class javadoc.
    var expr = new And(new Comparison("service", Operator.EQ, "gateway"), new Comparison("level", Operator.EQ, "ERROR"));
    assertThat(LogQlDslPlanner.extractServiceEquality(expr)).isEmpty();
  }

  @Test
  void anOrExpressionIsNeverPushedDown() {
    var expr = new Or(new Comparison("service", Operator.EQ, "gateway"), new Comparison("service", Operator.EQ, "auth"));
    assertThat(LogQlDslPlanner.extractServiceEquality(expr)).isEmpty();
  }
}
