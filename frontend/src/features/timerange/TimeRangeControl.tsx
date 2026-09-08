import { useRef, useState } from 'react';
import { useDismissableLayer } from '../../shared/ui/useDismissableLayer';
import { usePopoverTrigger } from '../../shared/ui/usePopoverTrigger';
import { formatZoneLabel } from '../../shared/time/timezone';
import { CUSTOM_RANGE_ID, TIME_RANGE_PRESETS } from '../../shared/time/presets';
import { CustomRangePopover } from './CustomRangePopover';
import { getPopoverInitialValues } from './prefill';
import { getTimeRangeDisplayLabel } from './label';
import type { CommittedTimeRange } from './types';
import { isCustomRange } from './types';
import styles from './TimeRangeControl.module.css';

export interface TimeRangeControlProps {
  value: CommittedTimeRange;
  onChange: (next: CommittedTimeRange) => void;
}

/** Time Range (IMPLEMENTATION_PLAN.md "Phase F" scope item 7) - the full screenshot-driven contract. */
export function TimeRangeControl({ value, onChange }: TimeRangeControlProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const menu = usePopoverTrigger();
  const [showCustomEditor, setShowCustomEditor] = useState(false);

  useDismissableLayer(wrapperRef, menu.isOpen && !showCustomEditor, menu.close);

  function selectPreset(presetId: string) {
    const preset = TIME_RANGE_PRESETS.find((p) => p.id === presetId);
    if (!preset) {
      return;
    }
    const end = new Date();
    const start = new Date(end.getTime() - preset.durationMs);
    onChange({ presetId, start: start.toISOString(), end: end.toISOString() });
    setShowCustomEditor(false);
    menu.close();
  }

  function openCustomEditor() {
    setShowCustomEditor(true);
  }

  function applyCustomRange(startIso: string, endIso: string) {
    onChange({ presetId: CUSTOM_RANGE_ID, start: startIso, end: endIso });
    setShowCustomEditor(false);
    menu.close();
  }

  function cancelCustomEditor() {
    setShowCustomEditor(false);
    menu.close();
  }

  const label = getTimeRangeDisplayLabel(value);
  const zoneLabel = isCustomRange(value) ? formatZoneLabel(new Date(value.end)) : null;
  const popoverInitial = showCustomEditor ? getPopoverInitialValues(value) : null;

  return (
    <div ref={wrapperRef} className={styles.wrapper}>
      <button
        ref={menu.triggerRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="true"
        aria-expanded={menu.isOpen}
        onClick={() => (menu.isOpen ? menu.close() : menu.open())}
      >
        <span aria-hidden="true">🕐</span>
        <span className={styles.triggerLabel}>{label}</span>
        {zoneLabel ? <span className={styles.triggerZone}>{zoneLabel}</span> : null}
      </button>

      {menu.isOpen && !showCustomEditor ? (
        <div className={styles.menu} role="menu" aria-label="Time range presets">
          {TIME_RANGE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              role="menuitemradio"
              aria-checked={value.presetId === preset.id}
              aria-current={value.presetId === preset.id}
              className={styles.menuItem}
              onClick={() => selectPreset(preset.id)}
            >
              {preset.label}
            </button>
          ))}
          <div className={styles.divider} role="separator" />
          <button type="button" className={styles.menuItem} onClick={openCustomEditor}>
            Custom…
          </button>
        </div>
      ) : null}

      {menu.isOpen && showCustomEditor && popoverInitial ? (
        <CustomRangePopover
          initialStartIso={popoverInitial.startIso}
          initialEndIso={popoverInitial.endIso}
          onApply={applyCustomRange}
          onCancel={cancelCustomEditor}
        />
      ) : null}
    </div>
  );
}
