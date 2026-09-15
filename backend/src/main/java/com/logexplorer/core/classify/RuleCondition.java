package com.logexplorer.core.classify;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * One condition of a classification rule: a field reference (see {@link
 * FieldRef}), a matcher, and the matcher's literal or RE2 expression.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record RuleCondition(String field, MatcherType matcher, String value, Boolean ignoreCase) {

  /** Fills documented defaults; never trims {@code value} (leading/trailing spaces can be meaningful). */
  public RuleCondition normalized() {
    return new RuleCondition(field == null ? null : field.trim(), matcher, value, ignoreCase == null ? Boolean.FALSE : ignoreCase);
  }
}
