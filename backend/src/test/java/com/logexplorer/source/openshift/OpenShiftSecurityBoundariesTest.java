package com.logexplorer.source.openshift;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.logexplorer.config.DirectPodLogProperties;
import com.logexplorer.core.model.RawToken;
import com.logexplorer.core.model.SourceHealth;
import com.logexplorer.core.parse.LogLineParser;
import com.logexplorer.core.search.ContextTargetProofCodec;
import java.net.URI;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * OS-1A §5/§9/§10/§21 - the security and truthfulness boundaries around
 * the OpenShift connection: the loopback guard, the token's lifetime, the
 * session's stale-response protection, and the source's capability
 * honesty.
 */
class OpenShiftSecurityBoundariesTest {

  private static final OcLoginCommand COMMAND = new OcLoginCommand(
      URI.create("https://api.cluster.example.com:6443"), RawToken.of("sha256~secret-token-value-123456"), null);

  // ------------------------------------------------- §10 loopback guard

  @ParameterizedTest
  @ValueSource(strings = {"127.0.0.1", "127.0.0.53", "localhost", "::1"})
  void credentialIntakeIsAllowedOnLoopbackBindings(String address) {
    assertThat(LoopbackBindingGuard.isLoopback(address)).isTrue();
    new LoopbackBindingGuard(address).requireLoopback(); // must not throw
  }

  @ParameterizedTest
  @ValueSource(strings = {"0.0.0.0", "::", "*", "10.1.2.3", "192.168.1.50"})
  void credentialIntakeIsRefusedOnAnyNetworkReachableBinding(String address) {
    assertThat(LoopbackBindingGuard.isLoopback(address)).isFalse();
    assertThatThrownBy(() -> new LoopbackBindingGuard(address).requireLoopback())
        .isInstanceOf(LoopbackBindingGuard.NonLoopbackBindingException.class);
  }

  @Test
  void aBlankBindAddressCountsAsNetworkReachable() {
    // Spring Boot binds every interface when server.address is unset, which
    // is exactly the case this guard exists to stop.
    assertThat(LoopbackBindingGuard.isLoopback("")).isFalse();
    assertThat(LoopbackBindingGuard.isLoopback(null)).isFalse();
  }

  @Test
  void theRefusalNeverMentionsACredential() {
    var e = new LoopbackBindingGuard.NonLoopbackBindingException();
    assertThat(e.getMessage()).doesNotContain("token").contains("loopback");
  }

  // -------------------------------------------------- §9 token lifetime

  @Test
  void theSessionNeverPrintsTheToken() {
    OpenShiftSession session = new OpenShiftSession();
    session.connect(COMMAND, "Prod", "developer", List.of("payments"), ProjectDiscovery.Api.PROJECTS, null);

    assertThat(session.toString())
        .doesNotContain("sha256~secret-token-value-123456")
        .contains("REDACTED");
  }

  @Test
  void disconnectClearsTheToken() {
    OpenShiftSession session = new OpenShiftSession();
    session.connect(COMMAND, "Prod", "developer", List.of("payments"), ProjectDiscovery.Api.PROJECTS, null);
    assertThat(session.token().isPresent()).isTrue();

    session.disconnect();

    assertThat(session.token().isPresent()).isFalse();
    assertThat(session.state()).isEqualTo(OpenShiftConnectionState.DISCONNECTED);
    assertThat(session.projects()).isEmpty();
    assertThat(session.selectedProject()).isNull();
  }

  @Test
  void aRejectedTokenIsDroppedImmediately() {
    OpenShiftSession session = new OpenShiftSession();
    session.connect(COMMAND, "Prod", "developer", List.of("payments"), ProjectDiscovery.Api.PROJECTS, null);

    session.markExpired();

    // Keeping a credential the cluster has already refused serves no
    // purpose and only widens exposure.
    assertThat(session.token().isPresent()).isFalse();
    assertThat(session.state()).isEqualTo(OpenShiftConnectionState.EXPIRED);
  }

  @Test
  void connectingAgainReplacesThePreviousToken() {
    OpenShiftSession session = new OpenShiftSession();
    session.connect(COMMAND, "Prod", "developer", List.of("payments"), ProjectDiscovery.Api.PROJECTS, null);

    OcLoginCommand second = new OcLoginCommand(
        URI.create("https://api.other.example.com:6443"), RawToken.of("sha256~second-token-value-98765"), null);
    session.connect(second, "Other", "someone", List.of("other"), ProjectDiscovery.Api.PROJECTS, null);

    assertThat(session.token().value()).isEqualTo("sha256~second-token-value-98765");
    assertThat(session.serverDisplay()).isEqualTo("api.other.example.com:6443");
  }

