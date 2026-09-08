package com.logexplorer.core.query;

import static org.assertj.core.api.Assertions.assertThat;

import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.RawSensitiveFields;
import com.logexplorer.core.query.ast.And;
import com.logexplorer.core.query.ast.Comparison;
import com.logexplorer.core.query.ast.Operator;
import com.logexplorer.core.query.ast.Or;
import com.logexplorer.core.query.ast.QueryExpr;
import org.junit.jupiter.api.Test;

/**
 * The in-memory predicate compiler's correctness (IMPLEMENTATION_PLAN.md
 * "Phase E" scope item 4, "Docker path" — also the correctness backbone
 * for every other source via {@code core.search.EventFilters}).
 */
class QueryEvaluatorTest {

  private CanonicalLogEvent event() {
    return CanonicalLogEvent.builder()
        .service("gateway")
        .severity("ERROR")
        .message("connection timeout occurred")
        .logger("com.example.Gateway")
        .traceId("trace-1")
        .spanId("span-1")
        .correlationId("corr-1")
        .journeyId("journey-1")
        .eventId("event-1")
        .errorCode("ERR-500")
        .businessStep("payment")
        .uiIdentifier("ui-1")
        .devicePlatformType("ios")
        .language("en")
        .sensitive(new RawSensitiveFields("CIF123", "alice", "CUST1", "device-1", "1.2.3.4"))
        .build();
  }

  @Test
  void nullExpressionAlwaysMatches() {
    assertThat(QueryEvaluator.evaluate(null, event())).isTrue();
  }

  @Test
  void equalityMatchesExactlyAndIsCaseInsensitive() {
    assertThat(QueryEvaluator.evaluate(new Comparison("service", Operator.EQ, "gateway"), event())).isTrue();
    assertThat(QueryEvaluator.evaluate(new Comparison("service", Operator.EQ, "GATEWAY"), event())).isTrue();
    assertThat(QueryEvaluator.evaluate(new Comparison("service", Operator.EQ, "auth"), event())).isFalse();
  }

  @Test
  void notEqualIsTheNegationOfEquality() {
    assertThat(QueryEvaluator.evaluate(new Comparison("service", Operator.NE, "gateway"), event())).isFalse();
    assertThat(QueryEvaluator.evaluate(new Comparison("service", Operator.NE, "auth"), event())).isTrue();
  }

  @Test
  void containsIsASubstringMatchCaseInsensitive() {
    assertThat(QueryEvaluator.evaluate(new Comparison("message", Operator.CONTAINS, "timeout"), event())).isTrue();
    assertThat(QueryEvaluator.evaluate(new Comparison("message", Operator.CONTAINS, "TIMEOUT"), event())).isTrue();
    assertThat(QueryEvaluator.evaluate(new Comparison("message", Operator.CONTAINS, "nope"), event())).isFalse();
  }

  @Test
  void aMissingFieldNeverMatchesEqualsOrContains() {
    CanonicalLogEvent bare = CanonicalLogEvent.builder().build();
    assertThat(QueryEvaluator.evaluate(new Comparison("service", Operator.EQ, "gateway"), bare)).isFalse();
    assertThat(QueryEvaluator.evaluate(new Comparison("message", Operator.CONTAINS, "x"), bare)).isFalse();
  }

  @Test
  void aMissingFieldMatchesNotEqual() {
    CanonicalLogEvent bare = CanonicalLogEvent.builder().build();
    assertThat(QueryEvaluator.evaluate(new Comparison("service", Operator.NE, "gateway"), bare)).isTrue();
  }

  @Test
  void everyNonSensitiveAliasReadsTheRightField() {
    CanonicalLogEvent e = event();
    assertThat(QueryEvaluator.evaluate(new Comparison("level", Operator.EQ, "ERROR"), e)).isTrue();
    assertThat(QueryEvaluator.evaluate(new Comparison("logger", Operator.EQ, "com.example.Gateway"), e)).isTrue();
    assertThat(QueryEvaluator.evaluate(new Comparison("traceid", Operator.EQ, "trace-1"), e)).isTrue();
    assertThat(QueryEvaluator.evaluate(new Comparison("spanid", Operator.EQ, "span-1"), e)).isTrue();
    assertThat(QueryEvaluator.evaluate(new Comparison("correlationid", Operator.EQ, "corr-1"), e)).isTrue();
    assertThat(QueryEvaluator.evaluate(new Comparison("journeyid", Operator.EQ, "journey-1"), e)).isTrue();
    assertThat(QueryEvaluator.evaluate(new Comparison("eventid", Operator.EQ, "event-1"), e)).isTrue();
    assertThat(QueryEvaluator.evaluate(new Comparison("errorcode", Operator.EQ, "ERR-500"), e)).isTrue();
    assertThat(QueryEvaluator.evaluate(new Comparison("businessstep", Operator.EQ, "payment"), e)).isTrue();
    assertThat(QueryEvaluator.evaluate(new Comparison("uiidentifier", Operator.EQ, "ui-1"), e)).isTrue();
    assertThat(QueryEvaluator.evaluate(new Comparison("device.platform", Operator.EQ, "ios"), e)).isTrue();
    assertThat(QueryEvaluator.evaluate(new Comparison("language", Operator.EQ, "en"), e)).isTrue();
  }

  @Test
  void sensitiveAliasesReadFromRawSensitiveFieldsNotAnyPlainAccessor() {
    CanonicalLogEvent e = event();
    assertThat(QueryEvaluator.evaluate(new Comparison("cif", Operator.EQ, "CIF123"), e)).isTrue();
    assertThat(QueryEvaluator.evaluate(new Comparison("username", Operator.EQ, "alice"), e)).isTrue();
    assertThat(QueryEvaluator.evaluate(new Comparison("customerid", Operator.EQ, "CUST1"), e)).isTrue();
  }

  @Test
  void andRequiresBothSidesToMatch() {
    QueryExpr expr = new And(
        new Comparison("service", Operator.EQ, "gateway"),
        new Comparison("level", Operator.EQ, "ERROR"));
    assertThat(QueryEvaluator.evaluate(expr, event())).isTrue();

    QueryExpr mismatched = new And(
        new Comparison("service", Operator.EQ, "gateway"),
        new Comparison("level", Operator.EQ, "INFO"));
    assertThat(QueryEvaluator.evaluate(mismatched, event())).isFalse();
  }

  @Test
  void orRequiresEitherSideToMatch() {
    QueryExpr expr = new Or(
        new Comparison("service", Operator.EQ, "auth"),
        new Comparison("service", Operator.EQ, "gateway"));
    assertThat(QueryEvaluator.evaluate(expr, event())).isTrue();

    QueryExpr neitherMatches = new Or(
        new Comparison("service", Operator.EQ, "auth"),
        new Comparison("service", Operator.EQ, "billing"));
    assertThat(QueryEvaluator.evaluate(neitherMatches, event())).isFalse();
  }

  @Test
  void nestedAndOrEvaluatesWithCorrectStructure() {
    // (service = "gateway" or service = "auth") and level = "ERROR"
    QueryExpr expr = new And(
        new Or(new Comparison("service", Operator.EQ, "gateway"), new Comparison("service", Operator.EQ, "auth")),
        new Comparison("level", Operator.EQ, "ERROR"));
    assertThat(QueryEvaluator.evaluate(expr, event())).isTrue();
  }
}
