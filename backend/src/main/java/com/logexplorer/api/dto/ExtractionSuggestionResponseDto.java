package com.logexplorer.api.dto;

import com.logexplorer.core.classify.detect.DetectionResult;
import java.util.List;

/**
 * Extractable values deterministically inferred from the events a rule
 * actually matches in the user's committed search scope.
 *
 * <p>Every number is measured: {@code sampledEvents} is how many events
 * were read, {@code matchedEvents} how many the rule matched, and each
 * suggestion carries the matched events it really produced a value from.
 * No confidence score is invented. When nothing can be suggested safely,
 * {@code status} is {@code NO_SUGGESTION} and {@code reason} says why in
 * words the user can act on.
 *
 * <p>{@code alreadyDefined} lists the output names the rule already has, so
 * the UI can show them as existing rather than offering a duplicate.
 */
public record ExtractionSuggestionResponseDto(
    Status status,
    String reason,
    String field,
    int sampledEvents,
    int matchedEvents,
    List<DetectionResult.SuggestedExtraction> suggestions,
    List<String> alreadyDefined,
    List<String> warnings
) {

  public enum Status { SUGGESTED, NO_SUGGESTION }

  public ExtractionSuggestionResponseDto {
    suggestions = suggestions == null ? List.of() : List.copyOf(suggestions);
    alreadyDefined = alreadyDefined == null ? List.of() : List.copyOf(alreadyDefined);
    warnings = warnings == null ? List.of() : List.copyOf(warnings);
  }

  public static ExtractionSuggestionResponseDto none(String reason, String field, int sampled, int matched,
      List<String> alreadyDefined) {
    return new ExtractionSuggestionResponseDto(Status.NO_SUGGESTION, reason, field, sampled, matched, List.of(),
        alreadyDefined, List.of());
  }
}
