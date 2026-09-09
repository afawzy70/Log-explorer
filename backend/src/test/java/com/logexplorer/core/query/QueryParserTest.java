package com.logexplorer.core.query;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.logexplorer.core.query.ast.And;
import com.logexplorer.core.query.ast.Comparison;
import com.logexplorer.core.query.ast.Operator;
import com.logexplorer.core.query.ast.Or;
import com.logexplorer.core.query.ast.QueryExpr;
import org.junit.jupiter.api.Test;

/**
 * Tokenizer/parser tables (IMPLEMENTATION_PLAN.md "Phase E" required
 * automated test: "valid + malformed + adversarial input: unbalanced
 * parens, unterminated strings, injection-ish payloads, very deep nesting
 * -> bounded depth error").
 */
class QueryParserTest {

  // --- valid ---------------------------------------------------------

  @Test
  void blankOrNullQueryParsesToNull() {
    assertThat(QueryParser.parse(null)).isNull();
    assertThat(QueryParser.parse("")).isNull();
    assertThat(QueryParser.parse("   ")).isNull();
  }

  @Test
  void simpleEqualityComparison() {
    QueryExpr expr = QueryParser.parse("service = \"gateway\"");
    assertThat(expr).isEqualTo(new Comparison("service", Operator.EQ, "gateway"));
  }

  @Test
  void notEqualComparison() {
    QueryExpr expr = QueryParser.parse("service != \"gateway\"");
    assertThat(expr).isEqualTo(new Comparison("service", Operator.NE, "gateway"));
  }

  @Test
  void containsComparison() {
    QueryExpr expr = QueryParser.parse("message contains \"timeout\"");
    assertThat(expr).isEqualTo(new Comparison("message", Operator.CONTAINS, "timeout"));
  }

  @Test
  void fieldAliasesAreCaseInsensitiveAndNormalizedInTheAst() {
    QueryExpr expr = QueryParser.parse("SERVICE = \"gateway\"");
    assertThat(expr).isEqualTo(new Comparison("service", Operator.EQ, "gateway"));
  }

  @Test
  void dottedAliasDevicePlatformIsSupported() {
    QueryExpr expr = QueryParser.parse("device.platform = \"ios\"");
    assertThat(expr).isEqualTo(new Comparison("device.platform", Operator.EQ, "ios"));
  }

  @Test
  void andCombinesTwoComparisons() {
    QueryExpr expr = QueryParser.parse("service = \"gateway\" and level = \"ERROR\"");
    assertThat(expr).isEqualTo(new And(
        new Comparison("service", Operator.EQ, "gateway"),
        new Comparison("level", Operator.EQ, "ERROR")));
  }

  @Test
  void orCombinesTwoComparisons() {
    QueryExpr expr = QueryParser.parse("service = \"gateway\" or service = \"auth\"");
    assertThat(expr).isEqualTo(new Or(
        new Comparison("service", Operator.EQ, "gateway"),
        new Comparison("service", Operator.EQ, "auth")));
  }

  @Test
  void andKeywordCaseInsensitive() {
    QueryExpr expr = QueryParser.parse("service = \"gateway\" AND level = \"ERROR\"");
    assertThat(expr).isInstanceOf(And.class);
  }

  @Test
  void andBindsTighterThanOr() {
    // a and b or c -> (a and b) or c
    QueryExpr expr = QueryParser.parse("service = \"a\" and level = \"b\" or service = \"c\"");
    assertThat(expr).isEqualTo(new Or(
        new And(
            new Comparison("service", Operator.EQ, "a"),
            new Comparison("level", Operator.EQ, "b")),
        new Comparison("service", Operator.EQ, "c")));
  }

  @Test
  void parenthesesOverridePrecedence() {
    QueryExpr expr = QueryParser.parse("(service = \"a\" or service = \"b\") and level = \"ERROR\"");
    assertThat(expr).isEqualTo(new And(
        new Or(
            new Comparison("service", Operator.EQ, "a"),
            new Comparison("service", Operator.EQ, "b")),
        new Comparison("level", Operator.EQ, "ERROR")));
  }

  @Test
  void backslashEscapedQuoteInsideAString() {
    QueryExpr expr = QueryParser.parse("message contains \"say \\\"hi\\\"\"");
    assertThat(expr).isEqualTo(new Comparison("message", Operator.CONTAINS, "say \"hi\""));
  }

  @Test
  void backslashEscapedBackslashInsideAString() {
    QueryExpr expr = QueryParser.parse("message contains \"back\\\\slash\"");
    assertThat(expr).isEqualTo(new Comparison("message", Operator.CONTAINS, "back\\slash"));
  }

  @Test
  void emptyStringLiteralIsAValidValue() {
    QueryExpr expr = QueryParser.parse("service = \"\"");
    assertThat(expr).isEqualTo(new Comparison("service", Operator.EQ, ""));
  }

  @Test
  void allSeventeenHandoverAliasesAreAccepted() {
    String[] aliases = {
        "service", "level", "message", "logger", "traceId", "spanId", "correlationId",
        "journeyId", "eventId", "errorCode", "businessStep", "uiIdentifier", "device.platform",
        "language", "userName", "customerId", "cif"
    };
    for (String alias : aliases) {
      QueryExpr expr = QueryParser.parse(alias + " = \"x\"");
      assertThat(expr).as("alias " + alias).isInstanceOf(Comparison.class);
    }
  }

  // --- sensitive-field operator restriction (Legacy Remediation Slice 2) ---

  @Test
  void exactMatchIsAllowedForEverySensitiveAlias() {
    for (String alias : new String[] {"userName", "customerId", "cif"}) {
      assertThat(QueryParser.parse(alias + " = \"x\"")).as("alias " + alias).isInstanceOf(Comparison.class);
      assertThat(QueryParser.parse(alias + " != \"x\"")).as("alias " + alias).isInstanceOf(Comparison.class);
    }
  }

