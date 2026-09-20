package com.logexplorer.core.classify.detect;

import static com.logexplorer.core.classify.ClassificationTestRules.webhook;
import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.logexplorer.core.classify.CompiledCondition;
import com.logexplorer.core.classify.ExtractedValueType;
import com.logexplorer.core.classify.ExtractionType;
import com.logexplorer.core.classify.MatcherType;
import com.logexplorer.core.classify.RuleCompiler;
import com.logexplorer.core.classify.RuleCondition;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

class PatternDetectorTest {

  private final RuleCompiler compiler = new RuleCompiler();
  private final PatternDetector detector = new PatternDetector(compiler, new ObjectMapper());

  private static final String ANCHOR = webhook("/payments", 123, 200, 45);

  /** 11 synthetic webhook calls (including the anchor itself) plus similar-looking and unrelated noise. */
  private static List<String> sample() {
    List<String> values = new ArrayList<>();
    String[] paths = {"/payments", "/profile", "/customer", "/accounts", "/refunds"};
    int[] codes = {200, 500, 404, 201, 200};
    for (int i = 0; i < 11; i++) {
      values.add(webhook(paths[i % 5], 100 + i * 111, codes[i % 5], 20 + i * 9));
    }
    for (int i = 0; i < 20; i++) {
      values.add(switch (i % 4) {
        case 0 -> "Make webhook configuration reload requested version=" + i;
        case 1 -> "Webhook call to /payments skipped: circuit open responseCode=503";
        case 2 -> "Loaded account summary for request " + i;
        default -> "Payment authorized in " + i + "ms";
      });
    }
    return values;
  }

  private boolean matchesAll(List<RuleCondition> conditions, String value) {
    return conditions.stream().map(compiler::compileCondition).allMatch(c -> c.test(value));
  }

  @Test
  void suggestsTheLeastComplexMatcherAnchoredOnTheSelectedEvent() {
    List<String> sample = sample();
    DetectionResult result = detector.detect("message", ANCHOR, sample, 200);

    assertThat(result.status()).isEqualTo(DetectionResult.Status.SUGGESTED);
    assertThat(result.sampledEvents()).isEqualTo(200);
    assertThat(result.valuesWithField()).isEqualTo(sample.size());
    assertThat(result.similarEvents()).isEqualTo(11);
    assertThat(result.stableSegments()).contains("Make webhook call to", "requestId=", "responseCode=", "duration=");
    assertThat(result.variableSegments()).extracting(DetectionResult.VariableSegment::name)
        .contains("url", "requestId", "responseCode", "duration");

    assertThat(result.suggestedConditions()).extracting(RuleCondition::matcher).doesNotContain(MatcherType.REGEX);
    assertThat(result.suggestedConditions().get(0).matcher()).isEqualTo(MatcherType.STARTS_WITH);
    assertThat(result.suggestedConditions().get(0).value()).isEqualTo("Make webhook call to");
    assertThat(matchesAll(result.suggestedConditions(), ANCHOR)).as("generated pattern matches the anchor").isTrue();
    assertThat(result.coverage().matchedSimilar()).isEqualTo(11);
    assertThat(result.coverage().matchedOther()).isZero();
    long matchedInSample = sample.stream().filter(v -> matchesAll(result.suggestedConditions(), v)).count();
    assertThat(matchedInSample).as("measured against the candidate set").isEqualTo(11);
  }

