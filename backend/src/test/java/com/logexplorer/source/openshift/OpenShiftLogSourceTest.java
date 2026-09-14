package com.logexplorer.source.openshift;

import static org.assertj.core.api.Assertions.assertThat;

import com.logexplorer.core.model.RawToken;
import com.logexplorer.core.model.SearchRequest;
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
}
