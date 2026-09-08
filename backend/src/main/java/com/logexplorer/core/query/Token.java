package com.logexplorer.core.query;

/**
 * One lexed token. {@code text} holds the literal value for {@link
 * TokenType#STRING} tokens (an unescaped search value the user typed — the
 * same class of value {@code SearchRequest#text} already treats as
 * sensitive for logging purposes) — so {@link #toString()} always redacts
 * it, the same architectural defense-in-depth pattern as {@code
 * core.model.RawSensitiveFields}/{@code RawToken}. For every other token
 * type {@code text} is safe, fixed grammar vocabulary (a field alias, an
 * operator) and is printed as-is.
 */
public record Token(TokenType type, String text, int position) {

  @Override
  public String toString() {
    String safeText = type == TokenType.STRING ? "[REDACTED]" : text;
    return "Token[type=" + type + ", text=" + safeText + ", position=" + position + "]";
  }
}
