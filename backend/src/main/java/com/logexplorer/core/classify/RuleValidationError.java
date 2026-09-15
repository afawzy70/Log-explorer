package com.logexplorer.core.classify;

/** One validation problem, addressed by a JSON-style path within the rule (e.g. {@code conditions[0].value}). */
public record RuleValidationError(String path, String message) {
}
