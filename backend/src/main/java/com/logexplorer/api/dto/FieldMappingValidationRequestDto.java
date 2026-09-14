package com.logexplorer.api.dto;

import java.util.List;
import java.util.Map;

/**
 * {@code POST /api/v1/settings/field-mapping/validate} request body.
 *
 * <p>{@code proposedCandidates} carries only the fields the user is
 * currently editing (keyed by {@code core.mapping.CanonicalField#key()});
 * every other canonical field falls back to the currently active profile's
 * own existing candidates, so a single-field edit can still be validated in
 * full context (see {@code core.mapping.FieldMappingValidationService#validate}).
 *
 * <p>{@code samples} are the raw Original Source JSON strings the frontend
 * already fetched via {@code POST /api/v1/sources/{id}/field-mapping/samples}
 * and is holding in its own session-memory state — never re-fetched or
 * cached server-side (mission §4/§20). Never logged: see {@code
 * FieldMappingSettingsLeakTest}.
 */
public record FieldMappingValidationRequestDto(
    Map<String, List<String>> proposedCandidates,
    List<String> samples
) {

  @Override
  public String toString() {
    // proposedCandidates (paths) are not sensitive; samples ARE the
    // privileged original-JSON content and must never appear in an
    // accidental log.info("{}", dto) the way SearchRequestDto's own
    // toString() already redacts its own sensitive fields.
    return "FieldMappingValidationRequestDto[proposedCandidates=" + proposedCandidates
        + ", samples=" + (samples == null ? "null" : "[REDACTED, " + samples.size() + " sample(s)]") + "]";
  }
}
