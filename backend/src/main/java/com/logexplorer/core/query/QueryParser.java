package com.logexplorer.core.query;

import com.logexplorer.core.query.ast.And;
import com.logexplorer.core.query.ast.Comparison;
import com.logexplorer.core.query.ast.Operator;
import com.logexplorer.core.query.ast.Or;
import com.logexplorer.core.query.ast.QueryExpr;
import java.util.List;

/**
 * Recursive-descent parser for the DSL (HANDOVER.md §9). Grammar:
 *
 * <pre>
 *   expr       := orExpr
 *   orExpr     := andExpr ("or" andExpr)*
 *   andExpr    := primary ("and" primary)*
 *   primary    := "(" expr ")" | comparison
 *   comparison := FIELD ("=" | "!=" | "contains") STRING
 * </pre>
 *
 * {@code and} binds tighter than {@code or}, matching every mainstream
 * boolean-expression convention this DSL's users (developers/support
 * engineers, HANDOVER.md §1) will already know.
 *
 * <p>Recursion depth is bounded (IMPLEMENTATION_PLAN.md "Phase E"
 * automated test: "very deep nesting → bounded depth error") — this both
 * satisfies the plan's explicit requirement and, as a side effect, is what
 * actually prevents a {@code StackOverflowError} on adversarial input like
 * a few thousand nested {@code (}.
 */
public final class QueryParser {

  private static final int MAX_DEPTH = 60;

  private final List<Token> tokens;
  private int index;
  private int depth;

  private QueryParser(List<Token> tokens) {
    this.tokens = tokens;
  }

  /** @return {@code null} for a blank/absent query - "no DSL filter", not an error. */
  public static QueryExpr parse(String text) {
    if (text == null || text.isBlank()) {
      return null;
    }
    QueryParser parser = new QueryParser(new QueryLexer(text).tokenize());
    QueryExpr expr = parser.parseOr();
    parser.expect(TokenType.EOF, "end of query");
    return expr;
  }

  private QueryExpr parseOr() {
    QueryExpr left = parseAnd();
    while (peek().type() == TokenType.OR) {
      advance();
      QueryExpr right = parseAnd();
      left = new Or(left, right);
    }
    return left;
  }

  private QueryExpr parseAnd() {
    QueryExpr left = parsePrimary();
    while (peek().type() == TokenType.AND) {
      advance();
      QueryExpr right = parsePrimary();
      left = new And(left, right);
    }
    return left;
  }

  private QueryExpr parsePrimary() {
    depth++;
    if (depth > MAX_DEPTH) {
      throw new QuerySyntaxException("Query nesting is too deep", peek().position());
    }
    try {
      if (peek().type() == TokenType.LPAREN) {
        advance();
        QueryExpr inner = parseOr();
        expect(TokenType.RPAREN, "')'");
        return inner;
      }
      return parseComparison();
    } finally {
      depth--;
    }
  }

  private QueryExpr parseComparison() {
    Token fieldToken = expect(TokenType.FIELD, "a field name");
    if (!QueryFields.isKnown(fieldToken.text())) {
      throw new QuerySyntaxException("Unknown field '" + fieldToken.text() + "'", fieldToken.position());
    }
    Operator operator = parseOperator();
    Token valueToken = expect(TokenType.STRING, "a quoted string");
    return new Comparison(QueryFields.normalize(fieldToken.text()), operator, valueToken.text());
  }

  private Operator parseOperator() {
    Token token = peek();
    return switch (token.type()) {
      case EQ -> {
        advance();
        yield Operator.EQ;
      }
      case NE -> {
        advance();
        yield Operator.NE;
      }
      case CONTAINS -> {
        advance();
        yield Operator.CONTAINS;
      }
      default -> throw new QuerySyntaxException("Expected '=', '!=' or 'contains'", token.position());
    };
  }

  private Token expect(TokenType type, String expectedDescription) {
    Token token = peek();
    if (token.type() != type) {
      throw new QuerySyntaxException("Expected " + expectedDescription, token.position());
    }
    advance();
    return token;
  }

  private Token peek() {
    return tokens.get(index);
  }

  private void advance() {
    if (index < tokens.size() - 1) {
      index++;
    }
  }
}
