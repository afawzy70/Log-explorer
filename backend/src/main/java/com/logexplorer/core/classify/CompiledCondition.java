package com.logexplorer.core.classify;

import com.google.re2j.Pattern;
import java.util.Locale;

/**
 * A validated, ready-to-run condition. Literals are pre-lowercased and
 * regular expressions pre-compiled once, when the rule is activated —
 * never per event.
 */
public final class CompiledCondition {

  private final FieldRef field;
  private final MatcherType matcher;
  private final String literal;
  private final boolean ignoreCase;
  private final Pattern pattern;

  CompiledCondition(FieldRef field, MatcherType matcher, String literal, boolean ignoreCase, Pattern pattern) {
    this.field = field;
    this.matcher = matcher;
    this.ignoreCase = ignoreCase;
    this.literal = ignoreCase && literal != null ? literal.toLowerCase(Locale.ROOT) : literal;
    this.pattern = pattern;
  }

  public FieldRef field() {
    return field;
  }

  public MatcherType matcher() {
    return matcher;
  }

  /** Values longer than {@link ClassificationLimits#MAX_EVALUATED_FIELD_CHARS} are matched on their prefix. */
  public boolean test(String value) {
    if (value == null) {
      return false;
    }
    String subject = value.length() > ClassificationLimits.MAX_EVALUATED_FIELD_CHARS
        ? value.substring(0, ClassificationLimits.MAX_EVALUATED_FIELD_CHARS)
        : value;
    if (matcher == MatcherType.REGEX) {
      return pattern.matcher(subject).find();
    }
    String candidate = ignoreCase ? subject.toLowerCase(Locale.ROOT) : subject;
    return switch (matcher) {
      case EXACT -> candidate.equals(literal);
      case CONTAINS -> candidate.contains(literal);
      case STARTS_WITH -> candidate.startsWith(literal);
      case REGEX -> false; // handled above
    };
  }
}
