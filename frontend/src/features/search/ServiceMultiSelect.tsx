import { useId, useMemo, useRef, useState } from 'react';
import type { ServiceInfo } from '../../shared/api/types';
import { Button } from '../../shared/ui/Button';
import { VisuallyHidden } from '../../shared/ui/VisuallyHidden';
import { useDismissableLayer } from '../../shared/ui/useDismissableLayer';
import { usePopoverTrigger } from '../../shared/ui/usePopoverTrigger';
import styles from './ServiceMultiSelect.module.css';

export type ServiceFilterMode = 'INCLUDE' | 'EXCLUDE';

export interface ServiceMultiSelectProps {
  services: ServiceInfo[];
  selected: string[];
  onChange: (next: string[]) => void;
  /**
   * Owner mission "Service Filter, Docker Performance, and Verified
   * Default Mapping" §A — whether `selected` is an allow-list ("Include
   * selected") or a deny-list ("Exclude selected"). Defaults to INCLUDE
   * when omitted, so any caller that hasn't wired this yet is unaffected.
   */
  mode?: ServiceFilterMode;
  onModeChange?: (next: ServiceFilterMode) => void;
}

/**
 * Accessible searchable checkbox multi-select (IMPLEMENTATION_PLAN.md
 * "Phase F" scope item 3) - deliberately not a native `<select multiple>`,
 * which would require an inaccessible Ctrl/Cmd-click gesture.
 */
export function ServiceMultiSelect({ services, selected, onChange, mode = 'INCLUDE', onModeChange }: ServiceMultiSelectProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const popover = usePopoverTrigger();
  const [filter, setFilter] = useState('');
  const searchId = useId();

  useDismissableLayer(wrapperRef, popover.isOpen, popover.close);

  const filtered = useMemo(
    () => services.filter((s) => s.name.toLowerCase().includes(filter.toLowerCase())),
    [services, filter],
  );

  function toggle(name: string) {
    if (selected.includes(name)) {
      onChange(selected.filter((s) => s !== name));
    } else {
      onChange([...selected, name]);
    }
  }

  // EXCLUDE with an empty list means "no restriction," identical to
  // INCLUDE with an empty list (owner mission "Service Filter, Docker
  // Performance, and Verified Default Mapping" §A) - so the empty-selection
  // label never depends on mode, only a non-empty selection's wording does.
  const triggerLabel =
    selected.length === 0
      ? 'All services'
      : mode === 'EXCLUDE'
        ? selected.length === 1
          ? `All except ${selected[0]}`
          : `All except ${selected.length} services`
        : selected.length === 1
          ? selected[0]
          : `${selected.length} services`;

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
        <span className={styles.triggerLabel}>{triggerLabel}</span>
        {selected.length > 0 ? <span className={styles.badge}>{selected.length}</span> : null}
      </button>

      {popover.isOpen ? (
        <div className={styles.panel} role="dialog" aria-label="Select services">
          {onModeChange ? (
            <div className={styles.modeGroup} role="group" aria-label="Service filter mode">
              <button
                type="button"
                className={styles.modeButton}
                aria-pressed={mode === 'INCLUDE'}
                onClick={() => onModeChange('INCLUDE')}
              >
                Include selected
              </button>
              <button
                type="button"
                className={styles.modeButton}
                aria-pressed={mode === 'EXCLUDE'}
                onClick={() => onModeChange('EXCLUDE')}
              >
                Exclude selected
              </button>
            </div>
          ) : null}
          <label htmlFor={searchId}>
            <VisuallyHidden>Search services</VisuallyHidden>
          </label>
          <input
            id={searchId}
            className={styles.searchInput}
            type="text"
            placeholder="Search services…"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            autoFocus
          />
          <div className={styles.list} role="group" aria-label="Services">
            {filtered.length === 0 ? (
              <p className={styles.emptyState}>No services match “{filter}”.</p>
            ) : (
              filtered.map((service) => (
                <label key={service.name} className={styles.option}>
                  <input
                    type="checkbox"
                    checked={selected.includes(service.name)}
                    onChange={() => toggle(service.name)}
                  />
                  <span>{service.name}</span>
                  <span className={styles.optionMeta}>
                    {service.runningCount}/{service.totalCount} running
                  </span>
                </label>
              ))
            )}
          </div>
          <div className={styles.footer}>
            <span>{selected.length} selected</span>
            <Button variant="ghost" onClick={() => onChange([])} disabled={selected.length === 0}>
              Clear
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
