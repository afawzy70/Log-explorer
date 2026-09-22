import { useEffect, useId, useState } from 'react';
import { Icon } from '../../shared/ui/Icon';
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
 * The global, source-independent "Privacy & Masking" settings control -
 * the owner's explicit correction of the prior, incorrect placement of
 * masking information under Docker Settings (masking applies identically
 * to every source: Fixture/Docker/OpenShift/Loki).
 *
 * <p>B6.2 (Session 7) recomposed this from a trigger-button popover into a
 * persistent inline section of the Settings workspace - COMPONENT_
 * INVENTORY.md's own RECOMPOSE row: "Same move → Privacy &amp; masking,
 * 'All sources' scope tag, switches with Masked/Unmasked words, warning
 * banner while any field is unmasked." The per-field control changed from
 * a plain checkbox to a real `role="switch"` (the design's own required
 * grammar) - same underlying boolean toggle, same
 * {@link updateMaskingSetting} call, only the control TYPE changed; state
 * is still exposed via `aria-checked`, never colour alone (the visible
 * Masked/Unmasked word carries the same information). The policy now
 * fetches on mount instead of on trigger-click - this component only
 * mounts once per Settings-workspace open (`App.tsx`'s own takeover
 * ternary), which gives the same "always a fresh fetch" guarantee the old
 * open/close cycle used to provide explicitly.
 *
 * <p>Mission "Field Mapping Schema Scan + Masking Policy Extension" §B:
 * all five protected fields (CIF, Username, Customer ID, Device ID, Device
 * IP) start **unmasked** (`MASKED=NO`) on a fresh install / fresh default
 * state. This component itself has no hardcoded assumption about which way
 * the switches start - it always renders exactly what
 * {@link fetchMaskingSettings} returns.
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
 * value already rendered in the browser from an earlier response. No raw
 * value is ever cached here for a later "reveal" - the panel only ever
 * holds the boolean policy itself.
 */
export function PrivacyMaskingSettingsPanel() {
  const headingId = useId();

  const [settings, setSettings] = useState<MaskingSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingField, setPendingField] = useState<ProtectedFieldKey | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    fetchMaskingSettings()
      .then(setSettings)
      .catch((error: unknown) => setLoadError(error instanceof Error ? error.message : 'Failed to load masking settings'))
      .finally(() => setLoading(false));
    // Mount-once fetch - see the doc comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    <section className={styles.panel} aria-labelledby={headingId} data-testid="privacy-masking-settings-panel">
      <div className={styles.panelHead}>
        <h2 id={headingId} className={styles.heading}>
          Privacy &amp; masking
        </h2>
        <span className={`${styles.scopeTag} ${styles.scopeTagGlobal}`}>
          <Icon name="globe" size="sm" />
          All sources
        </span>
        <span className={styles.roTag}>Applies to new requests only</span>
      </div>

      {anyFieldUnmasked ? (
        <p role="status" className={styles.banner}>
          <Icon name="triangle-alert" size="sm" />
          <span>
            <strong>Some fields are unmasked.</strong> New search results and event details may show real values for
            them. Re-check a field to mask it again for future results.
          </span>
        </p>
      ) : null}

      <div className={styles.panelBody}>
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
            {FIELD_LABELS.map(({ key, label }) => {
              const masked = settings[key];
              return (
                <div key={key} className={styles.switchRow}>
                  <span className={styles.switchLabel}>{label}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={masked}
                    aria-label={`Mask ${label}`}
                    className={styles.switch}
                    disabled={pendingField === key}
                    onClick={() => toggle(key, !masked)}
                  >
                    <span className={styles.track} aria-hidden="true" />
                    <span className={styles.word}>{masked ? 'Masked' : 'Unmasked'}</span>
                  </button>
                  <span className={styles.switchDesc}>
                    {masked
                      ? 'Masked on the server before any response leaves the backend.'
                      : 'Off — new responses include this value unmasked.'}
                  </span>
                </div>
              );
            })}

            {updateError ? (
              <p role="alert" className={styles.error}>
                {updateError}
              </p>
            ) : null}
          </>
        ) : null}

        <p className={styles.footNote}>
          <Icon name="info" size="sm" />
          Fresh installations start with masking off for all five fields. There is no per-row reveal action anywhere
          in Log Explorer.
        </p>
      </div>
    </section>
  );
}
