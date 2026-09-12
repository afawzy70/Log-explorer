package com.logexplorer.source.openshift;

import com.logexplorer.core.model.RawToken;
import java.net.URI;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.springframework.stereotype.Component;

/**
 * The single, in-memory OpenShift connection for this application run
 * (OS-1A §5/§9, OS-A decision 1: one active connection; multi-cluster is
 * out of scope).
 *
 * <h2>Token lifetime</h2>
 *
 * <p>The bearer token lives <b>only here, only in memory, only for this
 * process</b>. It is never written to disk, never returned by any
 * endpoint, never placed in a URL, and never serialised into a settings
 * response. It is held as a {@link RawToken}, whose {@code toString()} is
 * a fixed redacted string, so even an accidental {@code log.info("{}",
 * session)} cannot leak it - this class's own {@link #toString()} is
 * redacted for the same reason.
 *
 * <h2>Generation counter</h2>
 *
 * <p>{@link #generation()} increments on every connect and disconnect.
 * Callers capture it before an async call and re-check it before applying
 * the result, so a slow response belonging to a <i>previous</i> connection
 * can never be written into the current one. This is the same protection
 * UX-R6 added for source-scoped discovery after a stale Docker response
 * overwrote Fixture's service list - the lesson generalises, and a
 * credentialled connection is a worse place to relearn it.
 *
 * <h2>Discovery mode is part of the session's truth (OS-1A review recovery #2)</h2>
 *
 * <p>{@link #discoveryApi()} records whether the currently-visible scope
 * list came from OpenShift's own {@code Projects} API or the Kubernetes
 * {@code namespaces} fallback ({@link ProjectDiscovery.Api}). This is
 * stored explicitly, never inferred from list contents, because the two
 * modes are not visually or structurally distinguishable from the names
 * alone - only the API that answered knows which one actually happened.
 * Presenting a namespace-fallback result as if it were a native Projects
 * response would misrepresent what the cluster actually supports.
 *
 * <p>It is set on {@link #connect}, kept current by {@link
 * #updateProjects} (a refresh may legitimately observe a different mode
 * than the one recorded at connect time - see {@code
 * OpenShiftConnectionService#discoverProjectsOrNamespaces}), and cleared
 * on {@link #disconnect} and {@link #markExpired}: once there is no live,
 * trusted connection, there is no current discovery mode to report either.
 *
 * <h2>Atomic operation snapshot (OS-1D final review recovery)</h2>
 *
 * <p>{@link #operationSnapshot()} is the one atomic read every
 * authenticated OpenShift operation must use to capture the state it
 * will act on — never several independent getter calls stitched
 * together, which a reconnect landing in between could turn into a
 * hybrid of two different connections (generation from one, server/token
 * from another). See {@link ConnectionOperationSnapshot}'s own javadoc
 * for the full rationale.
 *
 * <h2>Workload/pod/container scope (OS-1B)</h2>
 *
 * <p>{@link #scope()} carries everything below the selected project -
 * discovered workloads/pods/containers and the current selection at each
 * level - as one {@link OpenShiftScope} value. It is replaced wholesale
 * with {@link OpenShiftScope#EMPTY} whenever the project selection
 * actually changes ({@link #selectProject}), whenever the project list
 * itself causes the current selection to be cleared ({@link
 * #updateProjects}), and on {@link #connect}, {@link #disconnect} and
 * {@link #markExpired} - a workload/pod/container from a different
 * project, or from before a reconnect, is never carried forward (OS-1B
 * §14). Within one project, {@link OpenShiftScope}'s own {@code with*}
 * methods own the finer-grained workload→pod→container cascade.
 */
@Component
public class OpenShiftSession {

  /** All mutable state in one immutable snapshot, swapped atomically. */
  private record Snapshot(
      OpenShiftConnectionState state,
      URI server,
      RawToken token,
      String certificateAuthorityPath,
      String connectionName,
      String username,
      List<String> projects,
      ProjectDiscovery.Api discoveryApi,
      String selectedProject,
      String proxyDisplay,
      OpenShiftScope scope,
      long generation) {}

