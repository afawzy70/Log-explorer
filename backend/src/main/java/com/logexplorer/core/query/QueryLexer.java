package com.logexplorer.core.query;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Tokenizes DSL query text (HANDOVER.md §9) into a flat {@link Token} list.
 * Never evaluates or interprets the input as code of any kind — purely
 * character-by-character lexical analysis.
 *
 * <p>Grammar vocabulary: field aliases ({@code [A-Za-z_][A-Za-z0-9_]*}
 * optionally dotted once, e.g. {@code device.platform}), double-quoted
 * strings with {@code \"}/{@code \\} escaping, {@code =}, {@code !=}, the
 * keywords {@code and}/{@code or}/{@code contains} (case-insensitive), and
 * parentheses.
 */
final class QueryLexer {

  /**
   * A courtesy bound independent of the parser's own recursion-depth limit
   * (CLAUDE.md "no unbounded scans... anywhere") — a query this long is
   * never a legitimate investigation query.
   */
  static final int MAX_QUERY_LENGTH = 4000;

  private final String input;
  private int pos;

  QueryLexer(String input) {
    if (input.length() > MAX_QUERY_LENGTH) {
      throw new QuerySyntaxException("Query text exceeds the maximum allowed length", MAX_QUERY_LENGTH);
    }
    this.input = input;
  }

  List<Token> tokenize() {
    List<Token> tokens = new ArrayList<>();
    Token token;
    do {
      token = next();
      tokens.add(token);
    } while (token.type() != TokenType.EOF);
    return tokens;
  }

  private Token next() {
    skipWhitespace();
    if (pos >= input.length()) {
      return new Token(TokenType.EOF, "", pos);
    }

    int start = pos;
    char c = input.charAt(pos);

    if (c == '(') {
      pos++;
      return new Token(TokenType.LPAREN, "(", start);
    }
    if (c == ')') {
      pos++;
      return new Token(TokenType.RPAREN, ")", start);
    }
    if (c == '=') {
      pos++;
      return new Token(TokenType.EQ, "=", start);
    }
    if (c == '!') {
      if (pos + 1 < input.length() && input.charAt(pos + 1) == '=') {
        pos += 2;
        return new Token(TokenType.NE, "!=", start);
      }
      throw new QuerySyntaxException("Unexpected character '!' (did you mean '!=' ?)", start);
    }
    if (c == '"') {
      return readString(start);
    }
    if (isIdentifierStart(c)) {
      return readIdentifierOrKeyword(start);
    }
    throw new QuerySyntaxException("Unexpected character", start);
  }

  private Token readString(int start) {
    StringBuilder value = new StringBuilder();
    pos++; // opening quote
    while (true) {
      if (pos >= input.length()) {
        // Never quote the partial literal content back in the message -
        // it is exactly the kind of search-value text that must never be
        // echoed (CLAUDE.md "never log search values").
        throw new QuerySyntaxException("Unterminated string literal", start);
      }
      char c = input.charAt(pos);
      if (c == '"') {
        pos++;
        return new Token(TokenType.STRING, value.toString(), start);
      }
      if (c == '\\' && pos + 1 < input.length() && (input.charAt(pos + 1) == '"' || input.charAt(pos + 1) == '\\')) {
        value.append(input.charAt(pos + 1));
        pos += 2;
        continue;
      }
      value.append(c);
      pos++;
    }
  }

  private Token readIdentifierOrKeyword(int start) {
    pos++;
    while (pos < input.length() && isIdentifierPart(input.charAt(pos))) {
      pos++;
    }
    // A single embedded '.' is allowed (device.platform) - not a general
    // dotted-path syntax, just this one documented alias shape.
    if (pos < input.length() && input.charAt(pos) == '.'
        && pos + 1 < input.length() && isIdentifierStart(input.charAt(pos + 1))) {
      pos++;
      while (pos < input.length() && isIdentifierPart(input.charAt(pos))) {
        pos++;
      }
    }

    String text = input.substring(start, pos);
    String lower = text.toLowerCase(Locale.ROOT);
    return switch (lower) {
      case "and" -> new Token(TokenType.AND, lower, start);
      case "or" -> new Token(TokenType.OR, lower, start);
      case "contains" -> new Token(TokenType.CONTAINS, lower, start);
      default -> new Token(TokenType.FIELD, text, start);
    };
  }

  private boolean isIdentifierStart(char c) {
    return Character.isLetter(c) || c == '_';
  }

  private boolean isIdentifierPart(char c) {
    return Character.isLetterOrDigit(c) || c == '_';
  }

  private void skipWhitespace() {
    while (pos < input.length() && Character.isWhitespace(input.charAt(pos))) {
      pos++;
    }
  }
}
