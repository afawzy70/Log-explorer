package com.logexplorer.core.classify;

/**
 * Deterministic condition matchers. {@code REGEX} uses RE2/J (linear-time,
 * no backtracking), so lookaround and backreferences are rejected at
 * validation time rather than silently run on an unsafe engine.
 */
public enum MatcherType { EXACT, CONTAINS, STARTS_WITH, REGEX }
