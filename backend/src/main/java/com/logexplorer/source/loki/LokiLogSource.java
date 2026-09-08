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
    // rawLogQL and liveTail both reflect real configuration, never assumed
    // (IMPLEMENTATION_PLAN.md "Phase D" scope item 8).
    return new SourceCapabilities(
        true, properties.isLiveTailSupported(), properties.isRawLogQlEnabled(), false, false, false);
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

    Instant start = request.start() != null ? request.start() : Instant.now().minusSeconds(3600);
    Instant end = request.end() != null ? request.end() : Instant.now();
    String direction = request.direction() == SearchRequest.Direction.FORWARD ? "forward" : "backward";

    return queryClient.queryRange(selector, toNanos(start), toNanos(end), properties.getMaxResultsPerQuery(), direction)
        .map(response -> toEvents(response, request))
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

    List<String> requestedServices = request.services();
    if (requestedServices.isEmpty()) {
      requestedServices = LogQlDslPlanner.extractServiceEquality(request.query())
          .map(List::of)
          .orElse(requestedServices);
    }
    return LogQlSelectorBuilder.build(
        properties.getNamespaceLabelKey(), properties.getNamespace(), properties.getServiceLabelKey(), requestedServices);
  }

  private List<CanonicalLogEvent> toEvents(LokiQueryResponse response, SearchRequest request) {
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
            .build();
        if (EventFilters.matches(enriched, request)) {
          events.add(enriched);
        }
      }
    }
    // Merge and sort (scope item 4): newest first across every stream,
    // malformed/unknown-timestamp events last - same convention as every
    // other source (see FixtureLogSource/DockerLogSource for the
    // nullsLast(reverseOrder()) vs reversed(nullsLast(...)) trap this
    // avoids).
    events.sort(Comparator.comparing(CanonicalLogEvent::timestamp, Comparator.nullsLast(Comparator.reverseOrder())));
    return events;
  }

  private long toNanos(Instant instant) {
    return instant.getEpochSecond() * 1_000_000_000L + instant.getNano();
  }
}
