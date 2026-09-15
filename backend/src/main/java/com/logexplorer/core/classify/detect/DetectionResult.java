package com.logexplorer.core.classify.detect;

import com.logexplorer.core.classify.ExtractionDefinition;
import com.logexplorer.core.classify.MatchMode;
import com.logexplorer.core.classify.RuleCondition;
import java.util.List;

/**
 * The result of deterministic pattern detection — a <b>suggestion only</b>.
 * Nothing here is ever saved automatically.
 *
 * <p>Every number is measured on the actual bounded sample: {@code
 * sampledEvents} is how many events were really read, {@code
 * valuesWithField} how many had the selected field, {@code similarEvents}
 * how many were structurally similar to the selected (anchor) value. No
 * confidence score is invented; {@link Coverage} reports exactly how the
 * suggestion behaves on the sample.
 */
public record DetectionResult(
    Status status,
    String reason,
    String field,
    String structure,
    int sampledEvents,
    int valuesWithField,
    int similarEvents,
    List<String> stableSegments,
    List<VariableSegment> variableSegments,
    MatchMode suggestedMatchMode,
    List<RuleCondition> suggestedConditions,
    String suggestedPattern,
    Coverage coverage,
    List<SuggestedExtraction> suggestedExtractions,
    List<String> warnings
) {

  public enum Status { SUGGESTED, NO_SAFE_PATTERN_SUGGESTION }

  /** A variable part of the anchor value; {@code example} is taken from the (already redacted) anchor only. */
  public record VariableSegment(String name, String kind, String example) {
  }

  /**
   * How the suggested conditions behave on the sample: similar events they match, and how many events that were
   * not considered similar they would also match (to review for false positives).
   */
  public record Coverage(int matchedSimilar, int similar, int matchedOther, int other) {
  }

  /** A suggested extraction with how many similar events it actually extracted a value from. */
  public record SuggestedExtraction(ExtractionDefinition definition, int extracted, int of) {
  }

  public DetectionResult {
    stableSegments = stableSegments == null ? List.of() : List.copyOf(stableSegments);
    variableSegments = variableSegments == null ? List.of() : List.copyOf(variableSegments);
    suggestedConditions = suggestedConditions == null ? List.of() : List.copyOf(suggestedConditions);
    suggestedExtractions = suggestedExtractions == null ? List.of() : List.copyOf(suggestedExtractions);
    warnings = warnings == null ? List.of() : List.copyOf(warnings);
  }

  static DetectionResult noSuggestion(String reason, String field, String structure, int sampled, int withField,
      int similar, List<String> warnings) {
    return new DetectionResult(Status.NO_SAFE_PATTERN_SUGGESTION, reason, field, structure, sampled, withField, similar,
        List.of(), List.of(), null, List.of(), null, null, List.of(), warnings);
  }
}
