package com.logexplorer.core.query;

import static org.assertj.core.api.Assertions.assertThat;

import com.logexplorer.core.model.SearchRequest;
import com.logexplorer.core.query.ast.And;
import com.logexplorer.core.query.ast.Comparison;
import com.logexplorer.core.query.ast.Operator;
import java.time.Instant;
import org.junit.jupiter.api.Test;

/**
 * Defense-in-depth redaction, mirroring {@code core.model.RawSensitiveFields}/
 * {@code RawToken}'s architectural pattern: literal query values must never
 * appear via {@code toString()} at any layer that might hold them - a raw
 * lexer {@link Token}, an AST {@link Comparison} node, or the containing
 * {@code SearchRequest} - even if something accidentally logs one of these
 * objects directly instead of going through {@link QueryPlanExplainer}.
 */
class QueryRedactionTest {

  private static final String SENTINEL = "RAW-SENTINEL-VALUE-9f21";

  @Test
  void aStringTokenNeverRevealsItsLiteralTextViaToString() {
    Token token = new Token(TokenType.STRING, SENTINEL, 0);
    assertThat(token.toString()).doesNotContain(SENTINEL);
  }

  @Test
  void aNonStringTokenPrintsItsTextNormally() {
    Token token = new Token(TokenType.FIELD, "service", 0);
    assertThat(token.toString()).contains("service");
  }

  @Test
  void aComparisonNodeNeverRevealsItsLiteralValueViaToString() {
    Comparison comparison = new Comparison("service", Operator.EQ, SENTINEL);
    assertThat(comparison.toString()).doesNotContain(SENTINEL);
    assertThat(comparison.toString()).contains("service");
  }

  @Test
  void searchRequestToStringNeverRevealsTheQueryLiteralEvenWhenSet() {
    SearchRequest request = SearchRequest.builder()
        .sourceId("fixture")
        .start(Instant.parse("2026-01-01T00:00:00Z"))
        .end(Instant.parse("2026-01-01T01:00:00Z"))
        .query(new And(
            new Comparison("service", Operator.EQ, SENTINEL),
            new Comparison("level", Operator.EQ, "ERROR")))
        .build();

    assertThat(request.toString()).doesNotContain(SENTINEL);
    assertThat(request.toString()).contains("query=[REDACTED]");
  }

  @Test
  void searchRequestToStringNeverRevealsRawLogQlEvenWhenSet() {
    SearchRequest request = SearchRequest.builder()
        .sourceId("openshift-loki")
        .start(Instant.parse("2026-01-01T00:00:00Z"))
        .end(Instant.parse("2026-01-01T01:00:00Z"))
        .rawLogQl("{namespace=\"" + SENTINEL + "\"}")
        .build();

    assertThat(request.toString()).doesNotContain(SENTINEL);
    assertThat(request.toString()).contains("rawLogQl=[REDACTED]");
  }

  @Test
  void searchRequestBuilderParsesADslStringEagerlyAndRejectsInvalidSyntax() {
    org.assertj.core.api.Assertions.assertThatThrownBy(() -> SearchRequest.builder()
            .sourceId("fixture")
            .start(Instant.now().minusSeconds(60))
            .end(Instant.now())
            .query("bogus = \"x\"")
            .build())
        .isInstanceOf(QuerySyntaxException.class);
  }
}