  private static final Snapshot EMPTY = new Snapshot(
      OpenShiftConnectionState.DISCONNECTED, null, RawToken.empty(), null, null, null, List.of(), null, null, null,
      OpenShiftScope.EMPTY, 0L);

  private final AtomicReference<Snapshot> current = new AtomicReference<>(EMPTY);

  public OpenShiftConnectionState state() {
    return current.get().state();
  }

  public long generation() {
    return current.get().generation();
  }

  public boolean isConnected() {
    return current.get().state() == OpenShiftConnectionState.CONNECTED;
  }

  public URI server() {
    return current.get().server();
  }

  public String certificateAuthorityPath() {
    return current.get().certificateAuthorityPath();
  }

  public String connectionName() {
    return current.get().connectionName();
  }

  public String username() {
    return current.get().username();
  }

  public List<String> projects() {
    return current.get().projects();
  }

  /**
   * Whether the currently-visible scope list came from OpenShift's own
   * Projects API or the Kubernetes namespaces fallback - {@code null}
   * when there is no current, trusted connection to have a mode at all
   * (disconnected or expired). Never inferred from {@link #projects()}'s
   * contents - only the API that actually answered knows which mode
   * applies.
   */
  public ProjectDiscovery.Api discoveryApi() {
    return current.get().discoveryApi();
  }

  public String selectedProject() {
    return current.get().selectedProject();
  }

  /** The current workload/pod/container scope beneath the selected project (OS-1B). Never {@code null}. */
  public OpenShiftScope scope() {
    return current.get().scope();
  }

  public String proxyDisplay() {
    return current.get().proxyDisplay();
  }

  /**
   * The token, for the API client only. Deliberately package-private
   * rather than public: nothing outside this package has any business
   * holding it, and keeping the accessor narrow is what makes "no
   * readback" reviewable rather than merely intended.
   */
  RawToken token() {
    return current.get().token();
  }

  /**
   * OS-1D final snapshot atomicity recovery — the one atomic read every
   * authenticated OpenShift operation (search, context-target
   * authorization, workload/pod/container discovery, project refresh)
   * must use instead of several independent getter calls. Reads {@link
   * #current} exactly once and projects every connection-sensitive field
   * from that SAME value into a {@link ConnectionOperationSnapshot} — so
   * a reconnect landing between what would otherwise be two separate
   * getter calls can never produce a hybrid pre-/post-reconnect operation
   * state (generation from one connection paired with a server/token from
   * another). This is the fix for the exact defect the individual getters
   * above ({@link #generation()}, {@link #server()}, {@link #token()},
   * {@link #certificateAuthorityPath()}, {@link #selectedProject()},
   * {@link #scope()}) each remain correct for on their own (a single
   * value, read once) but were never safe to combine across multiple
   * calls into one logical operation's state.
   */
  ConnectionOperationSnapshot operationSnapshot() {
    Snapshot snapshot = current.get();
    return new ConnectionOperationSnapshot(
        snapshot.state(), snapshot.generation(), snapshot.server(), snapshot.token(),
        snapshot.certificateAuthorityPath(), snapshot.selectedProject(), snapshot.scope());
  }

  /** Host:port of the API server - safe for display and logs. */
  public String serverDisplay() {
    URI server = current.get().server();
    if (server == null) {
      return null;
    }
    return server.getPort() == -1 ? server.getHost() : server.getHost() + ":" + server.getPort();
  }

  /**
   * Establishes a new connection, replacing (and thereby discarding) any
   * previous token. Returns the new generation.
   *
   * @param discoveryApi which API answered project discovery for THIS
   *     connection attempt (OS-1A review recovery #2) - stored verbatim,
   *     never re-derived later from list contents.
   */
  public long connect(
      OcLoginCommand command,
      String connectionName,
      String username,
      List<String> projects,
      ProjectDiscovery.Api discoveryApi,
      String proxyDisplay) {
    return current
        .updateAndGet(previous -> new Snapshot(
            OpenShiftConnectionState.CONNECTED,
            command.server(),
            command.token(),
            command.certificateAuthorityPath(),
            connectionName,
            username,
            List.copyOf(projects),
            discoveryApi,
            null, // a new connection never inherits the previous selection
            proxyDisplay,
            OpenShiftScope.EMPTY, // nor does it inherit the previous workload/pod/container scope
            previous.generation() + 1))
        .generation();
  }

