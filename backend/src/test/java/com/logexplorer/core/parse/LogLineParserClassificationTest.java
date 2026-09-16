package com.logexplorer.core.parse;

import static com.logexplorer.core.classify.ClassificationTestRules.condition;
import static com.logexplorer.core.classify.ClassificationTestRules.middlewareRule;
import static com.logexplorer.core.classify.ClassificationTestRules.rule;
import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.logexplorer.core.classify.ClassificationEngine;
import com.logexplorer.core.classify.CompiledRuleSet;
import com.logexplorer.core.classify.MatcherType;
import com.logexplorer.core.classify.RuleCompiler;
import com.logexplorer.core.mapping.FieldMappingProfileService;
import com.logexplorer.core.mapping.MappingScopeKey;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.ExtractedField;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * The single classification hook: every line any adapter parses — search,
 * context, journey, or live — is classified once, after field mapping.
 */
class LogLineParserClassificationTest {

  private final ObjectMapper objectMapper = new ObjectMapper();
  private final ClassificationEngine engine = new ClassificationEngine(objectMapper);
  private final FieldMappingProfileService mapping = new FieldMappingProfileService();
  private final LogLineParser parser = new LogLineParser(objectMapper, mapping, engine);

  private static final String LINE = "{\"@timestamp\":\"2026-09-15T10:00:00Z\",\"level\":\"INFO\",\"application\":\"gateway\","
      + "\"message\":\"Make webhook call to /payments/authorize method=POST requestId=req-000020 responseCode=200 "
      + "duration=45ms\",\"stepName\":\"route-request\"}";

  @Test
  void parsedEventsReceiveClassificationsFromTheActiveRuleSet() {
    engine.activate(CompiledRuleSet.ofEnabled(1, List.of(new RuleCompiler().compile(middlewareRule()))));
    CanonicalLogEvent event = parser.parse(LINE, "gateway", MappingScopeKey.of("docker", "payments"));
    assertThat(event.tags()).containsExactly("middleware");
    assertThat(event.classifications().get(0).extracted()).extracting(ExtractedField::value)
        .containsExactly("/payments/authorize", "200", "45");
    assertThat(event.service()).isEqualTo("gateway");
  }

  @Test
  void rulesCanTargetMappedCanonicalFieldsNotOnlyMessage() {
    engine.activate(CompiledRuleSet.ofEnabled(1, List.of(new RuleCompiler().compile(
        rule("routing", "routing", condition("businessStep", MatcherType.EXACT, "route-request"))))));
    assertThat(parser.parse(LINE, null, MappingScopeKey.UNSPECIFIED).tags()).containsExactly("routing");
  }

  @Test
  void malformedLinesAreClassifiedThroughRawLine() {
    engine.activate(CompiledRuleSet.ofEnabled(1, List.of(new RuleCompiler().compile(
        rule("raw", "raw", condition("rawLine", MatcherType.STARTS_WITH, "NOT-JSON"))))));
    CanonicalLogEvent event = parser.parse("NOT-JSON something happened", null, MappingScopeKey.UNSPECIFIED);
    assertThat(event.malformed()).isTrue();
    assertThat(event.tags()).containsExactly("raw");
  }

  @Test
  void aRuleChangeAppliesToNewlyParsedEventsAndNeverMutatesAlreadyParsedOnes() {
    CanonicalLogEvent before = parser.parse(LINE, null, MappingScopeKey.UNSPECIFIED);
    long generation = parser.classificationGeneration();
    engine.activate(CompiledRuleSet.ofEnabled(1, List.of(new RuleCompiler().compile(middlewareRule()))));
    CanonicalLogEvent after = parser.parse(LINE, null, MappingScopeKey.UNSPECIFIED);
    assertThat(before.tags()).isEmpty();
    assertThat(after.tags()).containsExactly("middleware");
    assertThat(parser.classificationGeneration()).isGreaterThan(generation);
  }

  @Test
  void theTwoArgumentConstructorKeepsClassificationOff() {
    LogLineParser plain = new LogLineParser(objectMapper, mapping);
    engine.activate(CompiledRuleSet.ofEnabled(1, List.of(new RuleCompiler().compile(middlewareRule()))));
    assertThat(plain.parse(LINE).tags()).isEmpty();
  }
}
