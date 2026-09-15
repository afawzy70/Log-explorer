package com.logexplorer.core.classify;

import java.util.List;

/** A rule failed validation. The message never contains event data; errors address the rule's own fields. */
public class RuleValidationException extends RuntimeException {

  private final transient List<RuleValidationError> errors;

  public RuleValidationException(List<RuleValidationError> errors) {
    super("The classification rule is invalid");
    this.errors = List.copyOf(errors);
  }

  public List<RuleValidationError> errors() {
    return errors;
  }
}