  @Test
  void suggestsLabelledAndUrlExtractionsWithMeasuredCoverage() {
    DetectionResult result = detector.detect("message", ANCHOR, sample(), 31);
    Map<String, DetectionResult.SuggestedExtraction> byName = result.suggestedExtractions().stream()
        .collect(Collectors.toMap(s -> s.definition().name(), Function.identity()));
    assertThat(byName).containsKeys("url", "requestId", "responseCode", "durationMs");
    assertThat(byName.get("responseCode").definition().valueType()).isEqualTo(ExtractedValueType.INTEGER);
    assertThat(byName.get("responseCode").definition().type()).isEqualTo(ExtractionType.REGEX);
    assertThat(byName.get("responseCode").extracted()).isEqualTo(11);
    assertThat(byName.get("responseCode").of()).isEqualTo(11);
    assertThat(byName.get("durationMs").definition().label()).isEqualTo("Duration (ms)");
    assertThat(byName.get("url").definition().label()).isEqualTo("URL");
    assertThat(byName.get("requestId").definition().label()).isEqualTo("Request ID");
    byName.values().forEach(s -> compiler.compileExtraction(s.definition()));
  }

  @Test
  void neverGeneralizesFromASingleEventOrTooFewSimilarOnes() {
    DetectionResult single = detector.detect("message", ANCHOR, List.of(ANCHOR), 1);
    assertThat(single.status()).isEqualTo(DetectionResult.Status.NO_SAFE_PATTERN_SUGGESTION);
    assertThat(single.suggestedConditions()).isEmpty();
    assertThat(single.sampledEvents()).isEqualTo(1);

    DetectionResult two = detector.detect("message", ANCHOR,
        List.of(ANCHOR, webhook("/x", 1, 200, 1), "Unrelated message here"), 3);
    assertThat(two.status()).isEqualTo(DetectionResult.Status.NO_SAFE_PATTERN_SUGGESTION);
    assertThat(two.similarEvents()).isEqualTo(2);
    assertThat(two.reason()).contains("at least 3");
  }

  @Test
  void valuesWithTooLittleFixedTextAreNotGeneralized() {
    DetectionResult result = detector.detect("message", "12345", List.of("12345", "67890", "11111"), 3);
    assertThat(result.status()).isEqualTo(DetectionResult.Status.NO_SAFE_PATTERN_SUGGESTION);
  }

  @Test
  void identicalValuesSuggestExact() {
    String message = "Scheduled cleanup finished without errors";
    DetectionResult result = detector.detect("message", message,
        List.of(message, message, message, "Scheduled cleanup started"), 4);
    assertThat(result.suggestedConditions()).singleElement()
        .satisfies(c -> assertThat(c.matcher()).isEqualTo(MatcherType.EXACT));
  }

  @Test
  void usesContainsWhenThereIsNoStablePrefix() {
    List<String> sample = new ArrayList<>();
    for (int i = 0; i < 6; i++) {
      sample.add("[req-" + (1000 + i) + "] upstream gateway timeout after " + (i + 3) + "s code=504");
    }
    sample.add("Scheduler heartbeat ok");
    DetectionResult result = detector.detect("message", sample.get(0), sample, sample.size());
    assertThat(result.status()).isEqualTo(DetectionResult.Status.SUGGESTED);
    assertThat(result.suggestedConditions().get(0).matcher()).isEqualTo(MatcherType.CONTAINS);
    assertThat(result.suggestedConditions().get(0).value()).isEqualTo("upstream gateway timeout after");
  }

  @Test
  void redactionMarkersAreNeverStableLiteralsInASuggestion() {
    List<String> sample = new ArrayList<>();
    for (int i = 0; i < 5; i++) {
      sample.add("Outbound call to partner api token=[REDACTED] status=" + (200 + i));
    }
    DetectionResult result = detector.detect("message", sample.get(0), sample, 5);
    assertThat(result.stableSegments()).noneMatch(s -> s.contains("[REDACTED"));
    assertThat(result.suggestedConditions()).noneMatch(c -> c.value().contains("[REDACTED"));
  }