  /**
   * Replaces the visible project list AND the discovery mode for the
   * <i>current</i> connection, but only if {@code generation} still
   * matches - a refresh belonging to a connection that has since been
   * replaced must not land on the new one. The generation itself is
   * deliberately NOT bumped: this is the same connection, just newer
   * information about it.
   *
   * <p><b>The new {@code discoveryApi} always wins - it is never pinned to
   * whatever mode was recorded before</b> (OS-1A review recovery #2). If a
   * connection started via the namespaces fallback and a later refresh
   * finds the Projects API available, the mode genuinely becomes {@code
   * PROJECTS}; if a connection started on the Projects API and it later
   * starts answering 404, the mode genuinely becomes {@code NAMESPACES}.
   * Truthfulness means reporting what this call actually observed, not
   * defending a stale label.
   *
   * @return whether the update was applied
   */
  public boolean updateProjects(List<String> projects, ProjectDiscovery.Api discoveryApi, long generation) {
    Snapshot updated = current.updateAndGet(previous -> {
      if (previous.generation() != generation || previous.state() != OpenShiftConnectionState.CONNECTED) {
        return previous;
      }
      // A selection the refreshed list no longer contains is cleared
      // rather than silently kept - the project may have been deleted or
      // access revoked (OS-1A §20: "clear it truthfully").
      String selected = previous.selectedProject() != null && projects.contains(previous.selectedProject())
          ? previous.selectedProject()
          : null;
      // OS-1B §14 "Project disappears": if the selection was actually
      // cleared above, the workload/pod/container scope beneath it is
      // meaningless and is cleared too. If the selection is unchanged, the
      // scope is left untouched - only the visible project *list* changed.
      OpenShiftScope scope = java.util.Objects.equals(selected, previous.selectedProject())
          ? previous.scope()
          : OpenShiftScope.EMPTY;
      return new Snapshot(
          previous.state(),
          previous.server(),
          previous.token(),
          previous.certificateAuthorityPath(),
          previous.connectionName(),
          previous.username(),
          List.copyOf(projects),
          discoveryApi,
          selected,
          previous.proxyDisplay(),
          scope,
          previous.generation());
    });
    return updated.generation() == generation
        && updated.projects().equals(List.copyOf(projects))
        && updated.discoveryApi() == discoveryApi;
  }

  /**
   * Clears everything, including the token and the discovery mode.
   * Increments the generation.
   */
  public void disconnect() {
    current.updateAndGet(previous -> new Snapshot(
        OpenShiftConnectionState.DISCONNECTED, null, RawToken.empty(), null, null, null, List.of(), null, null, null,
        OpenShiftScope.EMPTY, previous.generation() + 1));
  }

  /**
   * The cluster rejected the token (401). The token is dropped immediately
   * - keeping a credential the cluster has already refused serves no
   * purpose and only widens exposure. The discovery mode is cleared too:
   * once the connection is no longer trusted, there is no current mode to
   * report (OS-1A review recovery #2) - a caller must re-authenticate and
   * re-discover before either question means anything again.
   */
  public void markExpired() {
    current.updateAndGet(previous -> new Snapshot(
        OpenShiftConnectionState.EXPIRED,
        previous.server(),
        RawToken.empty(),
        previous.certificateAuthorityPath(),
        previous.connectionName(),
        previous.username(),
        List.of(),
        null,
        null,
        previous.proxyDisplay(),
        OpenShiftScope.EMPTY,
        previous.generation() + 1));
  }

