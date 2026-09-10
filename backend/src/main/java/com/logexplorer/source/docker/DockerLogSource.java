package com.logexplorer.source.docker;

import com.github.dockerjava.api.model.Container;
import com.logexplorer.config.DockerProperties;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.FollowRequest;
import com.logexplorer.core.model.SearchRequest;
import com.logexplorer.core.model.ServiceInfo;
import com.logexplorer.core.model.SourceCapabilities;
import com.logexplorer.core.model.SourceHealth;
import com.logexplorer.core.parse.LogLineParser;
import com.logexplorer.core.search.EventFilters;
import com.logexplorer.source.LogSource;
import com.logexplorer.source.docker.security.RemoteHostGuard;
import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Flux;
import reactor.core.publisher.FluxSink;
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
  private final RemoteHostGuard remoteHostGuard;

  public DockerLogSource(DockerClientFactory factory, DockerProperties properties, LogLineParser parser, RemoteHostGuard remoteHostGuard) {
    this.client = factory.create(properties);
    this.properties = properties;
    this.parser = parser;
    this.remoteHostGuard = remoteHostGuard;
  }

  /**
   * Legacy Remediation Slice 3 — "re-resolve before each real connection
   * attempt to reduce DNS-rebinding risk... apply identically to Test
   * Connection and runtime Docker construction." {@link DockerClientFactory#create}
   * already checks once, at this source's own construction (app boot); this
   * is the second half - a fresh, uncached re-check immediately before
   * every real Docker operation this adapter performs, for the lifetime of
   * the long-lived client {@link #client} built at boot. A no-op for
   * {@link DockerProperties.Mode#LOCAL} (deployment-time configuration
   * only, not the SSRF-sensitive surface this guard defends).
   */
  private void checkRemoteHostIfNeeded() {
    if (properties.getMode() == DockerProperties.Mode.REMOTE) {
      remoteHostGuard.checkOrThrow(properties.getHost());
    }
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
    // liveTail is true now that Phase J's follow() implementation and
    // /api/v1/logs/live endpoint both exist - "capabilities reflect
    // reality" (HANDOVER.md §7) the same way historicalSearch/
    // serviceDiscovery are declared true regardless of whether any
    // container happens to be running right now (an empty container list
    // means an empty stream, not an unsupported capability).
    return new SourceCapabilities(true, true, false, true, false, false, true);
  }

  /**
   * Legacy Remediation Slice 6 — beyond binary reachability, this now also
   * checks the one other thing a health check can cheaply, honestly know
   * without reading any container's actual logs: whether the daemon is
   * reachable but the configured Compose project filter matched zero real
   * containers. That is a genuine, observable reason to distrust
   * completeness (any search against this source will silently return
   * nothing), so it is reported as {@code DEGRADED}, not {@code UP}.
   *
   * <p>Deliberately does NOT attempt to detect "some containers
   * unreadable" here — that would mean actually reading logs from every
   * relevant container on every health check (an expensive, per-container
   * operation this class already knows can fail per-container, see {@link
   * #readContainerLogs}), which would make health checks as costly as a
   * real search. That class of degradation is already handled the way it
   * always has been (a container is simply skipped for that one search/
   * live-tail attempt, logged, never silently presented as complete) —
   * see {@code docs/verification/LEGACY_REMEDIATION_SLICE_6_REPORT.md}
   * for why this line was drawn where it was.
   */
  @Override
  public Mono<SourceHealth> health() {
    return Mono.fromCallable(() -> {
          checkRemoteHostIfNeeded();
          client.ping();
          List<Container> relevant = relevantContainers(client.listContainers(true), List.of(), null);
          if (relevant.isEmpty()) {
            return new SourceHealth(
                SourceHealth.Status.DEGRADED,
                "Docker daemon reachable, but no containers matched the configured Compose project filter",
                Instant.now(),
                List.of("No containers matched the configured Compose project filter"));
          }
          return new SourceHealth(SourceHealth.Status.UP, "Docker daemon reachable", Instant.now());
        })
        .subscribeOn(Schedulers.boundedElastic())
        .onErrorResume(e -> Mono.just(DockerDiagnostics.toHealth(e)));
  }

  @Override
  public Flux<ServiceInfo> discoverServices() {
    return discoverServices(null);
  }

  /**
   * UX-R3 §7/§9 — scoped to one Compose project when {@code composeProject}
   * is non-blank, exactly the same hard boundary {@link #relevantContainers}
   * already enforces for search/live - service discovery routes through
   * the identical chokepoint, never a separate/looser filter.
   */
  @Override
  public Flux<ServiceInfo> discoverServices(String composeProject) {
    return Mono.fromCallable(() -> discoverServicesBlocking(composeProject))
        .subscribeOn(Schedulers.boundedElastic())
        .flatMapMany(Flux::fromIterable);
  }

  private List<ServiceInfo> discoverServicesBlocking(String composeProject) {
    checkRemoteHostIfNeeded();
    List<Container> containers = client.listContainers(true);
    Map<String, int[]> counts = new TreeMap<>();
    for (Container container : relevantContainers(containers, List.of(), composeProject)) {
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

  /**
   * UX-R3 §7 — real, currently-visible Compose projects on this
   * connection (the canonical {@code com.docker.compose.project} label,
   * never a container-name guess). Deliberately does *not* go through
   * {@link #relevantContainers} - that method's whole point is applying
   * the effective project filter (static-config or per-request), and
   * discovery must show every real project regardless of any filter,
   * static or previously-selected, or a deployment/session already
   * scoped to one project could never discover any other to switch to.
   * Self-excluded/unmanaged containers are still filtered out (the same
   * rule, just inlined). Sorted for a stable, deterministic UI list.
   */
  @Override
  public List<String> discoverComposeProjects() {
    checkRemoteHostIfNeeded();
    List<Container> containers = client.listContainers(true);
    return containers.stream()
        .filter(c -> ComposeLabels.isComposeManaged(c.getLabels()))
        .filter(c -> !ComposeLabels.isExcluded(c.getLabels()))
        .map(c -> ComposeLabels.project(c.getLabels()))
        .filter(p -> p != null && !p.isBlank())
        .distinct()
        .sorted()
        .toList();
  }

  @Override
  public Flux<CanonicalLogEvent> search(SearchRequest request) {
    return Mono.fromCallable(() -> searchBlocking(request))
        .subscribeOn(Schedulers.boundedElastic())
        .flatMapMany(Flux::fromIterable);
  }

  /**
   * Live tail (IMPLEMENTATION_PLAN.md "Phase J", HANDOVER.md §18.2) - one
   * {@link DockerFollowCallback} per relevant container, merged into a
   * single {@link Flux}. Cancellation (a client disconnecting, or the
   * caller cancelling the subscription for any other reason) closes every
   * callback via {@code sink.onDispose} - the actual mechanism by which
   * "disconnect must cancel upstream callback/resource" holds, verified
   * directly (not just by absence of an error) in {@code DockerLogSourceTest}.
   */
  @Override
  public Flux<CanonicalLogEvent> follow(FollowRequest request) {
    return Mono.fromCallable(() -> {
          checkRemoteHostIfNeeded();
          return relevantContainers(client.listContainers(true), request.services(), request.composeProject());
        })
        .subscribeOn(Schedulers.boundedElastic())
        .flatMapMany(containers -> Flux.<CanonicalLogEvent>create(
            sink -> startFollowing(containers, sink), FluxSink.OverflowStrategy.BUFFER));
  }

  private void startFollowing(List<Container> containers, FluxSink<CanonicalLogEvent> sink) {
    if (containers.isEmpty()) {
      sink.complete();
      return;
    }
    List<DockerFollowCallback> callbacks = new ArrayList<>();
    AtomicInteger remaining = new AtomicInteger(containers.size());
    for (Container container : containers) {
      Map<String, String> labels = container.getLabels();
      DockerFollowCallback callback = new DockerFollowCallback(
          line -> emitFollowedLine(sink, container, labels, line),
          () -> {
            if (remaining.decrementAndGet() <= 0) {
              sink.complete();
            }
          });
      try {
        client.followLogs(container.getId(), callback);
        callbacks.add(callback);
      } catch (Exception e) {
        // One container failing to start following (removed mid-scan,
        // unsupported logging driver, ...) must not fail the whole tail -
        // the others keep streaming.
        log.warn("Skipping container {} for live tail - could not start follow: {}",
            container.getId(), DockerDiagnostics.classify(e));
        if (remaining.decrementAndGet() <= 0) {
          sink.complete();
        }
      }
    }
    sink.onDispose(() -> closeAll(callbacks));
  }

  private void emitFollowedLine(FluxSink<CanonicalLogEvent> sink, Container container, Map<String, String> labels, DockerLogLine line) {
    CanonicalLogEvent parsed = parser.parse(line.content(), ComposeLabels.service(labels));
    CanonicalLogEvent enriched = parsed.toBuilder()
        .sourceId(id())
        .composeProject(ComposeLabels.project(labels))
        .composeService(ComposeLabels.service(labels))
        .containerId(container.getId())
        .containerName(firstName(container))
        .stream(line.stream())
        .build();
    sink.next(enriched);
  }

  private void closeAll(List<DockerFollowCallback> callbacks) {
    for (DockerFollowCallback callback : callbacks) {
      try {
        callback.close();
      } catch (IOException ignored) {
        // best-effort cleanup - the connection is going away regardless
      }
    }
  }

  private record ContainerLine(DockerLogLine line, Container container) {
  }

  private List<CanonicalLogEvent> searchBlocking(SearchRequest request) {
    checkRemoteHostIfNeeded();
    List<Container> containers = client.listContainers(true);
    List<Container> targets = relevantContainers(containers, request.services(), request.composeProject()).stream()
        .limit(properties.getMaxContainers())
        .toList();

    boolean forward = request.direction() == SearchRequest.Direction.FORWARD;
    Integer since = request.start() != null ? (int) request.start().getEpochSecond() : null;
    Integer until = request.end() != null ? (int) request.end().getEpochSecond() : null;

    // Legacy Remediation Slice 1 recovery, mandatory blocker #1/#2: narrow
    // the Docker-side read further using the *source-native* pagination
    // boundary (Docker's own receive clock - never the parsed application
    // timestamp), so successive pages can reach genuinely older/newer
    // history instead of always re-reading the same tail-capped window.
    // This is a best-effort narrowing only (second-granularity, since
    // that is all Docker's since/until accept) - exact, nanosecond-precise
    // exclusion of already-returned events happens in SearchService
    // regardless, so an imprecise narrowing here can never cause a skip or
    // a duplicate, only (in the worst case) a slightly less efficient read.
    Instant boundary = request.pageBoundary();
    if (boundary != null) {
      if (forward) {
        long candidateSince = boundary.getEpochSecond();
        if (since == null || candidateSince > since) {
          since = (int) candidateSince;
        }
      } else {
        long candidateUntil = boundary.getEpochSecond() + 1;
        if (until == null || candidateUntil < until) {
          until = (int) candidateUntil;
        }
      }
    }

    List<ContainerLine> merged = new ArrayList<>();
    for (Container container : targets) {
      for (DockerLogLine line : readContainerLogs(container, since, until)) {
        merged.add(new ContainerLine(line, container));
      }
    }

    // Deterministic merge across containers, in direction-of-travel order
    // (mandatory blocker #2: never silently treat FORWARD as BACKWARD) -
    // Docker's own receive timestamp, containerId as a stable tiebreaker
    // for equal timestamps (never left to HTTP-response arrival order).
    Comparator<Instant> nativeOrder = forward ? Comparator.naturalOrder() : Comparator.reverseOrder();
    merged.sort(
        Comparator.<ContainerLine, Instant>comparing(cl -> cl.line().dockerTimestamp(), Comparator.nullsLast(nativeOrder))
            .thenComparing(cl -> cl.container().getId()));

    List<CanonicalLogEvent> events = new ArrayList<>(merged.size());
    for (ContainerLine cl : merged) {
      Map<String, String> labels = cl.container().getLabels();
      CanonicalLogEvent parsed = parser.parse(cl.line().content(), ComposeLabels.service(labels));
      CanonicalLogEvent enriched = parsed.toBuilder()
          .sourceId(id())
          .composeProject(ComposeLabels.project(labels))
          .composeService(ComposeLabels.service(labels))
          .containerId(cl.container().getId())
          .containerName(firstName(cl.container()))
          .stream(cl.line().stream())
          // Mandatory blocker #1: always set, even for a malformed/
          // non-JSON line whose parsed `timestamp` is null - Docker
          // always knows when it received the line.
          .sourceTimestamp(cl.line().dockerTimestamp())
          .build();
      // Container/time-range filtering above narrows which containers and
      // Docker-API-level range we even read; this applies every remaining
      // structured filter (traceId, correlationId, text, sensitive
      // filters, ...) that the Docker API itself has no way to push down -
      // real gap found while extracting EventFilters: this adapter
      // previously applied none of these at all.
      if (EventFilters.matches(enriched, request)) {
        events.add(enriched);
      }
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

  /**
   * @param requestedComposeProject UX-R3 §7/§8/§9 - a caller-supplied,
   *     request/session-scoped project selection (never a global mutation
   *     of {@link DockerProperties}). When non-blank, this takes
   *     precedence over the deployment-time-static {@code
   *     properties.getComposeProjectFilter()} - a caller that has
   *     genuinely selected a project always means exactly that project,
   *     regardless of what the deployer's own static filter says. There is
   *     no separate "is this a real project" allow-list check here: the
   *     equality filter below can only ever match a container whose own
   *     real {@code com.docker.compose.project} label equals the supplied
   *     value, so a malicious/invalid/made-up project string is
   *     structurally incapable of matching anything and safely narrows to
   *     zero containers - the same fail-safe property the pre-existing
   *     static filter already had, extended unchanged to the per-request
   *     case.
   */
  private List<Container> relevantContainers(
      List<Container> containers, List<String> requestedServices, String requestedComposeProject) {
    // A real bug found via Phase K's own Compose end-to-end verification:
    // Compose's `env_file` mechanism passes a declared-but-empty .env line
    // (e.g. "LOGEXPLORER_DOCKER_COMPOSE_PROJECT_FILTER=") through as the
    // literal empty string, not an absent variable - Spring then binds
    // that as "" here, not null. A bare `== null` check let that empty
    // string reach `.equals(project)`, which no real project name ever
    // matches, so EVERY container was silently filtered out. isBlank()
    // treats both "unset" and "set to blank" as "no filter", matching
    // this codebase's own established convention for the same class of
    // optional string field (see DockerClientFactory#buildConfig's own
    // `host == null || host.isBlank()` check).
    String effectiveProjectFilter = (requestedComposeProject != null && !requestedComposeProject.isBlank())
        ? requestedComposeProject
        : properties.getComposeProjectFilter();
    boolean noProjectFilter = effectiveProjectFilter == null || effectiveProjectFilter.isBlank();
    return containers.stream()
        .filter(c -> ComposeLabels.isComposeManaged(c.getLabels()))
        // Self-exclusion (Legacy Remediation Slice 3) - an explicitly
        // labeled container (e.g. Log Explorer's own, see
        // docker-compose.yml) is treated as if it did not exist at all,
        // applied before the project filter so it is excluded regardless
        // of which project is selected/configured.
        .filter(c -> !ComposeLabels.isExcluded(c.getLabels()))
        // Compose project hard boundary (Legacy Remediation Slice 3,
        // extended UX-R3) - the single filter point every caller
        // (discoverComposeProjects/discoverServices/search/follow)
        // already routes through; containers from another project never
        // reach any candidate set built from this method's result.
        .filter(c -> noProjectFilter || effectiveProjectFilter.equals(ComposeLabels.project(c.getLabels())))
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
