package com.logexplorer.core.query;

import static org.assertj.core.api.Assertions.assertThat;

import com.logexplorer.core.query.ast.And;
import com.logexplorer.core.query.ast.Comparison;
import com.logexplorer.core.query.ast.Operator;
import com.logexplorer.core.query.ast.Or;
import org.junit.jupiter.api.Test;

/**
 * Redaction test (IMPLEMENTATION_PLAN.md "Phase E" required automated
 * test: "redaction test asserting sensitive literals never appear in
 * explanations or errors").
 */
class QueryPlanExplainerTest {

  private static final String SENTINEL = "RAW-SENTINEL-VALUE-7c2e";

  @Test
  void nullQueryExplainsAsNoQuery() {
    assertThat(QueryPlanExplainer.explain(null)).isEqualTo("(no query)");
  }

  @Test
  void aSimpleComparisonNeverIncludesTheLiteralValue() {
    String explanation = QueryPlanExplainer.explain(new Comparison("service", Operator.EQ, SENTINEL));
    assertThat(explanation).doesNotContain(SENTINEL);
    assertThat(explanation).isEqualTo("service = ***");
  }

  @Test
  void aSensitiveAliasComparisonNeverIncludesTheLiteralValueEither() {
    String explanation = QueryPlanExplainer.explain(new Comparison("cif", Operator.EQ, SENTINEL));
    assertThat(explanation).doesNotContain(SENTINEL);
  }

  @Test
  void everyOperatorRendersDistinctlyWithoutTheLiteral() {
    assertThat(QueryPlanExplainer.explain(new Comparison("service", Operator.EQ, SENTINEL))).contains("=");
    assertThat(QueryPlanExplainer.explain(new Comparison("service", Operator.NE, SENTINEL))).contains("!=");
    assertThat(QueryPlanExplainer.explain(new Comparison("service", Operator.CONTAINS, SENTINEL))).contains("contains");
  }

  @Test
  void nestedAndOrStructureIsVisibleButNoLiteralLeaksAnywhereInIt() {
    var expr = new And(
        new Or(
            new Comparison("service", Operator.EQ, SENTINEL),
            new Comparison("service", Operator.EQ, SENTINEL + "-2")),
        new Comparison("level", Operator.EQ, "ERROR"));
    String explanation = QueryPlanExplainer.explain(expr);
    assertThat(explanation).doesNotContain(SENTINEL);
    assertThat(explanation).contains("AND").contains("OR").contains("service").contains("level");
  }
}
