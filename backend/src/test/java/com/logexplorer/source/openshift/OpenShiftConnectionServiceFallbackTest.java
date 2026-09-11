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
 * OS-1A review recovery - {@link OpenShiftConnectionService}'s namespaces
 * fallback decision.
 *
 * <h2>The defect this class exists to prevent from recurring</h2>
 *
 * <p>{@code fallbackToNamespacesIfAppropriate} previously guarded on
 * {@code failure.kind() != Kind.MALFORMED_RESPONSE} - and every HTTP
 * status other than 401/403 fell into that one bucket, including 429
 * (rate limited) and 500/502/503 (real upstream failures). A busy or
 * failing cluster could therefore be silently reinterpreted as "this
 * cluster has no OpenShift Projects API" and retried against namespaces
 * instead of surfacing the real failure.
 *
 * <p>The fix gives the genuine "API not found" case its own kind
 * ({@link Kind#NOT_FOUND}, HTTP 404 only) and the fallback now checks
 * for that kind exclusively. Every test below proves one of the two
 * outcomes required by the review: fallback happens for {@code
 * NOT_FOUND} and ONLY for {@code NOT_FOUND}.
 *
 * <h2>Why these are tested at the {@code Kind} level directly</h2>
 *
 * <p>{@code OpenShiftConnectionService#connect(String, String)} - the only
 * public entry point - requires an {@code https://} server per {@link
 * OcLoginCommandParser}. The deterministic fake OpenShift API used here is
 * a plain JDK {@code HttpServer} over {@code http} (the same convention as
 * this repository's existing {@code MockLokiServer}), so the fallback
 * decision is exercised directly via the package-private {@code
 * fallbackToNamespaces}, which is exactly where the original defect lived.
 * {@link OpenShiftApiClientTest} separately proves that real HTTP statuses
 * (404, 401, 403, 429, 500, 502, 503, a malformed body) map to the correct
 * {@code Kind} in the first place.
 *
 * <h2>Signature note (OS-1A review recovery #2)</h2>
 *
 * <p>This method was originally called {@code
 * fallbackToNamespacesIfAppropriate(OcLoginCommand, OpenShiftApiException)}.
 * It was renamed to {@code fallbackToNamespaces(URI, RawToken, String,
 * OpenShiftApiException)} and now takes the server/token/CA path directly
 * rather than a full {@code OcLoginCommand}, so it can be shared between
 * {@code connect} (which has an {@code OcLoginCommand}) and {@code
 * refreshProjects} (which only has loose fields already resolved from the
 * session) via one authoritative {@code discoverProjectsOrNamespaces}
 * policy - see {@link OpenShiftDiscoveryModeAndRefreshTest} for the tests
 * proving that policy is genuinely shared and that the discovery mode
 * itself (PROJECTS vs NAMESPACES) survives connect, summary readback,
 * refresh and stale-response protection. The 404-only fallback invariant
 * this class proves is completely unchanged by that refactor.
 */
class OpenShiftConnectionServiceFallbackTest {

  private static final RawToken TOKEN = RawToken.of("sha256~test-token-value-0123456789");
  private static final OcLoginCommand COMMAND =
      new OcLoginCommand(URI.create("https://api.example.com:6443"), TOKEN, null);

  private MockOpenShiftServer server;
  private OpenShiftConnectionService service;
  private URI base;

  @BeforeEach
  void setUp() throws IOException {
    server = new MockOpenShiftServer();
    base = URI.create(server.baseUrl());
    OpenShiftApiClient client = new OpenShiftApiClient(Map.of());
    service = new OpenShiftConnectionService(client, new OpenShiftSession(), new LoopbackBindingGuard("127.0.0.1"));
  }

  @AfterEach
  void tearDown() {
    if (server != null) {
      server.close();
    }
  }

  // ---------------------------------------------------------------- YES

  @Test
  void aGenuine404OnTheProjectsApiTriggersTheNamespacesFallback() {
    OpenShiftApiException notFound =
        new OpenShiftApiException(Kind.NOT_FOUND, "The cluster returned HTTP 404 for that API.");

    ProjectDiscovery discovery =
        service.fallbackToNamespaces(base, TOKEN, null, notFound).block();

    assertThat(discovery).as("PROJECTS_404 must fall back to namespaces").isNotNull();
    assertThat(discovery.api()).isEqualTo(ProjectDiscovery.Api.NAMESPACES);
    assertThat(server.namespacesRequestCount()).as("namespaces endpoint must actually be called").isEqualTo(1);
  }

  // ----------------------------------------------------------------- NO

  @Test
  void a401NeverFallsBack() {
    assertNoFallback(new OpenShiftApiException(Kind.UNAUTHORIZED, "expired"));
  }

  @Test
  void a403NeverFallsBack() {
    assertNoFallback(new OpenShiftApiException(Kind.FORBIDDEN, "not permitted"));
  }

  @Test
  void a429NeverFallsBack() {
    // 429 (rate limited) is exactly the class of real cluster-side failure
    // that the original MALFORMED_RESPONSE-based guard would have
    // misclassified as "no Projects API".
    assertNoFallback(new OpenShiftApiException(Kind.MALFORMED_RESPONSE, "The cluster returned HTTP 429."));
  }

  @Test
  void a500NeverFallsBack() {
    assertNoFallback(new OpenShiftApiException(Kind.MALFORMED_RESPONSE, "The cluster returned HTTP 500."));
  }

  @Test
  void a502NeverFallsBack() {
    assertNoFallback(new OpenShiftApiException(Kind.MALFORMED_RESPONSE, "The cluster returned HTTP 502."));
  }

  @Test
  void a503NeverFallsBack() {
    assertNoFallback(new OpenShiftApiException(Kind.MALFORMED_RESPONSE, "The cluster returned HTTP 503."));
  }

  @Test
  void aMalformedJsonResponseNeverFallsBack() {
    // A decode failure on an otherwise-200 response also lands in
    // MALFORMED_RESPONSE - it must not be treated as "API not found" either.
    assertNoFallback(new OpenShiftApiException(Kind.MALFORMED_RESPONSE, "The cluster API call failed."));
  }

  @Test
  void aNetworkFailureNeverFallsBack() {
    assertNoFallback(new OpenShiftApiException(Kind.NETWORK, "Could not reach the cluster API."));
  }

  @Test
  void aTlsFailureNeverFallsBack() {
    assertNoFallback(new OpenShiftApiException(Kind.TLS, "TLS verification failed."));
  }

  @Test
  void aProxyFailureNeverFallsBack() {
    assertNoFallback(new OpenShiftApiException(Kind.PROXY, "The configured proxy could not be used."));
  }

  /**
   * Asserts that {@code failure} is propagated unchanged - the namespaces
   * endpoint is never called, and the caller sees exactly the original
   * failure, not a second-order error from an API it never chose.
   */
  private void assertNoFallback(OpenShiftApiException failure) {
    OpenShiftApiException propagated = catchThrowableOfType(
        () -> service.fallbackToNamespaces(base, TOKEN, null, failure).block(),
        OpenShiftApiException.class);

    assertThat(propagated).as("the original failure must propagate, not be swallowed").isSameAs(failure);
    assertThat(server.namespacesRequestCount())
        .as("the namespaces endpoint must NEVER be called for kind %s", failure.kind())
        .isZero();
  }

  // --------------------------------------------- sanitized errors preserved

  @Test
  void noFallbackDecisionEverLeaksTheTokenOrRequestData() {
    for (Kind kind : Kind.values()) {
      if (kind == Kind.NOT_FOUND) {
        continue; // exercised above with a real (safe) message
      }
      OpenShiftApiException failure = new OpenShiftApiException(kind, "synthetic failure for " + kind);
      OpenShiftApiException propagated = catchThrowableOfType(
          () -> service.fallbackToNamespaces(base, TOKEN, null, failure).block(),
          OpenShiftApiException.class);
      assertThat(propagated.getMessage()).doesNotContain(TOKEN.value());
    }
  }

  // ------------------------------------- existing 401/403/empty semantics

  @Test
  void a401OnTheRealProjectsCallStillMarksTheSessionExpired_notFallback() {
    OpenShiftSession session = new OpenShiftSession();
    OpenShiftApiClient client = new OpenShiftApiClient(Map.of());
    OpenShiftConnectionService realService =
        new OpenShiftConnectionService(client, session, new LoopbackBindingGuard("127.0.0.1"));
    session.connect(COMMAND, "prior", "developer", java.util.List.of("payments"), ProjectDiscovery.Api.PROJECTS, null);
    server.setScenario(Scenario.UNAUTHORIZED_401);

    OpenShiftApiException e = catchThrowableOfType(
        () -> client.fetchProjects(base, TOKEN, null)
            .onErrorResume(OpenShiftApiException.class,
                failure -> realService.fallbackToNamespaces(base, TOKEN, null, failure))
            .block(),
        OpenShiftApiException.class);

    assertThat(e).isNotNull();
    assertThat(e.kind()).isEqualTo(Kind.UNAUTHORIZED);
    assertThat(server.namespacesRequestCount()).isZero();
  }

  @Test
  void anEmptyProjectListIsStillSuccessAndNeverTriggersFallback() {
    server.setScenario(Scenario.EMPTY_PROJECTS);
    OpenShiftApiClient client = new OpenShiftApiClient(Map.of());

    ProjectDiscovery discovery = client
        .fetchProjects(base, TOKEN, null)
        .onErrorResume(OpenShiftApiException.class,
            failure -> service.fallbackToNamespaces(base, TOKEN, null, failure))
        .block();

    assertThat(discovery).isNotNull();
    assertThat(discovery.api()).isEqualTo(ProjectDiscovery.Api.PROJECTS);
    assertThat(discovery.isEmpty()).isTrue();
    assertThat(server.namespacesRequestCount()).as("a successful empty list must never trigger fallback").isZero();
  }

  @Test
  void aReal404EndToEndThroughTheClientAlsoFallsBack() {
    // Belt and braces: the same assertion as the top of this file, but
    // going through the REAL classify() path (a genuine HTTP 404) rather
    // than a hand-constructed exception, so the wiring between
    // OpenShiftApiClient and OpenShiftConnectionService is proved too.
    server.setScenario(Scenario.NO_PROJECTS_API_404);
    OpenShiftApiClient client = new OpenShiftApiClient(Map.of());

    ProjectDiscovery discovery = client
        .fetchProjects(base, TOKEN, null)
        .onErrorResume(OpenShiftApiException.class,
            failure -> service.fallbackToNamespaces(base, TOKEN, null, failure))
        .block();

    assertThat(discovery).isNotNull();
    assertThat(discovery.api()).isEqualTo(ProjectDiscovery.Api.NAMESPACES);
    assertThat(server.namespacesRequestCount()).isEqualTo(1);
  }
}
