package com.logexplorer.core.query.ast;

/**
 * A leaf {@code field <op> "value"} node. {@code value} is a raw search
 * literal the user typed — the same class of sensitive-for-logging value as
 * {@code SearchRequest#text} — so {@link #toString()} always redacts it,
 * the same architectural pattern as {@code core.model.RawSensitiveFields}/
 * {@code RawToken}/{@code core.query.Token}. {@code field} is safe, fixed
 * grammar vocabulary (one of the aliases in {@code core.query.QueryFields})
 * and is printed as-is.
 */
public record Comparison(String field, Operator operator, String value) implements QueryExpr {

  @Override
  public String toString() {
    return "Comparison[field=" + field + ", operator=" + operator + ", value=[REDACTED]]";
  }
}
