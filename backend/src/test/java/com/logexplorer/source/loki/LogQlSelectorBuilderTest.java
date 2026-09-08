package com.logexplorer.source.loki;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Selector escaping tests (IMPLEMENTATION_PLAN.md "Phase D" required
 * automated test: "selector escaping incl. quotes/backslashes/regex
 * metacharacters, pushdown vs post-filter equivalence").
 */
class LogQlSelectorBuilderTest {

  @Test
  void namespaceOnlyProducesAnExactMatchSelector() {
    String selector = LogQlSelectorBuilder.build("kubernetes_namespace_name", "my-ns", "app", List.of());
    assertThat(selector).isEqualTo("{kubernetes_namespace_name=\"my-ns\"}");
  }

  @Test
  void namespaceAndExactlyOneServicePushesDownBoth() {
    String selector = LogQlSelectorBuilder.build("kubernetes_namespace_name", "my-ns", "app", List.of("gateway"));
    assertThat(selector).isEqualTo("{kubernetes_namespace_name=\"my-ns\",app=\"gateway\"}");
  }

  @Test
  void multipleRequestedServicesAreNotPushedDown() {
    // Not a safe single exact-match pushdown - EventFilters post-filtering
    // handles the actual narrowing; the selector just keeps the namespace.
    String selector = LogQlSelectorBuilder.build(
        "kubernetes_namespace_name", "my-ns", "app", List.of("gateway", "accounts-api"));
    assertThat(selector).isEqualTo("{kubernetes_namespace_name=\"my-ns\"}");
  }

  @Test
  void noFiltersAtAllFallsBackToAnyNonEmptyNamespaceLabel() {
    String selector = LogQlSelectorBuilder.build("kubernetes_namespace_name", null, "app", List.of());
    assertThat(selector).isEqualTo("{kubernetes_namespace_name=~\".+\"}");
  }

  @Test
  void doubleQuotesInAValueAreEscaped() {
    String selector = LogQlSelectorBuilder.build("kubernetes_namespace_name", "ns-\"quoted\"", "app", List.of());
    assertThat(selector).isEqualTo("{kubernetes_namespace_name=\"ns-\\\"quoted\\\"\"}");
  }

  @Test
  void backslashesInAValueAreEscaped() {
    String selector = LogQlSelectorBuilder.build("kubernetes_namespace_name", "ns\\with\\backslash", "app", List.of());
    assertThat(selector).isEqualTo("{kubernetes_namespace_name=\"ns\\\\with\\\\backslash\"}");
  }

  @Test
  void aValueContainingRegexMetacharactersPassesThroughSafelyAsALiteralExactMatch() {
    // "=" is plain string equality in LogQL, not regex - metacharacters in
    // the value need no special handling beyond the quote/backslash
    // escaping already applied to any value.
    String tricky = "ns.*[a-z]+(x|y)$^";
    String selector = LogQlSelectorBuilder.build("kubernetes_namespace_name", tricky, "app", List.of());
    assertThat(selector).isEqualTo("{kubernetes_namespace_name=\"" + tricky + "\"}");
  }

  @Test
  void escapeHandlesBackslashBeforeQuoteWithoutDoubleEscaping() {
    // Order matters: escape backslashes first, or a quote-escape's inserted
    // backslash would itself get re-escaped. Built via concatenation
    // rather than a dense escaped literal, so the real character sequence
    // is unambiguous on both sides.
    String input = "a" + "\\" + "\"" + "b"; // real chars: a \ " b
    String expected = "a" + "\\" + "\\" + "\\" + "\"" + "b"; // real chars: a \ \ \ " b
    assertThat(LogQlSelectorBuilder.escape(input)).isEqualTo(expected);
  }

  @Test
  void blankServiceValuesAreTreatedAsAbsent() {
    String selector = LogQlSelectorBuilder.build("kubernetes_namespace_name", "my-ns", "app", List.of("  "));
    assertThat(selector).isEqualTo("{kubernetes_namespace_name=\"my-ns\"}");
  }
}
