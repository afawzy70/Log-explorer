package com.logexplorer.core.classify;

import static com.logexplorer.core.classify.ClassificationTestRules.condition;
import static com.logexplorer.core.classify.ClassificationTestRules.event;
import static com.logexplorer.core.classify.ClassificationTestRules.middlewareRule;
import static com.logexplorer.core.classify.ClassificationTestRules.regex;
import static com.logexplorer.core.classify.ClassificationTestRules.rule;
import static com.logexplorer.core.classify.ClassificationTestRules.webhook;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.logexplorer.core.mask.ExtractedValueRedactor;
import com.logexplorer.core.mask.MaskingPolicyService;
import com.logexplorer.core.mask.MaskingService;
import com.logexplorer.core.mask.TextRedactor;
import com.logexplorer.core.model.CanonicalLogEvent;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class RuleTesterTest {

  private final RuleCompiler compiler = new RuleCompiler();
  private final ClassificationEngine engine = new ClassificationEngine(new ObjectMapper());
  private final RuleTester tester = new RuleTester(compiler, engine,
      new ExtractedValueRedactor(new MaskingService(new MaskingPolicyService()), new TextRedactor()));

  private static List<CanonicalLogEvent> sample() {
    List<CanonicalLogEvent> events = new ArrayList<>();
    for (int i = 0; i < 12; i++) {
      String message = i < 10 ? webhook("/p" + i, i, 200 + i, 10 + i) : "Make webhook call to /p" + i + " responseCode=500";
      events.add(event(message));
    }
    for (int i = 0; i < 8; i++) {
      events.add(event(i < 6
          ? "Make webhook configuration reload requested version=" + i
          : "Make webhook call to /queued" + i + " accepted for retry"));
    }
    return events;
  }

  @Test
  void reportsAccurateCountsCoverageAndABoundedPreview() {
    RuleTester.RuleTestResult result = tester.test(middlewareRule(), sample(), true);
    assertThat(result.sampledEvents()).isEqualTo(20);
    assertThat(result.sampleLimitReached()).isTrue();
    assertThat(result.matched()).isEqualTo(12);
    assertThat(result.notMatched()).isEqualTo(8);
    assertThat(result.extractionCoverage()).extracting(RuleTester.ExtractionCoverage::name, RuleTester.ExtractionCoverage::extracted,
        RuleTester.ExtractionCoverage::of).containsExactly(
        org.assertj.core.groups.Tuple.tuple("url", 12, 12),
        org.assertj.core.groups.Tuple.tuple("responseCode", 12, 12),
        org.assertj.core.groups.Tuple.tuple("durationMs", 10, 12));
    assertThat(result.matchedPreview()).hasSize(ClassificationLimits.PREVIEW_COUNT);
    assertThat(result.reviewNote()).startsWith("Review these matches for false positives");
  }

  @Test
  void nearMissEventsAreShownForAllModeRules() {
    RuleTester.RuleTestResult result = tester.test(middlewareRule(), sample(), false);
    assertThat(result.nearMissPreview()).hasSize(2)
        .allSatisfy(p -> {
          assertThat(p.conditionsMatched()).isEqualTo(1);
          assertThat(p.conditionsTotal()).isEqualTo(2);
          assertThat(p.fieldValue()).startsWith("Make webhook call to /queued");
          assertThat(p.extracted()).isEmpty();
        });
  }

  @Test
  void previewValuesPassTheMaskingBoundary() {
    ClassificationRule headers = rule("headers", "external-api", MatchMode.ALL,
        List.of(condition("message", MatcherType.CONTAINS, "Calling partner")),
        List.of(regex("requestHeaders", "headers=\\{(?P<requestHeaders>[^}]*)\\}")));
    CanonicalLogEvent secretEvent = event("Calling partner headers={Authorization: Bearer abc.def.ghi, "
        + "X-API-Key: key-123456, Accept: json} password=Hunter2!");
    RuleTester.RuleTestResult result = tester.test(headers, List.of(secretEvent), false);
    String rendered = result.matchedPreview().toString();
    assertThat(rendered).doesNotContain("abc.def.ghi", "key-123456", "Hunter2!");
    assertThat(result.matchedPreview().get(0).extracted().get(0).redacted()).isTrue();
  }

  @Test
  void neverChangesTheActiveRulesAndRejectsInvalidRules() {
    CompiledRuleSet before = engine.activeRuleSet();
    tester.test(middlewareRule(), sample(), false);
    assertThat(engine.activeRuleSet()).isSameAs(before);
    assertThatThrownBy(() -> tester.test(rule("bad", "t", condition("message", MatcherType.REGEX, "(")), sample(), false))
        .isInstanceOf(RuleValidationException.class);
  }
}
