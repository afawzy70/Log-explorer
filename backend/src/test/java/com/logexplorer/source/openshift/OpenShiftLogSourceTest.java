package com.logexplorer.source.openshift;

import static org.assertj.core.api.Assertions.assertThat;

import com.logexplorer.core.model.RawToken;
import com.logexplorer.core.model.SearchRequest;
import com.logexplorer.core.model.SourceHealth;
import java.net.URI;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Owner mission "Project-Scoped Schema Scan" §3/§8 — {@link
 * OpenShiftLogSource#resolveMappingScopeLabel} must always resolve the
 * session's own real, currently-selected project, ignoring anything a
 * caller passes on {@link SearchRequest#composeProject()} (which does not
 * even exist as a concept for OpenShift) — the same "session is
 * authoritative, never the request" contract {@link DirectPodLogProvider}
 * and {@link OpenShiftLiveTailProvider} already have for real target
 * resolution.
 */
class OpenShiftLogSourceTest {

  private static final RawToken TOKEN = RawToken.of("sha256~mapping-scope-test-token-0123456789");

  @Test
  void resolvesTheSessionsCurrentlySelectedProject_ignoringAnyClientSuppliedComposeProject() {
    OpenShiftSession session = new OpenShiftSession();
    OpenShiftLogSource source = new OpenShiftLogSource(session, null, null);

    OcLoginCommand command = new OcLoginCommand(URI.create("https://cluster.example:6443"), TOKEN, null);
    long generation = session.connect(command, "Test", "developer", List.of("payments"), ProjectDiscovery.Api.PROJECTS, null);
    assertThat(session.selectProject("payments", generation)).isTrue();

    SearchRequest requestWithADifferentClientSuppliedValue = SearchRequest.builder()
        .sourceId("openshift")
        .start(Instant.parse("2026-01-01T00:00:00Z"))
        .end(Instant.parse("2026-01-01T01:00:00Z"))
        .composeProject("something-a-client-might-wrongly-send")
        .build();

    assertThat(source.resolveMappingScopeLabel(requestWithADifferentClientSuppliedValue)).isEqualTo("payments");
  }

  @Test
  void noConnectionResolvesANullScope() {
    OpenShiftSession session = new OpenShiftSession();
    OpenShiftLogSource source = new OpenShiftLogSource(session, null, null);

    SearchRequest request = SearchRequest.builder()
        .sourceId("openshift")
        .start(Instant.parse("2026-01-01T00:00:00Z"))
        .end(Instant.parse("2026-01-01T01:00:00Z"))
        .build();

    assertThat(source.resolveMappingScopeLabel(request)).isNull();
  }

  /**
   * SOURCE_EXPERIENCE_PARITY_TARGETED_RECOVERY_1 - Settings no longer owns Project/Workload/Pod/Container
   * selection (Search does, {@code OpenShiftScopeSelect.tsx}); the DEGRADED guidance naming where to act must
   * name Search, not Settings, or it actively misdirects the investigator.
   */
  @Test
  void connectedWithNoProjectSelectedNamesSearchNotSettingsAsWhereToAct() {
    OpenShiftSession session = new OpenShiftSession();
    OpenShiftLogSource source = new OpenShiftLogSource(session, null, null);

    OcLoginCommand command = new OcLoginCommand(URI.create("https://cluster.example:6443"), TOKEN, null);
    session.connect(command, "Test", "developer", List.of("payments"), ProjectDiscovery.Api.PROJECTS, null);

    SourceHealth health = source.health().block();

    assertThat(health.status()).isEqualTo(SourceHealth.Status.DEGRADED);
    assertThat(health.warnings()).containsExactly("Select a project/namespace in Search to search");
    assertThat(health.warnings().get(0)).doesNotContain("Settings");
  }

  /**
   * SOURCE_EXPERIENCE_PARITY_TARGETED_RECOVERY_1 - selecting a Project must reconcile health from DEGRADED to
   * UP without any separate polling mechanism; the frontend triggers this by calling the same health check
   * again after a successful Project mutation, but the truth itself must already be correct as soon as the
   * session reflects the new selection - this test proves that server-side truth, independent of when/how
   * often the frontend chooses to ask for it.
   */
  @Test
  void selectingAProjectReconcilesHealthFromDegradedToUp() {
    OpenShiftSession session = new OpenShiftSession();
    OpenShiftLogSource source = new OpenShiftLogSource(session, null, null);

    OcLoginCommand command = new OcLoginCommand(URI.create("https://cluster.example:6443"), TOKEN, null);
    long generation = session.connect(command, "Test", "developer", List.of("payments"), ProjectDiscovery.Api.PROJECTS, null);
    assertThat(source.health().block().status()).isEqualTo(SourceHealth.Status.DEGRADED);

    assertThat(session.selectProject("payments", generation)).isTrue();

    SourceHealth afterSelection = source.health().block();
    assertThat(afterSelection.status()).isEqualTo(SourceHealth.Status.UP);
    assertThat(afterSelection.warnings()).isEmpty();
  }
}
