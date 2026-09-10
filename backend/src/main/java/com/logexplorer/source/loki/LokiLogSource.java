package com.logexplorer.source.loki;

import com.logexplorer.config.LokiProperties;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.SearchRequest;
import com.logexplorer.core.model.ServiceInfo;
import com.logexplorer.core.model.SourceCapabilities;
import com.logexplorer.core.model.SourceHealth;
import com.logexplorer.core.parse.LogLineParser;
import com.logexplorer.core.search.EventFilters;
import com.logexplorer.source.LogSource;
import com.logexplorer.source.loki.plan.LogQlDslPlanner;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * Read-only OpenShift Loki {@link LogSource} (IMPLEMENTATION_PLAN.md "Phase
 * D"). Stable id {@code "openshift-loki"}.
 *
 * <p>{@code discoverServices()} deliberately returns nothing and {@link
 * SourceCapabilities#serviceDiscovery()} reports {@code false} - unlike
 * Docker (Phase C scope item 3), Phase D's scope never asked for a
 * service-discovery capability (there is no Loki equivalent of Compose
 * labels listing "all services"; that would mean querying every label
 * value for the configured service label, which is out of this phase's
 * stated scope) - this is a deliberate boundary, not an oversight.
 */
@Component
public class LokiLogSource implements LogSource {

  private final LokiProperties properties;
  private final LokiQueryClient queryClient;
  private final LogLineParser parser;

  public LokiLogSource(LokiProperties properties, LokiQueryClient queryClient, LogLineParser parser) {
    this.properties = properties;
    this.queryClient = queryClient;
    this.parser = parser;
  }

  @Override
  public String id() {
    return "openshift-loki";
  }

  @Override
  public String displayName() {
    return "OpenShift Loki";
  }

  @Override
  public SourceCapabilities capabilities() {
    // rawLogQL reflects real configuration, never assumed
    // (IMPLEMENTATION_PLAN.md "Phase D" scope item 8). liveTail is
    // deliberately hardcoded false (Legacy Remediation Slice 5 finding):
    // this class never overrides `follow()`, so the pre-existing
    // `LokiProperties#liveTailSupported` config toggle could make this
    // capability report `true` for a source that would error on the very
    // first live-tail attempt - a "fake capability" (HANDOVER.md §18.3
    // "Do not fake it"), never actually exercised because nothing in this
    // repository ever set that flag true outside its own now-corrected
    // unit test. Never trust that toggle here again - see
    // `LokiProperties#liveTailSupported`'s own doc comment.
    return new SourceCapabilities(true, false, properties.isRawLogQlEnabled(), false, false, false, false);
  }

  @Override
  public Mono<SourceHealth> health() {
    Instant now = Instant.now();
    String selector = LogQlSelectorBuilder.build(
        properties.getNamespaceLabelKey(), properties.getNamespace(), properties.getServiceLabelKey(), List.of());
    return queryClient.queryRange(selector, toNanos(now.minusSeconds(5)), toNanos(now), 1, "backward")
        .map(response -> new SourceHealth(SourceHealth.Status.UP, "Loki gateway reachable", Instant.now()))
        .onErrorResume(e -> Mono.just(new SourceHealth(
            SourceHealth.Status.DOWN, LokiErrorClassifier.classifyThrowable(e).getMessage(), Instant.now())));
  }

  @Override
  public Flux<ServiceInfo> discoverServices() {
    return Flux.empty();
  }

  @Override
  public Flux<CanonicalLogEvent> search(SearchRequest request) {
    String selector = buildSelector(request);
    boolean forward = request.direction() == SearchRequest.Direction.FORWARD;

    Instant start = request.start() != null ? request.start() : Instant.now().minusSeconds(3600);
    Instant end = request.end() != null ? request.end() : Instant.now();
    long startNanos = toNanos(start);
    long endNanos = toNanos(end);

    // Legacy Remediation Slice 1 recovery, mandatory blocker #1/#2: narrow
    // the Loki-side query further using the *source-native* pagination
    // boundary (Loki's own stream-entry nanosecond timestamp - never the
    // parsed application timestamp), so successive pages reach genuinely
    // older/newer history rather than re-querying the same
    // maxResultsPerQuery-capped window. Best-effort only, at full
    // nanosecond precision this time (unlike Docker's second-granularity
    // API) - exact exclusion of already-returned events still happens in
    // SearchService regardless, so an off-by-a-little narrowing here can
    // never cause a skip or a duplicate.
    Instant boundary = request.pageBoundary();
    if (boundary != null) {
      long boundaryNanos = toNanos(boundary);
      if (forward) {
        startNanos = Math.max(startNanos, boundaryNanos);
      } else {
        endNanos = Math.min(endNanos, boundaryNanos + 1);
      }
    }

    String direction = forward ? "forward" : "backward";
    return queryClient.queryRange(selector, startNanos, endNanos, properties.getMaxResultsPerQuery(), direction)
        .map(response -> toEvents(response, request, forward))
        .flatMapMany(Flux::fromIterable);
  }

  /**
   * Raw LogQL (IMPLEMENTATION_PLAN.md "Phase E" scope item 8) is used
   * verbatim, in place of the built selector, when present - {@code
   * api.SearchService} already rejects it before ever reaching here unless
   * {@link SourceCapabilities#rawLogQL()} (which reflects {@code
   * properties.isRawLogQlEnabled()}) was true, but this check is repeated
   * here too as defense in depth, never trusting a single call site as the
   * only line of defense (the same posture {@link LogSource#search}'s own
   * javadoc states for guardrails generally).
   *
   * <p>Otherwise builds the normal selector — augmented with {@code
   * LogQlDslPlanner}'s narrow, provably-safe {@code service = "..."}
   * pushdown from the DSL query when the request didn't already specify a
   * service list itself (an optimization only; {@code EventFilters}
   * always still re-applies the full DSL predicate afterward regardless).
   */
  private String buildSelector(SearchRequest request) {
    if (request.rawLogQl() != null && !request.rawLogQl().isBlank()) {
      if (!properties.isRawLogQlEnabled()) {
        throw new IllegalStateException("Raw LogQL is not enabled for this source");
      }
      return request.rawLogQl();
    }
    return LogQlSelectorBuilder.build(
        properties.getNamespaceLabelKey(), properties.getNamespace(), properties.getServiceLabelKey(),
        resolvePushedDownServices(request));
  }

  /**
   * The exact service list {@link #buildSelector} pushes down as an exact-
   * match label — request-supplied services take priority; otherwise
   * {@code LogQlDslPlanner}'s narrow, provably-safe single {@code service =
   * "..."} DSL extraction. Shared with {@link #describePushDown} so the
   * query-plan disclosure can never drift from what was actually queried.
   */
  private List<String> resolvePushedDownServices(SearchRequest request) {
    List<String> requestedServices = request.services();
    if (requestedServices.isEmpty()) {
      requestedServices = LogQlDslPlanner.extractServiceEquality(request.query())
          .map(List::of)
          .orElse(requestedServices);
    }
    return requestedServices;
  }

  /**
   * Legacy Remediation Slice 2 — genuinely reports the same narrowing
   * {@link #buildSelector} applies, never more: raw LogQL replaces the
   * selector entirely (nothing else is "pushed down," the whole query is
   * source-native); otherwise the fixed namespace (source configuration,
   * not user input, so always safe to show) and, only when exactly one
   * service resolves, that single exact-match label — the same "safe
   * single exact-match pushdown" boundary {@link LogQlSelectorBuilder}'s
   * own javadoc documents.
   */
  @Override
  public List<String> describePushDown(SearchRequest request) {
    if (request.rawLogQl() != null && !request.rawLogQl().isBlank()) {
      return List.of("Raw LogQL executed verbatim against Loki (bypasses the generated selector entirely)");
    }
    List<String> conditions = new ArrayList<>();
    conditions.add("namespace = \"" + properties.getNamespace() + "\" (Loki stream label, from source configuration)");
    List<String> pushedServices = resolvePushedDownServices(request);
    if (pushedServices.size() == 1) {
      conditions.add("service = \"" + pushedServices.get(0) + "\" (Loki stream label, exact match)");
    }
    return conditions;
  }

  private List<CanonicalLogEvent> toEvents(LokiQueryResponse response, SearchRequest request, boolean forward) {
    List<CanonicalLogEvent> events = new ArrayList<>();
    if (response.data() == null || response.data().result() == null) {
      return events;
    }
    for (LokiQueryResponse.StreamResult stream : response.data().result()) {
      Map<String, String> labels = stream.stream();
      String serviceHint = labels == null ? null : labels.get(properties.getServiceLabelKey());
      for (List<String> value : stream.values()) {
        if (value.size() < 2) {
          continue;
        }
        String line = value.get(1);
        CanonicalLogEvent parsed = parser.parse(line, serviceHint);
        CanonicalLogEvent enriched = parsed.toBuilder()
            .sourceId(id())
            .namespace(labels == null ? null : labels.get(properties.getNamespaceLabelKey()))
            .pod(labels == null ? null : labels.get(properties.getPodLabelKey()))
            .containerName(labels == null ? null : labels.get(properties.getContainerLabelKey()))
            .stream("stdout")
            // Mandatory blocker #1: Loki's own stream-entry nanosecond
            // timestamp (value[0]) - always present per the API's own
            // contract, distinct from and possibly different than the
            // parsed application timestamp inside the JSON payload.
            .sourceTimestamp(parseNanos(value.get(0)))
            .build();
        if (EventFilters.matches(enriched, request)) {
          events.add(enriched);
        }
      }
    }
    // Merge and sort in direction-of-travel order (mandatory blocker #2:
    // never silently treat FORWARD as BACKWARD) - Loki's own native
    // stream-entry timestamp, malformed/unknown-source-timestamp events
    // last regardless of direction (see FixtureLogSource/DockerLogSource
    // for the nullsLast(reverseOrder()) vs reversed(nullsLast(...)) trap
    // this avoids).
    Comparator<Instant> nativeOrder = forward ? Comparator.naturalOrder() : Comparator.reverseOrder();
    events.sort(Comparator.comparing(CanonicalLogEvent::sourceTimestamp, Comparator.nullsLast(nativeOrder)));
    return events;
  }

  private long toNanos(Instant instant) {
    return instant.getEpochSecond() * 1_000_000_000L + instant.getNano();
  }

  /** Loki's {@code value[0]} - a plain nanoseconds-since-epoch decimal string, per its own API contract. */
  private static Instant parseNanos(String nanosString) {
    try {
      long nanos = Long.parseLong(nanosString);
      return Instant.ofEpochSecond(0L, nanos);
    } catch (NumberFormatException | NullPointerException e) {
      return null;
    }
  }
}