  @Test
  void jsonValuesUseKeysAndSuggestJsonPointerExtractions() {
    List<String> sample = new ArrayList<>();
    for (int i = 0; i < 5; i++) {
      sample.add("{\"operation\":\"transfer\",\"status\":" + (200 + i) + ",\"latencyMs\":" + (10 + i) + "}");
    }
    sample.add("{\"heartbeat\":true}");
    DetectionResult result = detector.detect("message", sample.get(0), sample, sample.size());
    assertThat(result.structure()).isEqualTo("JSON");
    assertThat(result.status()).isEqualTo(DetectionResult.Status.SUGGESTED);
    assertThat(result.suggestedConditions()).allSatisfy(c -> assertThat(c.matcher()).isEqualTo(MatcherType.CONTAINS));
    assertThat(result.suggestedExtractions()).anySatisfy(s -> {
      assertThat(s.definition().type()).isEqualTo(ExtractionType.JSON_POINTER);
      assertThat(s.definition().expression()).isEqualTo("/status");
      assertThat(s.definition().valueType()).isEqualTo(ExtractedValueType.INTEGER);
    });
  }

  @Test
  void detectionIsDeterministicAndBoundedOnLongValues() {
    List<String> sample = sample();
    assertThat(detector.detect("message", ANCHOR, sample, 200)).isEqualTo(detector.detect("message", ANCHOR, sample, 200));
    String huge = ANCHOR + " " + "x".repeat(50_000);
    DetectionResult result = detector.detect("message", huge, List.of(huge, huge, huge), 3);
    assertThat(result).isNotNull();
  }

  @Test
  void candidateConditionsAlwaysCompile() {
    DetectionResult result = detector.detect("message", ANCHOR, sample(), 200);
    for (RuleCondition condition : result.suggestedConditions()) {
      CompiledCondition compiled = compiler.compileCondition(condition);
      assertThat(compiled.test(ANCHOR)).isTrue();
    }
  }

  /**
   * Synthetic data shaped like the owner-observed defect (PR61_OWNER_MANUAL_USABILITY_AND_CLASSIFICATION_
   * RECOVERY §22): request method, URL, response code, response body - never real owner/customer log content.
   * `Request:` anchors a run of variable tokens (method, then URL, matching this class's own documented
   * "reached by skipping the variables in between" shape), then `Response:`/`Body:` anchor their own values.
   */
  private static String httpCallLine(String method, String path, int code, String body) {
    return "Request: " + method + " https://example.invalid" + path + " Response: " + code + " Body: " + body;
  }

  private static List<String> httpCallSample() {
    List<String> values = new ArrayList<>();
    String[] methods = {"POST", "GET", "POST", "PUT", "GET"};
    String[] paths = {"/api/orders", "/api/accounts", "/api/refunds", "/api/customers", "/api/payments"};
    int[] codes = {201, 200, 201, 204, 200};
    String[] bodies = {"{\"status\":\"ok\"}", "{\"status\":\"ok\"}", "{\"status\":\"created\"}",
        "{\"status\":\"ok\"}", "{\"status\":\"ok\"}"};
    for (int i = 0; i < 11; i++) {
      values.add(httpCallLine(methods[i % 5], paths[i % 5], codes[i % 5], bodies[i % 5]));
    }
    for (int i = 0; i < 15; i++) {
      values.add("Unrelated worker heartbeat tick=" + i);
    }
    return values;
  }

  @Test
  void everySuggestedRegexExtractionAlreadyCompilesBeforeItIsEverOffered() {
    String anchor = httpCallLine("POST", "/api/orders", 201, "{\"status\":\"ok\"}");
    DetectionResult result = detector.detect("message", anchor, httpCallSample(), 200);

    assertThat(result.status()).isEqualTo(DetectionResult.Status.SUGGESTED);
    assertThat(result.suggestedExtractions()).as("owner-observed shape (method/URL/code/body) yields real suggestions").isNotEmpty();
    // The mission's own core invariant (§11 ASSISTED_SUGGESTION_VALIDITY): a suggestion this method already
    // returned must already be compilable, unconditionally - never validated for the first time by the frontend
    // or by a later Test-step round trip.
    for (DetectionResult.SuggestedExtraction suggested : result.suggestedExtractions()) {
      compiler.compileExtraction(suggested.definition());
    }
  }
}
