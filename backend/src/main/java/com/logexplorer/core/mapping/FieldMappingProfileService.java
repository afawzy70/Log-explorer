package com.logexplorer.core.mapping;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.springframework.stereotype.Service;

/**
 * Holds one active {@link FieldMappingProfile} — and its search-readiness
 * gate (mission §15) — <b>per {@link MappingScopeKey}</b> (owner mission
 * "Project-Scoped Schema Scan" §7/§8, superseding this class's earlier
 * "one active profile, not yet per-source" scope note — CLAUDE.md §5 named
 * conflict, applied): a Docker Compose project, an OpenShift namespace, or
 * any other source's logical scope each get their own independent profile,
 * never silently sharing one another's saved mapping.
 *
 * <p>Deliberately still in-memory only, application-wide — the same
 * "single-user local desktop tool, no per-session/per-user state to
 * isolate, resets to the safe default on restart" design {@code
 * core.mask.MaskingPolicyService} and {@code
 * source.openshift.OpenShiftProxyConfigService} already established. A
 * restart always comes back up fully {@code SEARCH_READY} on the built-in
 * default profile for EVERY scope (mission §23 backward compatibility) —
 * a scope with no explicit edits yet simply doesn't exist in {@link
 * #scopes} until first touched, and {@link #stateFor} lazily creates it
 * pre-populated with the untouched default.
 *
 * <p><b>Readiness gate</b> (mission §15, now evaluated per scope — mission
 * §8: "Search readiness must be evaluated against the selected project's
 * saved mapping profile. Changing project/namespace must recalculate
 * readiness."): {@link #isSearchReady(MappingScopeKey)} is {@code true}
 * whenever that scope's active profile is still exactly the untouched
 * built-in default, OR the user has explicitly edited it AND then
 * confirmed a save whose last validation passed for THAT scope. Any edit
 * immediately un-readies search again for that scope only — every other
 * scope's own readiness is completely unaffected.
 *
 * <p>The no-arg overloads below (operating on {@link MappingScopeKey#UNSPECIFIED})
 * are a deliberate convenience for callers with no real scope concept —
 * unit tests exercising mapping mechanics independent of project scoping.
 * Every real production call site (parsing, the search-readiness gate, the
 * schema scan, and the settings controller once given a real {@code
 * sourceId}/project) always resolves and uses a real {@link
 * MappingScopeKey} instead.
 */
@Service
public class FieldMappingProfileService {

  private static final class ScopeState {
    private final AtomicReference<FieldMappingProfile> activeProfile =
        new AtomicReference<>(DefaultFieldMappingProfile.build());
    private final AtomicBoolean modifiedFromDefault = new AtomicBoolean(false);
    private final AtomicBoolean validatedAndSaved = new AtomicBoolean(true);
    /** Owner mission "Mapping Verification and Investigation Workspace" — every field starts {@link FieldVerificationStatus#UNVERIFIED}, regardless of whether it uses the built-in default or an edited candidate (DEFAULT_MAPPING != VERIFIED_MAPPING). {@link ConcurrentHashMap}, not {@link EnumMap}, for safe concurrent single-key updates without external synchronization. */
    private final ConcurrentHashMap<CanonicalField, FieldVerificationStatus> verificationStatuses = freshUnverifiedMap();
  }

  private static ConcurrentHashMap<CanonicalField, FieldVerificationStatus> freshUnverifiedMap() {
    ConcurrentHashMap<CanonicalField, FieldVerificationStatus> map = new ConcurrentHashMap<>();
    for (CanonicalField field : CanonicalField.values()) {
      map.put(field, FieldVerificationStatus.UNVERIFIED);
    }
    return map;
  }

  private final ConcurrentHashMap<MappingScopeKey, ScopeState> scopes = new ConcurrentHashMap<>();

  private ScopeState stateFor(MappingScopeKey scope) {
    return scopes.computeIfAbsent(scope, k -> new ScopeState());
  }

  // ---------------------------------------------------------------- scope-aware API

  public FieldMappingProfile activeProfile(MappingScopeKey scope) {
    return stateFor(scope).activeProfile.get();
  }

  /**
   * Replaces one canonical field's candidate list on {@code scope}'s
   * active profile. Un-readies search for THAT scope only until {@link
   * #confirmSave}. Owner mission "Mapping Verification and Investigation
   * Workspace" — if {@code field} was {@link FieldVerificationStatus#VERIFIED},
   * editing its candidates reverts it to {@link
   * FieldVerificationStatus#UNVERIFIED} (the evidence that justified
   * {@code VERIFIED} no longer necessarily applies to the new candidate);
   * {@code NEEDS_CHANGE} and {@code UNVERIFIED} are left exactly as they
   * are — an edit does not itself count as re-verification.
   */
  public FieldMappingProfile updateCandidates(MappingScopeKey scope, CanonicalField field, List<JsonPath> newCandidates) {
    ScopeState state = stateFor(scope);
    FieldMappingProfile updated = state.activeProfile.updateAndGet(p -> p.withCandidates(field, newCandidates));
    state.modifiedFromDefault.set(true);
    state.validatedAndSaved.set(false);
    state.verificationStatuses.computeIfPresent(field,
        (f, status) -> status == FieldVerificationStatus.VERIFIED ? FieldVerificationStatus.UNVERIFIED : status);
    return updated;
  }

