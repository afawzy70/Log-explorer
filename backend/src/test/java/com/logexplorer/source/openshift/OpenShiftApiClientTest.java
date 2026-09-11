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
    assertThat(e.kind()).isEqualTo(Kind.MALFORMED_RESPONSE);
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
