package com.logexplorer.source.docker;

import com.github.dockerjava.api.model.Container;
import com.logexplorer.config.DockerProperties;
import com.logexplorer.core.mapping.MappingScopeKey;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.FollowRequest;
import com.logexplorer.core.model.SearchRequest;
import com.logexplorer.core.model.ServiceInfo;
import com.logexplorer.core.model.SourceCapabilities;
import com.logexplorer.core.model.SourceHealth;
import com.logexplorer.core.model.SourceSearchOutcome;
import com.logexplorer.core.parse.LogLineParser;
import com.logexplorer.core.search.EventFilters;
import com.logexplorer.source.LogSource;
import com.logexplorer.source.docker.security.RemoteHostGuard;
import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
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

  /**
   * Owner mission "Service Filter, Docker Performance, and Verified
   * Default Mapping" §B — low-cost timing/observability from the most
   * recent {@link #searchBlocking} call, for tests/diagnostics only.
   * Deliberately carries no log content, query values, or identifiers —
   * only counts and durations. Package-private so {@code DockerLogSourceTest}
   * can assert on it directly; not part of the public {@link LogSource} API.
   */
  private volatile HistoricalSearchTiming lastHistoricalSearchTiming;

  /**
   * @param targetContainerCount containers matched by the service/project
   *     filter before any read was attempted (post service-include/exclude
   *     narrowing, pre {@code maxContainers} cap already applied by the
   *     caller).
   * @param containersActuallyRead containers a real read was attempted for
   *     (always equal to {@code targetContainerCount} today — Docker never
   *     short-circuits a read — kept distinct from it because a future
   *     early-exit/cap would change only this field).
   * @param effectiveConcurrency the bounded-parallelism limit actually used
   *     for this search ({@code max(1, configured value)}).
   * @param totalDurationMillis wall-clock time for the whole container-read
   *     phase (parallel reads only, not parsing/filtering/merge).
   * @param slowestContainerReadMillis the single slowest container read's
   *     own duration — proves one slow container never serializes the rest.
   */
  record HistoricalSearchTiming(
      int targetContainerCount, int containersActuallyRead, int effectiveConcurrency,
      long totalDurationMillis, long slowestContainerReadMillis) {
  }

  /** Test/diagnostic visibility only — see {@link #lastHistoricalSearchTiming} field javadoc. */
  HistoricalSearchTiming lastHistoricalSearchTiming() {
    return lastHistoricalSearchTiming;
  }

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
    // UX-R4 §11/§19 - see FixtureLogSource for why `contextView` is now
    // declared truthfully; verified for this source against real Docker
    // containers (UX-R4 report, "Real Docker verification").
    return new SourceCapabilities(true, true, false, true, false, true, true, true);
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
    return searchWithOutcome(request).flatMapMany(outcome -> Flux.fromIterable(outcome.events()));
  }

  /**
   * PR65_FRESH_SEARCH_CUSTOM_TIME_AND_BATCH_RECOVERY (defect 1) — overridden
   * so a genuinely partial bounded scan (see {@link #searchBlocking}) can
   * report it truthfully through {@link SourceSearchOutcome#runtimeWarnings()},
   * exactly the same channel {@code source.openshift.OpenShiftLogSource}
   * already uses for its own partial-scope case (OS-1C) — {@code
   * api.SearchService} turns a non-empty list here into {@code
   * ResultCounts#truncated() == true} and suppresses a fabricated exact
   * total, regardless of how many events this call happened to return.
   */
  @Override
  public Mono<SourceSearchOutcome> searchWithOutcome(SearchRequest request) {
    return Mono.fromCallable(() -> searchBlocking(request))
        .subscribeOn(Schedulers.boundedElastic());
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
          List<Container> candidates = relevantContainers(
              client.listContainers(true), request.services(), request.serviceFilterMode(), request.composeProject());
          // LIVE_TIME_INSPECTOR_AND_DOCUMENTATION_RECOVERY - real root cause found: relevantContainers
          // (shared with Search, where a STOPPED container's own historical logs are correctly still
          // readable) never filtered by container state, and listContainers(true) includes stopped/
          // exited containers - so a stale exited container that still carries the requested service's
          // Compose label was silently selected as a live-tail target. Its DockerFollowCallback opens
          // and completes almost instantly (nothing to follow), and if it was the only match, the whole
          // merged Flux completed right away - the live status/heartbeat channel deliberately keeps the
          // SSE connection open regardless (see LiveTailService), so the browser just saw a nominally
          // "Live" connection that could structurally never deliver an event. A follow target only makes
          // sense for a container that is actually running right now; this filter is intentionally
          // applied ONLY on the follow path, never on relevantContainers itself (search must keep
          // reading a stopped container's own already-written log lines).
          return candidates.stream().filter(c -> "running".equalsIgnoreCase(c.getState())).toList();
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
    // Project-Scoped Schema Scan mission §2/§8 - keyed to THIS container's
    // own real Compose project label, not the request's (possibly absent)
    // filter value - a caller with no project filter selected still gets
    // events from multiple real projects correctly attributed to their
    // own distinct scopes, never merged into one.
    MappingScopeKey scope = MappingScopeKey.of(id(), ComposeLabels.project(labels));
    CanonicalLogEvent parsed = parser.parse(line.content(), ComposeLabels.service(labels), scope);
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

  /**
   * PR65_FRESH_SEARCH_CUSTOM_TIME_AND_BATCH_RECOVERY (defect 1) — one
   * container's own remaining read window within one progressive scan.
   * Mutable by design (narrowed round by round) but never shared across
   * two different {@link #searchBlocking} invocations — a fresh list is
   * built at the top of every call, so two concurrent searches can never
   * see or mutate each other's windows.
   *
   * @param floorSince epoch seconds, the fixed outer lower bound for this whole scan - never mutated.
   * @param ceilingUntil epoch seconds, the fixed outer upper bound for this whole scan - never mutated.
   * @param since epoch seconds, the NEXT read's lower bound - recomputed every round.
   * @param until epoch seconds, the NEXT read's upper bound - recomputed every round.
   * @param anyRoundCapped once true (a round for this container came back at the client-side line
   *     cap, or timed out incomplete), stays true for the rest of this container's scan - this
   *     container's window can never again be honestly reported as fully covered, even if a later,
   *     narrower round happens to complete cleanly.
   */
  private static final class ScanWindow {
    final Container container;
    final Integer floorSince;
    final Integer ceilingUntil;
    Integer since;
    Integer until;
    boolean active = true;
    boolean anyRoundCapped;
    /** Set once per round by {@link #readWindowRound} - this container's own result for the round just read. */
    ContainerReadResult lastRead;

    ScanWindow(Container container, Integer floorSince, Integer ceilingUntil) {
      this.container = container;
      this.floorSince = floorSince;
      this.ceilingUntil = ceilingUntil;
      this.since = floorSince;
      this.until = ceilingUntil;
    }
  }

  private record ContainerReadResult(List<DockerLogLine> lines, boolean completed) {
  }

  /**
   * PR65_FRESH_SEARCH_CUSTOM_TIME_AND_BATCH_RECOVERY (defect 1) — real root
   * cause: every prior release read at most {@code defaultTailLines}
   * (Docker's own {@code tail}, applied per container) lines ONCE per
   * search, regardless of how wide the requested time range was or how
   * selective the request's other criteria were. A container that logged
   * more than that many lines within the requested window silently hid
   * anything older than its own newest {@code defaultTailLines} lines from
   * EVERY search against that window — a fresh, correctly-built request
   * (proven fresh by {@code api.SearchService} always re-invoking this
   * method) still could not find a genuine match sitting just past that
   * raw cutoff, which is indistinguishable from "still filtering the old
   * page" to an investigator. Adversarial reproduction: a broad first
   * Search's raw tail contains no ERROR event; a real ERROR event exists
   * further back but still inside the requested window; an ERROR-only
   * Search must return it.
   *
   * <p>Fix: a bounded, per-container PROGRESSIVE scan. Round 1 reads
   * exactly the window every prior release already read, capped at the
   * same {@code defaultTailLines} — fully backward-compatible for the
   * common case where that single read already covers a container's whole
   * relevant history (the read comes back under the cap, proving nothing
   * was cut off). Only a container whose round-1 (or later) read comes
   * back AT the cap — proof more may exist — has its own window narrowed
   * to strictly older (backward) / newer (forward) territory and is read
   * again, independently of every other container, for up to {@link
   * DockerProperties#getMaxHistoricalScanChunks()} total rounds. The scan
   * also stops early, before any round limit, the moment enough matching
   * events have been found to fill a page and prove there is at least one
   * more (mirroring {@code api.SearchService}'s own {@code
   * moreWithinThisFetch} pagination signal) — a search that only needs 20
   * matches never pays for 5 full rounds just because one busy container
   * happened to be capped.
   *
   * <p>Bounded by construction: total Docker reads for one search are at
   * most {@code targetContainerCount * maxHistoricalScanChunks}, each
   * still capped at {@code defaultTailLines} lines and the configured
   * per-read timeout — no unbounded container-log read is ever introduced.
   * If the round limit is reached with containers still active (capped)
   * and still short of the target match count, the scan honestly reports
   * a runtime warning (via {@link SourceSearchOutcome#runtimeWarnings()})
   * rather than silently presenting a possibly-incomplete result as
   * complete — {@code api.SearchService} turns that into {@code
   * ResultCounts#truncated() == true} and withholds a fabricated exact
   * total.
   */
  private SourceSearchOutcome searchBlocking(SearchRequest request) {
    checkRemoteHostIfNeeded();
    List<Container> containers = client.listContainers(true);
    List<Container> targets = relevantContainers(
            containers, request.services(), request.serviceFilterMode(), request.composeProject())
        .stream()
        .limit(properties.getMaxContainers())
        .toList();

    boolean forward = request.direction() == SearchRequest.Direction.FORWARD;
    Integer baseSince = request.start() != null ? (int) request.start().getEpochSecond() : null;
    Integer baseUntil = request.end() != null ? (int) request.end().getEpochSecond() : null;

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
    // This narrows the OUTER (whole-scan) boundary the progressive scan
    // below then operates within - a continuation page picks up its own
    // independent progressive scan of exactly its own remaining window.
    Instant boundary = request.pageBoundary();
    if (boundary != null) {
      if (forward) {
        long candidateSince = boundary.getEpochSecond();
        if (baseSince == null || candidateSince > baseSince) {
          baseSince = (int) candidateSince;
        }
      } else {
        long candidateUntil = boundary.getEpochSecond() + 1;
        if (baseUntil == null || candidateUntil < baseUntil) {
          baseUntil = (int) candidateUntil;
        }
      }
    }

    int tailCap = properties.getDefaultTailLines();
    int maxRounds = Math.max(1, properties.getMaxHistoricalScanChunks());
    int targetMatches = resolveTargetMatchCount(request);
    // PR65_FRESH_SEARCH_CUSTOM_TIME_AND_BATCH_RECOVERY review recovery -
    // real-Docker verification (not a mocked client) proved a critical,
    // previously-undiscovered fact about Docker's own log API: `tail`
    // always selects from the absolute END of a container's WHOLE log
    // stream first, and ONLY THEN intersects with `since`/`until` - it is
    // NOT "the last N lines within the requested window". Verified
    // directly: `docker logs --since <early> --until <T-excludes-newest>
    // --tail N` returns EMPTY even though `--since <early> --until <T>`
    // alone (no tail) correctly returns everything up to T - because the
    // real absolute-newest N lines Docker selects for `tail` fall AFTER
    // `until` and get filtered out, leaving nothing. So `tail` is only
    // ever meaningful on a read whose `until` has NOT been narrowed below
    // "the container's actual current newest content" - i.e. only the
    // very first read of a brand-new (uncursored) search, over the whole
    // requested window. Every other read - a later progressive-scan
    // round, OR any page beyond the first via the pre-existing
    // pageBoundary cursor mechanism - instead reads a BOUNDED TIME SLICE
    // (never Docker's own `tail`) that narrows toward the outer floor/
    // ceiling one round at a time, sized so the whole remaining window is
    // coverable within the remaining round budget. Still bounded
    // regardless of `tail`: `DockerFrameCollectingCallback`'s own
    // client-side `maxLines` cap (never accumulates more than `tailCap`
    // lines in memory for any single read) and
    // `properties.getRequestTimeout()` (never runs longer than that per
    // read, see `readContainerLogs`) apply to every round alike.
    boolean pageAlreadyNarrowed = boundary != null;

    List<ScanWindow> windows = new ArrayList<>(targets.size());
    for (Container c : targets) {
      windows.add(new ScanWindow(c, baseSince, baseUntil));
    }

    List<ContainerLine> accumulated = new ArrayList<>();
    Set<String> seenLineKeys = new HashSet<>();
    long scanStartNanos = System.nanoTime();
    AtomicInteger totalContainerReads = new AtomicInteger();
    AtomicLong slowestReadNanos = new AtomicLong();
    int roundsUsed = 0;

    while (true) {
      List<ScanWindow> active = windows.stream().filter(w -> w.active).toList();
      if (active.isEmpty()) {
        break; // every container's relevant window has now been fully read - nothing more exists to find
      }
      roundsUsed++;
      // Only the very first round of a brand-new (uncursored) search asks
      // Docker for its own newest-N `tail`, reading the WHOLE outer
      // window in one shot - every other round reads a bounded slice
      // instead (see the review-recovery comment above). Whichever plan
      // applies, it is computed once per container BEFORE the read (this
      // round's since/until already reflect it - see the narrowing step
      // at the end of the previous iteration, or the constructor for
      // round 1).
      boolean wholeWindowTailRound = roundsUsed == 1 && !pageAlreadyNarrowed;
      int roundsLeft = Math.max(1, maxRounds - roundsUsed + 1);
      if (!wholeWindowTailRound) {
        for (ScanWindow w : active) {
          sliceWindowForBoundedRound(w, forward, roundsLeft);
        }
      }
      Integer dockerTail = wholeWindowTailRound ? tailCap : null;
      readWindowRound(active, tailCap, dockerTail, totalContainerReads, slowestReadNanos);

      for (ScanWindow w : active) {
        ContainerReadResult result = w.lastRead;
        List<DockerLogLine> lines = result == null ? List.of() : result.lines();
        for (DockerLogLine line : lines) {
          // Intra-search dedup safety net: a bounded-slice round's own
          // [since, until) can abut (never overlap in principle, but
          // second-granularity boundaries plus the tail-round's own
          // +1-inclusive convention below make an exact-boundary overlap
          // possible) the previous round's slice. There is no cross-page
          // tie-key mechanism available within one search call to rely on
          // instead, so this set is the correctness backstop - cheap and
          // bounded by the same total-lines-read bound this whole scan
          // already enforces.
          String key = w.container.getId() + '\u0000' + line.dockerTimestamp() + '\u0000' + line.stream() + '\u0000' + line.content();
          if (seenLineKeys.add(key)) {
            accumulated.add(new ContainerLine(line, w.container));
          }
        }

        boolean cappedOrIncomplete = lines.size() >= tailCap || (result != null && !result.completed());
        if (cappedOrIncomplete) {
          w.anyRoundCapped = true;
        }

        if (wholeWindowTailRound) {
          if (!cappedOrIncomplete) {
            w.active = false; // the WHOLE window fit in one tail read - genuinely, provably complete
            continue;
          }
          // Capped: more may exist older than this tail read. Hand off to
          // bounded-slice rounds starting just before the oldest line
          // this read actually returned (falls back to the outer
          // ceiling/floor, i.e. "start slicing from the very top", if for
          // some defensive reason no line here carries a usable native
          // timestamp - should not happen in practice).
          Instant extreme = extremeDockerTimestamp(lines, forward);
          if (forward) {
            w.since = extreme != null ? (int) extreme.getEpochSecond() : w.floorSince;
          } else {
            w.until = extreme != null ? (int) extreme.getEpochSecond() + 1 : w.ceilingUntil;
          }
          continue; // next iteration narrows this window further via sliceWindowForBoundedRound
        }

        // Bounded-slice round: this round's own [since, until) has now
        // been read in full (capped or not - a capped bounded slice is
        // still a real, honestly-flagged gap, not a reason to re-read the
        // exact same slice again and again). Advance toward the outer
        // bound for the next round.
        if (forward) {
          w.since = w.until; // this slice's own ceiling becomes the next slice's floor
          if (w.ceilingUntil != null && w.since >= w.ceilingUntil) {
            w.active = false; // reached the outer ceiling - nothing left in this window
          }
        } else {
          w.until = w.since; // this slice's own floor becomes the next slice's ceiling
          if (w.floorSince != null && w.until <= w.floorSince) {
            w.active = false; // reached the outer floor - nothing left in this window
          }
        }
      }

      if (countPotentialMatches(accumulated, request) >= targetMatches) {
        break; // enough found to fill a page and prove there is at least one more - no need to keep scanning
      }
      if (roundsUsed >= maxRounds) {
        break; // bounded cutoff - see the runtime-warning check below
      }
    }

    // Fully covered only when EVERY container both stopped needing more
    // rounds (inactive) AND never once came back capped/incomplete along
    // the way - a container that was capped in an earlier round but later
    // read cleanly through its remaining (now-covered) slices still left
    // a real, unread gap earlier in its history, so it can never
    // honestly count as fully covered.
    boolean windowFullyCovered = windows.stream().noneMatch(w -> w.active || w.anyRoundCapped);
    lastHistoricalSearchTiming = new HistoricalSearchTiming(
        targets.size(), totalContainerReads.get(), Math.max(1, properties.getHistoricalSearchConcurrency()),
        Duration.ofNanos(System.nanoTime() - scanStartNanos).toMillis(),
        Duration.ofNanos(slowestReadNanos.get()).toMillis());
    log.debug(
        "Docker historical search read {} container-round(s) across {} of {} target container(s) in {} rounds/{} ms "
            + "(windowFullyCovered={})",
        totalContainerReads.get(), lastHistoricalSearchTiming.containersActuallyRead(), targets.size(),
        roundsUsed, lastHistoricalSearchTiming.totalDurationMillis(), windowFullyCovered);

    // Deterministic merge across containers, in direction-of-travel order
    // (mandatory blocker #2: never silently treat FORWARD as BACKWARD) -
    // Docker's own receive timestamp, containerId as a stable tiebreaker
    // for equal timestamps (never left to HTTP-response arrival order).
    Comparator<Instant> nativeOrder = forward ? Comparator.naturalOrder() : Comparator.reverseOrder();
    long sortStartNanos = System.nanoTime();
    accumulated.sort(
        Comparator.<ContainerLine, Instant>comparing(cl -> cl.line().dockerTimestamp(), Comparator.nullsLast(nativeOrder))
            .thenComparing(cl -> cl.container().getId()));
    long sortMillis = Duration.ofNanos(System.nanoTime() - sortStartNanos).toMillis();

    // SEARCH_LATENCY_INVESTIGATION_AND_SAFE_OPTIMIZATION Phase 2 - safe
    // diagnostic timing for the CPU-bound parse+classify+filter phase.
    // Counts and durations only - never a log line, query value, or any
    // field from `request`/an event.
    long pipelineStartNanos = System.nanoTime();
    int classifiedCount = 0;
    List<CanonicalLogEvent> events = new ArrayList<>(accumulated.size());
    for (ContainerLine cl : accumulated) {
      CanonicalLogEvent enriched = buildUnclassifiedEvent(cl);
      // Container/time-range filtering above narrows which containers and
      // Docker-API-level range we even read; this applies every remaining
      // structured filter (traceId, correlationId, text, sensitive
      // filters, ...) that the Docker API itself has no way to push down.
      //
      // SEARCH_LATENCY_INVESTIGATION_AND_SAFE_OPTIMIZATION — classification
      // (parser.classify) is deliberately deferred until AFTER every
      // non-tag condition passes: it is the single most expensive part of
      // this per-line loop, and an event rejected by time range/severity/
      // text/traceId/... was never going to be returned regardless of its
      // tags, so classifying it first was pure waste. See
      // EventFilters#matchesExceptTags/#tagsMatch and
      // LogLineParser#parseUnclassified for why this changes nothing about
      // which events are returned or what tags they carry.
      if (EventFilters.matchesExceptTags(enriched, request)) {
        CanonicalLogEvent classified = parser.classify(enriched);
        classifiedCount++;
        if (EventFilters.tagsMatch(classified, request)) {
          events.add(classified);
        }
      }
    }
    log.debug(
        "Docker historical search pipeline: {} raw line(s) merged/sorted in {} ms, {} classified (of {}), "
            + "{} returned in {} ms",
        accumulated.size(), sortMillis, classifiedCount, accumulated.size(), events.size(),
        Duration.ofNanos(System.nanoTime() - pipelineStartNanos).toMillis());

    List<String> warnings = (!windowFullyCovered && events.size() < targetMatches)
        ? List.of("Docker historical scan reached its bounded read-round limit (" + maxRounds
            + ") before fully scanning the requested time range for one or more containers - results may be partial")
        : List.of();
    return new SourceSearchOutcome(events, warnings);
  }

  /**
   * The number of matched (non-tag-filtered where tags are absent, fully
   * filtered where present - see {@link #countPotentialMatches}) events
   * the progressive scan aims to collect before it is willing to stop
   * early, one more than {@link SearchRequest#effectiveLimit()} so
   * finding "enough" also proves at least one further event exists
   * (mirrors {@code api.SearchService}'s own {@code moreWithinThisFetch}).
   * {@link SearchRequest#effectiveLimit()} is set by {@code
   * api.SearchService} on every real request; the fallback below is
   * defensive only, for a {@link SearchRequest} built directly (tests)
   * without going through that path.
   */
  private static int resolveTargetMatchCount(SearchRequest request) {
    Integer effectiveLimit = request.effectiveLimit();
    int limit = effectiveLimit != null ? effectiveLimit : 500;
    return limit + 1;
  }

  private CanonicalLogEvent buildUnclassifiedEvent(ContainerLine cl) {
    Map<String, String> labels = cl.container().getLabels();
    // Project-Scoped Schema Scan mission §2/§8 - see emitFollowedLine's matching comment.
    MappingScopeKey scope = MappingScopeKey.of(id(), ComposeLabels.project(labels));
    CanonicalLogEvent parsed = parser.parseUnclassified(cl.line().content(), ComposeLabels.service(labels), scope);
    return parsed.toBuilder()
        .sourceId(id())
        .composeProject(ComposeLabels.project(labels))
        .composeService(ComposeLabels.service(labels))
        .containerId(cl.container().getId())
        .containerName(firstName(cl.container()))
        .stream(cl.line().stream())
        // Mandatory blocker #1: always set, even for a malformed/non-JSON
        // line whose parsed `timestamp` is null - Docker always knows when
        // it received the line.
        .sourceTimestamp(cl.line().dockerTimestamp())
        .build();
  }

  /**
   * A count, not the final filtered list - used only to decide whether the
   * progressive scan already has enough to stop early. When {@code
   * request.tags()} is empty (the common case), {@link
   * EventFilters#matchesExceptTags} alone is exactly equivalent to the
   * full {@link EventFilters#matches} check (an empty tag filter always
   * matches - see that method's own javadoc), so classification is
   * skipped entirely for this count, matching this adapter's established
   * performance discipline. Only when tags are actually requested does
   * this run the full classify+tagsMatch pipeline - the same pipeline
   * {@link #searchBlocking}'s own final pass runs - so the two can never
   * disagree about whether "enough" was really found.
   */
  private int countPotentialMatches(List<ContainerLine> rawLines, SearchRequest request) {
    boolean tagFiltered = !request.tags().isEmpty();
    int count = 0;
    for (ContainerLine cl : rawLines) {
      CanonicalLogEvent enriched = buildUnclassifiedEvent(cl);
      if (!EventFilters.matchesExceptTags(enriched, request)) {
        continue;
      }
      if (!tagFiltered || EventFilters.tagsMatch(parser.classify(enriched), request)) {
        count++;
      }
    }
    return count;
  }

  /**
   * PR65_FRESH_SEARCH_CUSTOM_TIME_AND_BATCH_RECOVERY review recovery - sizes
   * and positions the NEXT bounded-slice read for one container, narrowing
   * from wherever the previous round left off toward the scan's outer
   * floor/ceiling. The slice width divides whatever time span still
   * remains by {@code roundsLeft} (never less than 1 second), so the
   * whole remaining window is always coverable within the round budget -
   * the very last allowed round always attempts the entire remaining
   * span in one read (which may itself come back capped, honestly
   * flagged via {@link ScanWindow#anyRoundCapped}, rather than silently
   * dropped). Mutates {@code w.since}/{@code w.until} in place; does not
   * touch {@code w.active} or {@code w.anyRoundCapped} - the caller
   * decides those from the read that follows.
   */
  private static void sliceWindowForBoundedRound(ScanWindow w, boolean forward, int roundsLeft) {
    if (forward) {
      int remaining = (w.ceilingUntil != null && w.since != null)
          ? Math.max(1, w.ceilingUntil - w.since) : Integer.MAX_VALUE;
      int sliceWidth = Math.max(1, remaining / roundsLeft);
      long candidateUntil = (long) w.since + sliceWidth;
      w.until = w.ceilingUntil != null ? (int) Math.min(candidateUntil, w.ceilingUntil) : (int) candidateUntil;
    } else {
      int remaining = (w.until != null && w.floorSince != null)
          ? Math.max(1, w.until - w.floorSince) : Integer.MAX_VALUE;
      int sliceWidth = Math.max(1, remaining / roundsLeft);
      long candidateSince = (long) w.until - sliceWidth;
      w.since = w.floorSince != null ? (int) Math.max(candidateSince, w.floorSince) : (int) candidateSince;
    }
  }

  private static Instant extremeDockerTimestamp(List<DockerLogLine> lines, boolean wantMax) {
    Instant result = null;
    for (DockerLogLine line : lines) {
      Instant ts = line.dockerTimestamp();
      if (ts == null) {
        continue;
      }
      if (result == null || (wantMax ? ts.isAfter(result) : ts.isBefore(result))) {
        result = ts;
      }
    }
    return result;
  }

  /**
   * Owner mission "Service Filter, Docker Performance, and Verified
   * Default Mapping" §B — replaces the previous sequential {@code for
   * (Container : targets) { readContainerLogs(...) }} loop (latency ==
   * SUM of every container's own read timeout) with BOUNDED parallelism:
   * at most {@code historicalSearchConcurrency} container reads run at
   * once, so latency approaches {@code ceil(N / concurrency) *
   * perContainerLatency} instead. {@link Flux#flatMap(java.util.function.Function, int)}'s
   * own concurrency parameter is the actual bound enforced — never
   * unbounded. Each container read still runs on {@link
   * Schedulers#boundedElastic()} (the codebase's established rule for
   * blocking Docker client calls); nesting bounded-elastic-scheduled
   * inner work inside this already-bounded-elastic-scheduled outer call
   * is safe because that scheduler has its own dynamic thread cap (10x
   * cores by default), far larger than this method's own small
   * concurrency bound.
   *
   * <p>Final ordering is untouched by this change: {@link #searchBlocking}
   * always re-sorts the full accumulated result deterministically once the
   * whole progressive scan finishes, so the unordered-completion nature of
   * {@code flatMap} can never affect the final event order, only which
   * order individual container reads happen to finish in.
   *
   * <p>PR65_FRESH_SEARCH_CUSTOM_TIME_AND_BATCH_RECOVERY - reads exactly the
   * given (already active-filtered) {@code windows}, one bounded-parallel
   * round, each container using its OWN current {@link ScanWindow#since}/
   * {@link ScanWindow#until} (never a single shared range) - the result is
   * stashed on each window's own {@link ScanWindow#lastRead} rather than
   * returned, so {@link #searchBlocking} can tell exactly which container
   * produced which lines without needing a second grouping pass.
   */
  private void readWindowRound(
      List<ScanWindow> windows, int tailCap, Integer dockerTail, AtomicInteger totalContainerReads,
      AtomicLong slowestReadNanos) {
    int concurrency = Math.max(1, properties.getHistoricalSearchConcurrency());
    Flux.fromIterable(windows)
        .flatMap(w -> Mono.fromCallable(() -> {
              long readStartNanos = System.nanoTime();
              ContainerReadResult result = readContainerLogs(w.container, w.since, w.until, tailCap, dockerTail);
              slowestReadNanos.accumulateAndGet(System.nanoTime() - readStartNanos, Math::max);
              totalContainerReads.incrementAndGet();
              w.lastRead = result;
              return w;
            }).subscribeOn(Schedulers.boundedElastic()),
            concurrency)
        .collectList()
        .block();
  }

  /**
   * @param tailCap the client-side cap on how many lines {@link DockerFrameCollectingCallback} will
   *     ever accumulate in memory for this one read - always enforced, regardless of {@code dockerTail}.
   * @param dockerTail the {@code tail} argument actually sent to Docker's own API - {@code null} for
   *     "no server-side tail limiting, rely on since/until alone" (every read whose {@code until} is
   *     narrower than the scan's outer ceiling - see the review-recovery comment on {@code
   *     searchBlocking}'s own {@code pageAlreadyNarrowed}/{@code wholeWindowTailRound} for why).
   */
  private ContainerReadResult readContainerLogs(
      Container container, Integer since, Integer until, int tailCap, Integer dockerTail) {
    DockerFrameCollectingCallback callback = new DockerFrameCollectingCallback(tailCap);
    try {
      client.readLogs(container.getId(), true, true, true, since, until, dockerTail, callback);
      // Owner mission "Service Filter, Docker Performance, and Verified
      // Default Mapping" §B review recovery - a real, previously-unreported
      // bug: this boolean (true == the read genuinely completed; false ==
      // it timed out) was discarded entirely, so a timed-out read was
      // silently treated as a normal, complete one, with whatever partial
      // lines had arrived by then returned with no signal at all. Still
      // returns those partial lines unchanged (never fabricates zero,
      // never silently claims completeness) - the caller (searchBlocking's
      // progressive scan) now also treats an incomplete read exactly like
      // a capped one: worth narrowing and retrying, worth an honest
      // partial-result warning if the round budget runs out first.
      boolean completed = callback.awaitCompletion(properties.getRequestTimeout().toMillis(), TimeUnit.MILLISECONDS);
      if (!completed) {
        log.warn("Docker log read for container {} did not complete within {} - returning {} partial line(s) already received",
            container.getId(), properties.getRequestTimeout(), callback.lines().size());
      }
      return new ContainerReadResult(callback.lines(), completed);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      return new ContainerReadResult(List.of(), true);
    } catch (Exception e) {
      // One unreadable container (removed mid-scan, unsupported logging
      // driver, ...) must not fail the whole bounded search.
      log.warn("Skipping container {} - could not read logs: {}", container.getId(), DockerDiagnostics.classify(e));
      return new ContainerReadResult(List.of(), true);
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
    return relevantContainers(containers, requestedServices, SearchRequest.ServiceFilterMode.INCLUDE, requestedComposeProject);
  }

  /**
   * @param serviceFilterMode Owner mission "Service Filter, Docker
   *     Performance, and Verified Default Mapping" §A — {@code INCLUDE}
   *     (default, matches every prior caller's behavior unchanged) keeps
   *     only containers whose Compose service is in {@code
   *     requestedServices}; {@code EXCLUDE} keeps every container whose
   *     Compose service is NOT in {@code requestedServices} (an empty
   *     list under EXCLUDE means "no restriction," same as an empty list
   *     under INCLUDE). This is the one narrowing point every Docker
   *     caller (search/follow) builds its container target list from, so
   *     an excluded service's containers are structurally never passed to
   *     {@link #readContainerLogs} — their logs are never read at all.
   */
  private List<Container> relevantContainers(
      List<Container> containers, List<String> requestedServices,
      SearchRequest.ServiceFilterMode serviceFilterMode, String requestedComposeProject) {
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
        .filter(c -> {
          if (requestedServices.isEmpty()) {
            return true;
          }
          boolean inList = requestedServices.contains(ComposeLabels.service(c.getLabels()));
          return serviceFilterMode == SearchRequest.ServiceFilterMode.EXCLUDE ? !inList : inList;
        })
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
