import { useId, useRef, useState } from 'react';
import { Button } from '../../shared/ui/Button';
import { useDismissableLayer } from '../../shared/ui/useDismissableLayer';
import { usePopoverTrigger } from '../../shared/ui/usePopoverTrigger';
import { fetchMaskingSettings, updateMaskingSetting } from '../../shared/api/client';
import type { MaskingSettings, ProtectedFieldKey } from '../../shared/api/types';
import styles from './PrivacyMaskingSettingsPanel.module.css';

const FIELD_LABELS: ReadonlyArray<{ key: ProtectedFieldKey; label: string }> = [
  { key: 'cif', label: 'CIF' },
  { key: 'userName', label: 'Username' },
  { key: 'customerId', label: 'Customer ID' },
  { key: 'deviceId', label: 'Device ID' },
  { key: 'deviceIp', label: 'Device IP' },
];

/**
 * Pre-closure functional recovery (§11/§12/§13/§14): the global, source-
 * independent "Privacy & Masking" settings control - the owner's explicit
 * correction of the prior, incorrect placement of masking information
 * under Docker Settings (masking applies identically to every source:
 * Fixture/Docker/OpenShift/Loki).
 *
 * <p><b>Mission "Field Mapping Schema Scan + Masking Policy Extension"
 * §B — SUPERSEDES the paragraph immediately below.</b> The owner has
 * explicitly changed the fresh/default state: all five protected fields
 * (CIF, Username, Customer ID, Device ID, Device IP) start **unmasked**
 * (`MASKED=NO`) on a fresh install / fresh default state. The user may
 * explicitly enable masking per field here. This is a code-level default
 * only — this component itself has no hardcoded assumption about which
 * way the checkboxes start; it always renders exactly what {@link
 * fetchMaskingSettings} returns.
 *
 * <p><i>Historical (SUPERSEDED) — Pre-closure functional recovery
 * (§11/§12/§13):</i> the five protected fields remained masked by default
 * (`MASKED=YES`) - this SUPERSEDED the historical "permanently masked, no
 * configurability" rule (recorded, with the supersession made explicit,
 * in the requirements register), not a silent removal of it. Preserved
 * here, not deleted, per this project's own "never erase a historical
 * decision" discipline.
 *
 * <p>Unchecking/checking a field calls the real server-side policy
 * endpoint immediately; the server is the sole authority on whether a
 * value is masked (CLAUDE.md §2 rule 1's masking boundary is unchanged -
 * this control only flips a policy switch that boundary now consults, it
 * does not move enforcement into the browser).
 *
 * <p>Deliberately NOT a per-row "Reveal" button (§13: "Do NOT implement a
 * casual per-row Reveal button") - this is a policy control that affects
 * NEW results going forward; it never attempts to reconstruct or unmask a
 * value already rendered in the browser from an earlier response (there
 * is nothing to reconstruct from - already-masked values were never
 * anything but the mask marker to begin with, by design). No raw value is
 * ever cached here for a later "reveal" - the panel only ever holds the
 * boolean policy itself, fetched fresh on every open, exactly like {@link
 * DockerSettingsPanel} does for its own settings.
 */
export function PrivacyMaskingSettingsPanel() {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const popover = usePopoverTrigger();
  const headingId = useId();

  const [settings, setSettings] = useState<MaskingSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingField, setPendingField] = useState<ProtectedFieldKey | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  useDismissableLayer(wrapperRef, popover.isOpen, close);

  function open() {
    popover.open();
    setLoading(true);
    setLoadError(null);
    fetchMaskingSettings()
      .then(setSettings)
      .catch((error: unknown) => setLoadError(error instanceof Error ? error.message : 'Failed to load masking settings'))
      .finally(() => setLoading(false));
  }

  function close() {
    popover.close();
    setUpdateError(null);
  }

  function toggle(field: ProtectedFieldKey, nextMasked: boolean) {
    setPendingField(field);
    setUpdateError(null);
    updateMaskingSetting(field, nextMasked)
      .then(setSettings)
      .catch((error: unknown) => setUpdateError(error instanceof Error ? error.message : `Failed to update ${field}`))
      .finally(() => setPendingField(null));
  }

  const anyFieldUnmasked = settings != null && FIELD_LABELS.some(({ key }) => settings[key] === false);

  return (
    <div ref={wrapperRef} className={styles.wrapper}>
      <button
        ref={popover.triggerRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="true"
        aria-expanded={popover.isOpen}
        onClick={() => (popover.isOpen ? close() : open())}
      >
        Privacy &amp; masking
      </button>

      {popover.isOpen ? (
        <div className={styles.panel} role="dialog" aria-labelledby={headingId}>
          <h2 id={headingId} className={styles.heading}>
            Privacy &amp; masking
          </h2>
          <p className={styles.hint}>
            Applies to every source (Fixture, Docker, OpenShift, Loki). Masked fields are replaced with a safe marker
            on the server before any response reaches the browser — there is no reveal action for an already-masked
            value.
          </p>

          {loading ? <p role="status">Loading…</p> : null}
          {loadError ? (
            <p role="alert" className={styles.error}>
              {loadError}
            </p>
          ) : null}

          {settings ? (
            <>
              <ul className={styles.fieldList}>
                {FIELD_LABELS.map(({ key, label }) => {
                  const masked = settings[key];
                  const checkboxId = `${headingId}-${key}`;
                  return (
                    <li key={key} className={styles.fieldRow}>
                      <input
                        id={checkboxId}
                        type="checkbox"
                        checked={masked}
                        disabled={pendingField === key}
                        onChange={(event) => toggle(key, event.target.checked)}
                      />
                      <label htmlFor={checkboxId}>{label}</label>
                    </li>
                  );
                })}
              </ul>

              {/*
               * §14 - concise but not obstructive: a single inline notice,
               * not a blocking modal/confirm dialog, and only shown at all
               * once at least one field is actually unmasked.
               */}
              {anyFieldUnmasked ? (
                <p role="status" className={styles.warning}>
                  ⚠ Unmasked fields may show real, unmasked values in new search results and event details. Re-check a
                  field to mask it again for future results.
                </p>
              ) : null}

              {updateError ? (
                <p role="alert" className={styles.error}>
                  {updateError}
                </p>
              ) : null}
            </>
          ) : null}

          <div className={styles.actions}>
            <Button variant="ghost" onClick={close}>
              Close
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
