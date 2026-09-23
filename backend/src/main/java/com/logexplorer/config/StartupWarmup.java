package com.logexplorer.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.logexplorer.api.EventMapper;
import com.logexplorer.api.dto.EventDto;
import com.logexplorer.core.mapping.MappingScopeKey;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.SearchRequest;
import com.logexplorer.core.parse.LogLineParser;
import com.logexplorer.core.search.EventFilters;
import com.logexplorer.source.docker.DockerLogSource;
import jakarta.annotation.PostConstruct;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/**
 * FIRST_SEARCH_WARMUP_ROOT_CAUSE_AND_OPTIMIZATION — pays the real user's
 * first-search JIT/class-loading/first-call cost once, here, at startup,
 * on synthetic in-memory data and a read-only Docker discovery call,
 * instead of on the user's own first real request.
 *
 * <p><b>Evidence this targets</b> (see {@code
 * docs/performance/FIRST_SEARCH_WARMUP_INVESTIGATION.md} "Phase 2"): a
 * realistic 12-container/24,000-raw-event benchmark showed every phase of
 * a real search — Docker container reads, the parse/filter/classify/mask
 * pipeline, and framework/Jackson serialization — running 2-4x slower on
 * the first request than on the third, on byte-identical data, on the
 * SAME already-running JVM. That is the textbook signature of JIT
 * interpretation-to-compilation and class-loading cost, not a
 * data-dependent one — which is exactly what running the same code paths
 * once, early, on throwaway synthetic data can pay down ahead of time.
 *
 * <p><b>Why {@code @PostConstruct}, not an {@code ApplicationRunner}.</b>
 * Spring Boot's embedded reactive (Netty) web server starts accepting
 * connections as a {@code SmartLifecycle} during {@code
 * AbstractApplicationContext#finishRefresh()} — strictly AFTER every
 * singleton bean's own initialization ({@code @PostConstruct}) has already
 * run, but BEFORE any {@code ApplicationRunner}/{@code CommandLineRunner}
 * executes (those run even later, once {@code SpringApplication.run()}
 * itself calls them). Netty's own I/O threads are independent of the main
 * startup thread, so an {@code ApplicationRunner}-based warmup would still
 * let {@code /actuator/health} and real search traffic reach the server
 * WHILE the warmup is still running on the main thread — defeating the
 * whole point. A {@code @PostConstruct} on an ordinary singleton bean runs
 * during bean initialization, before the web server exists at all, so
 * nothing can reach this process until this method returns.
 *
 * <p><b>What this deliberately does NOT do</b> (mission's own "NO FAKE
 * SEARCH" rule): never reads a real container's actual log content, never
 * calls {@code LogSource#search}, never mutates any Docker/OpenShift/Loki
 * resource, never persists anything, never retains the synthetic events it
 * builds (they are local variables, discarded after this method returns).
 * The one Docker call this makes — {@link DockerLogSource#health()} — is
 * the exact same read-only ping+list-containers call the Sources health
 * popover already makes on every ordinary health check; it never reads log
 * content and (per its own javadoc/{@code onErrorResume}) never throws, so
 * a misconfigured or unreachable Docker daemon can never fail startup —
 * it is bounded by {@link StartupWarmupProperties#getDockerWarmupTimeout()}
 * defensively regardless.
 *
 * <p>Disabled for the {@code test} profile ({@code @Profile("!test")}) so
 * it never adds latency or Docker-dependent nondeterminism to the backend
 * test suite's many {@code @SpringBootTest} contexts.
 */
@Component
@Profile("!test")
public class StartupWarmup {

  private static final Logger log = LoggerFactory.getLogger(StartupWarmup.class);

  /**
   * Deliberately fake, deliberately not `LogSource`-sourced — the whole
   * point is that this content never touches a real container, a real
   * OpenShift pod, or any customer data. Shaped like a real Spring Boot
   * JSON log line (same top-level field names {@code
   * core.mapping.DefaultFieldMappingProfile} resolves) purely so the
   * parse/field-mapping/classification code paths actually get exercised
   * the same way they would for a real line - a warmup that fed obviously
   * malformed input the whole time would only warm the malformed-fallback
   * branch, not the one real searches actually spend their time in.
   */
  private static final List<String> SYNTHETIC_LINES = List.of(
      "{\"@timestamp\":\"2020-01-01T00:00:00.000+00:00\",\"@version\":\"1\",\"application\":\"warmup-svc\","
          + "\"level\":\"INFO\",\"level_value\":20000,\"message\":\"warmup request handled in 42ms status=200\","
          + "\"logger_name\":\"com.example.warmup.Handler\",\"thread_name\":\"warmup-1\","
          + "\"traceId\":\"warmup-trace-0\",\"X-Correlation-id\":\"warmup-corr-0\",\"mdc\":{}}",
      "{\"@timestamp\":\"2020-01-01T00:00:01.000+00:00\",\"@version\":\"1\",\"application\":\"warmup-svc\","
          + "\"level\":\"WARN\",\"level_value\":30000,\"message\":\"warmup slow downstream in 900ms\","
          + "\"logger_name\":\"com.example.warmup.Handler\",\"thread_name\":\"warmup-2\","
          + "\"traceId\":\"warmup-trace-1\",\"X-Correlation-id\":\"warmup-corr-1\",\"mdc\":{}}",
      "{\"@timestamp\":\"2020-01-01T00:00:02.000+00:00\",\"@version\":\"1\",\"application\":\"warmup-svc\","
          + "\"level\":\"ERROR\",\"level_value\":40000,\"message\":\"warmup downstream call failed status=503\","
          + "\"logger_name\":\"com.example.warmup.Handler\",\"thread_name\":\"warmup-3\","
          + "\"traceId\":\"warmup-trace-2\",\"X-Correlation-id\":\"warmup-corr-2\",\"mdc\":{}}");

