import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { isTypingTarget } from './isTypingTarget';

/**
 * Legacy Remediation Slice 8 — one coherent keyboard-shortcut registry
 * (`docs/verification/LEGACY_REMEDIATION_SLICE_8_REPORT.md`), replacing the
 * previously-scattered independent `document.addEventListener('keydown', ...)`
 * calls each shortcut-owning component/hook used to register on its own
 * (`useGlobalShortcuts.ts`, `KeyboardShortcutsHelp.tsx`'s own `?` listener,
 * `useLiveKeyboardShortcuts.ts`'s P/S/C/F, `EventInspector.tsx`'s own
 * Escape/`[`/`]`). Exactly ONE `document` `keydown` listener now exists for
 * this whole class of shortcut (owned by {@link ShortcutRegistryProvider}),
 * for the entire lifetime of the app — never re-added/removed as components
 * mount and unmount, never duplicated.
 *
 * <p><b>Registration vs. applicability are deliberately decoupled.</b> A
 * shortcut registers once, for the lifetime of the component that owns it
 * (e.g. `EventInspector` is always mounted - App.tsx renders it
 * unconditionally - so its Escape/`[`/`]` shortcuts are always registered),
 * so the shortcuts-help popover can always list every shortcut the app
 * supports, even ones not currently actionable (matching the pre-Slice-8
 * help list's own "(while Live is the active view)" style caveat text) -
 * this is what keeps "derive help content from the real registry" from
 * regressing discoverability. Whether a keypress actually *does* anything
 * right now is a separate, runtime question each shortcut's own {@link
 * ShortcutDefinition#test} answers (e.g. Live's P/S/C/F only match while
 * Live is the active view; `[`/`]` only match while there is a previous/
 * next event to move to) - `test` returning `false` is exactly "disabled/
 * inapplicable shortcuts do nothing" (this mission's own §6 requirement).
 *
 * <p><b>Freshness without re-registration.</b> {@link useShortcut} takes a
 * plain object every render (not memoized by its caller) but only actually
 * re-registers when `id` changes - a `ref` always holds the latest `test`/
 * `onTrigger` closures, the exact same pattern `useLiveKeyboardShortcuts.ts`
 * already established for the identical problem (a hook whose dependency
 * would otherwise churn every render because the object it closes over is
 * recreated every render).
 *
 * <p>Out of scope, deliberately: `useDismissableLayer`'s own Escape-to-close
 * (tied to popover-lifecycle dismissal semantics - outside-click and
 * Escape as one cohesive unit - not general keyboard productivity) and the
 * element-scoped shortcuts (`ResultsTable`'s ArrowUp/ArrowDown row
 * navigation, the inspector resize handle's ArrowLeft/ArrowRight) which
 * are `onKeyDown` on one specific DOM element, not a `document`-level
 * concern this registry's single global listener model fits. Both remain
 * their own, already-correct, already-tested mechanisms - see the Slice 8
 * report for the full reasoning.
 */
export interface ShortcutDefinition {
  /** Stable, unique across the whole app - e.g. `"live.pause"`. */
  id: string;
  /** Display text for the shortcuts-help popover, e.g. `"Ctrl/Cmd + Enter"`. */
  keys: string;
  /** One line explaining what it does - shown in the help popover. */
  description: string;
  /** Groups entries in the help popover (e.g. `"Search & filters"`, `"Live"`). */
  group: string;
  /** Whether this exact keydown should trigger this shortcut right now. */
  test: (event: KeyboardEvent) => boolean;
  /** What happens when it fires. The registry calls `event.preventDefault()` first. */
  onTrigger: (event: KeyboardEvent) => void;
  /** Default false - guarded by {@link isTypingTarget}, matching every existing shortcut's own convention. */
  allowWhileTyping?: boolean;
}

interface RegistryApi {
  register: (def: ShortcutDefinition) => void;
  unregister: (id: string) => void;
}

const RegistryContext = createContext<RegistryApi | null>(null);
const ListContext = createContext<ShortcutDefinition[]>([]);

export function ShortcutRegistryProvider({ children }: { children: ReactNode }) {
  const registryRef = useRef(new Map<string, ShortcutDefinition>());
  const [list, setList] = useState<ShortcutDefinition[]>([]);

  const register = useCallback((def: ShortcutDefinition) => {
    registryRef.current.set(def.id, def);
    setList(Array.from(registryRef.current.values()));
  }, []);

  const unregister = useCallback((id: string) => {
    registryRef.current.delete(id);
    setList(Array.from(registryRef.current.values()));
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      for (const def of registryRef.current.values()) {
        if (!def.test(event)) {
          continue;
        }
        if (!def.allowWhileTyping && isTypingTarget(event.target)) {
          continue;
        }
        event.preventDefault();
        def.onTrigger(event);
        break; // first match wins - every registered shortcut uses a disjoint key today, but this keeps dispatch deterministic regardless
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []); // exactly one listener, for the provider's entire lifetime - never re-added

  // `register`/`unregister` are already stable (useCallback, empty deps),
  // but without this memo the context *value* itself would still be a new
  // object literal every render - and since `ctx` sits in useShortcut's own
  // effect dependency array below, a fresh reference on every render (which
  // register/unregister's own setList call causes) would re-run that
  // effect, which registers again, which re-renders this provider again:
  // an infinite loop. Memoizing keeps the value reference stable across the
  // `list` state changes that register/unregister themselves trigger.
  const api = useMemo<RegistryApi>(() => ({ register, unregister }), [register, unregister]);

  return (
    <RegistryContext.Provider value={api}>
      <ListContext.Provider value={list}>{children}</ListContext.Provider>
    </RegistryContext.Provider>
  );
}

/**
 * Registers one shortcut for the calling component's own mount lifetime -
 * unregistered automatically on unmount, re-registered only if `def.id`
 * itself changes (never on every render). `def.test`/`def.onTrigger` are
 * always read fresh via an internal ref, so the caller never needs to
 * memoize them.
 */
export function useShortcut(def: ShortcutDefinition): void {
  const ctx = useContext(RegistryContext);
  const defRef = useRef(def);
  defRef.current = def;

  useEffect(() => {
    if (!ctx) {
      return;
    }
    const stable: ShortcutDefinition = {
      id: def.id,
      keys: def.keys,
      description: def.description,
      group: def.group,
      allowWhileTyping: def.allowWhileTyping,
      test: (e) => defRef.current.test(e),
      onTrigger: (e) => defRef.current.onTrigger(e),
    };
    ctx.register(stable);
    return () => ctx.unregister(def.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, def.id]);
}

/** The live list of every currently-registered shortcut, for the shortcuts-help popover. */
export function useRegisteredShortcuts(): ShortcutDefinition[] {
  return useContext(ListContext);
}
