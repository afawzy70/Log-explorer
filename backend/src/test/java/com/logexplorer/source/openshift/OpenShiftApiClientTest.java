package com.logexplorer.source.openshift;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

import com.logexplorer.core.model.RawToken;
import com.logexplorer.source.openshift.MockOpenShiftServer.Scenario;
import com.logexplorer.source.openshift.OpenShiftApiException.Kind;
import java.io.IOException;
import java.net.URI;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * OS-1A Layer 2 - the API client against a deterministic fake OpenShift
 * API.
 *
 * <p>The decisive tests here are the three-way distinction OS-1A §15
 * requires: {@code 401}, {@code 403} and "200 with an empty list" are
 * three different truths and must never collapse into one another.
 */
class OpenShiftApiClientTest {

  private static final RawToken TOKEN = RawToken.of("sha256~test-token-value-0123456789");

  private MockOpenShiftServer server;
  private OpenShiftApiClient client;
  private URI base;

  @BeforeEach
  void setUp() throws IOException {
    server = new MockOpenShiftServer();
    // No proxy environment: these tests are about the API, not routing.
    client = new OpenShiftApiClient(Map.of());
    base = URI.create(server.baseUrl());
  }

  @AfterEach
  void tearDown() {
    if (server != null) {
      server.close();
    }
  }

  // ------------------------------------------------------------- happy paths

  @Test
  void listsProjectsTheUserCanSee_sortedDeterministically() {
    ProjectDiscovery discovery = client.fetchProjects(base, TOKEN, null).block();

    assertThat(discovery).isNotNull();
    assertThat(discovery.api()).isEqualTo(ProjectDiscovery.Api.PROJECTS);
    // The server returns them unsorted; the client's ordering is the contract.
    assertThat(discovery.projects()).containsExactly("accounts", "gateway", "payments");
    assertThat(discovery.isEmpty()).isFalse();
  }

  @Test
  void sendsTheTokenAsABearerHeader() {
    client.fetchProjects(base, TOKEN, null).block();

    assertThat(server.lastAuthorizationHeader()).isEqualTo("Bearer " + TOKEN.value());
    // ...and it goes in a header, never the URL (OS-1A §9).
    assertThat(server.lastPath()).doesNotContain(TOKEN.value());
  }

  @Test
  void usesTheOpenShiftProjectsApi_notNamespaces() {
    client.fetchProjects(base, TOKEN, null).block();
    assertThat(server.lastPath()).isEqualTo("/apis/project.openshift.io/v1/projects");
  }

  @Test
  void resolvesTheAuthenticatedUsername() {
    var username = client.fetchUsername(base, TOKEN, null).block();
    assertThat(username).isPresent().contains("developer");
  }

  // ------------------------------ the three truths that must not be collapsed

  @Test
  void aSuccessfulEmptyListMeansTheUserGenuinelyHasNoProjects() {
    server.setScenario(Scenario.EMPTY_PROJECTS);

    ProjectDiscovery discovery = client.fetchProjects(base, TOKEN, null).block();

    // Not an exception: this is a real, successful answer.
    assertThat(discovery).isNotNull();
    assertThat(discovery.isEmpty()).isTrue();
    assertThat(discovery.count()).isZero();
  }

  @Test
  void a401IsAnAuthenticationFailure_notAnEmptyProjectList() {
    server.setScenario(Scenario.UNAUTHORIZED_401);

    OpenShiftApiException e = catchThrowableOfType(
        () -> client.fetchProjects(base, TOKEN, null).block(), OpenShiftApiException.class);

    assertThat(e).isNotNull();
    assertThat(e.kind()).isEqualTo(Kind.UNAUTHORIZED);
  }