  private final StartupWarmupProperties properties;
  private final SearchGuardrailsProperties guardrailsProperties;
  private final LogLineParser parser;
  private final EventMapper eventMapper;
  private final ObjectMapper objectMapper;
  private final DockerLogSource dockerLogSource;

  public StartupWarmup(
      StartupWarmupProperties properties, SearchGuardrailsProperties guardrailsProperties,
      LogLineParser parser, EventMapper eventMapper, ObjectMapper objectMapper,
      DockerLogSource dockerLogSource) {
    this.properties = properties;
    this.guardrailsProperties = guardrailsProperties;
    this.parser = parser;
    this.eventMapper = eventMapper;
    this.objectMapper = objectMapper;
    this.dockerLogSource = dockerLogSource;
  }

  @PostConstruct
  void warmup() {
    if (!properties.isEnabled()) {
      log.debug("Startup warmup disabled (logexplorer.startup.enabled=false)");
      return;
    }
    long startNanos = System.nanoTime();
    int pipelineCount = warmParsePipeline();
    long pipelineMillis = Duration.ofNanos(System.nanoTime() - startNanos).toMillis();
    long dockerStartNanos = System.nanoTime();
    boolean dockerWarmed = warmDockerDiscovery();
    long dockerMillis = Duration.ofNanos(System.nanoTime() - dockerStartNanos).toMillis();
    log.info(
        "Startup warmup complete: pipelineMs={} (events matched={}) dockerDiscoveryMs={} (warmed={})",
        pipelineMillis, pipelineCount, dockerMillis, dockerWarmed);
  }

  /**
   * Candidate A+C (docs/performance/FIRST_SEARCH_WARMUP_INVESTIGATION.md
   * "Phase 3"): drives {@code properties.getIterations()} synthetic events
   * through the exact same parse -> filter -> classify -> mask -> DTO-map
   * -> JSON-serialize path a real search's per-event loop uses, on the
   * SAME production singleton beans (not throwaway instances) real
   * requests will use. Never reads a real source, never keeps the results.
   */
  private int warmParsePipeline() {
    // Wide enough to always contain SYNTHETIC_LINES' fixed 2020 timestamps
    // regardless of when this runs - the synthetic content's exact instant
    // is arbitrary and irrelevant (never displayed, never compared against
    // anything real), so a static, generously wide window is simpler and
    // just as correct as computing one relative to `now`.
    SearchRequest warmupRequest = SearchRequest.builder()
        .sourceId("warmup").start(Instant.parse("2000-01-01T00:00:00Z")).end(Instant.now().plusSeconds(60)).build();
    int defaultPageSize = guardrailsProperties.getDefaultLimit();
    int count = 0;
    List<CanonicalLogEvent> page = new ArrayList<>(defaultPageSize);
    for (int i = 0; i < properties.getIterations(); i++) {
      String line = SYNTHETIC_LINES.get(i % SYNTHETIC_LINES.size());
      CanonicalLogEvent event = parser.parse(line, "warmup-service", MappingScopeKey.UNSPECIFIED);
      if (EventFilters.matches(event, warmupRequest)) {
        count++;
        if (page.size() < defaultPageSize) {
          page.add(event);
        }
      }
    }
    // Warms EventMapper (masking + TextRedactor + classification DTO
    // mapping) and Jackson serialization of the exact response shape a
    // real page of results produces - the same bounded page size
    // (SearchGuardrailsProperties#defaultLimit) a real unfiltered search
    // returns, never the full raw candidate count.
    List<EventDto> dtos = new ArrayList<>(page.size());
    for (CanonicalLogEvent event : page) {
      dtos.add(eventMapper.toDto(event));
    }
    try {
      objectMapper.writeValueAsString(dtos);
    } catch (Exception e) {
      // Never fail startup over a warmup-only serialization hiccup.
      log.debug("Startup warmup: DTO serialization warmup skipped ({})", e.getClass().getSimpleName());
    }
    return count;
  }

  /**
   * Candidate B: the same read-only ping+list-containers call {@link
   * DockerLogSource#health()} already makes for every ordinary health
   * check - never reads log content, never fails (see that method's own
   * {@code onErrorResume}), bounded here defensively regardless so a slow
   * or unreachable daemon can never meaningfully delay startup.
   */
  private boolean warmDockerDiscovery() {
    if (!properties.isDockerWarmupEnabled()) {
      return false;
    }
    try {
      dockerLogSource.health().timeout(properties.getDockerWarmupTimeout()).block();
      return true;
    } catch (Exception e) {
      log.debug("Startup warmup: Docker discovery warmup skipped ({})", e.getClass().getSimpleName());
      return false;
    }
  }
}
