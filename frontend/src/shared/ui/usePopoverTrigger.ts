import { useCallback, useRef, useState } from 'react';
import type { RefObject } from 'react';

export interface PopoverTrigger {
  isOpen: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
  open: () => void;
  /** Closes and restores focus to the trigger control (CLAUDE.md §4: "restore focus to the Time Range control"). */
  close: () => void;
}

/**
 * Open/close state plus focus restoration shared by every popover-shaped
 * control in this phase (time range, service multi-select, advanced
 * filters) - logical focus restoration is a WCAG 2.2 AA requirement
 * (CLAUDE.md §7), not optional polish.
 */
export function usePopoverTrigger(): PopoverTrigger {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const open = useCallback(() => setIsOpen(true), []);

  const close = useCallback(() => {
    setIsOpen(false);
    triggerRef.current?.focus();
  }, []);

  return { isOpen, triggerRef, open, close };
}