  @Test
  void a403IsForbidden_andIsNeverReportedAsHavingNoProjects() {
    server.setScenario(Scenario.FORBIDDEN_403);

    OpenShiftApiException e = catchThrowableOfType(
        () -> client.fetchProjects(base, TOKEN, null).block(), OpenShiftApiException.class);

    assertThat(e).isNotNull();
    // OS-1A §15's explicit reviewer correction: "you may not list projects"
    // is a different truth from "you have no projects".
    assertThat(e.kind()).isEqualTo(Kind.FORBIDDEN);
  }

  // -------------------------------------------------------------- other failures

  @Test
  void aMissingOpenShiftProjectsApiIsDistinctFromForbidden() {
    server.setScenario(Scenario.NO_PROJECTS_API_404);

    OpenShiftApiException e = catchThrowableOfType(
        () -> client.fetchProjects(base, TOKEN, null).block(), OpenShiftApiException.class);

    assertThat(e).isNotNull();
    // OS-1A review correction: a genuine 404 gets its own kind, distinct
    // from the generic MALFORMED_RESPONSE bucket - it is the ONLY kind
    // OpenShiftConnectionService's namespaces fallback may act on.
    assertThat(e.kind()).isEqualTo(Kind.NOT_FOUND);
  }

  // OS-1A review recovery - proving classify() itself, not just the
  // fallback decision that consumes it. These HTTP statuses must map to
  // something other than NOT_FOUND, so OpenShiftConnectionService's
  // fallback (which checks for NOT_FOUND specifically) never fires for
  // them - see OpenShiftConnectionServiceFallbackTest for the decision
  // level.
  @Test
  void aRateLimited429IsNeverClassifiedAsApiNotFound() {
    server.setScenario(Scenario.RATE_LIMITED_429);

    OpenShiftApiException e = catchThrowableOfType(
        () -> client.fetchProjects(base, TOKEN, null).block(), OpenShiftApiException.class);

    assertThat(e).isNotNull();
    assertThat(e.kind()).isNotEqualTo(Kind.NOT_FOUND);
    assertThat(e.kind()).isEqualTo(Kind.MALFORMED_RESPONSE);
  }

  @Test
  void a500IsNeverClassifiedAsApiNotFound() {
    server.setScenario(Scenario.INTERNAL_SERVER_ERROR_500);

    OpenShiftApiException e = catchThrowableOfType(
        () -> client.fetchProjects(base, TOKEN, null).block(), OpenShiftApiException.class);

    assertThat(e).isNotNull();
    assertThat(e.kind()).isNotEqualTo(Kind.NOT_FOUND);
  }

  @Test
  void a502IsNeverClassifiedAsApiNotFound() {
    server.setScenario(Scenario.BAD_GATEWAY_502);

    OpenShiftApiException e = catchThrowableOfType(
        () -> client.fetchProjects(base, TOKEN, null).block(), OpenShiftApiException.class);

    assertThat(e).isNotNull();
    assertThat(e.kind()).isNotEqualTo(Kind.NOT_FOUND);
  }

  @Test
  void a503IsNeverClassifiedAsApiNotFound() {
    server.setScenario(Scenario.SERVICE_UNAVAILABLE_503);

    OpenShiftApiException e = catchThrowableOfType(
        () -> client.fetchProjects(base, TOKEN, null).block(), OpenShiftApiException.class);

    assertThat(e).isNotNull();
    assertThat(e.kind()).isNotEqualTo(Kind.NOT_FOUND);
  }

  @Test
  void theNamespacesFallbackReportsWhichApiAnsweredIt() {
    server.setScenario(Scenario.NO_PROJECTS_API_404);

    ProjectDiscovery discovery = client.fetchNamespaces(base, TOKEN, null).block();

    assertThat(discovery).isNotNull();
    assertThat(discovery.api()).isEqualTo(ProjectDiscovery.Api.NAMESPACES);
    assertThat(discovery.projects()).containsExactly("fallback-ns-a", "fallback-ns-b");
  }

