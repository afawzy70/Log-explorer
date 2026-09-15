package com.logexplorer.source.fixture;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.logexplorer.core.classify.ClassificationEngine;
import com.logexplorer.core.classify.ClassificationTestRules;
import com.logexplorer.core.classify.CompiledRuleSet;
import com.logexplorer.core.classify.RuleCompiler;
import com.logexplorer.core.mapping.FieldMappingProfileService;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.SearchRequest;
import com.logexplorer.core.parse.LogLineParser;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * The fixture corpus is parsed once and cached; a rule change must still
 * apply to the next search (the cache is keyed on the classification
 * generation), and the synthetic middleware / near-miss events must exist.
 */
class FixtureLogSourceClassificationTest {

  private final ObjectMapper objectMapper = new ObjectMapper();
  private final ClassificationEngine engine = new ClassificationEngine(objectMapper);
  private final FixtureLogSource source =
      new FixtureLogSource(objectMapper, new LogLineParser(objectMapper, new FieldMappingProfileService(), engine));

  private List<CanonicalLogEvent> search(List<String> tags) {
    return source.search(SearchRequest.builder()
        .sourceId("fixture")
        .start(Instant.now().minus(Duration.ofHours(1)))
        .end(Instant.now().plus(Duration.ofMinutes(5)))
        .tags(tags)
        .build()).collectList().block();
  }

  @Test
  void corpusContainsSyntheticMiddlewareAndDeliberateNearMisses() {
    List<CanonicalLogEvent> events = search(List.of());
    assertThat(events).filteredOn(e -> e.message() != null && e.message().startsWith("Make webhook call to")).hasSizeGreaterThan(20);
    assertThat(events).anySatisfy(e -> assertThat(e.message()).startsWith("Make webhook configuration reload"));
    assertThat(events).anySatisfy(e -> assertThat(e.message()).startsWith("Webhook call to"));
  }

  @Test
  void activatingARuleReclassifiesTheCachedCorpusOnTheNextSearchAndTagsFilter() {
    assertThat(search(List.of())).allSatisfy(e -> assertThat(e.tags()).isEmpty());
    engine.activate(CompiledRuleSet.ofEnabled(1, List.of(new RuleCompiler().compile(ClassificationTestRules.middlewareRule()))));

    List<CanonicalLogEvent> tagged = search(List.of("middleware"));
    assertThat(tagged).isNotEmpty().allSatisfy(e -> {
      assertThat(e.tags()).containsExactly("middleware");
      assertThat(e.message()).startsWith("Make webhook call to");
    });
    assertThat(search(List.of())).filteredOn(e -> e.message() != null && e.message().startsWith("Make webhook config"))
        .allSatisfy(e -> assertThat(e.tags()).isEmpty());
  }

  @Test
  void newLiveLinesAreClassifiedToo() {
    engine.activate(CompiledRuleSet.ofEnabled(1, List.of(new RuleCompiler().compile(ClassificationTestRules.middlewareRule()))));
    CanonicalLogEvent live = source.follow(new com.logexplorer.core.model.FollowRequest("fixture", List.of(), null))
        .filter(e -> e.message() != null && e.message().startsWith("Make webhook call to"))
        .blockFirst(Duration.ofSeconds(40));
    assertThat(live).isNotNull();
    assertThat(live.tags()).containsExactly("middleware");
  }
}
