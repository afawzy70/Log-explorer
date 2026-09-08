package com.logexplorer.core.query;

/**
 * A {@link QueryLexer}/{@link QueryParser} rejection — maps to HTTP 400
 * (see {@code api.GlobalExceptionHandler}). {@code getMessage()} is always
 * built from fixed strings, a 0-based character {@code position}, and
 * structural grammar vocabulary (token type names, field alias names) —
 * <b>never</b> the content of a {@link TokenType#STRING} literal or any
 * other substring of the raw query text (IMPLEMENTATION_PLAN.md "Phase E":
 * "semantic validation with precise, non-leaking error messages ... never
 * echo a sensitive literal").
 */
public class QuerySyntaxException extends RuntimeException {

  private final int position;

  public QuerySyntaxException(String message, int position) {
    super(message + " (position " + position + ")");
    this.position = position;
  }

  public int position() {
    return position;
  }
}