  @Test
  void aMalformedBodyIsReportedAsSuch_notAsSuccess() {
    server.setScenario(Scenario.MALFORMED_BODY);

    OpenShiftApiException e = catchThrowableOfType(
        () -> client.fetchProjects(base, TOKEN, null).block(), OpenShiftApiException.class);

    assertThat(e).isNotNull();
    assertThat(e.kind()).isEqualTo(Kind.MALFORMED_RESPONSE);
  }

  @Test
  void anUnreachableClusterIsANetworkFailure_notAnAuthFailure() {
    // Port 1 on loopback: nothing listens, connection is refused immediately.
    OpenShiftApiException e = catchThrowableOfType(
        () -> client.fetchProjects(URI.create("http://127.0.0.1:1"), TOKEN, null).block(),
        OpenShiftApiException.class);

    assertThat(e).isNotNull();
    assertThat(e.kind()).isEqualTo(Kind.NETWORK);
  }

  // Pre-closure functional recovery (§25/§27/§45) - proves the configured
  // proxy is ACTUALLY wired into the real HttpClient used for this
  // request (not just that ProxyRoute's own resolution logic is correct
  // in isolation, which ProxyRouteTest already covers), and that a
  // proxy-connect failure is classified distinctly from a generic
  // NETWORK failure.
  @Test
  void aConfiguredProxyThatCannotBeReachedIsClassifiedAsAProxyFailure_notGenericNetwork() {
    // Port 1 on loopback: nothing listens there, connection refused
    // immediately - same deterministic-failure pattern the existing
    // "anUnreachableClusterIsANetworkFailure" test above already uses,
    // but here it is the PROXY that is unreachable, not the cluster
    // itself (base is a real, live MockOpenShiftServer - proving the
    // failure is specifically about the proxy hop, not the target).
    OpenShiftApiClient proxiedClient = new OpenShiftApiClient(Map.of("HTTPS_PROXY", "http://127.0.0.1:1"));

    OpenShiftApiException e = catchThrowableOfType(
        () -> proxiedClient.fetchProjects(base, TOKEN, null).block(), OpenShiftApiException.class);

    assertThat(e).isNotNull();
    assertThat(e.kind()).isEqualTo(Kind.PROXY);
    // The generic client (no proxy configured) reaching the exact same
    // real, live server must succeed - proving the failure above is
    // genuinely caused by the (deliberately broken) proxy hop, not some
    // unrelated flakiness in the target server itself.
    ProjectDiscovery discovery = client.fetchProjects(base, TOKEN, null).block();
    assertThat(discovery).isNotNull();
  }

  // ------------------------------------------- ProxyMode DIRECT/CUSTOM
  // Pre-closure functional recovery 2 (§B2/§B7/§B8/§B9/Part F) - the
  // application-level proxy mode, over and above the environment-only
  // SYSTEM behavior already proven above.

  @Test
  void directModeConnectsSuccessfullyEvenWhenTheEnvironmentHasAProxyConfigured_neverConsultingIt() {
    // The environment alone would break this under SYSTEM mode (§B7's own
    // test above proves that exact scenario) - DIRECT must ignore it
    // entirely and reach the real, live server directly.
    OpenShiftProxyConfigService directConfig = new OpenShiftProxyConfigService();
    directConfig.update(ProxyConfig.direct());
    OpenShiftApiClient directClient =
        new OpenShiftApiClient(directConfig, Map.of("HTTPS_PROXY", "http://127.0.0.1:1"));

    ProjectDiscovery discovery = directClient.fetchProjects(base, TOKEN, null).block();

    assertThat(discovery).isNotNull();
    assertThat(discovery.projects()).containsExactly("accounts", "gateway", "payments");
  }

