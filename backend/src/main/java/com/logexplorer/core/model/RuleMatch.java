package com.logexplorer.core.model;

import java.util.List;

/**
 * A classification rule that matched one event, with the values its own
 * extraction definitions produced. Kept per rule (never merged into one
 * flat map) so two rules extracting a field with the same name can never
 * silently overwrite each other.
 */
public record RuleMatch(String ruleId, String ruleName, List<String> tags, List<ExtractedField> extracted) {

  public RuleMatch {
    tags = tags == null ? List.of() : List.copyOf(tags);
    extracted = extracted == null ? List.of() : List.copyOf(extracted);
  }
}
