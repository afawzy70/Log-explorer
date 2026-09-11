package com.logexplorer.source.openshift;

import com.logexplorer.source.openshift.OpenShiftApiException.Kind;
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

    return client
        .fetchProjects(command.server(), command.token(), command.certificateAuthorityPath())
        .onErrorResume(OpenShiftApiException.class, e -> fallbackToNamespacesIfAppropriate(command, e))
        .flatMap(discovery -> client
            .fetchUsername(command.server(), command.token(), command.certificateAuthorityPath())
            .defaultIfEmpty(Optional.empty())
            .map(username -> {
              session.connect(
                  command, connectionName, username.orElse(null), discovery.projects(), proxyDisplay);
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
   * OS-1A §16 - the namespaces fallback, used only when the cluster
   * genuinely has no OpenShift Projects API (a vanilla Kubernetes API
   * server answers 404 for that API group, which arrives here as
   * {@link Kind#MALFORMED_RESPONSE}).
   *
   * <p>A {@code 403} is <b>never</b> retried this way. "You may not list
   * projects" is a real, specific answer about a real API; silently asking
   * a different API instead would convert a permission truth into an
   * availability guess, and could then report "no accessible projects"
   * from a namespaces call that is also forbidden.
   */
  private Mono<ProjectDiscovery> fallbackToNamespacesIfAppropriate(
      OcLoginCommand command, OpenShiftApiException failure) {
    if (failure.kind() != Kind.MALFORMED_RESPONSE) {
      return Mono.error(failure);
    }
    return client
        .fetchNamespaces(command.server(), command.token(), command.certificateAuthorityPath())
        // If the fallback also fails, report the ORIGINAL failure: the
        // user asked to connect to OpenShift, and "the Projects API did
        // not work" is the more useful truth than a second-order error
        // from an API they never chose.
        .onErrorResume(secondary -> Mono.error(failure));
  }

  /** Clears the session, including the token. */
  public void disconnect() {
    session.disconnect();
  }

  /**
   * Re-runs project discovery for the <i>current</i> connection.
   *
   * <p>Guarded by the session generation: if the connection is replaced
   * while this call is in flight, the late result is discarded rather than
   * applied to the new connection (OS-1A §27 - the same stale-response
   * class of bug UX-R6 root-caused for source-scoped discovery).
   */
  public Mono<ProjectDiscovery> refreshProjects() {
    if (!session.isConnected()) {
      return Mono.error(new IllegalStateException("Not connected to OpenShift."));
    }
    long generation = session.generation();
    var server = session.server();
    var token = session.token();
    var caPath = session.certificateAuthorityPath();

    return client
        .fetchProjects(server, token, caPath)
        .flatMap(discovery -> {
          // Apply under the same generation the call started with. If the
          // connection was replaced meanwhile, this result belongs to a
          // connection that no longer exists and is discarded.
          if (!session.updateProjects(discovery.projects(), generation)) {
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
