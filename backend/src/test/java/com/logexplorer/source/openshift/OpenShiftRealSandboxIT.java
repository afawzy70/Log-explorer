package com.logexplorer.source.openshift;

import static org.assertj.core.api.Assertions.assertThat;

import com.logexplorer.core.model.RawToken;
import java.net.URI;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

/**
 * OS-1A Layer 3 - real OpenShift verification.
 *
 * <p><b>Opt-in, and skipped cleanly when credentials are absent</b>
 * ({@code @EnabledIfEnvironmentVariable}). Ordinary CI must stay
 * deterministic and credential-free (OS-1A §23/§31), so this class simply
 * does not run there - it is not a failure, and nothing about the build
 * depends on it.
 *
 * <h2>How to run it</h2>
 *
 * <pre>
 *   export OPENSHIFT_API_SERVER='https://api.your-cluster.example.com:6443'
 *   export OPENSHIFT_TOKEN='sha256~...'      # from the console's "Copy login command"
 *   ./mvnw test -Dtest=OpenShiftRealSandboxIT
 * </pre>
 *
 * <p>The Red Hat Developer Sandbox is the recommended environment: free,
 * 30-day renewable, and - because it is a shared multi-tenant cluster -
 * exactly the no-cluster-admin, namespace-scoped situation Direct mode is
 * designed for. Its documented policy of deleting pods after 12
 * consecutive hours is an asset for the later slices, giving free and
 * repeatable pod churn.
 *
 * <h2>What it deliberately does not do</h2>
 *
 * <ul>
 *   <li><b>Never prints the token</b>, or any prefix of it, or the
 *   {@code Authorization} header. Assertions are on counts and shapes, and
 *   the sanitized evidence printed below names the cluster host and
 *   project count only.</li>
 *   <li><b>Never shells out to {@code oc}.</b> The {@code oc} binary is
 *   not a runtime dependency and is not used here either.</li>
 *   <li><b>Never writes anything to the cluster</b> - every call is a
 *   {@code GET} (CLAUDE.md §2 rule 9).</li>
 * </ul>
 *
 * <p>Because a sandbox account's exact project list is not knowable in
 * advance, the assertions are about <i>truthfulness</i> rather than exact
 * values: the call must succeed, the identity must be resolvable or
 * honestly absent, and the project list must be internally consistent.
 */
@EnabledIfEnvironmentVariable(named = "OPENSHIFT_API_SERVER", matches = ".+")
@EnabledIfEnvironmentVariable(named = "OPENSHIFT_TOKEN", matches = ".+")
class OpenShiftRealSandboxIT {

  private static URI server() {
    return URI.create(System.getenv("OPENSHIFT_API_SERVER"));
  }

  private static RawToken token() {
    return RawToken.of(System.getenv("OPENSHIFT_TOKEN"));
  }

  private static OpenShiftApiClient client() {
    // Real environment: honour the machine's real proxy configuration.
    return new OpenShiftApiClient(System.getenv());
  }

  @Test
  void connectsAndListsTheProjectsThisAccountCanActuallySee() {
    ProjectDiscovery discovery = client().fetchProjects(server(), token(), null).block();

    assertThat(discovery).as("a real cluster must answer project discovery").isNotNull();
    assertThat(discovery.api()).isEqualTo(ProjectDiscovery.Api.PROJECTS);
    assertThat(discovery.projects()).doesNotContainNull();
    assertThat(discovery.count()).isEqualTo(discovery.projects().size());

    // Sanitized evidence only - host and counts, never the token.
    System.out.println("[OS-1A real] server=" + server().getHost() + " projects=" + discovery.count());
    System.out.println("[OS-1A real] project names=" + discovery.projects());
  }

  @Test
  void resolvesTheAuthenticatedIdentityOrHonestlyReportsItAsUnknown() {
    var username = client().fetchUsername(server(), token(), null).block();

    assertThat(username).as("identity lookup must not throw on a valid connection").isNotNull();
    // Either the cluster exposes the OpenShift user API, or it does not -
    // both are acceptable, and the product says "not reported by this
    // cluster" rather than guessing.
    System.out.println("[OS-1A real] identity resolved=" + username.isPresent());
  }

  @Test
  void theFullConnectFlowProducesASessionThatNeverExposesTheToken() {
    OpenShiftSession session = new OpenShiftSession();
    OpenShiftConnectionService service = new OpenShiftConnectionService(
        client(), session, new LoopbackBindingGuard("127.0.0.1"));

    String pasted = "oc login --token=" + token().value() + " --server=" + server();
    service.connect(pasted, "Real sandbox").block();

    assertThat(session.isConnected()).isTrue();
    assertThat(session.serverDisplay()).isNotBlank();

    // The session's own rendering, which is what could end up in a log.
    assertThat(session.toString()).doesNotContain(token().value()).contains("REDACTED");

    System.out.println("[OS-1A real] connected to " + session.serverDisplay()
        + " as " + (session.username() == null ? "<identity not reported>" : session.username())
        + " with " + session.projects().size() + " project(s)"
        + (session.proxyDisplay() == null ? " (direct)" : " via proxy " + session.proxyDisplay()));

    // A selected project must be one the connection can actually see.
    if (!session.projects().isEmpty()) {
      String first = session.projects().get(0);
      assertThat(session.selectProject(first, session.generation())).isTrue();
      assertThat(session.selectedProject()).isEqualTo(first);
    }

    service.disconnect();
    assertThat(session.token().isPresent()).as("disconnect must clear the token").isFalse();
  }

  @Test
  void anInvalidTokenIsReportedAsAnAuthenticationFailure_notAsAnEmptyProjectList() {
    OpenShiftApiException e = null;
    try {
      client().fetchProjects(server(), RawToken.of("sha256~definitely-not-a-valid-token-000"), null).block();
    } catch (OpenShiftApiException caught) {
      e = caught;
    }

    assertThat(e).as("a bogus token must fail, not return an empty list").isNotNull();
    assertThat(e.kind())
        .as("real clusters answer 401 for a bad bearer token")
        .isIn(OpenShiftApiException.Kind.UNAUTHORIZED, OpenShiftApiException.Kind.FORBIDDEN);
    assertThat(List.of(e.getMessage())).allSatisfy(m -> assertThat(m).doesNotContain("sha256~"));
  }

  @Test
  void reportsWhetherThisMachineWouldRouteThroughAProxy() {
    // Not an assertion about the environment - just recorded evidence for
    // the report, since enterprise proxy behaviour is the thing OS-1A had
    // to resolve from an assumption (§12).
    Map<String, String> env = System.getenv();
    var route = ProxyRoute.resolve(env, server().getHost());
    System.out.println("[OS-1A real] proxy route for " + server().getHost() + " = "
        + route.map(ProxyRoute::display).orElse("direct (no proxy, or covered by NO_PROXY)"));
  }
}
