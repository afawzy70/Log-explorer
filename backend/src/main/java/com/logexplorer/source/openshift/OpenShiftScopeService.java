package com.logexplorer.source.openshift;

import com.logexplorer.source.openshift.OpenShiftApiException.Kind;
import com.logexplorer.source.openshift.WorkloadDiscovery.KindOutcome;
import java.net.URI;
import java.util.ArrayList;
import java.util.Comparator;
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
    String namespace = requireSelectedProject();
    long generation = session.generation();
    URI server = session.server();
    var token = session.token();
    var caPath = session.certificateAuthorityPath();

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
          if (!session.updateWorkloads(discovery.workloads(), namespace, generation)) {
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
   * workload is selected ("All workloads", OS-1B §22) - every pod in the
   * current project. For a selected workload this is exactly two calls:
   * one to re-read its current selector, one namespace-scoped pod list
   * filtered by that selector (OS-1B §9/§18) - never a call per pod, and
   * robust to rolling deployments by construction, since an old and a new
   * ReplicaSet's pods both still carry the Deployment's own selector
   * labels.
   */
  public Mono<List<PodSummary>> discoverPods() {
    String namespace = requireSelectedProject();
    WorkloadRef selectedWorkload = session.scope().selectedWorkload();
    long generation = session.generation();
    URI server = session.server();
    var token = session.token();
    var caPath = session.certificateAuthorityPath();

    Mono<List<PodSummary>> pods = selectedWorkload == null
        ? client.fetchPods(server, token, caPath, namespace, Map.of(), null)
        : client.fetchWorkloadSelector(server, token, caPath, selectedWorkload)
            .flatMap(selector -> client.fetchPods(server, token, caPath, namespace, selector, selectedWorkload));

    return pods
        .flatMap(result -> {
          if (!session.updatePods(result, selectedWorkload, generation)) {
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

  /** A workload/pod/container discovery result belonged to a scope that has since changed. */
  public static class StaleScopeException extends RuntimeException {
    public StaleScopeException() {
      super("The OpenShift project or workload selection changed while this request was in flight.");
    }
  }
}
