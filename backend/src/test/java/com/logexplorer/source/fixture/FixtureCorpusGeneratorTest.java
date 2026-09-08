package com.logexplorer.source.fixture;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.parse.LogLineParser;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

/**
 * Mirrors {@code tools/demo-log-generator}'s own self-test: proves the
 * fixture corpus is deterministic given a seed and guarantees every
 * required edge case, by parsing every generated line through the real
 * {@link LogLineParser} and inspecting the resulting events - exactly what
 * {@link FixtureLogSource} does.
 */
class FixtureCorpusGeneratorTest {

  private final ObjectMapper objectMapper = new ObjectMapper();
  private final FixtureCorpusGenerator generator = new FixtureCorpusGenerator(objectMapper);
  private final LogLineParser parser = new LogLineParser(objectMapper);
  private static final Instant ANCHOR = Instant.parse("2026-01-01T12:00:00Z");

  @Test
  void sameSeedAndCountReproduceByteIdenticalLines() {
    List<String> a = generator.generateLines(42, 80, ANCHOR);
    List<String> b = generator.generateLines(42, 80, ANCHOR);
    assertThat(a).isEqualTo(b);
  }

  @Test
  void differentSeedsProduceDifferentContent() {
    List<String> a = generator.generateLines(42, 80, ANCHOR);
    List<String> b = generator.generateLines(43, 80, ANCHOR);
    assertThat(a).isNotEqualTo(b);
  }

  @Test
  void requestedCountIsRespectedExactly() {
    assertThat(generator.generateLines(42, 37, ANCHOR)).hasSize(37);
  }

  @Test
  void corpusContainsEveryRequiredEdgeCase() {
    List<String> lines = generator.generateLines(42, 80, ANCHOR);
    List<CanonicalLogEvent> events = lines.stream().map(l -> parser.parse(l, null)).toList();

    long malformedCount = events.stream().filter(CanonicalLogEvent::malformed).count();
    assertThat(malformedCount).as("at least one malformed line").isGreaterThanOrEqualTo(1);

    List<CanonicalLogEvent> wellFormed = events.stream().filter(e -> !e.malformed()).toList();

    assertThat(wellFormed.stream().anyMatch(e -> e.correlationId() != null
        && e.exception() == null)).as("at least one event with a resolved correlationId").isTrue();

    assertThat(wellFormed.stream().anyMatch(e -> e.exception() != null && e.exception().contains("\n")))
        .as("at least one multiline exception").isTrue();

    assertThat(wellFormed.stream().anyMatch(e -> "".equals(e.message())))
        .as("at least one empty message event").isTrue();

    Set<String> unknownMdcKeys = new HashSet<>();
    wellFormed.forEach(e -> unknownMdcKeys.addAll(e.unknownMdcFields().keySet()));
    assertThat(unknownMdcKeys).as("at least one unknown MDC field").isNotEmpty();

    assertThat(wellFormed.stream().anyMatch(e -> e.message() != null && e.message().contains("[burst]")))
        .as("at least one burst-tagged event").isTrue();

    assertThat(wellFormed.stream().allMatch(e -> e.sensitive().cif() != null
            ? e.sensitive().cif().startsWith("FAKE-") : true))
        .as("sensitive values are obviously fake").isTrue();

    // Journey spanning multiple services and multiple traceIds.
    java.util.Map<String, Set<String>> journeyServices = new java.util.HashMap<>();
    java.util.Map<String, Set<String>> journeyTraces = new java.util.HashMap<>();
    for (CanonicalLogEvent e : wellFormed) {
      if (e.journeyId() == null) {
        continue;
      }
      journeyServices.computeIfAbsent(e.journeyId(), k -> new HashSet<>()).add(e.service());
      journeyTraces.computeIfAbsent(e.journeyId(), k -> new HashSet<>()).add(e.traceId());
    }
    assertThat(journeyServices.values().stream().anyMatch(s -> s.size() >= 2))
        .as("at least one journey spanning multiple services").isTrue();
    assertThat(journeyTraces.values().stream().anyMatch(s -> s.size() >= 2))
        .as("at least one journey spanning multiple traceIds").isTrue();
  }

  @Test
  void timestampsAreAnchoredNearTheRequestedInstantForRealisticTimeRangeSearches() {
    Instant anchor = Instant.now();
    List<String> lines = generator.generateLines(42, 40, anchor);
    List<CanonicalLogEvent> events = lines.stream()
        .map(l -> parser.parse(l, null))
        .filter(e -> !e.malformed())
        .toList();
    assertThat(events).isNotEmpty();
    events.forEach(e -> assertThat(e.timestamp()).isBetween(anchor.minusSeconds(120), anchor.plusSeconds(1)));
  }
}
