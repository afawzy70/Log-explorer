package com.logexplorer.source.openshift;

import com.logexplorer.core.model.RawToken;
import com.logexplorer.source.openshift.OpenShiftApiException.Kind;
import java.net.URI;
import java.util.Optional;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

/**
 * Orchestrates OpenShift connect / disconnect / project discovery for
 * OS-1A.
 *
 * <p>Holds no state of its own - {@link OpenShiftSession} owns all of it -
 * and never returns the token to any caller.
 */
@Service
public class OpenShiftConnectionService {

  private final OpenShiftApiClient client;
  private final OpenShiftSession session;
  private final LoopbackBindingGuard bindingGuard;

  public OpenShiftConnectionService(
      OpenShiftApiClient client, OpenShiftSession session, LoopbackBindingGuard bindingGuard) {
    this.client = client;
    this.session = session;
    this.bindingGuard = bindingGuard;
  }

  /**
   * Parses the pasted command, validates it against the real cluster, and
   * - only on success - stores the session.
   *
   * <p>Order matters and is deliberate:
   *
   * <ol>
   *   <li><b>Loopback guard first</b>, before the credential is even
   *   parsed. A refused binding must not process the token at all.</li>
   *   <li>Parse (pure, no network).</li>
   *   <li>Discover projects - this doubles as connection validation, so a
   *   connection is only ever recorded as CONNECTED once the cluster has
   *   actually answered.</li>
   *   <li>Resolve identity, which is best-effort and must not fail an
   *   otherwise-valid connection.</li>
   * </ol>
   *
   * <p>A failed attempt never disturbs an existing good session: the
   * session is written only on success.
   *
   * <p><b>Discovery mode is recorded, not just the list</b> (OS-1A review
   * recovery #2). {@link #discoverProjectsOrNamespaces} returns which API
   * actually answered, and that mode is stored in the session alongside
   * the project list - it is what lets {@code GET /connection} keep
   * reporting {@code NAMESPACES} truthfully long after the connect
   * response itself has been forgotten by the caller.
   */
  public Mono<OpenShiftSession> connect(String pastedCommand, String connectionName) {
    bindingGuard.requireLoopback();

    OcLoginCommand command;
    try {
      command = OcLoginCommandParser.parse(pastedCommand);
    } catch (OcLoginParseException e) {
      return Mono.error(e);
    }

    String proxyDisplay = client.proxyFor(command.server()).map(ProxyRoute::display).orElse(null);

    return discoverProjectsOrNamespaces(
            command.server(), command.token(), command.certificateAuthorityPath())
        .flatMap(discovery -> client
            .fetchUsername(command.server(), command.token(), command.certificateAuthorityPath())
            .defaultIfEmpty(Optional.empty())
            .map(username -> {
              session.connect(
                  command, connectionName, username.orElse(null), discovery.projects(), discovery.api(),
                  proxyDisplay);
              return session;
            }))
        .onErrorMap(OpenShiftApiException.class, e -> {
          if (e.kind() == Kind.UNAUTHORIZED) {
            // Never leave a rejected credential in memory.
            session.markExpired();
          }
          return e;
        });
  }

  /**
   * The one authoritative discovery policy (OS-1A review recovery #2 §3):
   * try OpenShift's own Projects API first, and fall back to Kubernetes
   * namespaces <b>only</b> when that call fails with a genuine HTTP 404
   * ({@link Kind#NOT_FOUND}). Both {@link #connect} and {@link
   * #refreshProjects} call this and only this - the fallback decision is
   * never duplicated, so the 404-only invariant cannot drift between the
   * two call sites the way it previously did (initial connect had the
   * fallback; refresh did not call it at all).
   *
   * <p>Package-private rather than private for the same reason as {@link
   * #fallbackToNamespaces}: it is tested directly against a deterministic
   * fake server, independent of the https-only public front door.
   */
  Mono<ProjectDiscovery> discoverProjectsOrNamespaces(URI server, RawToken token, String caPath) {
    return client
        .fetchProjects(server, token, caPath)
        .onErrorResume(OpenShiftApiException.class, e -> fallbackToNamespaces(server, token, caPath, e));
  }

