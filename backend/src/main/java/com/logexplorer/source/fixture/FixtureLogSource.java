package com.logexplorer.source.fixture;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.RawSensitiveFields;
import com.logexplorer.core.model.SearchRequest;
import com.logexplorer.core.model.ServiceInfo;
import com.logexplorer.core.model.SourceCapabilities;
import com.logexplorer.core.model.SourceHealth;
import com.logexplorer.core.parse.LogLineParser;
import com.logexplorer.source.LogSource;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
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
  private static final int CORPUS_SIZE = 120;
  private static final SourceCapabilities CAPABILITIES =
      new SourceCapabilities(true, false, false, true, false, false);

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
    // Newest first, malformed/unknown-timestamp events last (not first -
    // Comparator.nullsLast(...).reversed() is a classic trap: reversing the
    // whole comparator also reverses the null placement, so it silently
    // sorts nulls to the FRONT. Reversing only the inner natural-order
    // comparator keeps nulls pinned last regardless of direction.
    return Flux.fromIterable(corpus())
        .filter(e -> matches(e, request))
        .sort(Comparator.comparing(CanonicalLogEvent::timestamp,
            Comparator.nullsLast(Comparator.reverseOrder())));
  }

  private List<CanonicalLogEvent> corpus() {
    List<CanonicalLogEvent> result = corpus;
    if (result == null) {
      synchronized (lock) {
        result = corpus;
        if (result == null) {
          List<String> lines = generator.generateLines(SEED, CORPUS_SIZE, Instant.now());
          result = lines.stream().map(line -> parser.parse(line, null)).toList();
          corpus = result;
        }
      }
    }
    return result;
  }

  private boolean matches(CanonicalLogEvent event, SearchRequest request) {
    // Malformed lines have no parsed timestamp by definition (LogLineParser
    // never fabricates one). Excluding them from every time-bounded search
    // would silently drop them from virtually all real usage - the opposite
    // of "malformed lines become raw fallback events, never dropped"
    // (HANDOVER.md §5.4). A real adapter (Phase C/D) would stamp these with
    // a receive-time instead; until then, don't let time-range filtering
    // hide what has no timestamp to filter on.
    if (event.timestamp() != null) {
      if (request.start() != null && event.timestamp().isBefore(request.start())) {
        return false;
      }
      if (request.end() != null && !event.timestamp().isBefore(request.end())) {
        return false;
      }
    }
    if (!request.services().isEmpty()
        && (event.service() == null || !request.services().contains(event.service()))) {
      return false;
    }
    if (!request.levels().isEmpty()
        && (event.severity() == null || !containsIgnoreCase(request.levels(), event.severity()))) {
      return false;
    }
    if (notBlank(request.text()) && (event.message() == null
        || !event.message().toLowerCase().contains(request.text().toLowerCase()))) {
      return false;
    }
    if (!fieldMatches(request.traceId(), event.traceId())) {
      return false;
    }
    if (!fieldMatches(request.spanId(), event.spanId())) {
      return false;
    }
    if (!fieldMatches(request.correlationId(), event.correlationId())) {
      return false;
    }
    if (!fieldMatches(request.journeyId(), event.journeyId())) {
      return false;
    }
    if (!fieldMatches(request.eventId(), event.eventId())) {
      return false;
    }
    if (!fieldMatches(request.errorCode(), event.errorCode())) {
      return false;
    }
    if (!fieldMatches(request.businessStep(), event.businessStep())) {
      return false;
    }
    if (!fieldMatches(request.uiIdentifier(), event.uiIdentifier())) {
      return false;
    }
    if (!fieldMatches(request.devicePlatform(), event.devicePlatformType())) {
      return false;
    }
    if (!fieldMatches(request.language(), event.language())) {
      return false;
    }
    // Source-side filtering against raw sensitive values is exactly the
    // allowance IMPLEMENTATION_PLAN.md Phase B item 8 describes: adapters
    // may hold raw values for this purpose; they never leave via search().
    RawSensitiveFields filters = request.sensitiveFilters();
    RawSensitiveFields raw = event.sensitive();
    if (!fieldMatches(filters.cif(), raw.cif())) {
      return false;
    }
    if (!fieldMatches(filters.userName(), raw.userName())) {
      return false;
    }
    if (!fieldMatches(filters.customerId(), raw.customerId())) {
      return false;
    }
    if (!fieldMatches(filters.deviceId(), raw.deviceId())) {
      return false;
    }
    return fieldMatches(filters.deviceIp(), raw.deviceIp());
  }

  private boolean fieldMatches(String requested, String actual) {
    return !notBlank(requested) || requested.equals(actual);
  }

  private boolean notBlank(String s) {
    return s != null && !s.isBlank();
  }

  private boolean containsIgnoreCase(List<String> values, String candidate) {
    return values.stream().anyMatch(v -> v.equalsIgnoreCase(candidate));
  }
}
