package com.logexplorer.api;

import com.logexplorer.api.dto.SchemaScanResponseDto;
import com.logexplorer.api.dto.SchemaScanResponseDto.DiscoveredPathEntryDto;
import com.logexplorer.api.dto.SchemaScanResponseDto.OriginalEventSampleDto;
import com.logexplorer.core.mapping.scan.DiscoveredPathEntry;
import com.logexplorer.core.mapping.scan.ObservedType;
import com.logexplorer.core.mapping.scan.OriginalEventSample;
import com.logexplorer.core.mapping.scan.SchemaScanResult;
import com.logexplorer.core.mapping.scan.SchemaScanService;
import java.util.List;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * Quick Schema Scan (owner mission "Field Mapping Schema Scan + Masking
 * Policy Extension" §A, project-scoped per owner mission "Project-Scoped
 * Schema Scan" §1) — nested under {@code /sources/{sourceId}}, same
 * convention as {@link FieldMappingSampleController}, and {@code POST} for
 * the same reason (a real bounded read against the live source).
 *
 * <p><b>Explicit scope</b> (mission §1 — "SCAN_SCOPE_EXPLICIT"): {@code
 * project} is the caller-selected Compose project (Docker) or OpenShift
 * project/namespace context — threaded straight to {@link
 * SchemaScanService#scan}, which resolves the source's own authoritative
 * scope via {@code LogSource#resolveMappingScopeLabel} rather than trusting
 * this parameter blindly for a source (OpenShift) whose real scope is
 * server-side session state. {@code null}/omitted means "this source's
 * default scope" (no project filter for Docker; whatever OpenShift's
 * session currently has selected).
 *
 * <p>New mapping-setup workflow (mission "Field Mapping Schema Scan..."
 * §A/§C, extended by "Project-Scoped Schema Scan"): Select Source → Select
 * Project/Namespace → Quick Schema Scan (this endpoint) → Review Original
 * Event Samples → Review Discovered Source Schema (for that scope only) →
 * Map Fields ({@link FieldMappingSettingsController}) → Validate → Save
 * (that scope's own profile) → Search Ready. The pre-existing {@code
 * /samples} endpoint on {@link FieldMappingSampleController} is left
 * unchanged for backward compatibility (mission §23-style discipline:
 * never remove a working surface) but the new frontend workflow uses this
 * endpoint instead, since it returns both the bounded raw representative
 * samples AND the discovered path union together.
 *
 * <p>Stateless — see {@link SchemaScanService}'s own javadoc.
 */
@RestController
@RequestMapping("/api/v1/sources/{sourceId}/field-mapping")
public class FieldMappingSchemaScanController {

  private final SchemaScanService scanService;

  public FieldMappingSchemaScanController(SchemaScanService scanService) {
    this.scanService = scanService;
  }

  @PostMapping("/schema-scan")
  public Mono<SchemaScanResponseDto> scan(
      @PathVariable String sourceId,
      @RequestParam(required = false) String project,
      @RequestParam(required = false) Integer maxEvents) {
    return scanService.scan(sourceId, project, maxEvents).map(this::toDto);
  }

  private SchemaScanResponseDto toDto(SchemaScanResult result) {
    List<OriginalEventSampleDto> samples = result.representativeEvents().stream()
        .map(this::toDto)
        .toList();
    List<OriginalEventSampleDto> diagnostics = result.diagnosticNonJsonSamples().stream()
        .map(this::toDto)
        .toList();
    List<DiscoveredPathEntryDto> schema = result.discoveredSchema().stream()
        .map(this::toDto)
        .toList();
    return new SchemaScanResponseDto(
        result.sourceId(),
        result.scopeLabel(),
        result.servicesObserved(),
        result.totalEventsInspected(),
        result.structuredJsonEventCount(),
        result.nonJsonEventCount(),
        result.structuralVariantCount(),
        result.totalBytesInspected(),
        result.eventLimitReached(),
        result.byteLimitReached(),
        result.durationLimitReached(),
        samples,
        diagnostics,
        schema,
        result.mappedPathsNotObserved());
  }

  private OriginalEventSampleDto toDto(OriginalEventSample sample) {
    return new OriginalEventSampleDto(sample.originalJson(), sample.severity(), sample.classification().name());
  }

  private DiscoveredPathEntryDto toDto(DiscoveredPathEntry entry) {
    List<String> types = entry.observedTypes().stream().map(ObservedType::name).sorted().toList();
    return new DiscoveredPathEntryDto(entry.path(), types, entry.occurrenceCount(), entry.coveragePercentage());
  }
}
