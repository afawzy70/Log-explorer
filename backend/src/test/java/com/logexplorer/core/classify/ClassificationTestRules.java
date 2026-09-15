package com.logexplorer.core.classify;

import com.logexplorer.core.model.CanonicalLogEvent;
import java.util.List;

/** Synthetic rule and event builders for classification tests. Every value is made up. */
public final class ClassificationTestRules {

  private ClassificationTestRules() {
  }

  public static RuleCondition condition(String field, MatcherType matcher, String value) {
    return new RuleCondition(field, matcher, value, false);
  }

  public static ExtractionDefinition regex(String name, String expression) {
    return new ExtractionDefinition(name, null, "message", ExtractionType.REGEX, expression, null, null, null);
  }

  public static ExtractionDefinition regex(String name, String expression, ExtractedValueType type) {
    return new ExtractionDefinition(name, null, "message", ExtractionType.REGEX, expression, null, type, null);
  }

  public static ExtractionDefinition pointer(String name, String sourceField, String pointer) {
    return new ExtractionDefinition(name, null, sourceField, ExtractionType.JSON_POINTER, pointer, null, null, null);
  }

  public static ClassificationRule rule(String id, String tag, RuleCondition... conditions) {
    return new ClassificationRule(id, "Rule " + id, null, List.of(tag), true, 100, MatchMode.ALL, List.of(conditions),
        List.of(), null, null);
  }

  public static ClassificationRule rule(String id, String tag, MatchMode mode, List<RuleCondition> conditions,
      List<ExtractionDefinition> extractions) {
    return new ClassificationRule(id, "Rule " + id, null, List.of(tag), true, 100, mode, conditions, extractions, null,
        null);
  }

  /** The owner's first real use case, expressed as data: nothing about middleware is special-cased in code. */
  public static ClassificationRule middlewareRule() {
    return new ClassificationRule("middleware-http-call", "Middleware HTTP Call", "Synthetic webhook calls",
        List.of("middleware"), true, 100, MatchMode.ALL,
        List.of(condition("message", MatcherType.STARTS_WITH, "Make webhook call to"),
            condition("message", MatcherType.CONTAINS, "responseCode=")),
        List.of(
            regex("url", "\\bto\\s+(?P<url>\\S+)"),
            regex("responseCode", "responseCode=(?P<responseCode>\\d+)", ExtractedValueType.INTEGER),
            regex("durationMs", "duration=(?P<durationMs>\\d+)ms", ExtractedValueType.INTEGER)),
        null, null);
  }

  public static String webhook(String path, int requestId, int responseCode, int durationMs) {
    return "Make webhook call to " + path + " requestId=req-" + requestId + " responseCode=" + responseCode
        + " duration=" + durationMs + "ms";
  }

  public static CanonicalLogEvent event(String message) {
    return CanonicalLogEvent.builder().message(message).service("gateway").severity("INFO").build();
  }
}