  // ------------------------------------- §27 stale-connection protection

  @Test
  void aProjectSelectionFromAReplacedConnectionIsRejected() {
    OpenShiftSession session = new OpenShiftSession();
    long first = session.connect(COMMAND, "Prod", "developer", List.of("payments", "accounts"), ProjectDiscovery.Api.PROJECTS, null);

    // The connection is replaced while a selection is "in flight".
    session.connect(COMMAND, "Prod", "developer", List.of("other"), ProjectDiscovery.Api.PROJECTS, null);

    assertThat(session.selectProject("payments", first)).isFalse();
    assertThat(session.selectedProject()).isNull();
  }

  @Test
  void aProjectRefreshFromAReplacedConnectionIsDiscarded() {
    OpenShiftSession session = new OpenShiftSession();
    long first = session.connect(COMMAND, "Prod", "developer", List.of("payments"), ProjectDiscovery.Api.PROJECTS, null);
    session.connect(COMMAND, "Prod", "developer", List.of("current"), ProjectDiscovery.Api.PROJECTS, null);

    assertThat(session.updateProjects(List.of("stale-a", "stale-b"), ProjectDiscovery.Api.PROJECTS, first)).isFalse();
    assertThat(session.projects()).containsExactly("current");
  }

  @Test
  void aProjectThisConnectionCannotSeeIsNeverSelectable() {
    OpenShiftSession session = new OpenShiftSession();
    long generation = session.connect(COMMAND, "Prod", "developer", List.of("payments"), ProjectDiscovery.Api.PROJECTS, null);

    assertThat(session.selectProject("a-project-the-user-cannot-see", generation)).isFalse();
    assertThat(session.selectedProject()).isNull();
  }

  @Test
  void aSelectionThatDisappearsFromARefreshedListIsClearedTruthfully() {
    OpenShiftSession session = new OpenShiftSession();
    long generation = session.connect(COMMAND, "Prod", "developer", List.of("payments", "accounts"), ProjectDiscovery.Api.PROJECTS, null);
    assertThat(session.selectProject("payments", generation)).isTrue();

    // The project is deleted, or access to it is revoked.
    session.updateProjects(List.of("accounts"), ProjectDiscovery.Api.PROJECTS, generation);

    assertThat(session.selectedProject()).isNull();
  }

  @Test
  void aNewConnectionNeverInheritsThePreviousProjectSelection() {
    OpenShiftSession session = new OpenShiftSession();
    long generation = session.connect(COMMAND, "Prod", "developer", List.of("payments"), ProjectDiscovery.Api.PROJECTS, null);
    session.selectProject("payments", generation);

    session.connect(COMMAND, "Prod", "developer", List.of("payments"), ProjectDiscovery.Api.PROJECTS, null);

    assertThat(session.selectedProject()).isNull();
  }

  // --------------------------------------------- §21 capability honesty

  private static OpenShiftLogSource logSource(OpenShiftSession session) {
    OpenShiftApiClient client = new OpenShiftApiClient(Map.of());
    DirectPodLogProperties properties = new DirectPodLogProperties();
    DirectPodLogProvider provider = new DirectPodLogProvider(
        client, session, new LogLineParser(new ObjectMapper()), properties, new ContextTargetProofCodec(new ObjectMapper()));
    return new OpenShiftLogSource(session, provider);
  }

