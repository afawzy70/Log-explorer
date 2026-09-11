package com.logexplorer.source.openshift;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.logexplorer.core.model.RawToken;
import com.logexplorer.core.model.SourceHealth;
import java.net.URI;
import java.util.List;
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
    session.connect(COMMAND, "Prod", "developer", List.of("payments"), null);

    assertThat(session.toString())
        .doesNotContain("sha256~secret-token-value-123456")
        .contains("REDACTED");
  }

  @Test
  void disconnectClearsTheToken() {
    OpenShiftSession session = new OpenShiftSession();
    session.connect(COMMAND, "Prod", "developer", List.of("payments"), null);
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
    session.connect(COMMAND, "Prod", "developer", List.of("payments"), null);

    session.markExpired();

    // Keeping a credential the cluster has already refused serves no
    // purpose and only widens exposure.
    assertThat(session.token().isPresent()).isFalse();
    assertThat(session.state()).isEqualTo(OpenShiftConnectionState.EXPIRED);
  }

  @Test
  void connectingAgainReplacesThePreviousToken() {
    OpenShiftSession session = new OpenShiftSession();
    session.connect(COMMAND, "Prod", "developer", List.of("payments"), null);

    OcLoginCommand second = new OcLoginCommand(
        URI.create("https://api.other.example.com:6443"), RawToken.of("sha256~second-token-value-98765"), null);
    session.connect(second, "Other", "someone", List.of("other"), null);

    assertThat(session.token().value()).isEqualTo("sha256~second-token-value-98765");
    assertThat(session.serverDisplay()).isEqualTo("api.other.example.com:6443");
  }

  // ------------------------------------- §27 stale-connection protection

  @Test
  void aProjectSelectionFromAReplacedConnectionIsRejected() {
    OpenShiftSession session = new OpenShiftSession();
    long first = session.connect(COMMAND, "Prod", "developer", List.of("payments", "accounts"), null);

    // The connection is replaced while a selection is "in flight".
    session.connect(COMMAND, "Prod", "developer", List.of("other"), null);

    assertThat(session.selectProject("payments", first)).isFalse();
    assertThat(session.selectedProject()).isNull();
  }

  @Test
  void aProjectRefreshFromAReplacedConnectionIsDiscarded() {
    OpenShiftSession session = new OpenShiftSession();
    long first = session.connect(COMMAND, "Prod", "developer", List.of("payments"), null);
    session.connect(COMMAND, "Prod", "developer", List.of("current"), null);

    assertThat(session.updateProjects(List.of("stale-a", "stale-b"), first)).isFalse();
    assertThat(session.projects()).containsExactly("current");
  }

  @Test
  void aProjectThisConnectionCannotSeeIsNeverSelectable() {
    OpenShiftSession session = new OpenShiftSession();
    long generation = session.connect(COMMAND, "Prod", "developer", List.of("payments"), null);

    assertThat(session.selectProject("a-project-the-user-cannot-see", generation)).isFalse();
    assertThat(session.selectedProject()).isNull();
  }

  @Test
  void aSelectionThatDisappearsFromARefreshedListIsClearedTruthfully() {
    OpenShiftSession session = new OpenShiftSession();
    long generation = session.connect(COMMAND, "Prod", "developer", List.of("payments", "accounts"), null);
    assertThat(session.selectProject("payments", generation)).isTrue();

    // The project is deleted, or access to it is revoked.
    session.updateProjects(List.of("accounts"), generation);

    assertThat(session.selectedProject()).isNull();
  }

  @Test
  void aNewConnectionNeverInheritsThePreviousProjectSelection() {
    OpenShiftSession session = new OpenShiftSession();
    long generation = session.connect(COMMAND, "Prod", "developer", List.of("payments"), null);
    session.selectProject("payments", generation);

    session.connect(COMMAND, "Prod", "developer", List.of("payments"), null);

    assertThat(session.selectedProject()).isNull();
  }

  // --------------------------------------------- §21 capability honesty

  @Test
  void openShiftAdvertisesNoCapabilityItCannotYetDeliver() {
    OpenShiftLogSource source = new OpenShiftLogSource(new OpenShiftSession());
    var capabilities = source.capabilities();

    // OS-1A can connect and discover projects - nothing more. Advertising
    // search merely because a connection exists would produce a control
    // that silently returns nothing (the failure mode UX-R4 had to fix in
    // the opposite direction).
    assertThat(capabilities.historicalSearch()).isFalse();
    assertThat(capabilities.liveTail()).isFalse();
    assertThat(capabilities.contextView()).isFalse();
    assertThat(capabilities.rawLogQL()).isFalse();
    assertThat(capabilities.serviceDiscovery()).isFalse();
    assertThat(capabilities.composeProjectScoping()).isFalse();
  }

  @Test
  void searchRefusesLoudlyRatherThanReturningAnEmptyResult() {
    OpenShiftLogSource source = new OpenShiftLogSource(new OpenShiftSession());

    // An empty Flux would render as "no results for this range", which is a
    // factual claim about the cluster's logs this slice cannot make.
    assertThatThrownBy(() -> source.search(null).blockFirst())
        .isInstanceOf(UnsupportedOperationException.class);
  }

  @Test
  void theSourceIdIsStableAndTheLokiSourceIsUntouched() {
    OpenShiftLogSource source = new OpenShiftLogSource(new OpenShiftSession());
    assertThat(source.id()).isEqualTo("openshift");
    assertThat(source.displayName()).isEqualTo("OpenShift");
  }

  @Test
  void healthReflectsConnectionStateWithoutAlarmingAboutTheNormalStartingState() {
    OpenShiftSession session = new OpenShiftSession();
    OpenShiftLogSource source = new OpenShiftLogSource(session);

    // Not connected yet is not a failure - it is Monday morning.
    assertThat(source.health().block().status()).isEqualTo(SourceHealth.Status.DEGRADED);

    session.connect(COMMAND, "Prod", "developer", List.of("payments"), null);
    assertThat(source.health().block().status()).isEqualTo(SourceHealth.Status.UP);

    session.markExpired();
    assertThat(source.health().block().status()).isEqualTo(SourceHealth.Status.DOWN);
  }

  @Test
  void healthMessagesNeverContainTheToken() {
    OpenShiftSession session = new OpenShiftSession();
    OpenShiftLogSource source = new OpenShiftLogSource(session);
    session.connect(COMMAND, "Prod", "developer", List.of("payments"), null);

    assertThat(source.health().block().message()).doesNotContain("sha256~secret-token-value-123456");
  }
}
