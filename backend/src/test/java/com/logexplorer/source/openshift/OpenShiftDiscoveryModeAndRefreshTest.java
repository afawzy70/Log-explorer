package com.logexplorer.source.openshift;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

import com.logexplorer.core.model.RawToken;
import com.logexplorer.source.openshift.MockOpenShiftServer.Scenario;
import com.logexplorer.source.openshift.OpenShiftApiException.Kind;
import java.io.IOException;
import java.net.URI;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * OS-1A review recovery #2 - discovery mode preservation and refresh
 * consistency.
 *
 * <h2>Defect A</h2>
 *
 * <p>{@link OpenShiftSession} used to store only the resulting project
 * list, never which API answered. {@code OpenShiftConnectionController}
 * always summarised with a {@code null} discovery, so the mode chosen at
 * connect time was thrown away the instant the connect response was read.
 * A connection that had gone through the namespaces fallback would report
 * {@code projectApi: null} on every later {@code GET /connection}, and the
 * UI could not keep labelling the list "Namespaces" truthfully.
 *
 * <h2>Defect B</h2>
 *
 * <p>{@code refreshProjects()} called {@code client.fetchProjects(...)}
 * directly, bypassing the 404-only namespaces fallback entirely. A
 * connection that legitimately reached {@code CONNECTED} through the
 * fallback would then fail outright on Refresh, because refresh never
 * retried against namespaces the way connect did.
 *
 * <h2>The fix under test here</h2>
 *
 * <p>Both defects are closed by (1) {@link OpenShiftSession} storing a
 * {@link ProjectDiscovery.Api} alongside the project list, and (2) both
 * {@code connect} and {@code refreshProjects} now routing through the one
 * shared {@code OpenShiftConnectionService#discoverProjectsOrNamespaces}
 * policy. This class proves the mode survives the full lifecycle (connect,
 * summary readback, refresh, stale-response protection, selection
 * invalidation, disconnect, expiry) and that refresh applies exactly the
 * same 404-only fallback rule as connect - see {@link
 * OpenShiftConnectionServiceFallbackTest} for the exhaustive per-{@code
 * Kind} proof that the shared policy itself is unchanged.
 */
class OpenShiftDiscoveryModeAndRefreshTest {

  private static final RawToken TOKEN = RawToken.of("sha256~discovery-mode-test-token-01");

  private MockOpenShiftServer server;
  private OpenShiftApiClient client;
  private OpenShiftSession session;
  private OpenShiftConnectionService service;
  private URI base;
  private OcLoginCommand command;

  @BeforeEach
  void setUp() throws IOException {
    server = new MockOpenShiftServer();
    base = URI.create(server.baseUrl());
    command = new OcLoginCommand(base, TOKEN, null);
    client = new OpenShiftApiClient(Map.of());
    session = new OpenShiftSession();
    service = new OpenShiftConnectionService(client, session, new LoopbackBindingGuard("127.0.0.1"));
  }

  @AfterEach
  void tearDown() {
    if (server != null) {
      server.close();
    }
  }

  /** Connects directly against the mock server, bypassing the https-only parser (see class javadoc). */
  private ProjectDiscovery connectViaSharedPolicy() {
    ProjectDiscovery discovery =
        service.discoverProjectsOrNamespaces(base, TOKEN, null).block();
    session.connect(command, "Test", "developer", discovery.projects(), discovery.api(), null);
    return discovery;
  }

  // ------------------------------------------------- INITIAL_CONNECT_*

  @Test
  void initialConnectProjects200ReportsApiProjects() {
    server.setScenario(Scenario.OK);

    ProjectDiscovery discovery = connectViaSharedPolicy();

    assertThat(discovery.api()).isEqualTo(ProjectDiscovery.Api.PROJECTS);
    assertThat(session.discoveryApi()).isEqualTo(ProjectDiscovery.Api.PROJECTS);
    assertThat(server.namespacesRequestCount()).isZero();
  }

  @Test
  void initialConnectProjects404NamespacesReportsApiNamespaces() {
    server.setScenario(Scenario.NO_PROJECTS_API_404);

    ProjectDiscovery discovery = connectViaSharedPolicy();

    assertThat(discovery.api()).isEqualTo(ProjectDiscovery.Api.NAMESPACES);
    assertThat(session.discoveryApi()).isEqualTo(ProjectDiscovery.Api.NAMESPACES);
    assertThat(server.namespacesRequestCount()).isEqualTo(1);
  }

  // --------------------------------------- CONNECTION_SUMMARY / GET_CONNECTION

  @Test
  void connectionSummaryAfterNamespaceFallbackStillReportsNamespaces() {
    server.setScenario(Scenario.NO_PROJECTS_API_404);
    connectViaSharedPolicy();

    // Simulates the controller's summarize(null) path used by every
    // endpoint except connect/refresh themselves - it must fall back to
    // the session's persisted mode rather than reporting null.
    assertThat(session.discoveryApi()).isEqualTo(ProjectDiscovery.Api.NAMESPACES);
  }

  @Test
  void getConnectionAfterNamespaceFallbackStillReportsNamespaces() {
    server.setScenario(Scenario.NO_PROJECTS_API_404);
    connectViaSharedPolicy();

    // A second, independent readback (as GET /connection would do, with no
    // discovery of its own in flight) must see the same persisted truth.
    assertThat(session.discoveryApi()).isEqualTo(ProjectDiscovery.Api.NAMESPACES);
    assertThat(session.projects()).containsExactly("fallback-ns-a", "fallback-ns-b");
  }

  // -------------------------------------------------------- REFRESH_*

  @Test
  void refreshProjects200ReportsProjects() {
    server.setScenario(Scenario.OK);
    connectViaSharedPolicy();
    server.setScenario(Scenario.OK); // still answering normally at refresh time

    ProjectDiscovery refreshed = service.refreshProjects().block();

    assertThat(refreshed.api()).isEqualTo(ProjectDiscovery.Api.PROJECTS);
    assertThat(session.discoveryApi()).isEqualTo(ProjectDiscovery.Api.PROJECTS);
  }

  @Test
  void refreshProjects404NamespacesReportsNamespaces() {
    // Connected while the Projects API was still healthy...
    server.setScenario(Scenario.OK);
    connectViaSharedPolicy();
    assertThat(session.discoveryApi()).isEqualTo(ProjectDiscovery.Api.PROJECTS);

    // ...but the Projects API has since started 404ing. Refresh must apply
    // the exact same fallback policy connect would have applied fresh -
    // this is Defect B: refresh used to call fetchProjects() directly and
    // never attempted this fallback at all.
    server.setScenario(Scenario.NO_PROJECTS_API_404);

    ProjectDiscovery refreshed = service.refreshProjects().block();

    assertThat(refreshed.api()).isEqualTo(ProjectDiscovery.Api.NAMESPACES);
    assertThat(session.discoveryApi()).isEqualTo(ProjectDiscovery.Api.NAMESPACES);
    assertThat(server.namespacesRequestCount()).isEqualTo(1);
  }

  @Test
  void refreshMovingFromNamespacesBackToProjectsLetsTheFreshModeWin() {
    // Connected via the namespaces fallback...
    server.setScenario(Scenario.NO_PROJECTS_API_404);
    connectViaSharedPolicy();
    assertThat(session.discoveryApi()).isEqualTo(ProjectDiscovery.Api.NAMESPACES);

    // ...and the Projects API becomes available again. The refresh must
    // NOT pin the stale NAMESPACES label - the fresh observation wins.
    server.setScenario(Scenario.OK);

    ProjectDiscovery refreshed = service.refreshProjects().block();

    assertThat(refreshed.api()).isEqualTo(ProjectDiscovery.Api.PROJECTS);
    assertThat(session.discoveryApi()).isEqualTo(ProjectDiscovery.Api.PROJECTS);
  }

  @Test
  void refreshProjects403NeverFallsBack() {
    server.setScenario(Scenario.OK);
    connectViaSharedPolicy();
    server.setScenario(Scenario.FORBIDDEN_403);

    OpenShiftApiException e =
        catchThrowableOfType(() -> service.refreshProjects().block(), OpenShiftApiException.class);

    assertThat(e.kind()).isEqualTo(Kind.FORBIDDEN);
    assertThat(server.namespacesRequestCount()).isZero();
    // The prior, still-valid discovery mode is left untouched by a failed refresh.
    assertThat(session.discoveryApi()).isEqualTo(ProjectDiscovery.Api.PROJECTS);
  }

  @Test
  void refreshProjects401NeverFallsBackAndExpiresTheSession() {
    server.setScenario(Scenario.OK);
    connectViaSharedPolicy();
    server.setScenario(Scenario.UNAUTHORIZED_401);

    OpenShiftApiException e =
        catchThrowableOfType(() -> service.refreshProjects().block(), OpenShiftApiException.class);

    assertThat(e.kind()).isEqualTo(Kind.UNAUTHORIZED);
    assertThat(server.namespacesRequestCount()).isZero();
    // Existing 401 semantics (session expiration) remain correct after the refactor.
    assertThat(session.state()).isEqualTo(OpenShiftConnectionState.EXPIRED);
    assertThat(session.token().isPresent()).isFalse();
    assertThat(session.discoveryApi()).isNull();
  }

  @Test
  void refreshProjects429NeverFallsBack() {
    server.setScenario(Scenario.OK);
    connectViaSharedPolicy();
    server.setScenario(Scenario.RATE_LIMITED_429);

    OpenShiftApiException e =
        catchThrowableOfType(() -> service.refreshProjects().block(), OpenShiftApiException.class);

    assertThat(e.kind()).isEqualTo(Kind.MALFORMED_RESPONSE);
    assertThat(server.namespacesRequestCount()).isZero();
    assertThat(session.discoveryApi()).isEqualTo(ProjectDiscovery.Api.PROJECTS);
  }

  @Test
  void refreshProjects500NeverFallsBack() {
    server.setScenario(Scenario.OK);
    connectViaSharedPolicy();
    server.setScenario(Scenario.INTERNAL_SERVER_ERROR_500);

    OpenShiftApiException e =
        catchThrowableOfType(() -> service.refreshProjects().block(), OpenShiftApiException.class);

    assertThat(e.kind()).isEqualTo(Kind.MALFORMED_RESPONSE);
    assertThat(server.namespacesRequestCount()).isZero();
    assertThat(session.discoveryApi()).isEqualTo(ProjectDiscovery.Api.PROJECTS);
  }

  @Test
  void refreshProjectsMalformedBodyNeverFallsBack() {
    server.setScenario(Scenario.OK);
    connectViaSharedPolicy();
    server.setScenario(Scenario.MALFORMED_BODY);

    OpenShiftApiException e =
        catchThrowableOfType(() -> service.refreshProjects().block(), OpenShiftApiException.class);

    assertThat(e.kind()).isEqualTo(Kind.MALFORMED_RESPONSE);
    assertThat(server.namespacesRequestCount()).isZero();
    assertThat(session.discoveryApi()).isEqualTo(ProjectDiscovery.Api.PROJECTS);
  }

  @Test
  void refreshNamespaceFallbackThenSelectionInvalidIsClearedTruthfully() {
    server.setScenario(Scenario.OK); // payments, accounts, gateway
    connectViaSharedPolicy();
    assertThat(session.selectProject("payments", session.generation())).isTrue();

    // The Projects API disappears; the namespaces fallback returns a
    // completely different set of names that does not include "payments".
    server.setScenario(Scenario.NO_PROJECTS_API_404);
    ProjectDiscovery refreshed = service.refreshProjects().block();

    assertThat(refreshed.api()).isEqualTo(ProjectDiscovery.Api.NAMESPACES);
    assertThat(session.discoveryApi()).isEqualTo(ProjectDiscovery.Api.NAMESPACES);
    // The vanished selection must be cleared truthfully, not silently kept.
    assertThat(session.selectedProject()).isNull();
  }

  @Test
  void staleRefreshFromOldConnectionCannotOverwriteCurrentConnectionOrDiscoveryMode() {
    server.setScenario(Scenario.OK);
    connectViaSharedPolicy();
    long staleGeneration = session.generation();
    ProjectDiscovery staleDiscovery = new ProjectDiscovery(List.of("stale-only"), ProjectDiscovery.Api.NAMESPACES);

    // The connection is replaced (e.g. the user reconnected) while the
    // stale refresh's result is still in flight.
    session.connect(command, "Second", "someone-else", List.of("current-project"), ProjectDiscovery.Api.PROJECTS, null);

    boolean applied = session.updateProjects(staleDiscovery.projects(), staleDiscovery.api(), staleGeneration);

    assertThat(applied).isFalse();
    assertThat(session.projects()).containsExactly("current-project");
    assertThat(session.discoveryApi()).isEqualTo(ProjectDiscovery.Api.PROJECTS);
  }

  @Test
  void aStaleRefreshInFlightThroughTheServiceThrowsRatherThanOverwriting() {
    server.setScenario(Scenario.OK);
    connectViaSharedPolicy();
    long originalGeneration = session.generation();

    // Simulate the connection being replaced between discovery and the
    // generation-guarded write, by advancing the session directly (the
    // service captures `generation` before this point in a real race).
    session.connect(command, "Second", "someone-else", List.of("current-project"), ProjectDiscovery.Api.PROJECTS, null);
    assertThat(session.generation()).isNotEqualTo(originalGeneration);

    boolean applied = session.updateProjects(
        List.of("late-result"), ProjectDiscovery.Api.NAMESPACES, originalGeneration);

    assertThat(applied).isFalse();
    assertThat(session.projects()).containsExactly("current-project");
  }

  @Test
  void refreshRejectsWhenNotConnectedRatherThanCallingTheCluster() {
    assertThatThrownBy(() -> service.refreshProjects().block()).isInstanceOf(IllegalStateException.class);
  }

  // ------------------------------------------------- DISCONNECT / EXPIRED

  @Test
  void disconnectClearsDiscoveryMode() {
    server.setScenario(Scenario.NO_PROJECTS_API_404);
    connectViaSharedPolicy();
    assertThat(session.discoveryApi()).isEqualTo(ProjectDiscovery.Api.NAMESPACES);

    service.disconnect();

    assertThat(session.discoveryApi()).isNull();
    assertThat(session.state()).isEqualTo(OpenShiftConnectionState.DISCONNECTED);
  }

  @Test
  void expiredSessionClearsDiscoveryMode() {
    server.setScenario(Scenario.OK);
    connectViaSharedPolicy();
    assertThat(session.discoveryApi()).isEqualTo(ProjectDiscovery.Api.PROJECTS);

    session.markExpired();

    assertThat(session.discoveryApi()).isNull();
    assertThat(session.state()).isEqualTo(OpenShiftConnectionState.EXPIRED);
  }
}