  /**
   * Records the selected project, but only if {@code generation} still
   * matches - a selection made against a connection that has since been
   * replaced must not land on the new one.
   *
   * @return whether the selection was applied
   */
  public boolean selectProject(String project, long generation) {
    Snapshot updated = current.updateAndGet(previous -> {
      if (previous.generation() != generation || previous.state() != OpenShiftConnectionState.CONNECTED) {
        return previous;
      }
      if (project != null && !previous.projects().contains(project)) {
        return previous; // never select a project this connection cannot see
      }
      // OS-1B §14 "Project changes -> clear Workload/Pod/Container". A
      // no-op reselect of the SAME project leaves a valid deeper scope
      // alone; any actual change wipes it.
      OpenShiftScope scope = java.util.Objects.equals(project, previous.selectedProject())
          ? previous.scope()
          : OpenShiftScope.EMPTY;
      return new Snapshot(
          previous.state(),
          previous.server(),
          previous.token(),
          previous.certificateAuthorityPath(),
          previous.connectionName(),
          previous.username(),
          previous.projects(),
          previous.discoveryApi(), // selecting a project never changes the discovery mode
          project,
          previous.proxyDisplay(),
          scope,
          previous.generation());
    });
    return updated.generation() == generation && java.util.Objects.equals(updated.selectedProject(), project);
  }

  /**
   * Replaces the discovered workload list for the current connection
   * (OS-1B §7/§15), guarded by generation exactly like {@link
   * #updateProjects} - a workload-discovery response belonging to a
   * connection (or project selection - see below) that has since changed
   * must never be applied.
   *
   * <p>{@code expectedProject} is the project the discovery request was
   * actually made against, captured by the caller before firing it. If the
   * user has since switched projects (same connection, same generation),
   * this still must not apply - the generation counter alone only protects
   * against reconnects, not project switches within one connection (OS-1B
   * §15 "Project A workload request -> user switches to Project B -> late
   * A response must not populate B").
   *
   * @return whether the update was applied
   */
  public boolean updateWorkloads(
      List<WorkloadSummary> workloads,
      List<WorkloadDiscovery.KindOutcome> kindOutcomes,
      String expectedProject,
      long generation) {
    Snapshot updated = current.updateAndGet(previous -> {
      if (previous.generation() != generation
          || previous.state() != OpenShiftConnectionState.CONNECTED
          || !java.util.Objects.equals(previous.selectedProject(), expectedProject)) {
        return previous;
      }
      return withScope(previous, previous.scope().withWorkloads(workloads, kindOutcomes));
    });
    return updated.generation() == generation
        && java.util.Objects.equals(updated.selectedProject(), expectedProject)
        && updated.scope().workloads().equals(List.copyOf(workloads));
  }

  /**
   * Selects a workload (or clears it with {@code null}), rejecting any
   * workload not present in the last discovered list for the current
   * project (OS-1B §13 - never trust the frontend's selection blindly).
   *
   * @return whether the selection was applied
   */
  public boolean selectWorkload(WorkloadRef ref, long generation) {
    Snapshot updated = current.updateAndGet(previous -> {
      if (previous.generation() != generation || previous.state() != OpenShiftConnectionState.CONNECTED) {
        return previous;
      }
      if (ref != null && !previous.scope().hasWorkload(ref)) {
        return previous; // never select a workload this discovery never returned
      }
      return withScope(previous, previous.scope().withSelectedWorkload(ref));
    });
    return updated.generation() == generation && java.util.Objects.equals(updated.scope().selectedWorkload(), ref);
  }

