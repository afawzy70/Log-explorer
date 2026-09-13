package com.logexplorer.source.openshift;

import com.logexplorer.core.model.RawToken;
import com.logexplorer.source.openshift.OpenShiftApiException.Kind;
import com.logexplorer.source.openshift.WorkloadDiscovery.KindOutcome;
import java.net.URI;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * OS-1B - namespace-scoped workload/pod/container discovery, sitting
 * directly on top of the OS-1A connection ({@link OpenShiftSession}).
 *
 * <h2>Discovery only</h2>
 *
 * <p>Nothing here reads a single log line. Every method resolves and
 * validates <i>scope</i> - which workload, which pods, which containers -
 * for later slices (OS-1C Search, OS-1E Live) to use. Calling any of these
 * methods before a project is selected is a caller error, not a discovery
 * outcome.
 *
 * <h2>Bounded, namespace-scoped calls only</h2>
 *
 * <p>Every request here is scoped to the currently-selected project
 * (namespace). There is no cluster-wide workload or pod listing anywhere
 * in this class (OS-1B §7/§18). One workload-discovery refresh issues
 * exactly one GET per supported {@link WorkloadKind} (four, run
 * concurrently); one pod-discovery-for-a-workload issues exactly one GET
 * to re-read that workload's selector plus one namespace-scoped, selector-
 * filtered pod list GET - never one call per pod.
 *
 * <h2>Stale-response protection, one level deeper than OS-1A</h2>
 *
 * <p>OS-1A's generation counter alone protects against a response
 * outliving its *connection*. It does not protect against a response
 * outliving its *project* or *workload* selection within the same
 * connection - the user can switch projects or workloads while a request
 * is still in flight. Every discovery method here therefore captures the
 * generation <b>and</b> the exact project/workload it was resolved
 * against before making the network call, and {@link OpenShiftSession}
 * rejects the result if either has changed by the time it arrives (OS-1B
 * §15).
 *
 * <h2>Atomic capture (OS-1D final review recovery)</h2>
 *
 * <p>{@code generation}/{@code server}/{@code token}/{@code caPath}
 * (and, for {@link #discoverPods()}, {@code scope}) are captured via
 * exactly one {@link OpenShiftSession#operationSnapshot()} call per
 * discovery method — never through several independent {@code
 * OpenShiftSession} getters, which a reconnect landing between two of
 * them could turn into a hybrid of two different connections. See {@link
 * ConnectionOperationSnapshot}'s own javadoc.
 */
@Service
public class OpenShiftScopeService {

  private final OpenShiftApiClient client;
  private final OpenShiftSession session;

  public OpenShiftScopeService(OpenShiftApiClient client, OpenShiftSession session) {
    this.client = client;
    this.session = session;
  }

  /**
   * Discovers every supported {@link WorkloadKind} in the currently
   * selected project, concurrently. A 401 on any kind aborts the whole
   * operation and expires the session immediately (an invalid token
   * invalidates every subsequent call regardless of kind); every other
   * per-kind failure (403, a genuine 404 meaning "this cluster has no such
   * API", or anything else) is recorded as that kind's own {@link
   * KindOutcome} rather than failing kinds that succeeded (OS-1B §7/§17).
   */
  public Mono<WorkloadDiscovery> discoverWorkloads() {
    // OS-1D final snapshot atomicity recovery - one atomic session read
    // for this whole operation (see ConnectionOperationSnapshot's own
    // javadoc), never several independent generation()/server()/token()/
    // certificateAuthorityPath() calls that a reconnect landing between
    // them could turn into a hybrid of two different connections.
    ConnectionOperationSnapshot connection = requireConnectedWithSelectedProject();
    String namespace = connection.selectedProject();
    long generation = connection.generation();
    URI server = connection.server();
    var token = connection.token();
    var caPath = connection.certificateAuthorityPath();

    List<Mono<KindAttempt>> attempts = new ArrayList<>();
    for (WorkloadKind kind : WorkloadKind.values()) {
      attempts.add(client.fetchWorkloads(server, token, caPath, kind, namespace)
          .map(summaries -> new KindAttempt(kind, summaries, KindOutcome.Status.AVAILABLE, null))
          .onErrorResume(OpenShiftApiException.class, e -> {
            if (e.kind() == Kind.UNAUTHORIZED) {
              return Mono.error(e);
            }
            KindOutcome.Status status = e.kind() == Kind.NOT_FOUND
                ? KindOutcome.Status.UNAVAILABLE_RESOURCE_TYPE
                : e.kind() == Kind.FORBIDDEN ? KindOutcome.Status.FORBIDDEN : KindOutcome.Status.ERROR;
            return Mono.just(new KindAttempt(kind, List.of(), status, e));
          }));
    }

    return Flux.merge(attempts)
        .collectList()
        .map(results -> {
          results.sort(Comparator.comparing(r -> r.kind().ordinal()));
          List<WorkloadSummary> workloads = new ArrayList<>();
          List<KindOutcome> outcomes = new ArrayList<>();
          for (KindAttempt result : results) {
            outcomes.add(new KindOutcome(result.kind(), result.status()));
            workloads.addAll(result.workloads());
          }
          workloads.sort(Comparator
              .comparing((WorkloadSummary w) -> w.ref().kind().ordinal())
              .thenComparing(w -> w.ref().name()));
          return new WorkloadDiscovery(List.copyOf(workloads), List.copyOf(outcomes));
        })
        .flatMap(discovery -> {
          if (!session.updateWorkloads(discovery.workloads(), discovery.kindOutcomes(), namespace, generation)) {
            return Mono.error(new StaleScopeException());
          }
          return Mono.just(discovery);
        })
        .onErrorMap(OpenShiftApiException.class, e -> {
          if (e.kind() == Kind.UNAUTHORIZED && session.generation() == generation) {
            session.markExpired();
          }
          return e;
        });
  }

  private record KindAttempt(
      WorkloadKind kind, List<WorkloadSummary> workloads, KindOutcome.Status status, OpenShiftApiException error) {}

  /**
   * Commits a workload selection, rejecting one the last {@link
   * #discoverWorkloads()} call never returned (OS-1B §13).
   *
   * @return whether the selection was applied
   */
  public boolean selectWorkload(WorkloadRef ref) {
    return session.selectWorkload(ref, session.generation());
  }

  /**
   * Resolves pods for the currently-selected workload, or - when no
   * workload is selected ("All workloads", OS-1B §22) - the union of pods
   * belonging to every currently-discovered <b>supported</b> workload in
   * the current project.
   *
   * <p><b>"All workloads" never means "every pod in the namespace"</b>
   * (OS-1B review recovery - the defect this method now closes). A pod
   * owned by a {@code Job}, a {@code CronJob}, an unsupported workload
   * kind, an operator/controller, or a standalone pod with no supported
   * owner at all, is never included merely because it happens to live in
   * the selected namespace - it is included only if it is proven to
   * belong to one of the workloads {@link #discoverWorkloads()} actually
   * returned, via that workload's own label selector (the same selector-
   * based evidence already used for a single selected workload - never a
   * pod-name guess, never an owner-reference chase that would need
   * unbounded extra calls).
   *
   * <p>For a selected workload this is exactly two calls: one to re-read
   * its current selector, one namespace-scoped pod list filtered by that
   * selector (OS-1B §9/§18). For "All workloads" this is exactly one call
   * per currently-discovered supported workload (its selector is already
   * known from {@link #discoverWorkloads()} - see {@link
   * WorkloadSummary#selector()} - so no separate selector re-read is
   * needed there), run concurrently - never a call per pod, and never a
   * cluster- or namespace-wide unfiltered listing. Robust to rolling
   * deployments by construction in both cases, since an old and a new
   * ReplicaSet's pods both still carry the Deployment's own selector
   * labels.
   *
   * <p>{@link PodDiscovery#status()} is {@code PARTIAL} for "All
   * workloads" when the workload set itself is known to be incomplete
   * (a supported kind is {@code FORBIDDEN}/{@code ERROR} - see {@link
   * OpenShiftScope#workloadScopeComplete()}) or when any individual
   * workload's own pod-selector fetch failed - in either case the
   * returned list is never silently widened to compensate; it is exactly
   * the pods that could be proven to belong to a known workload, reported
   * honestly as possibly incomplete (OS-1B §5/§6 of this recovery).
   */
  public Mono<PodDiscovery> discoverPods() {
    // OS-1D final snapshot atomicity recovery - one atomic session read,
    // same as discoverWorkloads() above.
    ConnectionOperationSnapshot connection = requireConnectedWithSelectedProject();
    String namespace = connection.selectedProject();
    OpenShiftScope scope = connection.scope();
    WorkloadRef selectedWorkload = scope.selectedWorkload();
    long generation = connection.generation();
    URI server = connection.server();
    var token = connection.token();
    var caPath = connection.certificateAuthorityPath();

    Mono<PodDiscovery> discovery = selectedWorkload != null
        ? client.fetchWorkloadSelector(server, token, caPath, selectedWorkload)
            .flatMap(selector -> client.fetchPods(server, token, caPath, namespace, selector, selectedWorkload))
            .map(pods -> new PodDiscovery(pods, PodDiscovery.Status.COMPLETE))
        : discoverAllWorkloadsPods(server, token, caPath, namespace, scope);

    return discovery
        .flatMap(result -> {
          boolean complete = result.status() == PodDiscovery.Status.COMPLETE;
          if (!session.updatePods(result.pods(), complete, namespace, selectedWorkload, generation)) {
            return Mono.error(new StaleScopeException());
          }
          return Mono.just(result);
        })
        .onErrorMap(OpenShiftApiException.class, e -> {
          if (e.kind() == Kind.UNAUTHORIZED && session.generation() == generation) {
            session.markExpired();
          }
          return e;
        });
  }

  private Mono<PodDiscovery> discoverAllWorkloadsPods(
      URI server, RawToken token, String caPath, String namespace, OpenShiftScope scope) {
    // OS-1D final snapshot atomicity recovery - `scope` is the caller's
    // (discoverPods') own already-captured operation snapshot field,
    // never a fresh session.scope() read here.
    List<WorkloadSummary> supportedWorkloads = scope.workloads();
    boolean workloadSetComplete = scope.workloadScopeComplete();

    if (supportedWorkloads.isEmpty()) {
      // Nothing to union - genuinely zero known supported workloads. If
      // that is itself only a partial truth (a kind is forbidden/erroring),
      // say so rather than reporting a confident empty result.
      return Mono.just(new PodDiscovery(List.of(),
          workloadSetComplete ? PodDiscovery.Status.COMPLETE : PodDiscovery.Status.PARTIAL));
    }

    List<Mono<WorkloadPodAttempt>> attempts = supportedWorkloads.stream()
        .map(workload -> client.fetchPods(server, token, caPath, namespace, workload.selector(), workload.ref())
            .map(pods -> new WorkloadPodAttempt(pods, true))
            .onErrorResume(OpenShiftApiException.class, e -> {
              if (e.kind() == Kind.UNAUTHORIZED) {
                return Mono.error(e);
              }
              // This one workload's pods could not be resolved (403/429/
              // 5xx/network/etc.) - excluded, not fabricated, and the
              // overall result is marked PARTIAL below.
              return Mono.just(new WorkloadPodAttempt(List.of(), false));
            }))
        .toList();

    return Flux.merge(attempts)
        .collectList()
        .map(results -> {
          boolean everyAttemptSucceeded = results.stream().allMatch(WorkloadPodAttempt::succeeded);
          // De-duplicated by pod name: a pod that happened to match more
          // than one supported workload's selector is kept once, attributed
          // to whichever workload's fetch reached it first (deterministic,
          // since supportedWorkloads is already sorted kind-then-name).
          Map<String, PodSummary> byName = new LinkedHashMap<>();
          for (WorkloadPodAttempt attempt : results) {
            for (PodSummary pod : attempt.pods()) {
              byName.putIfAbsent(pod.name(), pod);
            }
          }
          List<PodSummary> merged = new ArrayList<>(byName.values());
          merged.sort(Comparator.comparing(PodSummary::name));
          boolean complete = workloadSetComplete && everyAttemptSucceeded;
          return new PodDiscovery(List.copyOf(merged), complete ? PodDiscovery.Status.COMPLETE
              : PodDiscovery.Status.PARTIAL);
        });
  }

  private record WorkloadPodAttempt(List<PodSummary> pods, boolean succeeded) {}

  /**
   * Commits a pod selection, rejecting one the last {@link
   * #discoverPods()} call never returned (OS-1B §13).
   *
   * @return whether the selection was applied
   */
  public boolean selectPod(String podName) {
    return session.selectPod(podName, session.generation());
  }

  /**
   * Runtime container names for the currently-selected pod, read from the
   * pod summary already cached by the last {@link #discoverPods()} call -
   * no extra network call, and no risk of it disagreeing with the pod list
   * the user is actually looking at (OS-1B §11/§18). Returns an empty list
   * when no pod is selected.
   */
  public List<String> discoverContainers() {
    String selectedPod = session.scope().selectedPod();
    if (selectedPod == null) {
      return List.of();
    }
    PodSummary pod = session.scope().findPod(selectedPod);
    List<String> containers = pod != null ? pod.containerNames() : List.of();
    session.updateContainers(containers, selectedPod, session.generation());
    return containers;
  }

  /**
   * Commits a container selection, rejecting one the current pod's
   * container list never returned (OS-1B §13).
   *
   * @return whether the selection was applied
   */
  public boolean selectContainer(String containerName) {
    return session.selectContainer(containerName, session.generation());
  }

  /**
   * OS-1D final snapshot atomicity recovery - captures and validates the
   * connection state in one atomic read, replacing the previous {@code
   * requireSelectedProject()} (which called {@code session.isConnected()}
   * then {@code session.selectedProject()} as two separate live reads).
   */
  private ConnectionOperationSnapshot requireConnectedWithSelectedProject() {
    ConnectionOperationSnapshot connection = session.operationSnapshot();
    if (!connection.isConnected()) {
      throw new IllegalStateException("Not connected to OpenShift.");
    }
    if (connection.selectedProject() == null) {
      throw new IllegalStateException("No project/namespace selected.");
    }
    return connection;
  }

  /** A workload/pod/container discovery result belonged to a scope that has since changed. */
  public static class StaleScopeException extends RuntimeException {
    public StaleScopeException() {
      super("The OpenShift project or workload selection changed while this request was in flight.");
    }
  }
}
