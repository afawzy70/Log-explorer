package com.logexplorer.source.fixture;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.FollowRequest;
import com.logexplorer.core.model.SearchRequest;
import com.logexplorer.core.model.ServiceInfo;
import com.logexplorer.core.model.SourceCapabilities;
import com.logexplorer.core.model.SourceHealth;
import com.logexplorer.core.parse.LogLineParser;
import com.logexplorer.core.search.EventFilters;
import com.logexplorer.source.LogSource;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * H3 (Phase A2b) — in-process deterministic fixture {@link LogSource}.
 *
 * <p><b>Dev/test profiles only.</b> Gated by {@code @Profile({"dev",
 * "test"})} — with no active profile (the production default), this bean
 * simply does not exist, so it can never be reachable or selectable as a
 * production source. Proven by {@code FixtureLogSourceProfileGatingTest}
 * using a real {@code ApplicationContextRunner}, not just an annotation
 * inspection.
 *
 * <p>Generates its corpus once, on first use, via {@link
 * FixtureCorpusGenerator} (same deterministic shape as A2a's demo log
 * generator) and parses every line through the real {@link LogLineParser}
 * — the same parser Phase C/D adapters use — so fixture-backed tests
 * exercise the identical code path a real source would.
 */
@Component
@Profile({"dev", "test"})
public class FixtureLogSource implements LogSource {

  private static final long SEED = 42L;
  /**
   * Legacy Remediation Slice 1: large enough to exceed the default search
   * page size ({@code logexplorer.search.default-limit}, 200) on its own,
   * so a real, un-doctored browser search against this source genuinely
   * needs "Load more" - the only way to demonstrate real pagination
   * end-to-end (backend cursor + frontend append) without a live external
   * Docker/Loki deployment that happens to have that much history.
   */
  private static final int CORPUS_SIZE = 250;
  private static final SourceCapabilities CAPABILITIES =
      new SourceCapabilities(true, true, false, true, false, false);

  /** Every 6th tick emits a burst instead of one event - the "manual check... including a burst" (IMPLEMENTATION_PLAN.md "Phase J") needs a real, reproducible burst, not left to chance. */
  private static final Duration TICK_INTERVAL = Duration.ofMillis(700);
  private static final int BURST_EVERY_N_TICKS = 6;
  private static final int BURST_SIZE = 5;

  private final LogLineParser parser;
  private final FixtureCorpusGenerator generator;
  private final Object lock = new Object();
  private volatile List<CanonicalLogEvent> corpus;

  public FixtureLogSource(ObjectMapper objectMapper, LogLineParser parser) {
    this.parser = parser;
    this.generator = new FixtureCorpusGenerator(objectMapper);
  }

  @Override
  public String id() {
    return "fixture";
  }

  @Override
  public String displayName() {
    return "Fixture (dev/test only)";
  }

  @Override
  public SourceCapabilities capabilities() {
    return CAPABILITIES;
  }

  @Override
  public Mono<SourceHealth> health() {
    return Mono.just(new SourceHealth(SourceHealth.Status.UP, "deterministic fixture source", Instant.now()));
  }

  @Override
  public Flux<ServiceInfo> discoverServices() {
    Map<String, Long> counts = corpus().stream()
        .filter(e -> e.service() != null)
        .collect(Collectors.groupingBy(CanonicalLogEvent::service, TreeMap::new, Collectors.counting()));
    return Flux.fromIterable(counts.entrySet())
        .map(entry -> new ServiceInfo(entry.getKey(), entry.getValue().intValue(), entry.getValue().intValue()));
  }

  @Override
  public Flux<CanonicalLogEvent> search(SearchRequest request) {
    // Sorted by direction of travel (Legacy Remediation Slice 1 recovery,
    // mandatory blocker #2: never silently treat FORWARD as BACKWARD),
    // keyed on the source-native timestamp (mandatory blocker #1 - see
    // corpus()'s own comment), never the parsed application timestamp -
    // malformed/unknown-source-timestamp events last regardless of
    // direction (not first - Comparator.nullsLast(...).reversed() is a
    // classic trap: reversing the whole comparator also reverses the null
    // placement, so it silently sorts nulls to the FRONT. Reversing only
    // the inner natural-order comparator keeps nulls pinned last
    // regardless of direction).
    boolean forward = request.direction() == SearchRequest.Direction.FORWARD;
    Comparator<Instant> nativeOrder = forward ? Comparator.naturalOrder() : Comparator.reverseOrder();
    return Flux.fromIterable(corpus())
        .filter(e -> EventFilters.matches(e, request))
        .sort(Comparator.comparing(CanonicalLogEvent::sourceTimestamp, Comparator.nullsLast(nativeOrder)));
  }

  /**
   * "Live tail against the demo generator including a burst" (IMPLEMENTATION_PLAN.md
   * "Phase J" manual check) - this *is* that demo generator, continuing
   * forward in time rather than replaying the static corpus. Each
   * subscription gets its own independent counter/timeline (two
   * concurrent tails are two independent streams, not shared state).
   */
  @Override
  public Flux<CanonicalLogEvent> follow(FollowRequest request) {
    AtomicInteger tick = new AtomicInteger(0);
    AtomicInteger globalIndex = new AtomicInteger(0);
    return Flux.interval(TICK_INTERVAL)
        .flatMapIterable(ignored -> {
          int thisTick = tick.incrementAndGet();
          int count = thisTick % BURST_EVERY_N_TICKS == 0 ? BURST_SIZE : 1;
          List<CanonicalLogEvent> batch = new ArrayList<>(count);
          Instant now = Instant.now();
          for (int i = 0; i < count; i++) {
            int idx = globalIndex.getAndIncrement();
            String line = generator.generateLiveLine(SEED, idx, now);
            batch.add(parser.parse(line, null));
          }
          return batch;
        })
        .filter(e -> request.services().isEmpty() || request.services().contains(e.service()));
  }

  private List<CanonicalLogEvent> corpus() {
    List<CanonicalLogEvent> result = corpus;
    if (result == null) {
      synchronized (lock) {
        result = corpus;
        if (result == null) {
          Instant anchor = Instant.now();
          List<String> lines = generator.generateLines(SEED, CORPUS_SIZE, anchor);
          List<CanonicalLogEvent> built = new ArrayList<>(lines.size());
          for (int i = 0; i < lines.size(); i++) {
            // Legacy Remediation Slice 1 recovery, mandatory blocker #1:
            // fixture's own deterministic per-index source-native
            // timestamp, mirroring FixtureCorpusGenerator#generateLines'
            // own internal spacing formula exactly (index 0 = oldest) -
            // assigned regardless of whether the line itself is malformed
            // (a malformed line skips content-rewriting but still
            // occupies the same index position, so it still gets a real,
            // always-known source-native timestamp - never the parsed
            // application timestamp, which is null for it).
            Instant sourceTimestamp = anchor.minusSeconds((long) lines.size() - 1 - i);
            CanonicalLogEvent parsed = parser.parse(lines.get(i), null);
            built.add(parsed.toBuilder().sourceTimestamp(sourceTimestamp).build());
          }
          result = List.copyOf(built);
          corpus = result;
        }
      }
    }
    return result;
  }
}
