package com.logexplorer.source.openshift;

import com.logexplorer.config.DirectPodLogProperties;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.RawToken;
import com.logexplorer.core.model.SearchRequest;
import com.logexplorer.core.parse.LogLineParser;
import com.logexplorer.core.search.EventFilters;
import com.logexplorer.source.openshift.OpenShiftApiException.Kind;
import java.net.URI;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * OS-1C — direct OpenShift log retrieval: resolves the current OS-1B scope
 * into bounded (pod, container) targets, fetches each via the Kubernetes
 * pod-log API concurrently (bounded), reuses the canonical parser/filter
 * pipeline, and merges the result deterministically.
 *
 * <h2>Architecture</h2>
 *
 * <pre>
 * OpenShiftLogSource
 *    -&gt; DirectPodLogProvider (this class)
 *    -&gt; OpenShiftApiClient#fetchPodLog
 *    -&gt; LogLineParser (reused, unmodified)
 *    -&gt; EventFilters (reused, unmodified)
 *    -&gt; deterministic merge
 * </pre>
 *
 * <h2>Scope is consumed, never rediscovered (OS-1C §4)</h2>
 *
 * <p>This class reads {@link OpenShiftSession#scope()} exactly as OS-1B
 * last resolved it — it never calls {@code OpenShiftScopeService}'s own
 * discovery methods itself. "Workload = All" and "Pod = All" mean exactly
 * what OS-1B's own {@code discoverWorkloads()}/{@code discoverPods()}
 * already resolved and cached; this class only decides <em>which of those
 * already-resolved pods/containers</em> a specific search targets (OS-1C
 * §10), never re-derives the set itself. If the user has not yet visited
 * the scope controls for the currently-selected project, the resolved pod
 * list is genuinely empty and search correctly returns zero events — the
 * same "consume, don't guess" discipline OS-1B itself established for
 * "All workloads" is preserved one layer up.
 *
 * <h2>Immutable scope snapshot (OS-1C §23)</h2>
 *
 * <p>{@link #search} reads {@link OpenShiftSession#generation()}, the
 * selected project, discovery mode, and the whole {@link OpenShiftScope}
 * exactly once, synchronously, before issuing a single upstream call —
 * every target fetched by one search call belongs to that one snapshot.
 * A project/workload switch that happens after a search has started has
 * no effect on the pods/containers that search already resolved (OS-1C
 * §22 "do not silently attach new pods"). Protecting the *frontend's*
 * active search state from a late-arriving stale response reuses the
 * existing generic search request/abort machinery (established since
 * UX-R3) — this class adds no new mechanism for that, per OS-1C §23's own
 * "reuse existing search request/race protections."
 *
 * <h2>What this class deliberately does not surface (documented gap)</h2>
 *
 * <p>{@link #describeScopeWarnings} can only report what is known
 * <em>before</em> any network call is made (scope completeness, target-cap
 * truncation) — a specific target's own runtime failure (403 on one pod,
 * 404 because it disappeared, a timeout) is only known <em>during</em>
 * {@link #search}, and {@code LogSource#search} has no return channel back
 * to the query-plan notes {@code SearchService} builds before the search
 * even runs. Those per-target failures are still handled correctly (the
 * target is skipped, the search continues with whatever else is
 * readable — OS-1C §21) but are not yet individually named as a
 * user-visible note in this slice; seeing the query-plan warnings already
 * present for scope-level partiality/truncation, and finding fewer events
 * than expected, is the available signal today. Naming individual
 * per-target failures as their own note is tracked as a follow-up (see
 * the OS-1C verification report), not silently dropped.
 */
@Component
public class DirectPodLogProvider {

  private final OpenShiftApiClient client;
  private final OpenShiftSession session;
  private final LogLineParser parser;
  private final DirectPodLogProperties properties;

  public DirectPodLogProvider(
      OpenShiftApiClient client, OpenShiftSession session, LogLineParser parser, DirectPodLogProperties properties) {
    this.client = client;
    this.session = session;
    this.parser = parser;
    this.properties = properties;
  }

  /** Bounded, cancellable direct search — see the class javadoc for the full contract. */
  public Flux<CanonicalLogEvent> search(SearchRequest request) {
    return Mono.defer(() -> {
      String namespace = requireSelectedProject();
      long generation = session.generation();
      URI server = session.server();
      var token = session.token();
      var caPath = session.certificateAuthorityPath();
      OpenShiftScope scope = session.scope();

      TargetPlan plan = resolveTargetPlan(scope, namespace);
      Mono<List<CanonicalLogEvent>> result = plan.queried().isEmpty()
          ? Mono.just(List.<CanonicalLogEvent>of())
          : fetchAndMerge(server, token, caPath, plan, request);

      return result
          .timeout(properties.getOverallTimeout())
          .onErrorMap(OpenShiftApiException.class, e -> {
            if (e.kind() == Kind.UNAUTHORIZED && session.generation() == generation) {
              session.markExpired();
            }
            return e;
          });
    }).flatMapMany(Flux::fromIterable);
  }

  private Mono<List<CanonicalLogEvent>> fetchAndMerge(
      URI server, RawToken token, String caPath, TargetPlan plan, SearchRequest request) {
    Instant fetchedAt = Instant.now();
    return Flux.fromIterable(plan.queried())
        .flatMap(target -> fetchTarget(server, token, caPath, target, request.start()), properties.getMaxConcurrency())
        .collectList()
        .flatMap(attempts -> {
          boolean allForbidden = attempts.stream().allMatch(a -> a.outcome() == TargetOutcome.FORBIDDEN);
          if (allForbidden) {
            return Mono.error(new OpenShiftApiException(
                Kind.FORBIDDEN, "Not permitted to read logs for any resolved pod/container in this project."));
          }
          List<CanonicalLogEvent> events = parseFilterAndMerge(attempts, request, fetchedAt);
          return Mono.just(trimToInternalCap(events, request));
        });
  }

  /**
   * OS-1C — synchronous, no-network-call account of anything already known
   * to make this search's result potentially incomplete: scope
   * completeness (OS-1B review recovery's {@code workloadScopeComplete}/
   * {@code podScopeComplete}) and target-cap truncation. See the class
   * javadoc for why per-target runtime failures are not included here.
   */
  public List<String> describeScopeWarnings(SearchRequest request) {
    if (!session.isConnected() || session.selectedProject() == null) {
      return List.of();
    }
    OpenShiftScope scope = session.scope();
    List<String> warnings = new ArrayList<>();
    if (!scope.workloadScopeComplete()) {
      warnings.add("Workload scope may be incomplete: one or more supported workload kinds could not be listed, "
          + "so some pods may be missing from this search (SCOPE_PARTIAL).");
    }
    if (!scope.podScopeComplete()) {
      warnings.add("Pod scope may be incomplete: one or more resolved workloads' own pods could not be listed, "
          + "so some pods may be missing from this search (SCOPE_PARTIAL).");
    }
    if (scope.selectedPod() == null && scope.pods().size() > properties.getMaxPods()) {
      warnings.add("Only " + properties.getMaxPods() + " of " + scope.pods().size()
          + " resolved pods were included in this search (TARGET_CAP_REACHED) - some pods were skipped.");
    }
    TargetPlan plan = resolveTargetPlan(scope, session.selectedProject());
    if (plan.resolvedCount() > plan.queried().size()) {
      warnings.add("Only " + plan.queried().size() + " of " + plan.resolvedCount()
          + " resolved pod/container targets were queried (TARGET_CAP_REACHED) - some pods were skipped.");
    }
    return List.copyOf(warnings);
  }

  // ------------------------------------------------------------ target resolution

  private record TargetPlan(List<PodLogTarget> queried, int resolvedCount) {}

  /**
   * OS-1C §10 - resolves exactly what the current selection means, reading
   * only the already-cached OS-1B scope, then dedups and applies the hard
   * target cap (§8) — truncation is never silent; {@link #describeScopeWarnings}
   * reports it using the same {@code resolvedCount} this method computes.
   */
  private TargetPlan resolveTargetPlan(OpenShiftScope scope, String namespace) {
    List<PodLogTarget> resolved = resolveTargets(scope, namespace);
    Map<String, PodLogTarget> deduped = new LinkedHashMap<>();
    for (PodLogTarget target : resolved) {
      deduped.putIfAbsent(target.targetKey(), target);
    }
    List<PodLogTarget> all = List.copyOf(deduped.values());
    List<PodLogTarget> capped = all.size() > properties.getMaxTargets()
        ? all.subList(0, properties.getMaxTargets())
        : all;
    return new TargetPlan(capped, all.size());
  }

  private List<PodLogTarget> resolveTargets(OpenShiftScope scope, String namespace) {
    List<PodLogTarget> targets = new ArrayList<>();
    if (scope.selectedPod() != null) {
      PodSummary pod = scope.findPod(scope.selectedPod());
      if (pod == null) {
        return List.of();
      }
      if (scope.selectedContainer() != null) {
        // Selected Pod + Selected Container -> one target.
        targets.add(new PodLogTarget(namespace, pod.workload(), pod.name(), scope.selectedContainer()));
      } else {
        // Selected Pod + Container=All -> every normal runtime container in that pod.
        for (String container : pod.containerNames()) {
          targets.add(new PodLogTarget(namespace, pod.workload(), pod.name(), container));
        }
      }
      return targets;
    }
    // Pod=All: every pod currently resolved for the selected workload
    // (Pod=All + Workload selected), or OS-1B's own resolved
    // supported-workload pod union (Pod=All + Workload=All) - both cases
    // are already exactly {@code scope.pods()}, since OS-1B's own
    // discoverPods() already scoped that list to the selected workload
    // when one is selected. Never every pod in the namespace.
    //
    // maxPods (§7/§8) is a hard cap on distinct pods considered, applied
    // BEFORE per-pod container expansion - kept separate from maxTargets
    // (the (pod, container) fan-out cap applied afterward in {@link
    // #resolveTargetPlan}) so a namespace with many single-container pods
    // and a namespace with few many-container pods are each bounded on the
    // dimension that actually threatens them; describeScopeWarnings
    // reports pod-level truncation using this same cap.
    List<PodSummary> pods = scope.pods();
    List<PodSummary> cappedPods = pods.size() > properties.getMaxPods()
        ? pods.subList(0, properties.getMaxPods())
        : pods;
    for (PodSummary pod : cappedPods) {
      // Container=All across multiple pods: each pod's own discovered
      // runtime containers, never assumed identical across replicas.
      for (String container : pod.containerNames()) {
        targets.add(new PodLogTarget(namespace, pod.workload(), pod.name(), container));
      }
    }
    return targets;
  }

  // ------------------------------------------------------------ fetch

  private enum TargetOutcome { OK, FORBIDDEN, NOT_FOUND, ERROR }

  private record TargetAttempt(PodLogTarget target, List<String> rawLines, TargetOutcome outcome) {}

  private Mono<TargetAttempt> fetchTarget(
      URI server, RawToken token, String caPath, PodLogTarget target, Instant sinceTime) {
    return client
        .fetchPodLog(server, token, caPath, target.namespace(), target.podName(), target.containerName(),
            sinceTime, properties.getMaxLinesPerTarget(), properties.getMaxBytesPerTarget(),
            properties.getPerTargetTimeout())
        .map(body -> new TargetAttempt(target, splitLines(body), TargetOutcome.OK))
        .onErrorResume(OpenShiftApiException.class, e -> {
          if (e.kind() == Kind.UNAUTHORIZED) {
            return Mono.error(e);
          }
          TargetOutcome outcome = e.kind() == Kind.FORBIDDEN ? TargetOutcome.FORBIDDEN
              : e.kind() == Kind.NOT_FOUND ? TargetOutcome.NOT_FOUND
              : TargetOutcome.ERROR;
          return Mono.just(new TargetAttempt(target, List.of(), outcome));
        });
  }

  private static List<String> splitLines(String body) {
    if (body == null || body.isEmpty()) {
      return List.of();
    }
    return Arrays.stream(body.split("\n", -1)).filter(line -> !line.isEmpty()).toList();
  }

  // ------------------------------------------------------------ parse + filter + merge

  private record ParsedEvent(CanonicalLogEvent event, PodLogTarget target, int sequence) {}

  private List<CanonicalLogEvent> parseFilterAndMerge(
      List<TargetAttempt> attempts, SearchRequest request, Instant fetchedAt) {
    List<ParsedEvent> parsed = new ArrayList<>();
    for (TargetAttempt attempt : attempts) {
      if (attempt.outcome() != TargetOutcome.OK) {
        continue;
      }
      int sequence = 0;
      for (String rawLine : attempt.rawLines()) {
        Instant sourceTimestamp = extractTimestamp(rawLine, fetchedAt);
        String content = stripTimestamp(rawLine);
        String serviceHint = attempt.target().workload() != null ? attempt.target().workload().name() : null;
        CanonicalLogEvent event = parser.parse(content, serviceHint).toBuilder()
            .sourceId("openshift")
            .namespace(attempt.target().namespace())
            .pod(attempt.target().podName())
            .containerName(attempt.target().containerName())
            .sourceTimestamp(sourceTimestamp)
            .build();
        if (EventFilters.matches(event, request)) {
          parsed.add(new ParsedEvent(event, attempt.target(), sequence));
        }
        sequence++;
      }
    }

    // OS-1C §17 - deterministic multi-stream merge: primary key is the
    // event's own (source-native) timestamp, direction-of-travel ordered
    // exactly like Docker's own merge; secondary tie-breakers are
    // explicit and stable (namespace, pod, container, then this event's
    // own per-stream sequence) - never left to Flux arrival timing, which
    // Reactor's bounded flatMap does not otherwise preserve.
    boolean forward = request.direction() == SearchRequest.Direction.FORWARD;
    Comparator<Instant> nativeOrder = forward ? Comparator.naturalOrder() : Comparator.reverseOrder();
    parsed.sort(Comparator
        .comparing((ParsedEvent p) -> p.event().sourceTimestamp(), Comparator.nullsLast(nativeOrder))
        .thenComparing(p -> p.event().namespace(), Comparator.nullsLast(Comparator.naturalOrder()))
        .thenComparing(p -> p.event().pod(), Comparator.nullsLast(Comparator.naturalOrder()))
        .thenComparing(p -> p.event().containerName(), Comparator.nullsLast(Comparator.naturalOrder()))
        .thenComparingInt(ParsedEvent::sequence));

    return parsed.stream().map(ParsedEvent::event).toList();
  }

  /**
   * OS-1C §24 - never returns more than this source's own internal
   * default/cap, or the caller's requested limit if smaller. Deliberately
   * conservative: {@code api.SearchService} only ever builds a pagination
   * cursor when a source returns MORE events than the effective limit it
   * computed — trimming here first means that never happens for this
   * source, which is what makes {@code pagination=false} true rather than
   * aspirational (OS-1C never invents a cursor by slicing an
   * already-truncated array).
   */
  private List<CanonicalLogEvent> trimToInternalCap(List<CanonicalLogEvent> events, SearchRequest request) {
    int cap = request.limit() != null
        ? Math.min(request.limit(), properties.getMaxEventsOverall())
        : properties.getMaxEventsOverall();
    return events.size() > cap ? events.subList(0, cap) : events;
  }

  /**
   * Kubernetes' {@code timestamps=true} prefixes every line with its own
   * RFC3339Nano receive timestamp followed by a single space (OS-1C §5) -
   * this is this event's {@code sourceTimestamp}, always set even when the
   * line's own content fails canonical parsing (mirrors Docker's frame-
   * receive-time convention exactly). Falls back to the time this batch
   * was fetched only if the prefix is missing or unparseable - never null.
   */
  private static Instant extractTimestamp(String line, Instant fallback) {
    int idx = line.indexOf(' ');
    if (idx < 0) {
      return fallback;
    }
    try {
      return Instant.parse(line.substring(0, idx));
    } catch (DateTimeParseException e) {
      return fallback;
    }
  }

  private static String stripTimestamp(String line) {
    int idx = line.indexOf(' ');
    if (idx < 0) {
      return line;
    }
    try {
      Instant.parse(line.substring(0, idx));
      return line.substring(idx + 1);
    } catch (DateTimeParseException e) {
      return line;
    }
  }

  private String requireSelectedProject() {
    if (!session.isConnected()) {
      throw new IllegalStateException("Not connected to OpenShift.");
    }
    String project = session.selectedProject();
    if (project == null) {
      throw new IllegalStateException("No project/namespace selected.");
    }
    return project;
  }
}
