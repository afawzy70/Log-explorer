package com.logexplorer.core.classify;

import java.util.List;

/**
 * The immutable, in-memory snapshot the event-processing path evaluates:
 * enabled rules only, already compiled, in deterministic order. Replaced
 * atomically when rules are saved or imported; never re-read from disk per
 * event.
 */
public record CompiledRuleSet(long revision, List<CompiledRule> rules) {

  public static final CompiledRuleSet EMPTY = new CompiledRuleSet(0, List.of());

  public CompiledRuleSet {
    rules = List.copyOf(rules);
  }

  public static CompiledRuleSet ofEnabled(long revision, List<CompiledRule> compiled) {
    return new CompiledRuleSet(revision, compiled.stream()
        .filter(r -> r.rule().isEnabled())
        .sorted(CompiledRule.EVALUATION_ORDER)
        .toList());
  }
}