  /**
   * <b>CORRECTED (OS-1C)</b> — this test originally asserted {@code
   * historicalSearch=false}, true for OS-1A/1B (nothing but connect and
   * project discovery existed yet). OS-1C adds a real, bounded direct
   * search ({@link DirectPodLogProvider}), so {@code historicalSearch=true}
   * is now the truthful value — see {@link OpenShiftLogSource#capabilities()}'s
   * own javadoc for why that flag's real-world meaning ("bounded direct
   * search over resolved pods," never "indexed history") still satisfies
   * this test's original intent: never advertise a capability this source
   * cannot actually deliver.
   *
   * <p><b>CORRECTED (OS-1D)</b> — {@code contextView} was {@code false}
   * here because "Show surrounding logs" had not been implemented for
   * OpenShift yet. OS-1D implements it (narrowed to the exact (pod,
   * container) the selected event came from — see {@code
   * DirectPodLogProvider#resolveTargetPlan}'s own javadoc), reusing the
   * same generic {@code /api/v1/logs/context} endpoint every other source
   * already uses, tested end to end. {@code contextView=true} is now the
   * truthful value. {@code liveTail}/{@code rawLogQL}/{@code
   * serviceDiscovery}/{@code composeProjectScoping} remain unchanged and
   * still correctly {@code false} — OS-1E/Loki/Docker-shaped territory.
   */
  @Test
  void openShiftAdvertisesExactlyTheCapabilitiesItCanDeliver() {
    OpenShiftLogSource source = logSource(new OpenShiftSession());
    var capabilities = source.capabilities();

    assertThat(capabilities.historicalSearch()).isTrue();
    assertThat(capabilities.liveTail()).isFalse();
    assertThat(capabilities.contextView()).isTrue();
    assertThat(capabilities.rawLogQL()).isFalse();
    assertThat(capabilities.serviceDiscovery()).isFalse();
    assertThat(capabilities.composeProjectScoping()).isFalse();
  }

  /**
   * <b>CORRECTED (OS-1C)</b> — this test originally asserted that {@code
   * search()} always threw {@link UnsupportedOperationException}, true
   * only until OS-1C implemented real direct search. The still-valid
   * intent — "refuse loudly rather than silently return an empty result
   * that looks like a real, completed search" — is now proved against the
   * real precondition {@link DirectPodLogProvider} actually enforces: a
   * search attempted with no project/namespace selected fails fast with
   * {@link IllegalStateException} rather than returning zero events, which
   * would be indistinguishable from "genuinely no logs in this window."
   * Full search behavior (bounded fan-out, merge, truncation, RBAC) is
   * covered by {@code DirectPodLogProviderTest}, not this security-boundary
   * file.
   */
  @Test
  void searchRefusesLoudlyRatherThanReturningAnEmptyResult() {
    OpenShiftSession session = new OpenShiftSession();
    session.connect(COMMAND, "Prod", "developer", List.of("payments"), ProjectDiscovery.Api.PROJECTS, null);
    // Connected, but no project selected yet - search must not silently
    // report "zero logs", which would misrepresent an unset scope as a
    // genuinely empty cluster.
    OpenShiftLogSource source = logSource(session);

    assertThatThrownBy(() -> source.search(null).blockFirst())
        .isInstanceOf(IllegalStateException.class);
  }

  @Test
  void theSourceIdIsStableAndTheLokiSourceIsUntouched() {
    OpenShiftLogSource source = logSource(new OpenShiftSession());
    assertThat(source.id()).isEqualTo("openshift");
    assertThat(source.displayName()).isEqualTo("OpenShift");
  }

  @Test
  void healthReflectsConnectionStateWithoutAlarmingAboutTheNormalStartingState() {
    OpenShiftSession session = new OpenShiftSession();
    OpenShiftLogSource source = logSource(session);

    // Not connected yet is not a failure - it is Monday morning.
    assertThat(source.health().block().status()).isEqualTo(SourceHealth.Status.DEGRADED);

    long generation = session.connect(
        COMMAND, "Prod", "developer", List.of("payments"), ProjectDiscovery.Api.PROJECTS, null);
    // Connected but no project selected is a distinct, still-not-fully-ready
    // state (OS-1C §26) - genuinely UP requires a selected project too.
    assertThat(source.health().block().status()).isEqualTo(SourceHealth.Status.DEGRADED);

    session.selectProject("payments", generation);
    assertThat(source.health().block().status()).isEqualTo(SourceHealth.Status.UP);

    session.markExpired();
    assertThat(source.health().block().status()).isEqualTo(SourceHealth.Status.DOWN);
  }

  @Test
  void healthMessagesNeverContainTheToken() {
    OpenShiftSession session = new OpenShiftSession();
    OpenShiftLogSource source = logSource(session);
    session.connect(COMMAND, "Prod", "developer", List.of("payments"), ProjectDiscovery.Api.PROJECTS, null);

    assertThat(source.health().block().message()).doesNotContain("sha256~secret-token-value-123456");
  }
}