  @Test
  void containsIsRejectedForEverySensitiveAlias() {
    for (String alias : new String[] {"userName", "customerId", "cif"}) {
      assertThatThrownBy(() -> QueryParser.parse(alias + " contains \"x\""))
          .as("alias " + alias)
          .isInstanceOf(QuerySyntaxException.class)
          .hasMessageContaining("not allowed")
          .hasMessageContaining(alias);
    }
  }

  @Test
  void containsIsStillAllowedForNonSensitiveFields() {
    assertThat(QueryParser.parse("message contains \"x\"")).isInstanceOf(Comparison.class);
    assertThat(QueryParser.parse("logger contains \"x\"")).isInstanceOf(Comparison.class);
  }

  @Test
  void sensitiveFieldOperatorRejectionNeverEchoesTheAttemptedLiteral() {
    String sentinel = "SENSITIVE-CONTAINS-SENTINEL-91a2";
    assertThatThrownBy(() -> QueryParser.parse("cif contains \"" + sentinel + "\""))
        .isInstanceOf(QuerySyntaxException.class)
        .satisfies(e -> assertThat(e.getMessage()).doesNotContain(sentinel));
  }

  // --- malformed -------------------------------------------------------

  @Test
  void unknownFieldIsRejected() {
    assertThatThrownBy(() -> QueryParser.parse("bogus = \"x\""))
        .isInstanceOf(QuerySyntaxException.class)
        .hasMessageContaining("Unknown field");
  }

  @Test
  void deviceIdAndDeviceIpAreNotDslAliasesByDeliberateScopeBoundary() {
    // HANDOVER.md §9's own alias list omits these two - they remain
    // structured-filter-only fields, not DSL aliases.
    assertThatThrownBy(() -> QueryParser.parse("deviceId = \"x\""))
        .isInstanceOf(QuerySyntaxException.class);
    assertThatThrownBy(() -> QueryParser.parse("deviceIp = \"x\""))
        .isInstanceOf(QuerySyntaxException.class);
  }

  @Test
  void missingOperatorIsRejected() {
    assertThatThrownBy(() -> QueryParser.parse("service \"x\""))
        .isInstanceOf(QuerySyntaxException.class);
  }

  @Test
  void missingValueIsRejected() {
    assertThatThrownBy(() -> QueryParser.parse("service ="))
        .isInstanceOf(QuerySyntaxException.class);
  }

  @Test
  void unterminatedStringLiteralIsRejectedAndNeverEchoesItsPartialContent() {
    assertThatThrownBy(() -> QueryParser.parse("service = \"never-closed-abc123"))
        .isInstanceOf(QuerySyntaxException.class)
        .hasMessageContaining("Unterminated string literal")
        .hasMessageNotContaining("never-closed-abc123");
  }

  @Test
  void unbalancedOpenParenIsRejected() {
    assertThatThrownBy(() -> QueryParser.parse("(service = \"x\""))
        .isInstanceOf(QuerySyntaxException.class);
  }

  @Test
  void unbalancedCloseParenIsRejected() {
    assertThatThrownBy(() -> QueryParser.parse("service = \"x\")"))
        .isInstanceOf(QuerySyntaxException.class);
  }

  @Test
  void trailingGarbageAfterACompleteExpressionIsRejected() {
    assertThatThrownBy(() -> QueryParser.parse("service = \"x\" service = \"y\""))
        .isInstanceOf(QuerySyntaxException.class);
  }

  @Test
  void keywordUsedAsAFieldNameIsRejected() {
    assertThatThrownBy(() -> QueryParser.parse("and = \"x\""))
        .isInstanceOf(QuerySyntaxException.class);
  }

  @Test
  void unexpectedCharacterIsRejected() {
    assertThatThrownBy(() -> QueryParser.parse("service $ \"x\""))
        .isInstanceOf(QuerySyntaxException.class);
  }

  @Test
  void queryTextExceedingTheMaximumLengthIsRejected() {
    String huge = "service = \"" + "a".repeat(5000) + "\"";
    assertThatThrownBy(() -> QueryParser.parse(huge))
        .isInstanceOf(QuerySyntaxException.class);
  }

  // --- adversarial -----------------------------------------------------

  @Test
  void veryDeeplyNestedParenthesesFailWithABoundedDepthErrorNotAStackOverflow() {
    String deeplyNested = "(".repeat(500) + "service = \"x\"" + ")".repeat(500);
    assertThatThrownBy(() -> QueryParser.parse(deeplyNested))
        .isInstanceOf(QuerySyntaxException.class)
        .hasMessageContaining("too deep");
  }

  @Test
  void sqlInjectionLookingPayloadParsesAsAnInertPlainStringLiteral() {
    QueryExpr expr = QueryParser.parse("message contains \"'; DROP TABLE users; --\"");
    assertThat(expr).isEqualTo(new Comparison("message", Operator.CONTAINS, "'; DROP TABLE users; --"));
  }

  @Test
  void spelLookingPayloadParsesAsAnInertPlainStringLiteral() {
    QueryExpr expr = QueryParser.parse("message contains \"#{7*7}\"");
    assertThat(expr).isEqualTo(new Comparison("message", Operator.CONTAINS, "#{7*7}"));
  }

  @Test
  void manyRepeatedAndOrClausesParseWithoutError() {
    StringBuilder sb = new StringBuilder("service = \"a\"");
    for (int i = 0; i < 100; i++) {
      sb.append(" and service = \"a\"");
    }
    assertThat(QueryParser.parse(sb.toString())).isNotNull();
  }
}
