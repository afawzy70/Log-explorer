package com.logexplorer.core.mask;

import java.util.EnumMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Service;

/**
 * Pre-closure functional recovery (§12/§13/§16): the owner's explicit
 * policy supersession — protected fields remain masked by default
 * ({@code MASKED=YES}), but the user may now individually disable masking
 * per field via a global, source-independent settings control. This
 * SUPERSEDES the historical "permanently masked, no configurability" rule
 * (CLAUDE.md §2 rule 1's own "no reveal action" wording predates this
 * decision — see the requirements register for the explicit supersession
 * record); it does not delete that history, and the "no reveal action"
 * invariant for an *individual already-fetched value* still holds exactly
 * as before — this changes what the server sends in NEW results going
 * forward, never reconstructs or unmask a value already in the browser.
 *
 * <p>Deliberately in-memory only, application-wide (this is a single-user
 * local desktop tool, not a multi-tenant service — there is no per-session
 * or per-user policy to isolate). Every backend restart resets every field
 * back to the safe default (masked), which is the maximally safe failure
 * mode: an unmasked policy can never silently survive a restart or a
 * fresh install. {@link ConcurrentHashMap} backing (via a synchronized
 * {@link EnumMap} snapshot on read) makes concurrent WebFlux request
 * threads safe without a heavier lock.
 */
@Service
public class MaskingPolicyService {

  private final Map<ProtectedField, Boolean> maskedByField = new ConcurrentHashMap<>();

  public MaskingPolicyService() {
    resetToDefaults();
  }

  /** {@code true} (masked, the safe default) unless the user has explicitly disabled masking for this field. */
  public boolean isMasked(ProtectedField field) {
    return maskedByField.getOrDefault(field, Boolean.TRUE);
  }

  public void setMasked(ProtectedField field, boolean masked) {
    maskedByField.put(field, masked);
  }

  /** A stable, ordered snapshot of the current policy — safe to serialize directly. */
  public Map<ProtectedField, Boolean> currentPolicy() {
    Map<ProtectedField, Boolean> snapshot = new EnumMap<>(ProtectedField.class);
    for (ProtectedField field : ProtectedField.values()) {
      snapshot.put(field, isMasked(field));
    }
    return snapshot;
  }

  /** Restores every field to the safe default (masked=true) — used at construction, and available for tests. */
  public void resetToDefaults() {
    for (ProtectedField field : ProtectedField.values()) {
      maskedByField.put(field, Boolean.TRUE);
    }
  }
}
