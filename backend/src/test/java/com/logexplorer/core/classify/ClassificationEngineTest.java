package com.logexplorer.core.classify;

import static com.logexplorer.core.classify.ClassificationTestRules.condition;
import static com.logexplorer.core.classify.ClassificationTestRules.event;
import static com.logexplorer.core.classify.ClassificationTestRules.middlewareRule;
import static com.logexplorer.core.classify.ClassificationTestRules.pointer;
import static com.logexplorer.core.classify.ClassificationTestRules.regex;
import static com.logexplorer.core.classify.ClassificationTestRules.rule;
import static com.logexplorer.core.classify.ClassificationTestRules.webhook;
import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.ExtractedField;
import com.logexplorer.core.model.RuleMatch;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class ClassificationEngineTest {

  private final RuleCompiler compiler = new RuleCompiler();
  private final ClassificationEngine engine = new ClassificationEngine(new ObjectMapper());

  private void activate(ClassificationRule... rules) {
    engine.activate(CompiledRuleSet.ofEnabled(1, Arrays.stream(rules).map(compiler::compile).toList()));
  }

  private static Map<String, ExtractedField> extracted(RuleMatch match) {
    return match.extracted().stream().collect(java.util.stream.Collectors.toMap(ExtractedField::name, f -> f));
  }

  @Test
  void noActiveRulesReturnsTheSameEventUntouched() {
    CanonicalLogEvent input = event("anything");
    assertThat(engine.classify(input)).isSameAs(input);
  }

  @Test
  void allModeRequiresEveryConditionAndAnyModeOne() {
    activate(
        rule("all-rule", "all", MatchMode.ALL, List.of(condition("message", MatcherType.CONTAINS, "alpha"),
            condition("message", MatcherType.CONTAINS, "beta")), List.of()),
        rule("any-rule", "any", MatchMode.ANY, List.of(condition("message", MatcherType.CONTAINS, "alpha"),
            condition("message", MatcherType.CONTAINS, "beta")), List.of()));
    assertThat(engine.classify(event("alpha only")).tags()).containsExactly("any");
    assertThat(engine.classify(event("alpha and beta")).tags()).containsExactly("all", "any");
    assertThat(engine.classify(event("gamma")).tags()).isEmpty();
  }

  @Test
  void everyMatchingRuleContributesInDeterministicPriorityThenIdOrder() {
    ClassificationRule late = new ClassificationRule("b-rule", "B", null, List.of("second"), true, 50, MatchMode.ALL,
        List.of(condition("message", MatcherType.CONTAINS, "call")), List.of(), null, null);
    ClassificationRule early = new ClassificationRule("z-rule", "Z", null, List.of("first"), true, 10, MatchMode.ALL,
        List.of(condition("message", MatcherType.CONTAINS, "call")), List.of(), null, null);
    ClassificationRule tie = new ClassificationRule("a-rule", "A", null, List.of("second", "third"), true, 50,
        MatchMode.ALL, List.of(condition("message", MatcherType.CONTAINS, "call")), List.of(), null, null);
    activate(late, early, tie);
    CanonicalLogEvent classified = engine.classify(event("a call"));
    assertThat(classified.classifications()).extracting(RuleMatch::ruleId).containsExactly("z-rule", "a-rule", "b-rule");
    assertThat(classified.tags()).containsExactly("first", "second", "third");
  }

  @Test
  void disabledRulesAreNotEvaluated() {
    ClassificationRule disabled = new ClassificationRule("off", "Off", null, List.of("off"), false, 100, MatchMode.ALL,
        List.of(condition("message", MatcherType.CONTAINS, "call")), List.of(), null, null);
    activate(disabled, rule("on", "on", condition("message", MatcherType.CONTAINS, "call")));
    assertThat(engine.classify(event("a call")).tags()).containsExactly("on");
  }

  @Test
  void namedGroupExtractionWithTypeConversion() {
    activate(middlewareRule());
    RuleMatch match = engine.classify(event(webhook("/payments/authorize", 7, 201, 84))).classifications().get(0);
    Map<String, ExtractedField> fields = extracted(match);
    assertThat(match.tags()).containsExactly("middleware");
    assertThat(fields.get("url").value()).isEqualTo("/payments/authorize");
    assertThat(fields.get("responseCode").value()).isEqualTo("201");
    assertThat(fields.get("durationMs").value()).isEqualTo("84");
    assertThat(fields.values()).allSatisfy(f -> assertThat(f.status()).isEqualTo(ExtractedField.Status.PRESENT));
  }

  @Test
  void missingExtractionIsAbsentAndNeverFabricated() {
    activate(middlewareRule());
    RuleMatch match = engine.classify(event("Make webhook call to /x responseCode=200")).classifications().get(0);
    ExtractedField duration = extracted(match).get("durationMs");
    assertThat(duration.status()).isEqualTo(ExtractedField.Status.ABSENT);
    assertThat(duration.value()).isNull();
  }

  @Test
  void conversionFailureIsInvalidWhileClassificationStillApplies() {
    activate(rule("r", "t", MatchMode.ALL, List.of(condition("message", MatcherType.CONTAINS, "code=")),
        List.of(regex("code", "code=(\\S+)", ExtractedValueType.INTEGER))));
    RuleMatch match = engine.classify(event("code=abc")).classifications().get(0);
    assertThat(match.tags()).containsExactly("t");
    assertThat(match.extracted().get(0).status()).isEqualTo(ExtractedField.Status.INVALID);
    assertThat(match.extracted().get(0).value()).isNull();
  }

  @Test
  void jsonPointerExtractionFromJsonTextAndFromStructuredUnknownFields() {
    activate(rule("json", "api", MatchMode.ALL, List.of(condition("message", MatcherType.CONTAINS, "\"status\"")),
        List.of(pointer("status", "message", "/response/status"), pointer("body", "message", "/response/body"),
            pointer("method", "extra.http", "/method"), pointer("missing", "message", "/nope"))));
    CanonicalLogEvent input = CanonicalLogEvent.builder()
        .message("{\"response\":{\"status\":502,\"body\":{\"error\":\"upstream\"}}}")
        .unknownTopLevelFields(Map.of("http", Map.of("method", "PUT")))
        .build();
    Map<String, ExtractedField> fields = extracted(engine.classify(input).classifications().get(0));
    assertThat(fields.get("status").value()).isEqualTo("502");
    assertThat(fields.get("body").value()).isEqualTo("{\"error\":\"upstream\"}");
    assertThat(fields.get("method").value()).isEqualTo("PUT");
    assertThat(fields.get("missing").status()).isEqualTo(ExtractedField.Status.ABSENT);
  }

  @Test
  void jsonPointerOnNonJsonOrMalformedContentIsAbsentNotGuessed() {
    activate(rule("json", "api", MatchMode.ALL, List.of(condition("message", MatcherType.CONTAINS, "status")),
        List.of(pointer("status", "message", "/status"))));
    for (String message : List.of("status=500 plain text", "{\"status\": 500", "[\"status\"]")) {
      ExtractedField field = engine.classify(event(message)).classifications().get(0).extracted().get(0);
      assertThat(field.status()).as(message).isEqualTo(ExtractedField.Status.ABSENT);
    }
  }

  @Test
  void extractedValuesAreBoundedInMemory() {
    activate(rule("big", "big", MatchMode.ALL, List.of(condition("message", MatcherType.STARTS_WITH, "body=")),
        List.of(regex("body", "body=(.*)"))));
    String huge = "body=" + "x".repeat(ClassificationLimits.MAX_STORED_EXTRACTED_VALUE_LENGTH * 2);
    ExtractedField body = engine.classify(event(huge)).classifications().get(0).extracted().get(0);
    assertThat(body.value()).hasSize(ClassificationLimits.MAX_STORED_EXTRACTED_VALUE_LENGTH);
  }

  @Test
  void sameExtractionNameInTwoRulesStaysIsolatedPerRule() {
    activate(
        rule("first", "one", MatchMode.ALL, List.of(condition("message", MatcherType.CONTAINS, "code")),
            List.of(regex("code", "code=(\\d+)"))),
        rule("second", "two", MatchMode.ALL, List.of(condition("message", MatcherType.CONTAINS, "code")),
            List.of(regex("code", "status=(\\d+)"))));
    List<RuleMatch> matches = engine.classify(event("code=1 status=2")).classifications();
    assertThat(matches).hasSize(2);
    assertThat(matches.get(0).extracted().get(0).value()).isEqualTo("1");
    assertThat(matches.get(1).extracted().get(0).value()).isEqualTo("2");
  }

  @Test
  void otherFieldsAndMdcKeysCanBeTargeted() {
    activate(
        rule("svc", "svc", condition("service", MatcherType.EXACT, "payments-api")),
        rule("mdc", "mdc", condition("mdc.event.correlationId", MatcherType.STARTS_WITH, "corr-")));
    CanonicalLogEvent input = CanonicalLogEvent.builder().message("m").service("payments-api")
        .unknownMdcFields(Map.of("event.correlationId", "corr-1")).build();
    assertThat(engine.classify(input).tags()).containsExactly("mdc", "svc");
  }

  @Test
  void rulesAreCompiledOnceAndReusedAcrossEvents() {
    activate(middlewareRule());
    CompiledCondition before = engine.activeRuleSet().rules().get(0).conditions().get(0);
    for (int i = 0; i < 5_000; i++) {
      engine.classify(event(webhook("/p" + i, i, 200, i)));
    }
    assertThat(engine.activeRuleSet().rules().get(0).conditions().get(0)).isSameAs(before);
    assertThat(engine.stats().eventsEvaluated()).isEqualTo(5_000);
    assertThat(engine.stats().ruleMatches()).isEqualTo(5_000);
  }

  @Test
  void generationChangesWhenRulesAreActivated() {
    long before = engine.generation();
    activate(middlewareRule());
    assertThat(engine.generation()).isGreaterThan(before);
  }
}
