package com.logexplorer.core.query.ast;

public record Or(QueryExpr left, QueryExpr right) implements QueryExpr {
}
