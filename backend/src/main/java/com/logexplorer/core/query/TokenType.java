package com.logexplorer.core.query;

/** Lexical categories for {@link QueryLexer}/{@link QueryParser}. */
public enum TokenType {
  FIELD,
  STRING,
  EQ,
  NE,
  CONTAINS,
  AND,
  OR,
  LPAREN,
  RPAREN,
  EOF
}
