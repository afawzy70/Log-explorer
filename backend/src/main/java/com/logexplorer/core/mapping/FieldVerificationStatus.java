package com.logexplorer.core.mapping;

/**
 * Owner mission "Mapping Verification and Investigation Workspace" —
 * whether a canonical field's active candidate mapping has been
 * explicitly accepted by a human as correct for the CURRENT scope
 * (source + project/namespace), never inferred merely from the mapping
 * still being the untouched built-in default.
 *
 * <p><b>DEFAULT_MAPPING != VERIFIED_MAPPING</b> — every field starts
 * {@link #UNVERIFIED} regardless of whether it currently uses the
 * built-in default candidate or a user-edited one; the built-in default
 * (e.g. CIF → {@code mdc.cif}, correlation ID →
 * {@code mdc.X-Correlation-id} then the literal
 * {@code mdc["event.correlationId"]}) is a historically-known-good
 * CANDIDATE, not proof it is correct for this specific source's real
 * data — see {@code DefaultFieldMappingProfile}'s own javadoc for exactly
 * which fields have a real historical default and which (like {@code
 * JOURNEY_NAME}) deliberately have none at all, never guessed.
 *
 * <p>{@link #VERIFIED} is set only through {@code
 * FieldMappingSettingsController}'s evidence-gated verify endpoint, which
 * re-runs {@link FieldMappingValidationService} against real samples and
 * refuses to verify a field whose candidate was not actually found in any
 * of them — verification is evidence-based by construction, not merely a
 * UI checkbox trusted at face value.
 *
 * <p>{@link #NEEDS_CHANGE} is a deliberate, explicit user flag ("I have
 * looked at this and it is wrong/insufficient") — independent of whether
 * the field's candidate paths happen to validate; a field can be flagged
 * {@code NEEDS_CHANGE} even while still technically search-ready, because
 * verification and search-readiness are related but not identical
 * concepts (mission: "a saved default mapping may be technically
 * search-ready but still UNVERIFIED from the owner's mapping-verification
 * perspective").
 *
 * <p>Scoped identically to {@link FieldMappingProfile} itself — see
 * {@link FieldMappingProfileService}'s own javadoc for the per-{@link
 * MappingScopeKey} storage this status lives alongside. Editing a
 * verified field's candidates automatically reverts it to {@link
 * #UNVERIFIED} (the evidence that justified {@code VERIFIED} no longer
 * necessarily applies to the new candidate) — never silently left showing
 * a stale {@code VERIFIED} badge, and never silently auto-promoted back
 * to {@code VERIFIED} by a save alone.
 */
public enum FieldVerificationStatus {
  UNVERIFIED,
  VERIFIED,
  NEEDS_CHANGE
}