  /** See the no-arg {@link #confirmSave(boolean)}'s own javadoc — identical contract, scoped to {@code scope} only. */
  public boolean confirmSave(MappingScopeKey scope, boolean validationPassed) {
    stateFor(scope).validatedAndSaved.set(validationPassed);
    return isSearchReady(scope);
  }

  /**
   * Restores {@code scope}'s built-in default profile — always
   * immediately {@code SEARCH_READY} again for that scope. Also resets
   * every field's verification status back to {@link
   * FieldVerificationStatus#UNVERIFIED} — a whole-profile reset discards
   * any prior verification evidence along with the candidates it was
   * evidence for.
   */
  public FieldMappingProfile resetToDefault(MappingScopeKey scope) {
    FieldMappingProfile def = DefaultFieldMappingProfile.build();
    ScopeState state = stateFor(scope);
    state.activeProfile.set(def);
    state.modifiedFromDefault.set(false);
    state.validatedAndSaved.set(true);
    for (CanonicalField field : CanonicalField.values()) {
      state.verificationStatuses.put(field, FieldVerificationStatus.UNVERIFIED);
    }
    return def;
  }

  public boolean isModifiedFromDefault(MappingScopeKey scope) {
    return stateFor(scope).modifiedFromDefault.get();
  }

  public boolean isSearchReady(MappingScopeKey scope) {
    ScopeState state = stateFor(scope);
    return !state.modifiedFromDefault.get() || state.validatedAndSaved.get();
  }

  // ---------------------------------------------------------------- verification status (mission "Mapping Verification and Investigation Workspace")

  /** {@code scope}'s current verification status for {@code field} — {@link FieldVerificationStatus#UNVERIFIED} until explicitly changed. */
  public FieldVerificationStatus verificationStatus(MappingScopeKey scope, CanonicalField field) {
    return stateFor(scope).verificationStatuses.getOrDefault(field, FieldVerificationStatus.UNVERIFIED);
  }

  /** Every field's current verification status for {@code scope}, for the mapping verification page's own table. */
  public Map<CanonicalField, FieldVerificationStatus> allVerificationStatuses(MappingScopeKey scope) {
    return Map.copyOf(stateFor(scope).verificationStatuses);
  }

  /**
   * Sets {@code field} to {@link FieldVerificationStatus#VERIFIED} for
   * {@code scope}. Deliberately a pure state setter with no evidence
   * check of its own — the evidence gate (re-running {@code
   * FieldMappingValidationService} against real samples and requiring
   * {@code foundInAnySample()}) lives in {@code
   * FieldMappingSettingsController}'s verify endpoint, the only
   * production caller of this method, so verification is evidence-based
   * by construction at the API boundary, not by convention here.
   */
  public void markVerified(MappingScopeKey scope, CanonicalField field) {
    stateFor(scope).verificationStatuses.put(field, FieldVerificationStatus.VERIFIED);
  }

  /** Sets {@code field} to {@link FieldVerificationStatus#NEEDS_CHANGE} for {@code scope} — a deliberate user flag, no evidence required to set it. */
  public void markNeedsChange(MappingScopeKey scope, CanonicalField field) {
    stateFor(scope).verificationStatuses.put(field, FieldVerificationStatus.NEEDS_CHANGE);
  }

  /** Every scope this service currently holds any state for (diagnostics/testing only — never persisted, never exposed raw to the browser). */
  public Set<MappingScopeKey> knownScopes() {
    return Set.copyOf(scopes.keySet());
  }

  // ---------------------------------------------------------------- no-arg convenience (MappingScopeKey.UNSPECIFIED)

  public FieldMappingProfile activeProfile() {
    return activeProfile(MappingScopeKey.UNSPECIFIED);
  }

  public FieldMappingProfile updateCandidates(CanonicalField field, List<JsonPath> newCandidates) {
    return updateCandidates(MappingScopeKey.UNSPECIFIED, field, newCandidates);
  }

  public boolean confirmSave(boolean validationPassed) {
    return confirmSave(MappingScopeKey.UNSPECIFIED, validationPassed);
  }

  public FieldMappingProfile resetToDefault() {
    return resetToDefault(MappingScopeKey.UNSPECIFIED);
  }

  public boolean isModifiedFromDefault() {
    return isModifiedFromDefault(MappingScopeKey.UNSPECIFIED);
  }

  public boolean isSearchReady() {
    return isSearchReady(MappingScopeKey.UNSPECIFIED);
  }
}