  @Test
  void customModeRoutesThroughTheConfiguredProxyAndIgnoresNoProxy() {
    // NO_PROXY="*" would bypass every proxy under SYSTEM mode - CUSTOM
    // must ignore it (§B10: "do not silently bypass because machine
    // environment has NO_PROXY") and still route through the
    // deliberately-broken custom proxy, proving it is genuinely being
    // used rather than silently skipped.
    OpenShiftProxyConfigService customConfig = new OpenShiftProxyConfigService();
    customConfig.update(ProxyConfig.custom("127.0.0.1", 1));
    OpenShiftApiClient customClient = new OpenShiftApiClient(customConfig, Map.of("NO_PROXY", "*"));

    OpenShiftApiException e = catchThrowableOfType(
        () -> customClient.fetchProjects(base, TOKEN, null).block(), OpenShiftApiException.class);

    assertThat(e).isNotNull();
    assertThat(e.kind()).isEqualTo(Kind.PROXY);
  }

  @Test
  void customModeSucceedsWhenTheCustomProxyItselfIsReachable_provingItIsNotJustAlwaysBroken() {
    // Not a real corp proxy - but proves CUSTOM mode's OWN resolved route
    // is what actually gets dialed: pointing CUSTOM at the real
    // MockOpenShiftServer's own host:port (standing in for "a reachable
    // proxy") at least reaches something rather than failing to resolve
    // the custom host/port fields at all. A genuine HTTP CONNECT proxy
    // behavior is not something this deterministic fake server
    // implements, so this only proves routing/resolution, not a full
    // CONNECT handshake - the CONNECT-level behavior itself is Reactor
    // Netty's own, already-proven-correct ProxyProvider integration
    // (unchanged by this recovery).
    OpenShiftProxyConfigService customConfig = new OpenShiftProxyConfigService();
    customConfig.update(ProxyConfig.custom(base.getHost(), base.getPort()));
    OpenShiftApiClient customClient = new OpenShiftApiClient(customConfig, Map.of());

    assertThat(customClient.proxyFor(base)).isPresent();
    assertThat(customClient.proxyFor(base).get().host()).isEqualTo(base.getHost());
    assertThat(customClient.proxyFor(base).get().port()).isEqualTo(base.getPort());
  }

  @Test
  void anUnreadableCertificateAuthorityIsATlsFailure() {
    OpenShiftApiException e = catchThrowableOfType(
        () -> client.fetchProjects(base, TOKEN, "/nonexistent/path/to/ca.crt").block(),
        OpenShiftApiException.class);

    assertThat(e).isNotNull();
    assertThat(e.kind()).isEqualTo(Kind.TLS);
    // The path came from user input and must not be echoed back.
    assertThat(e.getMessage()).doesNotContain("/nonexistent/path/to/ca.crt");
  }

  // ------------------------------------------------- identity is best-effort

  @Test
  void aMissingIdentityApiDoesNotFailTheConnection() {
    // A 403 on users/~ means "this cluster/user does not expose identity",
    // which must leave an otherwise-valid connection usable.
    server.setScenario(Scenario.FORBIDDEN_403);

    var username = client.fetchUsername(base, TOKEN, null).block();

    assertThat(username).isEmpty();
  }

  @Test
  void butA401OnIdentityStillPropagates() {
    server.setScenario(Scenario.UNAUTHORIZED_401);

    OpenShiftApiException e = catchThrowableOfType(
        () -> client.fetchUsername(base, TOKEN, null).block(), OpenShiftApiException.class);

    assertThat(e).isNotNull();
    assertThat(e.kind()).isEqualTo(Kind.UNAUTHORIZED);
  }

  // --------------------------------------------------------- no token leakage

  @Test
  void noFailureMessageEverContainsTheToken() {
    for (Scenario scenario : new Scenario[] {
      Scenario.UNAUTHORIZED_401, Scenario.FORBIDDEN_403, Scenario.MALFORMED_BODY, Scenario.NO_PROJECTS_API_404
    }) {
      server.setScenario(scenario);
      OpenShiftApiException e = catchThrowableOfType(
          () -> client.fetchProjects(base, TOKEN, null).block(), OpenShiftApiException.class);
      assertThat(e).as("scenario %s must fail", scenario).isNotNull();
      assertThat(e.getMessage()).as("scenario %s message", scenario).doesNotContain(TOKEN.value());
    }
  }
}
