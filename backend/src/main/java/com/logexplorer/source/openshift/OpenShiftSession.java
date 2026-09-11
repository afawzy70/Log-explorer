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
      String selectedProject,
      String proxyDisplay,
      long generation) {}

  private static final Snapshot EMPTY =
      new Snapshot(OpenShiftConnectionState.DISCONNECTED, null, RawToken.empty(), null, null, null, List.of(), null, null, 0L);

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

  public String selectedProject() {
    return current.get().selectedProject();
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
   */
  public long connect(
      OcLoginCommand command, String connectionName, String username, List<String> projects, String proxyDisplay) {
    return current
        .updateAndGet(previous -> new Snapshot(
            OpenShiftConnectionState.CONNECTED,
            command.server(),
            command.token(),
            command.certificateAuthorityPath(),
            connectionName,
            username,
            List.copyOf(projects),
            null, // a new connection never inherits the previous selection
            proxyDisplay,
            previous.generation() + 1))
        .generation();
  }

  /**
   * Replaces the visible project list for the <i>current</i> connection,
   * but only if {@code generation} still matches - a refresh belonging to
   * a connection that has since been replaced must not land on the new
   * one. The generation itself is deliberately NOT bumped: this is the
   * same connection, just newer information about it.
   *
   * @return whether the update was applied
   */
  public boolean updateProjects(List<String> projects, long generation) {
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
      return new Snapshot(
          previous.state(),
          previous.server(),
          previous.token(),
          previous.certificateAuthorityPath(),
          previous.connectionName(),
          previous.username(),
          List.copyOf(projects),
          selected,
          previous.proxyDisplay(),
          previous.generation());
    });
    return updated.generation() == generation && updated.projects().equals(List.copyOf(projects));
  }

  /** Clears everything, including the token. Increments the generation. */
  public void disconnect() {
    current.updateAndGet(previous -> new Snapshot(
        OpenShiftConnectionState.DISCONNECTED, null, RawToken.empty(), null, null, null, List.of(), null, null,
        previous.generation() + 1));
  }

  /**
   * The cluster rejected the token (401). The token is dropped immediately
   * - keeping a credential the cluster has already refused serves no
   * purpose and only widens exposure.
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
        previous.proxyDisplay(),
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
      return new Snapshot(
          previous.state(),
          previous.server(),
          previous.token(),
          previous.certificateAuthorityPath(),
          previous.connectionName(),
          previous.username(),
          previous.projects(),
          project,
          previous.proxyDisplay(),
          previous.generation());
    });
    return updated.generation() == generation && java.util.Objects.equals(updated.selectedProject(), project);
  }

  @Override
  public String toString() {
    Snapshot snapshot = current.get();
    return "OpenShiftSession[state=" + snapshot.state()
        + ", server=" + serverDisplay()
        + ", token=[REDACTED]"
        + ", projects=" + snapshot.projects().size()
        + ", generation=" + snapshot.generation()
        + "]";
  }
}
