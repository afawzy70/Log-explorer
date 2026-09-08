package com.logexplorer.core.query.ast;

public record And(QueryExpr left, QueryExpr right) implements QueryExpr {
}
