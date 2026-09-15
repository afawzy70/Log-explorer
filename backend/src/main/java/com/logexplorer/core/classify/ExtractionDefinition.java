package com.logexplorer.core.classify;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * A user-defined structured value a rule extracts from a matching event.
 * {@code name} is the output field name (user-defined — nothing here is
 * middleware-specific). {@code group} selects the RE2 capture group (a
 * group name or a 1-based index); when omitted, a named group equal to
 * {@code name} or the expression's only group is used.
 *
 * <p>{@code sensitive} defaults to {@code false}. Every extracted value is
 * still redacted server-side before it reaches a browser (credential
 * headers, token/secret key-values, JWTs, card numbers, and this event's
 * own protected identifiers when the masking policy masks them); a value
 * marked {@code sensitive} is never shown at all, only {@code [REDACTED]}.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ExtractionDefinition(
    String name,
    String label,
    String sourceField,
    ExtractionType type,
    String expression,
    String group,
    ExtractedValueType valueType,
    Boolean sensitive
) {

  public ExtractionDefinition normalized() {
    return new ExtractionDefinition(
        name == null ? null : name.trim(),
        blankToNull(label),
        sourceField == null ? null : sourceField.trim(),
        type,
        expression,
        blankToNull(group),
        valueType == null ? ExtractedValueType.STRING : valueType,
        sensitive == null ? Boolean.FALSE : sensitive);
  }

  static String blankToNull(String value) {
    if (value == null) {
      return null;
    }
    String trimmed = value.trim();
    return trimmed.isEmpty() ? null : trimmed;
  }
}
