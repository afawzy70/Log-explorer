package com.logexplorer.core.mapping;

import com.logexplorer.core.model.SearchRequest;
import com.logexplorer.source.LogSource;
import com.logexplorer.source.LogSourceRegistry;
import org.springframework.stereotype.Component;

/**
 * Owner mission "Project-Scoped Schema Scan" §7/§8 — resolves the real,
 * authoritative {@link MappingScopeKey} for a {@code sourceId}/{@code
 * project} pair the exact same way {@code
 * com.logexplorer.core.mapping.scan.SchemaScanService} and {@code
 * api.SearchService} already do: deferring to {@link
 * LogSource#resolveMappingScopeLabel} rather than trusting a
 * client-supplied project label blindly — correct (an echo of the request)
 * for a source whose scope truly is request-scoped (Docker), authoritative
 * server-side truth (ignoring the client value entirely) for a source
 * whose scope is session-based (OpenShift).
 *
 * <p>Used by {@code api.FieldMappingSettingsController} so the settings
 * endpoints (view/edit/validate/save/reset) resolve their scope
 * identically to real search/scan traffic — no possible drift between
 * "which profile the settings UI is editing" and "which profile real
 * parsing will actually use" (mission: "Do not reuse a mapping from
 * another project silently").
 *
 * <p><b>Never throws for an unrecognized {@code sourceId}</b> — unlike
 * {@link LogSourceRegistry#require}, this is a purely local, no-network-I/O
 * profile lookup (a {@code Map} key computation), not a real source
 * operation; a settings/readiness call is never the right place to reject
 * a source id this registry doesn't currently know about (e.g. one a test
 * harness mocks entirely client-side, or one whose backend bean is briefly
 * unavailable) with a hard failure that would otherwise present as a
 * confusing "mapping not ready" — it falls back to trusting the raw {@code
 * sourceId}/{@code requestedProject} pair directly, exactly as if the
 * source had no special scope-resolution behavior of its own.
 */
@Component
public class MappingScopeResolver {

  private final LogSourceRegistry registry;

  public MappingScopeResolver(LogSourceRegistry registry) {
    this.registry = registry;
  }

  /** {@code sourceId == null}/blank resolves to {@link MappingScopeKey#UNSPECIFIED} — the legacy/global scope, never a lookup failure. */
  public MappingScopeKey resolve(String sourceId, String requestedProject) {
    if (sourceId == null || sourceId.isBlank()) {
      return MappingScopeKey.UNSPECIFIED;
    }
    return registry.find(sourceId)
        .map(source -> {
          SearchRequest probe = SearchRequest.builder().sourceId(sourceId).composeProject(requestedProject).build();
          return MappingScopeKey.of(sourceId, source.resolveMappingScopeLabel(probe));
        })
        .orElseGet(() -> MappingScopeKey.of(sourceId, requestedProject));
  }
}
