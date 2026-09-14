package com.logexplorer.api.dto;

import java.util.List;

/**
 * {@code GET /api/v1/settings/field-mapping} response — the current active
 * profile plus its readiness state, now for one specific project/namespace
 * scope (owner mission "Project-Scoped Schema Scan" §7/§8). {@code
 * sourceId}/{@code scopeLabel} echo back exactly which scope this profile
 * belongs to (mission §6-style transparency) — {@code scopeLabel} is
 * {@code null} for a source with no sub-project concept or none selected.
 *
 * <p>{@code verificationStatus} (owner mission "Mapping Verification and
 * Investigation Workspace") is deliberately separate from {@code
 * searchReady} — a field can be search-ready (its candidate resolves
 * without a parse error) while still {@code UNVERIFIED} from the owner's
 * mapping-verification perspective: DEFAULT_MAPPING != VERIFIED_MAPPING.
 */
public record FieldMappingProfileDto(
    String sourceId,
    String scopeLabel,
    List<CanonicalFieldMappingDto> fields,
    boolean modifiedFromDefault,
    boolean searchReady
) {

  public record CanonicalFieldMappingDto(
      String field,
      String displayName,
      boolean sensitive,
      List<String> candidatePaths,
      String verificationStatus
  ) {
  }
}