  /**
   * Replaces the discovered pod list, guarded exactly like {@link
   * #updateWorkloads} - by connection generation, by the project the
   * request was actually made against, AND by the workload (or lack of
   * one, for an unscoped "All workloads" discovery) the request was
   * actually made against (OS-1B §15 "Workload A pod request -> user
   * switches to Workload B -> late A pod response must not populate B").
   *
   * <p><b>{@code expectedProject} matters even when {@code
   * expectedWorkload} is {@code null}</b> (OS-1B review recovery). "All
   * workloads" pod resolution for project A and for project B are both
   * represented by {@code expectedWorkload == null} - checking only the
   * workload would let a stale "All workloads" result for project A land
   * on project B the instant the user switches projects, since both
   * states share the same {@code null} selected-workload value. Checking
   * the project explicitly closes that gap.
   *
   * @return whether the update was applied
   */
  public boolean updatePods(
      List<PodSummary> pods, boolean complete, String expectedProject, WorkloadRef expectedWorkload,
      long generation) {
    Snapshot updated = current.updateAndGet(previous -> {
      if (previous.generation() != generation
          || previous.state() != OpenShiftConnectionState.CONNECTED
          || !java.util.Objects.equals(previous.selectedProject(), expectedProject)
          || !java.util.Objects.equals(previous.scope().selectedWorkload(), expectedWorkload)) {
        return previous;
      }
      return withScope(previous, previous.scope().withPods(pods, complete));
    });
    return updated.generation() == generation
        && java.util.Objects.equals(updated.selectedProject(), expectedProject)
        && java.util.Objects.equals(updated.scope().selectedWorkload(), expectedWorkload)
        && updated.scope().pods().equals(List.copyOf(pods));
  }

  /**
   * Selects a pod (or clears it with {@code null}), rejecting any pod not
   * present in the last discovered pod list (OS-1B §13).
   *
   * @return whether the selection was applied
   */
  public boolean selectPod(String podName, long generation) {
    Snapshot updated = current.updateAndGet(previous -> {
      if (previous.generation() != generation || previous.state() != OpenShiftConnectionState.CONNECTED) {
        return previous;
      }
      if (podName != null && previous.scope().findPod(podName) == null) {
        return previous; // never select a pod this discovery never returned
      }
      return withScope(previous, previous.scope().withSelectedPod(podName));
    });
    return updated.generation() == generation && java.util.Objects.equals(updated.scope().selectedPod(), podName);
  }

  /**
   * Replaces the discovered container list for the currently-selected pod
   * (OS-1B §11), guarded by generation and by which pod the caller actually
   * asked about.
   *
   * @return whether the update was applied
   */
  public boolean updateContainers(List<String> containers, String expectedPod, long generation) {
    Snapshot updated = current.updateAndGet(previous -> {
      if (previous.generation() != generation
          || previous.state() != OpenShiftConnectionState.CONNECTED
          || !java.util.Objects.equals(previous.scope().selectedPod(), expectedPod)) {
        return previous;
      }
      return withScope(previous, previous.scope().withContainers(containers));
    });
    return updated.generation() == generation
        && java.util.Objects.equals(updated.scope().selectedPod(), expectedPod)
        && updated.scope().containers().equals(List.copyOf(containers));
  }

  /**
   * Selects a container (or clears it with {@code null}), rejecting any
   * container not present in the last discovered container list (OS-1B
   * §13).
   *
   * @return whether the selection was applied
   */
  public boolean selectContainer(String containerName, long generation) {
    Snapshot updated = current.updateAndGet(previous -> {
      if (previous.generation() != generation || previous.state() != OpenShiftConnectionState.CONNECTED) {
        return previous;
      }
      if (containerName != null && !previous.scope().containers().contains(containerName)) {
        return previous; // never select a container this discovery never returned
      }
      return withScope(previous, previous.scope().withSelectedContainer(containerName));
    });
    return updated.generation() == generation
        && java.util.Objects.equals(updated.scope().selectedContainer(), containerName);
  }

  private static Snapshot withScope(Snapshot previous, OpenShiftScope scope) {
    return new Snapshot(
        previous.state(),
        previous.server(),
        previous.token(),
        previous.certificateAuthorityPath(),
        previous.connectionName(),
        previous.username(),
        previous.projects(),
        previous.discoveryApi(),
        previous.selectedProject(),
        previous.proxyDisplay(),
        scope,
        previous.generation());
  }

  @Override
  public String toString() {
    Snapshot snapshot = current.get();
    return "OpenShiftSession[state=" + snapshot.state()
        + ", server=" + serverDisplay()
        + ", token=[REDACTED]"
        + ", discoveryApi=" + snapshot.discoveryApi()
        + ", projects=" + snapshot.projects().size()
        + ", scope=" + snapshot.scope()
        + ", generation=" + snapshot.generation()
        + "]";
  }
}
