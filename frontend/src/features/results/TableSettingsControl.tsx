import { useId, useRef } from 'react';
import { Button } from '../../shared/ui/Button';
import { useDismissableLayer } from '../../shared/ui/useDismissableLayer';
import { usePopoverTrigger } from '../../shared/ui/usePopoverTrigger';
import { COLUMN_REGISTRY_BY_ID } from './columnRegistry';
import type { TablePreferencesHandle } from './tablePreferences';
import styles from './TableSettingsControl.module.css';

/**
 * The "Columns" control (Legacy Remediation Slice 4,
 * `docs/LEGACY_TO_NEW_REMEDIATION_PLAN.md` §"Slice 4") - a single compact
 * popover covering every power-user table capability this slice adds
 * (show/hide, reorder, density, reset), rather than three separate
 * buttons cluttering the results toolbar. Every change here applies (and
 * persists) immediately - there is no draft/Apply/Cancel step, unlike
 * `AdvancedFilters`/`QueryBuilder`: nothing in this panel can fire a
 * search, discard investigation state, or do anything non-trivially
 * reversible (Reset always undoes everything), so instant feedback is
 * both simpler and more appropriate here than a commit gesture would be.
 *
 * <p>Reordering is a plain, fully keyboard-operable ordered list with
 * Move up/down buttons per row - deliberately not drag-and-drop (this
 * slice's own explicit requirement: "provide a keyboard-accessible
 * alternative... do not make drag-and-drop the only interaction" - the
 * simplest way to satisfy that is to not need one).
 */
export function TableSettingsControl({ table }: { table: TablePreferencesHandle }) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const popover = usePopoverTrigger();
  const headingId = useId();

  useDismissableLayer(wrapperRef, popover.isOpen, popover.close);

  const { preferences } = table;
  const visibleCount = preferences.columnOrder.length - preferences.hiddenColumnIds.length;

  return (
    <div ref={wrapperRef} className={styles.wrapper}>
      <button
        ref={popover.triggerRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="true"
        aria-expanded={popover.isOpen}
        onClick={() => (popover.isOpen ? popover.close() : popover.open())}
      >
        Columns
      </button>

      {popover.isOpen ? (
        <div className={styles.panel} role="dialog" aria-labelledby={headingId}>
          <h2 id={headingId} className={styles.heading}>
            Table settings
          </h2>

          <fieldset className={styles.densityGroup}>
            <legend className={styles.sectionLabel}>Density</legend>
            <div className={styles.densityToggle} role="group" aria-label="Density">
              <button
                type="button"
                aria-pressed={preferences.density === 'comfortable'}
                className={preferences.density === 'comfortable' ? styles.densityActive : styles.densityButton}
                onClick={() => table.setDensity('comfortable')}
              >
                Comfortable
              </button>
              <button
                type="button"
                aria-pressed={preferences.density === 'compact'}
                className={preferences.density === 'compact' ? styles.densityActive : styles.densityButton}
                onClick={() => table.setDensity('compact')}
              >
                Compact
              </button>
            </div>
          </fieldset>

          <div className={styles.columnsSection}>
            <h3 className={styles.sectionLabel}>Columns</h3>
            <p className={styles.hint}>Actions is always shown, last, and cannot be moved.</p>
            <ol className={styles.columnList}>
              {preferences.columnOrder.map((id, index) => {
                const column = COLUMN_REGISTRY_BY_ID.get(id);
                if (!column) {
                  return null;
                }
                const isVisible = !preferences.hiddenColumnIds.includes(id);
                const isOnlyVisible = isVisible && visibleCount <= 1;
                const checkboxId = `${headingId}-col-${id}`;
                return (
                  <li key={id} className={styles.columnRow}>
                    <input
                      id={checkboxId}
                      type="checkbox"
                      checked={isVisible}
                      disabled={isOnlyVisible}
                      aria-describedby={isOnlyVisible ? `${headingId}-only-visible-hint` : undefined}
                      onChange={(event) => table.setColumnVisible(id, event.target.checked)}
                    />
                    <label htmlFor={checkboxId} className={styles.columnLabel}>
                      {column.label}
                    </label>
                    <span className={styles.moveButtons}>
                      <button
                        type="button"
                        aria-label={`Move ${column.label} up`}
                        disabled={index === 0}
                        onClick={() => table.moveColumn(id, 'up')}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${column.label} down`}
                        disabled={index === preferences.columnOrder.length - 1}
                        onClick={() => table.moveColumn(id, 'down')}
                      >
                        ↓
                      </button>
                    </span>
                  </li>
                );
              })}
            </ol>
            <p id={`${headingId}-only-visible-hint`} className={styles.hint}>
              At least one column besides Actions must stay visible.
            </p>
          </div>

          <div className={styles.actions}>
            <Button variant="ghost" onClick={table.reset}>
              Reset table
            </Button>
            <Button variant="primary" onClick={popover.close}>
              Close
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
