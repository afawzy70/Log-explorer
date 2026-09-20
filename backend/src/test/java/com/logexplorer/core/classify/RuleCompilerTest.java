package com.logexplorer.core.classify;

import static com.logexplorer.core.classify.ClassificationTestRules.condition;
import static com.logexplorer.core.classify.ClassificationTestRules.pointer;
import static com.logexplorer.core.classify.ClassificationTestRules.regex;
import static com.logexplorer.core.classify.ClassificationTestRules.rule;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class RuleCompilerTest {

  private final RuleCompiler compiler = new RuleCompiler();

  private CompiledCondition only(RuleCondition condition) {
    return compiler.compile(rule("r1", "tag", condition)).conditions().get(0);
  }

  @Test
  void exactMatchesTheWholeValueOnly() {
    CompiledCondition exact = only(condition("message", MatcherType.EXACT, "Payment accepted"));
    assertThat(exact.test("Payment accepted")).isTrue();
    assertThat(exact.test("Payment accepted twice")).isFalse();
    assertThat(exact.test(null)).isFalse();
  }

  @Test
  void containsAndStartsWith() {
    assertThat(only(condition("message", MatcherType.CONTAINS, "responseCode=")).test("x responseCode=200")).isTrue();
    assertThat(only(condition("message", MatcherType.STARTS_WITH, "Make webhook")).test("Make webhook call")).isTrue();
    assertThat(only(condition("message", MatcherType.STARTS_WITH, "webhook")).test("Make webhook call")).isFalse();
  }

  @Test
  void ignoreCaseAppliesToLiteralsAndRegex() {
    CompiledCondition literal = compiler.compile(rule("r1", "t",
        new RuleCondition("message", MatcherType.CONTAINS, "WEBHOOK", true))).conditions().get(0);
    assertThat(literal.test("make webhook call")).isTrue();
    CompiledCondition pattern = compiler.compile(rule("r1", "t",
        new RuleCondition("message", MatcherType.REGEX, "^make\\s+WEBHOOK", true))).conditions().get(0);
    assertThat(pattern.test("Make webhook call")).isTrue();
  }

  @Test
  void regexIsCompiledWithRe2AndMatchesWithFind() {
    CompiledCondition regexCondition = only(condition("message", MatcherType.REGEX, "responseCode=(5\\d\\d)"));
    assertThat(regexCondition.test("call responseCode=503 duration=4ms")).isTrue();
    assertThat(regexCondition.test("call responseCode=200")).isFalse();
  }

  @Test
  void invalidRegexIsRejectedAtValidationWithItsPath() {
    assertThatThrownBy(() -> compiler.compile(rule("r1", "t", condition("message", MatcherType.REGEX, "(unclosed"))))
        .isInstanceOf(RuleValidationException.class)
        .satisfies(e -> assertThat(((RuleValidationException) e).errors())
            .anySatisfy(error -> assertThat(error.path()).isEqualTo("conditions[0].value")));
  }

  @Test
  void lookaroundAndBackreferencesAreRejectedAsUnsupportedNotRunOnAnUnsafeEngine() {
    for (String unsafe : List.of("(?<=token=)\\w+", "(\\w)\\1", "a(?=b)")) {
      assertThatThrownBy(() -> compiler.compile(rule("r1", "t", condition("message", MatcherType.REGEX, unsafe))))
          .isInstanceOf(RuleValidationException.class)
          .satisfies(e -> assertThat(((RuleValidationException) e).errors().get(0).message())
              .startsWith("Invalid or unsupported regular expression"));
    }
  }

  @Test
  void regexLongerThanTheLimitIsRejected() {
    String tooLong = "a".repeat(ClassificationLimits.MAX_PATTERN_LENGTH + 1);
    assertThatThrownBy(() -> compiler.compile(rule("r1", "t", condition("message", MatcherType.REGEX, tooLong))))
        .isInstanceOf(RuleValidationException.class);
  }

  @Test
  void catastrophicBacktrackingPatternStillRunsInLinearTime() {
    CompiledCondition evil = only(condition("message", MatcherType.REGEX, "(a+)+$"));
    String input = "a".repeat(30_000) + "!";
    long started = System.nanoTime();
    boolean matched = evil.test(input);
    assertThat(matched).isFalse();
    assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofSeconds(2));
  }

  @Test
  void requiredPartsAreValidated() {
    ClassificationRule empty = new ClassificationRule(null, " ", null, List.of(), null, null, null, List.of(), null, null,
        null);
    assertThatThrownBy(() -> compiler.compile(empty))
        .isInstanceOf(RuleValidationException.class)
        .satisfies(e -> assertThat(((RuleValidationException) e).errors()).extracting(RuleValidationError::path)
            .contains("name", "tags", "conditions"));
  }

  @Test
  void conditionAndExtractionCountsAreBounded() {
    List<RuleCondition> conditions = new ArrayList<>();
    for (int i = 0; i <= ClassificationLimits.MAX_CONDITIONS_PER_RULE; i++) {
      conditions.add(condition("message", MatcherType.CONTAINS, "x" + i));
    }
    assertThatThrownBy(() -> compiler.compile(rule("r1", "t", MatchMode.ALL, conditions, List.of())))
        .isInstanceOf(RuleValidationException.class);
    List<ExtractionDefinition> extractions = new ArrayList<>();
    for (int i = 0; i <= ClassificationLimits.MAX_EXTRACTIONS_PER_RULE; i++) {
      extractions.add(regex("value" + i, "v" + i + "=(\\d+)"));
    }
    assertThatThrownBy(() -> compiler.compile(rule("r1", "t", MatchMode.ALL,
        List.of(condition("message", MatcherType.CONTAINS, "x")), extractions)))
        .isInstanceOf(RuleValidationException.class);
  }

  @Test
  void unknownAndProtectedFieldsAreNotAddressable() {
    for (String field : List.of("nope", "cif", "customerId", "originalRawJson", "extra.", "mdc.with space")) {
      assertThatThrownBy(() -> compiler.compile(rule("r1", "t", condition(field, MatcherType.CONTAINS, "x"))))
          .as(field)
          .isInstanceOf(RuleValidationException.class);
    }
    compiler.compile(rule("r1", "t", condition("extra.httpMethod", MatcherType.EXACT, "POST")));
    compiler.compile(rule("r1", "t", condition("mdc.event.correlationId", MatcherType.CONTAINS, "corr")));
    compiler.compile(rule("r1", "t", condition("businessStep", MatcherType.EXACT, "debit-account")));
  }

  @Test
  void extractionGroupsAndPointersAreValidated() {
    RuleCondition any = condition("message", MatcherType.CONTAINS, "x");
    assertThatThrownBy(() -> compiler.compile(rule("r1", "t", MatchMode.ALL, List.of(any),
        List.of(regex("code", "responseCode=\\d+"))))).isInstanceOf(RuleValidationException.class);
    assertThatThrownBy(() -> compiler.compile(rule("r1", "t", MatchMode.ALL, List.of(any),
        List.of(regex("code", "(a)(b)"))))).isInstanceOf(RuleValidationException.class);
    assertThatThrownBy(() -> compiler.compile(rule("r1", "t", MatchMode.ALL, List.of(any),
        List.of(pointer("status", "message", "response/status"))))).isInstanceOf(RuleValidationException.class);
    assertThatThrownBy(() -> compiler.compile(rule("r1", "t", MatchMode.ALL, List.of(any),
        List.of(regex("code", "c=(\\d+)"), regex("code", "d=(\\d+)"))))).isInstanceOf(RuleValidationException.class);

    CompiledRule named = compiler.compile(rule("r1", "t", MatchMode.ALL, List.of(any),
        List.of(regex("code", "(x)=(?P<code>\\d+)"))));
    assertThat(named.extractions().get(0).groupIndex()).isEqualTo(2);
  }

  /**
   * PR61_OWNER_MANUAL_USABILITY_AND_CLASSIFICATION_RECOVERY - B01/B03-B09: every group-resolution case the
   * extraction step's own "Capture group (advanced)" helper text now describes, proven directly against {@link
   * RuleCompiler}. B02 (omitted group + a named capture matching the extraction's own name) is already covered
   * above ({@code (x)=(?P<code>\d+)}); B09/B10 (invalid/unsupported RE2 syntax) are already covered by {@link
   * #invalidRegexIsRejectedAtValidationWithItsPath()} and {@link
   * #lookaroundAndBackreferencesAreRejectedAsUnsupportedNotRunOnAnUnsafeEngine()}.
   */
  @Test
  void groupResolutionMatchesEveryDocumentedCase() {
    RuleCondition any = condition("message", MatcherType.CONTAINS, "x");

    // B01 - a single unnamed capture, group omitted -> auto-resolves to group 1.
    CompiledRule singleUnnamed = compiler.compile(rule("r1", "t", MatchMode.ALL, List.of(any),
        List.of(regex("value", "Response:\\s*(\\d+)"))));
    assertThat(singleUnnamed.extractions().get(0).groupIndex()).isEqualTo(1);

    // B03 - an explicit, existing named group, different from the extraction's own name.
    ExtractionDefinition explicitNamed = new ExtractionDefinition("value", null, "message", ExtractionType.REGEX,
        "Response:\\s*(?P<code>\\d+)", "code", null, null);
    CompiledRule named = compiler.compile(rule("r1", "t", MatchMode.ALL, List.of(any), List.of(explicitNamed)));
    assertThat(named.extractions().get(0).groupIndex()).isEqualTo(1);

    // B04 - an explicit, valid numeric group (the expression's second capture).
    ExtractionDefinition explicitNumeric = new ExtractionDefinition("value", null, "message", ExtractionType.REGEX,
        "(GET|POST)\\s+(\\S+)", "2", null, null);
    CompiledRule numeric = compiler.compile(rule("r1", "t", MatchMode.ALL, List.of(any), List.of(explicitNumeric)));
    assertThat(numeric.extractions().get(0).groupIndex()).isEqualTo(2);

    // B05 - an explicit group name that does not exist in the expression is rejected, never silently converted
    // to group 1 - the exact owner-observed shape and the exact message text the mission cites.
    ExtractionDefinition nonexistentNamed = new ExtractionDefinition("url", null, "message", ExtractionType.REGEX,
        "Request:\\s*(.*?)(?:\\r?\\n|$)", "url", null, null);
    assertThatThrownBy(() -> compiler.compile(rule("r1", "t", MatchMode.ALL, List.of(any), List.of(nonexistentNamed))))
        .isInstanceOf(RuleValidationException.class)
        .satisfies(e -> assertThat(((RuleValidationException) e).errors())
            .anySatisfy(error -> {
              assertThat(error.path()).isEqualTo("extractions[0].group");
              assertThat(error.message()).isEqualTo("The expression has no group with that name");
            }));

    // B06 - an explicit numeric group past the expression's actual capture count.
    ExtractionDefinition outOfRange = new ExtractionDefinition("value", null, "message", ExtractionType.REGEX,
        "Response:\\s*(\\d+)", "2", null, null);
    assertThatThrownBy(() -> compiler.compile(rule("r1", "t", MatchMode.ALL, List.of(any), List.of(outOfRange))))
        .isInstanceOf(RuleValidationException.class)
        .satisfies(e -> assertThat(((RuleValidationException) e).errors())
            .anySatisfy(error -> {
              assertThat(error.path()).isEqualTo("extractions[0].group");
              assertThat(error.message()).isEqualTo("Group index must be between 1 and 1");
            }));

    // B07 - multiple captures, no named match: rejected with its own exact ambiguity message.
    assertThatThrownBy(() -> compiler.compile(rule("r1", "t", MatchMode.ALL, List.of(any),
        List.of(regex("value", "(\\d+)-(\\d+)")))))
        .isInstanceOf(RuleValidationException.class)
        .satisfies(e -> assertThat(((RuleValidationException) e).errors())
            .anySatisfy(error -> {
              assertThat(error.path()).isEqualTo("extractions[0].group");
              assertThat(error.message()).isEqualTo("The expression has several groups; name the group to extract");
            }));

    // B08 - zero captures: rejected with its own exact message.
    assertThatThrownBy(() -> compiler.compile(rule("r1", "t", MatchMode.ALL, List.of(any),
        List.of(regex("value", "Response:\\s*\\d+")))))
        .isInstanceOf(RuleValidationException.class)
        .satisfies(e -> assertThat(((RuleValidationException) e).errors())
            .anySatisfy(error -> {
              assertThat(error.path()).isEqualTo("extractions[0].expression");
              assertThat(error.message()).contains("needs a capture group");
            }));
  }

  @Test
  void tagsAreNormalizedAndValidated() {
    ClassificationRule mixed = new ClassificationRule("r1", "Rule", null, List.of(" Middleware ", "middleware", "External-API"),
        null, null, null, List.of(condition("message", MatcherType.CONTAINS, "x")), null, null, null);
    assertThat(compiler.compile(mixed).rule().tags()).containsExactly("middleware", "external-api");
    ClassificationRule bad = new ClassificationRule("r1", "Rule", null, List.of("has space"), null, null, null,
        List.of(condition("message", MatcherType.CONTAINS, "x")), null, null, null);
    assertThatThrownBy(() -> compiler.compile(bad)).isInstanceOf(RuleValidationException.class);
  }

  @Test
  void defaultsAreDocumentedNotSilentZeros() {
    ClassificationRule minimal = new ClassificationRule(null, "Rule", null, List.of("t"), null, null, null,
        List.of(condition("message", MatcherType.CONTAINS, "x")), null, null, null);
    ClassificationRule compiled = compiler.compile(minimal).rule();
    assertThat(compiled.enabled()).isTrue();
    assertThat(compiled.priority()).isEqualTo(ClassificationRule.DEFAULT_PRIORITY);
    assertThat(compiled.matchMode()).isEqualTo(MatchMode.ALL);
  }
}
