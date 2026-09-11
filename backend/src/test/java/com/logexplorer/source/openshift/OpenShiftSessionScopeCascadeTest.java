package com.logexplorer.source.openshift;

import static org.assertj.core.api.Assertions.assertThat;

import com.logexplorer.core.model.RawToken;
import java.net.URI;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * OS-1B §14 - the project-level cascading resets that only {@link
 * OpenShiftSession} can enforce (connect/disconnect/expiry/project
 * change), as distinct from the workload/pod/container cascade already
 * proven directly against {@link OpenShiftScope} in {@link
 * OpenShiftScopeTest}.
 */
class OpenShiftSessionScopeCascadeTest {

  private static final OcLoginCommand COMMAND = new OcLoginCommand(
      URI.create("https://api.cluster.example.com:6443"), RawToken.of("sha256~scope-cascade-token-0123456"), null);

  private static final WorkloadRef WORKLOAD = new WorkloadRef(WorkloadKind.DEPLOYMENT, "payment-api", "payments");

  private OpenShiftSession connectedWithScope() {
    OpenShiftSession session = new OpenShiftSession();
    long generation = session.connect(COMMAND, "Prod", "developer", List.of("payments", "accounts"),
        ProjectDiscovery.Api.PROJECTS, null);
    session.selectProject("payments", generation);
    session.updateWorkloads(List.of(new WorkloadSummary(WORKLOAD, 1, 1, Map.of("app", "payment-api"))), List.of(),
        "payments", generation);
    session.selectWorkload(WORKLOAD, generation);
    session.updatePods(List.of(new PodSummary("payment-api-abc", "Running", "1/1", 0, List.of("application"),
        WORKLOAD)), "payments", WORKLOAD, generation);
    session.selectPod("payment-api-abc", generation);
    session.updateContainers(List.of("application"), "payment-api-abc", generation);
    session.selectContainer("application", generation);
    assertThat(session.scope().selectedContainer()).isEqualTo("application"); // sanity: scope really is populated
    return session;
  }

  @Test
  void switchingToADifferentProjectClearsTheWholeScope() {
    OpenShiftSession session = connectedWithScope();

    assertThat(session.selectProject("accounts", session.generation())).isTrue();

    assertThat(session.scope()).isEqualTo(OpenShiftScope.EMPTY);
  }

  @Test
  void reselectingTheSameProjectLeavesScopeUntouched() {
    OpenShiftSession session = connectedWithScope();

    assertThat(session.selectProject("payments", session.generation())).isTrue();

    assertThat(session.scope().selectedContainer()).isEqualTo("application");
  }

  @Test
  void aProjectDisappearingFromARefreshedListClearsScopeToo() {
    OpenShiftSession session = connectedWithScope();
    long generation = session.generation();

    session.updateProjects(List.of("accounts"), ProjectDiscovery.Api.PROJECTS, generation); // "payments" is gone

    assertThat(session.selectedProject()).isNull();
    assertThat(session.scope()).isEqualTo(OpenShiftScope.EMPTY);
  }

  @Test
  void aProjectListRefreshThatKeepsTheSameSelectionLeavesScopeUntouched() {
    OpenShiftSession session = connectedWithScope();
    long generation = session.generation();

    session.updateProjects(List.of("payments", "accounts", "billing"), ProjectDiscovery.Api.PROJECTS, generation);

    assertThat(session.selectedProject()).isEqualTo("payments");
    assertThat(session.scope().selectedContainer()).isEqualTo("application");
  }

  @Test
  void reconnectingNeverInheritsThePreviousScope() {
    OpenShiftSession session = connectedWithScope();

    session.connect(COMMAND, "Prod", "developer", List.of("payments"), ProjectDiscovery.Api.PROJECTS, null);

    assertThat(session.scope()).isEqualTo(OpenShiftScope.EMPTY);
  }

  @Test
  void disconnectClearsScope() {
    OpenShiftSession session = connectedWithScope();

    session.disconnect();

    assertThat(session.scope()).isEqualTo(OpenShiftScope.EMPTY);
  }

  @Test
  void expiryClearsScope() {
    OpenShiftSession session = connectedWithScope();

    session.markExpired();

    assertThat(session.scope()).isEqualTo(OpenShiftScope.EMPTY);
  }
}