  /**
   * OS-1A §16 - the namespaces fallback, used only when the cluster
   * genuinely has no OpenShift Projects API (a vanilla Kubernetes API
   * server answers 404 for that API group, which arrives here as
   * {@link Kind#NOT_FOUND} - and ONLY that kind).
   *
   * <p>A {@code 403} is <b>never</b> retried this way. "You may not list
   * projects" is a real, specific answer about a real API; silently asking
   * a different API instead would convert a permission truth into an
   * availability guess, and could then report "no accessible projects"
   * from a namespaces call that is also forbidden.
   *
   * <p><b>Review correction (OS-1A recovery #1).</b> This previously
   * guarded on {@code Kind.MALFORMED_RESPONSE}, which every non-401/403
   * HTTP status fell into - so a busy or failing cluster (429
   * rate-limited, 500/502/503 upstream errors) could be misread as "no
   * Projects API" and silently retried against namespaces instead of
   * surfacing the real failure. {@link Kind#NOT_FOUND} exists specifically
   * so this guard can be exact: a cluster/server failure must never be
   * reinterpreted as "the Projects API does not exist." <b>This invariant
   * is unchanged by review recovery #2</b> - only the call sites that
   * reach it were unified.
   */
  // Package-private rather than private: OS-1A review recovery tests this
  // decision directly, against constructed OpenShiftApiException Kinds,
  // because the only public front door (connect(String, String)) requires
  // an https:// server per the parser, while the deterministic fake
  // OpenShift API used in tests is a plain JDK HttpServer over http (the
  // same convention as this repo's existing MockLokiServer). Testing the
  // decision in isolation - "does THIS kind trigger fallback" - is more
  // precise than only exercising it end-to-end, and is exactly the level
  // at which the original defect lived.
  Mono<ProjectDiscovery> fallbackToNamespaces(
      URI server, RawToken token, String caPath, OpenShiftApiException failure) {
    if (failure.kind() != Kind.NOT_FOUND) {
      return Mono.error(failure);
    }
    return client
        .fetchNamespaces(server, token, caPath)
        // If the fallback also fails, report the ORIGINAL failure: the
        // user asked to connect to OpenShift, and "the Projects API did
        // not work" is the more useful truth than a second-order error
        // from an API they never chose.
        .onErrorResume(secondary -> Mono.error(failure));
  }

  /** Clears the session, including the token and the discovery mode. */
  public void disconnect() {
    session.disconnect();
  }

  /**
   * Re-runs project discovery for the <i>current</i> connection, using the
   * exact same {@link #discoverProjectsOrNamespaces} policy as {@link
   * #connect} (OS-1A review recovery #2, Defect B) - a connection that
   * legitimately succeeded through the namespaces fallback must not start
   * failing Refresh merely because refresh used to skip the fallback.
   *
   * <p>Guarded by the session generation: if the connection is replaced
   * while this call is in flight, the late result is discarded rather than
   * applied to the new connection (OS-1A §27 - the same stale-response
   * class of bug UX-R6 root-caused for source-scoped discovery). The
   * discovery mode is protected by the exact same guard as the project
   * list - {@link OpenShiftSession#updateProjects} applies both together
   * or neither.
   *
   * <p><b>The freshly-observed mode always wins</b> - a refresh that finds
   * the Projects API newly available (or newly 404) reports that truth
   * rather than defending whatever mode was recorded at connect time.
   */
  public Mono<ProjectDiscovery> refreshProjects() {
    if (!session.isConnected()) {
      return Mono.error(new IllegalStateException("Not connected to OpenShift."));
    }
    long generation = session.generation();
    var server = session.server();
    var token = session.token();
    var caPath = session.certificateAuthorityPath();

    return discoverProjectsOrNamespaces(server, token, caPath)
        .flatMap(discovery -> {
          // Apply under the same generation the call started with. If the
          // connection was replaced meanwhile, this result belongs to a
          // connection that no longer exists and is discarded.
          if (!session.updateProjects(discovery.projects(), discovery.api(), generation)) {
            return Mono.error(new StaleConnectionException());
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

  /** The connection this result belonged to has already been replaced. */
  public static class StaleConnectionException extends RuntimeException {
    public StaleConnectionException() {
      super("The OpenShift connection changed while this request was in flight.");
    }
  }
}
