package com.logexplorer.core.mask;

import java.util.EnumMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Service;

/**
 * <p><b>Owner mission "Field Mapping Schema Scan + Masking Policy
 * Extension" — SUPERSEDES the policy below.</b> The owner has explicitly
 * changed the fresh/default state: {@code MASKED=NO} for all five
 * protected fields on a fresh install / fresh default state. This is
 * recorded, not silently applied — see the requirements register (§20)
 * for the full supersession record. The paragraph immediately below is
 * preserved verbatim as history, not deleted, per this project's own
 * "never erase a historical decision" discipline (CLAUDE.md §5).
 *
 * <p><i>Historical (SUPERSEDED) — Pre-closure functional recovery
 * (§12/§13/§16):</i> the owner's explicit policy supersession — protected
 * fields remain masked by default ({@code MASKED=YES}), but the user may
 * now individually disable masking per field via a global,
 * source-independent settings control. This SUPERSEDES the historical
 * "permanently masked, no configurability" rule (CLAUDE.md §2 rule 1's
 * own "no reveal action" wording predates this decision); it does not
 * delete that history, and the "no reveal action" invariant for an
 * *individual already-fetched value* still holds exactly as before — this
 * changes what the server sends in NEW results going forward, never
 * reconstructs or unmasks a value already in the browser.
 *
 * <p><b>What has NOT changed</b> (mission §B2/B3 — the masking
 * architecture remains fully intact regardless of which way the default
 * points): sensitive-field classification ({@link ProtectedField}) is
 * unaffected; {@link MaskingService} still enforces server-side masking
 * whenever a field's policy is {@code true}; there is still no per-row
 * "reveal" action anywhere; the field-mapping profile ({@code
 * core.mapping}) still cannot influence this policy in any way — which
 * canonical field a raw value came from, or which JSON path supplied it,
 * is invisible to this class entirely.
 *
 * <p><b>Migration note (mission §B1 — "do not overwrite an existing
 * user's stored masking preferences").</b> This service has never
 * persisted policy to disk — it is, and always has been, in-memory only,
 * reset to whatever the current code's default is on every backend
 * restart (see below). There is therefore no separate "existing
 * installation" state this code change could silently overwrite: a
 * running backend's current in-session policy (whatever a user has
 * already explicitly set via {@link #setMasked}) is untouched by this
 * change and untouched by any restart-unrelated code path — only an
 * actual process restart (a "fresh install" in this architecture's own
 * terms) ever re-applies the default, and that default is what this
 * mission changes. If a future mission adds real persistence, that
 * persistence layer — not this default — becomes the thing responsible
 * for preserving an explicit prior choice across restarts.
 *
 * <p>Deliberately in-memory only, application-wide (this is a single-user
 * local desktop tool, not a multi-tenant service — there is no per-session
 * or per-user policy to isolate). {@link ConcurrentHashMap} backing (via a
 * synchronized {@link EnumMap} snapshot on read) makes concurrent WebFlux
 * request threads safe without a heavier lock.
 */
@Service
public class MaskingPolicyService {

  private final Map<ProtectedField, Boolean> maskedByField = new ConcurrentHashMap<>();

  public MaskingPolicyService() {
    resetToDefaults();
  }

  /**
   * {@code false} (unmasked, the current fresh-state default per the
   * owner's explicit supersession) unless the user has explicitly
   * enabled masking for this field. See class javadoc for the full
   * history of this default.
   */
  public boolean isMasked(ProtectedField field) {
    return maskedByField.getOrDefault(field, Boolean.FALSE);
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

  /** Restores every field to the current fresh-state default (masked=false) — used at construction, and available for tests. */
  public void resetToDefaults() {
    for (ProtectedField field : ProtectedField.values()) {
      maskedByField.put(field, Boolean.FALSE);
    }
  }
}
