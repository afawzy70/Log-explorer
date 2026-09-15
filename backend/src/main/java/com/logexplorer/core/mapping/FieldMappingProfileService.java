package com.logexplorer.core.mapping;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
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
    /**
     * Owner mission "Mapping Verification and Investigation Workspace"
     * established the field, <b>superseded in part</b> by owner mission
     * "Service Filter, Docker Performance, and Verified Default Mapping"
     * §C (CLAUDE.md §5 named conflict, applied): the ORIGINAL rule — every
     * field starts {@link FieldVerificationStatus#UNVERIFIED} regardless of
     * whether it uses the built-in default or an edited candidate
     * ("DEFAULT_MAPPING != VERIFIED_MAPPING") — was written before the
     * owner had reviewed and approved a specific built-in default mapping
     * against real source JSON. Now that the owner has explicitly approved
     * one (see {@link DefaultFieldMappingProfile}'s own javadoc), that
     * approval itself IS the evidence: an untouched owner-approved default
     * candidate starts {@link FieldVerificationStatus#VERIFIED}, never
     * {@code UNVERIFIED}, and a Quick Schema Scan is never required to
     * establish it. A field the owner deliberately left unmapped ({@link
     * CanonicalField#JOURNEY_ID}/{@link CanonicalField#UI_IDENTIFIER}, both
     * with zero default candidates) still starts {@code UNVERIFIED} — there
     * is no default to have approved. The general "verified means evidence-
     * checked, never inferred" principle is UNCHANGED for anything the
     * owner did not explicitly approve: the moment a field is edited away
     * from its untouched default, it reverts to {@code UNVERIFIED} exactly
     * as before (see {@link #updateCandidates}) and requires the normal
     * evidence-gated {@code /verify} flow, never auto-verified. {@link
     * ConcurrentHashMap}, not {@link EnumMap}, for safe concurrent
     * single-key updates without external synchronization.
     */
    private final ConcurrentHashMap<CanonicalField, FieldVerificationStatus> verificationStatuses =
        freshDefaultVerificationMap();
    /**
     * Owner mission "Service Filter, Docker Performance, and Verified
     * Default Mapping" §C review recovery — a real, previously-latent
     * defect this mission's own change exposed: {@code
     * source.fixture.FixtureLogSource} memoizes its parsed corpus once
     * per JVM lifetime for performance (re-parsing a fixed 250-line
     * corpus on every search would be wasteful), so a mapping change made
     * after that source's first-ever search previously had no effect on
     * already-cached parsed events - invisible while every field had a
     * default (nothing to reconfigure), but a real, observable gap now
     * that Journey ID/UI Identifier require explicit configuration:
     * reconfiguring one, then searching, silently kept showing the old
     * (unmapped) result. This counter lets any cache keyed to a scope's
     * mapping invalidate itself cheaply (a single volatile-read comparison)
     * without polling or re-parsing eagerly - bumped on every real change
     * to the scope's active profile, read via {@link #generation}.
     */
    private final AtomicLong generation = new AtomicLong(0);
  }

  /**
   * The current mapping generation for {@code scope} - increases by
   * exactly one on every {@link #updateCandidates}/{@link #resetToDefault}
   * call for that scope, never on a read-only call. A caller that caches
   * anything derived from this scope's mapping (see {@code
   * source.fixture.FixtureLogSource#corpus()}) can cheaply detect
   * staleness by comparing the generation it built its cache with against
   * this current value, instead of either never invalidating (the
   * pre-existing defect this exists to fix) or re-checking/re-parsing
   * unconditionally on every access (defeating the point of caching at
   * all).
   */
  public long generation(MappingScopeKey scope) {
    return stateFor(scope).generation.get();
  }

  /**
   * A field with a non-empty owner-approved built-in default candidate
   * starts {@link FieldVerificationStatus#VERIFIED}; a field the owner
   * deliberately left unmapped by default (zero candidates) starts {@link
   * FieldVerificationStatus#UNVERIFIED} — derived directly from {@link
   * DefaultFieldMappingProfile#build()} itself (never a second, hand-
   * maintained field list that could silently drift out of sync with it).
   */
  private static ConcurrentHashMap<CanonicalField, FieldVerificationStatus> freshDefaultVerificationMap() {
    ConcurrentHashMap<CanonicalField, FieldVerificationStatus> map = new ConcurrentHashMap<>();
    FieldMappingProfile builtInDefault = DefaultFieldMappingProfile.build();
    for (CanonicalField field : CanonicalField.values()) {
      boolean hasApprovedDefault = !builtInDefault.candidates(field).isEmpty();
      map.put(field, hasApprovedDefault ? FieldVerificationStatus.VERIFIED : FieldVerificationStatus.UNVERIFIED);
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
    state.generation.incrementAndGet();
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
   * immediately {@code SEARCH_READY} again for that scope. Also restores
   * every field's verification status back to exactly the fresh-scope
   * state (owner mission "Service Filter, Docker Performance, and
   * Verified Default Mapping" §C, superseding this method's own original
   * "resets every field to UNVERIFIED" behavior — CLAUDE.md §5): every
   * owner-approved default candidate comes back {@code VERIFIED} (a
   * whole-profile reset discards any CUSTOM verification evidence along
   * with the custom candidates it was evidence for, but never discards the
   * owner's own standing approval of the built-in default itself), and
   * {@link CanonicalField#JOURNEY_ID}/{@link CanonicalField#UI_IDENTIFIER}
   * come back {@code UNVERIFIED} with no candidate — never silently
   * carrying over a stale custom mapping or its verification status.
   */
  public FieldMappingProfile resetToDefault(MappingScopeKey scope) {
    FieldMappingProfile def = DefaultFieldMappingProfile.build();
    ScopeState state = stateFor(scope);
    state.activeProfile.set(def);
    state.modifiedFromDefault.set(false);
    state.validatedAndSaved.set(true);
    state.generation.incrementAndGet();
    freshDefaultVerificationMap().forEach(state.verificationStatuses::put);
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
