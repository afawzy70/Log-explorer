package com.logexplorer.core.mapping;

import static org.assertj.core.api.Assertions.assertThat;

import com.logexplorer.config.SourcesProperties;
import com.logexplorer.core.model.SourceCapabilities;
import com.logexplorer.source.LogSourceRegistry;
import com.logexplorer.source.StubLogSource;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Owner mission "Project-Scoped Schema Scan" §7/§8 — {@link
 * MappingScopeResolver} must never fail the whole field-mapping settings
 * call just because {@code sourceId} names a source this registry doesn't
 * currently know about (e.g. a source a test harness mocks entirely
 * client-side, never registered on the real backend) — a real regression
 * found by the E2E suite: a mocked-frontend-only source made the readiness
 * GET throw, which made Search look permanently "mapping not ready."
 */
class MappingScopeResolverTest {

  private MappingScopeResolver resolverFor(StubLogSource... sources) {
    LogSourceRegistry registry = new LogSourceRegistry(List.of(sources), new SourcesProperties());
    return new MappingScopeResolver(registry);
  }

  @Test
  void nullSourceIdResolvesToUnspecified() {
    MappingScopeResolver resolver = resolverFor();
    assertThat(resolver.resolve(null, "anything")).isEqualTo(MappingScopeKey.UNSPECIFIED);
  }

  @Test
  void blankSourceIdResolvesToUnspecified() {
    MappingScopeResolver resolver = resolverFor();
    assertThat(resolver.resolve("  ", "anything")).isEqualTo(MappingScopeKey.UNSPECIFIED);
  }

  @Test
  void anUnrecognizedSourceIdNeverThrows_fallsBackToTrustingTheRawValuesDirectly() {
    MappingScopeResolver resolver = resolverFor();
    MappingScopeKey resolved = resolver.resolve("mock-loki", "some-project");
    assertThat(resolved).isEqualTo(MappingScopeKey.of("mock-loki", "some-project"));
  }

  @Test
  void aKnownSourceWithDefaultScopeResolutionEchoesTheRequestedProject() {
    StubLogSource docker = new StubLogSource("local-docker", "Local Docker",
        new SourceCapabilities(true, false, false, false, false, false, true, true));
    MappingScopeResolver resolver = resolverFor(docker);

    MappingScopeKey resolved = resolver.resolve("local-docker", "boubyan-platform");

    assertThat(resolved).isEqualTo(MappingScopeKey.of("local-docker", "boubyan-platform"));
  }

  @Test
  void aKnownSourceWithCustomScopeResolutionOverridesTheRequestedProject() {
    StubLogSource openshiftLike = new StubLogSource("openshift", "OpenShift",
        new SourceCapabilities(true, true, false, false, false, true, false, true));
    openshiftLike.withResolveMappingScopeLabelFn(request -> "real-session-project");
    MappingScopeResolver resolver = resolverFor(openshiftLike);

    MappingScopeKey resolved = resolver.resolve("openshift", "something-a-client-might-wrongly-send");

    assertThat(resolved).isEqualTo(MappingScopeKey.of("openshift", "real-session-project"));
  }
}
