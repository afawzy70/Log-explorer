package com.logexplorer.source.docker;

import com.github.dockerjava.api.model.Container;
import com.logexplorer.config.DockerProperties;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.SearchRequest;
import com.logexplorer.core.model.ServiceInfo;
import com.logexplorer.core.model.SourceCapabilities;
import com.logexplorer.core.model.SourceHealth;
import com.logexplorer.core.parse.LogLineParser;
import com.logexplorer.source.LogSource;
import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/**
 * Read-only Docker Compose {@link LogSource} (IMPLEMENTATION_PLAN.md "Phase
 * C"). Stable id {@code "local-docker"} regardless of connection mode —
 * only {@link #displayName()} reflects local vs. remote, since the
 * frontend keys off the id, not the label (HANDOVER.md §10: "Stable source
 * identity originally: ID: local-docker").
 *
 * <p>Only ever depends on {@link ReadOnlyDockerClient} (never the raw
 * {@code DockerClient}) — the mutating-operation ban is structural, not a
 * convention (see that class's javadoc).
 *
 * <p>All blocking Docker client calls run on {@link Schedulers#boundedElastic()}
 * (IMPLEMENTATION_PLAN.md §5 "Blocking Docker client calls run on
 * Schedulers.boundedElastic() — never on the WebFlux event loop").
 */
@Component
public class DockerLogSource implements LogSource {

  private static final Logger log = LoggerFactory.getLogger(DockerLogSource.class);

  private final ReadOnlyDockerClient client;
  private final DockerProperties properties;
  private final LogLineParser parser;

  public DockerLogSource(DockerClientFactory factory, DockerProperties properties, LogLineParser parser) {
    this.client = factory.create(properties);
    this.properties = properties;
    this.parser = parser;
  }

  @Override
  public String id() {
    return "local-docker";
  }

  @Override
  public String displayName() {
    return properties.getMode() == DockerProperties.Mode.REMOTE
        ? "Remote Docker (" + properties.getHost() + ":" + properties.getPort() + ")"
        : "Local Docker Compose";
  }

  @Override
  public SourceCapabilities capabilities() {
    // liveTail is false here on purpose: Phase C builds the follow
    // primitive, but the /api/v1/logs/live endpoint and buffering
    // lifecycle are Phase J's job - reporting true before that exists
    // would violate "capabilities reflect reality" (HANDOVER.md §7).
    return new SourceCapabilities(true, false, false, true, false, false);
  }

  @Override
  public Mono<SourceHealth> health() {
    return Mono.fromCallable(() -> {
          client.ping();
          return new SourceHealth(SourceHealth.Status.UP, "Docker daemon reachable", Instant.now());
        })
        .subscribeOn(Schedulers.boundedElastic())
        .onErrorResume(e -> Mono.just(DockerDiagnostics.toHealth(e)));
  }

  @Override
  public Flux<ServiceInfo> discoverServices() {
    return Mono.fromCallable(this::discoverServicesBlocking)
        .subscribeOn(Schedulers.boundedElastic())
        .flatMapMany(Flux::fromIterable);
  }

  private List<ServiceInfo> discoverServicesBlocking() {
    List<Container> containers = client.listContainers(true);
    Map<String, int[]> counts = new TreeMap<>();
    for (Container container : relevantContainers(containers, List.of())) {
      String service = ComposeLabels.service(container.getLabels());
      if (service == null) {
        continue;
      }
      int[] countPair = counts.computeIfAbsent(service, k -> new int[2]); // [running, total]
      countPair[1]++;
      if ("running".equalsIgnoreCase(container.getState())) {
        countPair[0]++;
      }
    }
    List<ServiceInfo> result = new ArrayList<>();
    counts.forEach((name, countPair) -> result.add(new ServiceInfo(name, countPair[0], countPair[1])));
    return result;
  }

  @Override
  public Flux<CanonicalLogEvent> search(SearchRequest request) {
    return Mono.fromCallable(() -> searchBlocking(request))
        .subscribeOn(Schedulers.boundedElastic())
        .flatMapMany(Flux::fromIterable);
  }

  private record ContainerLine(DockerLogLine line, Container container) {
  }

  private List<CanonicalLogEvent> searchBlocking(SearchRequest request) {
    List<Container> containers = client.listContainers(true);
    List<Container> targets = relevantContainers(containers, request.services()).stream()
        .limit(properties.getMaxContainers())
        .toList();

    Integer since = request.start() != null ? (int) request.start().getEpochSecond() : null;
    Integer until = request.end() != null ? (int) request.end().getEpochSecond() : null;

    List<ContainerLine> merged = new ArrayList<>();
    for (Container container : targets) {
      for (DockerLogLine line : readContainerLogs(container, since, until)) {
        merged.add(new ContainerLine(line, container));
      }
    }

    // Deterministic merge across containers: Docker's own receive
    // timestamp, newest first, containerId as a stable tiebreaker for
    // equal timestamps (never left to HTTP-response arrival order).
    merged.sort(
        Comparator.<ContainerLine, Instant>comparing(
                cl -> cl.line().dockerTimestamp(), Comparator.nullsLast(Comparator.reverseOrder()))
            .thenComparing(cl -> cl.container().getId()));

    List<CanonicalLogEvent> events = new ArrayList<>(merged.size());
    for (ContainerLine cl : merged) {
      Map<String, String> labels = cl.container().getLabels();
      CanonicalLogEvent parsed = parser.parse(cl.line().content(), ComposeLabels.service(labels));
      events.add(parsed.toBuilder()
          .sourceId(id())
          .composeProject(ComposeLabels.project(labels))
          .containerId(cl.container().getId())
          .containerName(firstName(cl.container()))
          .stream(cl.line().stream())
          .build());
    }
    return events;
  }

  private List<DockerLogLine> readContainerLogs(Container container, Integer since, Integer until) {
    DockerFrameCollectingCallback callback = new DockerFrameCollectingCallback(properties.getDefaultTailLines());
    try {
      client.readLogs(container.getId(), true, true, true, since, until, properties.getDefaultTailLines(), callback);
      callback.awaitCompletion(properties.getRequestTimeout().toMillis(), TimeUnit.MILLISECONDS);
      return callback.lines();
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      return List.of();
    } catch (Exception e) {
      // One unreadable container (removed mid-scan, unsupported logging
      // driver, ...) must not fail the whole bounded search.
      log.warn("Skipping container {} - could not read logs: {}", container.getId(), DockerDiagnostics.classify(e));
      return List.of();
    } finally {
      try {
        callback.close();
      } catch (IOException ignored) {
        // best-effort cleanup
      }
    }
  }

  private List<Container> relevantContainers(List<Container> containers, List<String> requestedServices) {
    return containers.stream()
        .filter(c -> ComposeLabels.isComposeManaged(c.getLabels()))
        .filter(c -> properties.getComposeProjectFilter() == null
            || properties.getComposeProjectFilter().equals(ComposeLabels.project(c.getLabels())))
        .filter(c -> requestedServices.isEmpty()
            || requestedServices.contains(ComposeLabels.service(c.getLabels())))
        .toList();
  }

  private String firstName(Container container) {
    String[] names = container.getNames();
    if (names == null || names.length == 0) {
      return null;
    }
    String name = names[0];
    return name.startsWith("/") ? name.substring(1) : name;
  }
}
