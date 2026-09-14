package com.logexplorer.core.mapping;

import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.springframework.stereotype.Service;

/**
 * Holds the single active {@link FieldMappingProfile} and the search
 * readiness gate (mission §15) it controls.
 *
 * <p>Deliberately in-memory only, application-wide — the same "single-user
 * local desktop tool, no per-session/per-user state to isolate, resets to
 * the safe default on restart" design {@code core.mask.MaskingPolicyService}
 * and {@code source.openshift.OpenShiftProxyConfigService} already
 * established. A restart always comes back up fully {@code SEARCH_READY} on
 * the built-in default profile — the maximally safe failure mode (mission
 * §23 backward compatibility).
 *
 * <p><b>Scope</b> (mission §13): one active profile, not yet per-source or
 * per-application profiles — {@link FieldMappingProfile} already carries an
 * {@code id}/{@code name} so a later mission can extend this service to a
 * {@code Map<String, FieldMappingProfile>} keyed by scope without changing
 * the profile model itself.
 *
 * <p><b>Readiness gate</b> (mission §15): {@link #isSearchReady()} is
 * {@code true} whenever the active profile is still exactly the untouched
 * built-in default (mission §23 — "Existing supported log formats must
 * continue working... without requiring immediate manual setup"), OR the
 * user has explicitly edited it AND then confirmed a save whose last
 * validation passed ({@link #confirmSave}). Any edit
 * ({@link #updateCandidates}) immediately un-readies search again until the
 * next successful validate-and-save — mapping is never silently left
 * half-configured while Search stays open (mission §15: "Search must NOT
 * silently operate with an invalid/unverified mapping").
 */
@Service
public class FieldMappingProfileService {

  private final AtomicReference<FieldMappingProfile> activeProfile =
      new AtomicReference<>(DefaultFieldMappingProfile.build());
  private final AtomicBoolean modifiedFromDefault = new AtomicBoolean(false);
  private final AtomicBoolean validatedAndSaved = new AtomicBoolean(true);

  public FieldMappingProfile activeProfile() {
    return activeProfile.get();
  }

  /** Replaces one canonical field's candidate list on the active profile. Un-readies search until {@link #confirmSave} succeeds. */
  public FieldMappingProfile updateCandidates(CanonicalField field, List<JsonPath> newCandidates) {
    FieldMappingProfile updated = activeProfile.updateAndGet(p -> p.withCandidates(field, newCandidates));
    modifiedFromDefault.set(true);
    validatedAndSaved.set(false);
    return updated;
  }

  /**
   * Called once the frontend has run {@link FieldMappingValidationService#validate}
   * against real samples and the user explicitly chooses to save (mission
   * §14 step 8 "Save mapping"). {@code validationPassed} must be the result
   * of that same validation call — the controller never marks a save valid
   * without a validation report backing it.
   */
  public boolean confirmSave(boolean validationPassed) {
    validatedAndSaved.set(validationPassed);
    return isSearchReady();
  }

  /** Restores the built-in default profile — always immediately {@code SEARCH_READY} again. */
  public FieldMappingProfile resetToDefault() {
    FieldMappingProfile def = DefaultFieldMappingProfile.build();
    activeProfile.set(def);
    modifiedFromDefault.set(false);
    validatedAndSaved.set(true);
    return def;
  }

  public boolean isModifiedFromDefault() {
    return modifiedFromDefault.get();
  }

  public boolean isSearchReady() {
    return !modifiedFromDefault.get() || validatedAndSaved.get();
  }
}
