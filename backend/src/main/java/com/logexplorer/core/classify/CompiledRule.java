package com.logexplorer.core.classify;

import com.fasterxml.jackson.core.JsonPointer;
import com.google.re2j.Pattern;
import java.util.Comparator;
import java.util.List;

/** A rule that passed validation, with every matcher and extraction pre-compiled. */
public record CompiledRule(ClassificationRule rule, List<CompiledCondition> conditions, List<Extraction> extractions) {

  /** Deterministic evaluation order: priority ascending, then id. */
  public static final Comparator<CompiledRule> EVALUATION_ORDER = Comparator
      .comparingInt((CompiledRule r) -> r.rule().effectivePriority())
      .thenComparing(r -> r.rule().id() == null ? "" : r.rule().id());

  public CompiledRule {
    conditions = List.copyOf(conditions);
    extractions = List.copyOf(extractions);
  }

  /** One pre-compiled extraction definition. Exactly one of {@code pattern}/{@code pointer} is set. */
  public record Extraction(ExtractionDefinition definition, FieldRef source, Pattern pattern, int groupIndex,
      JsonPointer pointer) {
  }
}
