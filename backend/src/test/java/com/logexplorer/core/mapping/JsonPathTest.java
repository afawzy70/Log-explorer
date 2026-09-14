package com.logexplorer.core.mapping;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import org.junit.jupiter.api.Test;

class JsonPathTest {

  @Test
  void singleTopLevelSegment() {
    assertThat(JsonPath.parse("cif").segments()).isEqualTo(List.of("cif"));
  }

  @Test
  void dotSeparatedNestedSegments() {
    assertThat(JsonPath.parse("mdc.cif").segments()).isEqualTo(List.of("mdc", "cif"));
    assertThat(JsonPath.parse("context.customer.cif").segments()).isEqualTo(List.of("context", "customer", "cif"));
  }

  @Test
  void bracketedLiteralKeyContainingADot() {
    // The exact case core.parse.LogLineParser's old resolveCorrelationId hand-wrote:
    // a flat "event.correlationId" key nested one level under mdc, NOT a
    // nested event -> correlationId path.
    assertThat(JsonPath.parse("mdc[\"event.correlationId\"]").segments())
        .isEqualTo(List.of("mdc", "event.correlationId"));
  }

  @Test
  void bracketedLiteralKeyAtTopLevel() {
    assertThat(JsonPath.parse("[\"event.correlationId\"]").segments())
        .isEqualTo(List.of("event.correlationId"));
  }

  @Test
  void twoAdjacentBracketSegments() {
    assertThat(JsonPath.parse("a[\"b.c\"][\"d.e\"]").segments()).isEqualTo(List.of("a", "b.c", "d.e"));
  }

  @Test
  void distinguishesNestedPathFromLiteralDottedKey() {
    // "event.correlationId" (no brackets) means nested: root -> event -> correlationId.
    // mdc["event.correlationId"] means: root -> mdc -> (the literal key "event.correlationId").
    // These must be genuinely different paths.
    JsonPath nested = JsonPath.parse("mdc.event.correlationId");
    JsonPath literal = JsonPath.parse("mdc[\"event.correlationId\"]");
    assertThat(nested.segments()).isEqualTo(List.of("mdc", "event", "correlationId"));
    assertThat(literal.segments()).isEqualTo(List.of("mdc", "event.correlationId"));
    assertThat(nested).isNotEqualTo(literal);
  }

  @Test
  void blankPathIsRejected() {
    assertThatThrownBy(() -> JsonPath.parse("")).isInstanceOf(InvalidJsonPathException.class);
    assertThatThrownBy(() -> JsonPath.parse("   ")).isInstanceOf(InvalidJsonPathException.class);
    assertThatThrownBy(() -> JsonPath.parse(null)).isInstanceOf(InvalidJsonPathException.class);
  }

  @Test
  void trailingDotIsRejected() {
    assertThatThrownBy(() -> JsonPath.parse("mdc.")).isInstanceOf(InvalidJsonPathException.class);
  }

  @Test
  void leadingDotIsRejected() {
    assertThatThrownBy(() -> JsonPath.parse(".cif")).isInstanceOf(InvalidJsonPathException.class);
  }

  @Test
  void doubleDotIsRejected() {
    assertThatThrownBy(() -> JsonPath.parse("mdc..cif")).isInstanceOf(InvalidJsonPathException.class);
  }

  @Test
  void unterminatedBracketIsRejected() {
    assertThatThrownBy(() -> JsonPath.parse("mdc[\"abc")).isInstanceOf(InvalidJsonPathException.class);
  }

  @Test
  void unquotedBracketContentIsRejected() {
    assertThatThrownBy(() -> JsonPath.parse("mdc[abc]")).isInstanceOf(InvalidJsonPathException.class);
  }

  @Test
  void emptyBracketLiteralIsRejected() {
    assertThatThrownBy(() -> JsonPath.parse("mdc[\"\"]")).isInstanceOf(InvalidJsonPathException.class);
  }

  @Test
  void strayClosingBracketIsRejected() {
    assertThatThrownBy(() -> JsonPath.parse("mdc]cif")).isInstanceOf(InvalidJsonPathException.class);
  }

  @Test
  void noEvalNoScripting_arbitraryExpressionSyntaxIsNotInterpreted() {
    // Never treated as code - either parses as a literal (verbatim) plain-segment
    // chain, or is rejected outright. Nothing here can execute anything.
    JsonPath path = JsonPath.parse("cif == '2449'");
    assertThat(path.segments()).isEqualTo(List.of("cif == '2449'"));
  }

  @Test
  void rawPreservesOriginalTrimmedString() {
    assertThat(JsonPath.parse("  mdc.cif  ").raw()).isEqualTo("mdc.cif");
  }

  @Test
  void equalsAndHashCodeAreBySegmentsNotRawString() {
    assertThat(JsonPath.parse("mdc.cif")).isEqualTo(JsonPath.parse("mdc.cif"));
    assertThat(JsonPath.parse("mdc.cif").hashCode()).isEqualTo(JsonPath.parse("mdc.cif").hashCode());
  }
}
