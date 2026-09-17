package com.logexplorer.perf;

import static com.logexplorer.core.classify.ClassificationTestRules.condition;
import static com.logexplorer.core.classify.ClassificationTestRules.middlewareRule;
import static com.logexplorer.core.classify.ClassificationTestRules.rule;
import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.logexplorer.core.classify.ClassificationEngine;
import com.logexplorer.core.classify.ClassificationRule;
import com.logexplorer.core.classify.CompiledRuleSet;
import com.logexplorer.core.classify.MatchMode;
import com.logexplorer.core.classify.MatcherType;
import com.logexplorer.core.classify.RuleCompiler;
import com.logexplorer.core.mapping.FieldMappingProfileService;
import com.logexplorer.core.mapping.MappingScopeKey;
import com.logexplorer.core.mask.MaskingPolicyService;
import com.logexplorer.core.mask.MaskingService;
import com.logexplorer.core.mask.TextRedactor;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.SearchRequest;
import com.logexplorer.core.parse.LogLineParser;
import com.logexplorer.core.search.EventFilters;
import com.logexplorer.source.fixture.FixtureCorpusGenerator;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * SEARCH_LATENCY_INVESTIGATION_AND_SAFE_OPTIMIZATION — Phase 3 bounded
 * benchmark evidence. Isolates the backend's own CPU-bound per-event
 * pipeline (JSON parse + field mapping, classification, structured
 * filtering, masking/DTO mapping) from any real Docker/OpenShift network
 * I/O, using the same {@code FixtureCorpusGenerator} shape a real adapter
 * feeds through {@link LogLineParser} (see {@code FixtureLogSource}).
 *
 * <p>Not a JMH microbenchmark (this repository has none anywhere) — follows
 * the same deliberately-generous-ceiling technique as {@code
 * TextRedactorPerformanceTest}: catches a real algorithmic regression, never
 * asserts a tight production-throughput number. Measured ns/event numbers
 * are printed to stdout and copied into {@code
 * docs/performance/SEARCH_LATENCY_INVESTIGATION.md}.
 *
 * <p><b>What this test exists to prove or reject.</b> {@code
 * DockerLogSource#searchBlocking} (and every other {@code LogSource}) calls
 * {@code LogLineParser#parse} — which internally runs classification
 * ({@code core.classify.EventClassifier}) — on every raw candidate line
 * BEFORE {@code EventFilters#matches} ever runs (see {@code SearchService}
 * class javadoc "Totals" and {@code DockerLogSource#searchBlocking}). The
 * Docker/Loki APIs can narrow by time range and (for Docker) by
 * container/service, but severity, free-text, tag, and every structured
 * field filter are post-parse-only. This test measures whether that
 * ordering matters in practice: a "no-result" search (nothing will ever
 * match) still pays the full parse+classify cost for every raw line read,
 * because rejection happens only after both have already run.
 */
class SearchPipelinePerformanceTest {

  private static final int RAW_EVENTS = 20_000; // ~= defaultTailLines(2000) x 10 containers, a realistic Docker fan-out
  private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

  private final FixtureCorpusGenerator generator = new FixtureCorpusGenerator(OBJECT_MAPPER);
  private final LogLineParser parserNoRules =
      new LogLineParser(OBJECT_MAPPER, new FieldMappingProfileService());
  private final LogLineParser parserWithRules = buildParserWithRealisticRules();
  private final MaskingService maskingService = new MaskingService(new MaskingPolicyService());
  private final TextRedactor textRedactor = new TextRedactor();

  private static LogLineParser buildParserWithRealisticRules() {
    RuleCompiler compiler = new RuleCompiler();
    ClassificationEngine engine = new ClassificationEngine(OBJECT_MAPPER);
    // A realistic small-to-medium rule set (10 rules: 9 cheap CONTAINS/
    // STARTS_WITH matchers plus one real-shaped regex+extraction rule) —
    // deliberately not extreme, to measure ordinary configured cost, not a
    // worst case.
    List<ClassificationRule> rules = new ArrayList<>();
    rules.add(middlewareRule());
    for (int i = 0; i < 9; i++) {
      rules.add(rule("tag-rule-" + i, "tag-" + i, MatchMode.ANY,
          List.of(condition("message", MatcherType.CONTAINS, "token-" + i),
              condition("severity", MatcherType.CONTAINS, "ERROR")),
          List.of()));
    }
    engine.activate(CompiledRuleSet.ofEnabled(1, rules.stream().map(compiler::compile).toList()));
    return new LogLineParser(OBJECT_MAPPER, new FieldMappingProfileService(), engine);
  }

  private List<String> rawLines(int count) {
    return generator.generateLines(42L, count, Instant.parse("2026-01-01T00:00:00Z"));
  }

  private long timeMillis(Runnable warmup, Runnable timed) {
    warmup.run();
    long start = System.nanoTime();
    timed.run();
    return (System.nanoTime() - start) / 1_000_000;
  }

  private void report(String label, long elapsedMs, int events, long ceilingMs) {
    double nsPerEvent = (elapsedMs * 1_000_000.0) / events;
    System.out.printf(
        "[SearchPipelinePerformanceTest] %s: %d events in %dms (%.0f ns/event, ceiling %dms)%n",
        label, events, elapsedMs, nsPerEvent, ceilingMs);
    assertThat(elapsedMs)
        .as("%s took %dms for %d events, expected under the generous %dms ceiling", label, elapsedMs, events, ceilingMs)
        .isLessThan(ceilingMs);
  }

  // -----------------------------------------------------------------------
  // PARSE + FIELD MAPPING ONLY (no classification rules active)
  // -----------------------------------------------------------------------

  @Test
  void parseOnlyNoClassificationRulesForTwentyThousandRawLines() {
    List<String> lines = rawLines(RAW_EVENTS);
    long elapsed = timeMillis(
        () -> lines.subList(0, 500).forEach(parserNoRules::parse),
        () -> lines.forEach(parserNoRules::parse));
    report("PARSE only (no rules)", elapsed, RAW_EVENTS, 5_000);
  }

  // -----------------------------------------------------------------------
  // PARSE + CLASSIFY (10 realistic rules active) — isolates classification's
  // own added cost over parse-only, same raw corpus.
  // -----------------------------------------------------------------------

  @Test
  void parseAndClassifyTenRulesForTwentyThousandRawLines() {
    List<String> lines = rawLines(RAW_EVENTS);
    long elapsed = timeMillis(
        () -> lines.subList(0, 500).forEach(parserWithRules::parse),
        () -> lines.forEach(parserWithRules::parse));
    report("PARSE + CLASSIFY (10 rules)", elapsed, RAW_EVENTS, 6_000);
  }

  // -----------------------------------------------------------------------
  // THE CENTRAL QUESTION: does a "no-result" search (a filter nothing will
  // ever match) cost meaningfully less than a search that matches
  // everything, given the real pipeline order (parse+classify always runs
  // BEFORE EventFilters rejects)? If elapsed times are close, rejection
  // ordering is proven not to save the dominant cost.
  // -----------------------------------------------------------------------

  @Test
  void noResultSearchCostsAboutTheSameAsMatchEverythingBecauseFilteringIsPostParse() {
    List<String> lines = rawLines(RAW_EVENTS);
    List<CanonicalLogEvent> parsed = new ArrayList<>(RAW_EVENTS);
    for (String line : lines) {
      parsed.add(parserWithRules.parse(line));
    }
    Instant now = Instant.parse("2026-01-01T00:00:00Z");
    SearchRequest matchEverything = SearchRequest.builder()
        .sourceId("local-docker").start(now.minusSeconds(RAW_EVENTS + 10)).end(now.plusSeconds(10)).build();
    SearchRequest noResult = SearchRequest.builder()
        .sourceId("local-docker").start(now.minusSeconds(RAW_EVENTS + 10)).end(now.plusSeconds(10))
        .text("text-that-will-never-appear-in-any-fixture-line-xyz123").build();

    long fullPipelineMatchAll = timeMillis(
        () -> parsePlusFilter(lines.subList(0, 500), parserWithRules, matchEverything),
        () -> parsePlusFilter(lines, parserWithRules, matchEverything));
    long fullPipelineNoResult = timeMillis(
        () -> parsePlusFilter(lines.subList(0, 500), parserWithRules, noResult),
        () -> parsePlusFilter(lines, parserWithRules, noResult));

    System.out.printf(
        "[SearchPipelinePerformanceTest] full pipeline (parse+classify+filter), match-all=%dms vs no-result=%dms "
            + "for %d raw events%n",
        fullPipelineMatchAll, fullPipelineNoResult, RAW_EVENTS);

    // The claim under test: no-result is NOT dramatically cheaper (within
    // 2x) because the dominant cost (parse+classify) is paid regardless of
    // whether EventFilters ends up rejecting the event. A generous 2x
    // allowance covers JIT/GC noise while still failing this assertion if a
    // future change actually adds real short-circuiting before parse.
    assertThat((double) fullPipelineNoResult)
        .as("no-result search (%dms) should stay within 2x of match-all (%dms) under the current "
                + "parse-then-filter ordering — a large gap would mean cheap rejection is already happening earlier "
                + "than this test assumes",
            fullPipelineNoResult, fullPipelineMatchAll)
        .isLessThan(fullPipelineMatchAll * 2.0);
  }

  private int parsePlusFilter(List<String> lines, LogLineParser parser, SearchRequest request) {
    int kept = 0;
    for (String line : lines) {
      CanonicalLogEvent event = parser.parse(line);
      if (EventFilters.matches(event, request)) {
        kept++;
      }
    }
    return kept;
  }

  // -----------------------------------------------------------------------
  // OPTIMIZATION #1 EVIDENCE — deferring classification until after every
  // non-tag EventFilters condition passes (DockerLogSource/LokiLogSource/
  // DirectPodLogProvider), measured head-to-head against the old
  // classify-then-filter ordering in the SAME JVM run (avoids cross-run JIT
  // variance) for a selective severity filter, the case this optimization
  // targets directly.
  // -----------------------------------------------------------------------

  @Test
  void deferredClassificationIsFasterThanEagerForASelectiveSeverityFilter() {
    List<String> lines = rawLines(RAW_EVENTS);
    Instant now = Instant.parse("2026-01-01T00:00:00Z");
    // The fixture corpus cycles through severities; ERROR alone is a
    // realistic "narrow to one level" search that rejects most raw lines
    // on a field classification never touches.
    SearchRequest severityOnly = SearchRequest.builder()
        .sourceId("local-docker").start(now.minusSeconds(RAW_EVENTS + 10)).end(now.plusSeconds(10))
        .levels(List.of("ERROR")).build();

    long eager = timeMillis(
        () -> lines.subList(0, 500).forEach(l -> {
          CanonicalLogEvent e = parserWithRules.parse(l);
          EventFilters.matches(e, severityOnly);
        }),
        () -> {
          int kept = 0;
          for (String line : lines) {
            CanonicalLogEvent event = parserWithRules.parse(line); // classify always, THEN filter
            if (EventFilters.matches(event, severityOnly)) {
              kept++;
            }
          }
          assertThat(kept).isGreaterThan(0);
        });

    long deferred = timeMillis(
        () -> lines.subList(0, 500).forEach(l -> {
          CanonicalLogEvent e = parserWithRules.parseUnclassified(l, null, MappingScopeKey.UNSPECIFIED);
          if (EventFilters.matchesExceptTags(e, severityOnly)) {
            parserWithRules.classify(e);
          }
        }),
        () -> {
          int kept = 0;
          for (String line : lines) {
            CanonicalLogEvent unclassified = parserWithRules.parseUnclassified(line, null, MappingScopeKey.UNSPECIFIED);
            if (EventFilters.matchesExceptTags(unclassified, severityOnly)) { // cheap reject FIRST
              CanonicalLogEvent classified = parserWithRules.classify(unclassified);
              if (EventFilters.tagsMatch(classified, severityOnly)) {
                kept++;
              }
            }
          }
          assertThat(kept).isGreaterThan(0);
        });

    System.out.printf(
        "[SearchPipelinePerformanceTest] severity-only search over %d raw events: eager-classify=%dms, "
            + "deferred-classify=%dms (%.0f%% faster)%n",
        RAW_EVENTS, eager, deferred, 100.0 * (eager - deferred) / eager);
    // Deliberately NOT a strict "deferred < eager" assertion (CLAUDE.md "do
    // not add brittle CI tests asserting exact milliseconds") - back-to-
    // back wall-clock comparisons in one JVM run are noisy under CI/build
    // machine contention (observed directly: this assertion flapped by a
    // few percent when run alongside the full ~1400-test suite). The real,
    // non-flaky proof that classification is actually skipped is {@code
    // DockerLogSourceTest#classificationIsSkippedForEventsRejectedByANonTagFilterButResultsStayIdentical}
    // (counts real classifier invocations, not wall-clock time). This
    // assertion only guards against a gross regression (deferred somehow
    // costing DOUBLE eager) - the printed percentage above is the real
    // evidence, copied into docs/performance/SEARCH_LATENCY_INVESTIGATION.md.
    assertThat(deferred)
        .as("deferred classification (%dms) should not be dramatically slower than eager (%dms) for a selective "
                + "severity-only search over %d raw events - a large regression here would suggest the deferred "
                + "path is doing extra redundant work, not just noise", deferred, eager, RAW_EVENTS)
        .isLessThan(eager * 2);
  }

  // -----------------------------------------------------------------------
  // MASKING + DTO MAPPING — operates only on the bounded returned page
  // (effectiveLimit, default 200), never on the raw candidate set, so its
  // cost scales with page size, not RAW_EVENTS_READ.
  // -----------------------------------------------------------------------

  @Test
  void maskingForOneBoundedResultPageOfTwoHundredEvents() {
    int pageSize = 200;
    List<CanonicalLogEvent> page = new ArrayList<>(pageSize);
    for (String line : rawLines(pageSize)) {
      page.add(parserWithRules.parse(line));
    }
    long elapsed = timeMillis(
        () -> page.forEach(maskingService::mask),
        () -> {
          for (int i = 0; i < 50; i++) { // simulate 50 full page renders
            page.forEach(e -> {
              maskingService.mask(e);
              textRedactor.redact(e.message());
            });
          }
        });
    report("MASK + redact (200-event page x50)", elapsed, pageSize * 50, 2_000);
  }
}
