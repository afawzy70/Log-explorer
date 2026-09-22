import { useCallback, useState } from 'react';
import { ALL_COLUMN_IDS, DEFAULT_COLUMN_ORDER, DEFAULT_HIDDEN_COLUMN_IDS } from './columnRegistry';
import type { ColumnId } from './columnRegistry';

export type TableDensity = 'comfortable' | 'compact';

/**
 * Presentation-only table preferences (Legacy Remediation Slice 4,
 * `docs/LEGACY_TO_NEW_REMEDIATION_PLAN.md` §"Slice 4"). Deliberately a
 * tiny, closed shape: only column *ids* (never labels - CLAUDE.md-style
 * "stable id, not display text, is the persistence key"), a hidden-id
 * subset, and a density enum. Nothing here can ever be a log value, a
 * query, a filter, or any protected identifier - there is structurally no
 * field capable of holding one (CLAUDE.md §2 rule 4: "localStorage holds
 * only safe non-sensitive UI preferences").
 */
export interface TablePreferences {
  /** Every non-"actions" column id, in display order - hidden columns keep their position here too ("stable logical position" while hidden). */
  columnOrder: ColumnId[];
  /** Subset of `columnOrder` that is currently hidden. */
  hiddenColumnIds: ColumnId[];
  density: TableDensity;
}

const STORAGE_KEY = 'logexplorer.tablePreferences.v1';

/** Bumped only if the persisted shape itself changes incompatibly - see `sanitizeTablePreferences`'s own comment for what happens to an old version's data when that happens. */
const SCHEMA_VERSION = 1;

export function defaultTablePreferences(): TablePreferences {
  return {
    columnOrder: [...DEFAULT_COLUMN_ORDER],
    hiddenColumnIds: [...DEFAULT_HIDDEN_COLUMN_IDS],
    // Modern Developer Console (B1 "Instrument Neutral") owner decision D1:
    // compact (28px rows) is the default; comfortable stays available and
    // is never removed as an option.
    density: 'compact',
  };
}

interface PersistedShapeGuess {
  version?: unknown;
  columnOrder?: unknown;
  hiddenColumnIds?: unknown;
  density?: unknown;
}

/**
 * Never trusts the stored shape (CLAUDE.md-style "do not trust
 * localStorage shape blindly", this slice's own explicit requirement) -
 * malformed JSON, a wrong/missing version, non-array fields, unknown
 * column ids (a column removed in a later release), duplicate ids,
 * missing ids (a column added in a later release, or a truncated list),
 * and an invalid density all fail safely back to
 * {@link defaultTablePreferences}, in whole or in part as documented
 * below - this function never throws.
 *
 * <p>A future incompatible schema change bumps {@link SCHEMA_VERSION} and
 * adds a real migration branch here (e.g. `version === 1 ? migrateV1(raw)
 * : ...`) - today, any version other than the current one is simply
 * treated as absent (full default), since there has only ever been one
 * schema so far.
 */
export function sanitizeTablePreferences(raw: unknown): TablePreferences {
  try {
    if (raw === null || typeof raw !== 'object') {
      return defaultTablePreferences();
    }
    const obj = raw as PersistedShapeGuess;
    if (obj.version !== SCHEMA_VERSION) {
      return defaultTablePreferences();
    }

    const knownIds = new Set<string>(ALL_COLUMN_IDS);
    const rawOrder = Array.isArray(obj.columnOrder) ? obj.columnOrder : [];
    const seenInRawOrder = new Set<string>();
    const columnOrder: ColumnId[] = [];
    for (const id of rawOrder) {
      if (typeof id === 'string' && knownIds.has(id) && !seenInRawOrder.has(id)) {
        seenInRawOrder.add(id);
        columnOrder.push(id as ColumnId);
      }
      // A non-string entry, an unknown (removed-column) id, or a repeat
      // of an id already kept is silently dropped - never trusted, never
      // duplicated, never allowed to reference a column that no longer
      // exists.
    }

    const rawHidden = Array.isArray(obj.hiddenColumnIds) ? obj.hiddenColumnIds : [];
    const hiddenSet = new Set<string>();
    for (const id of rawHidden) {
      if (typeof id === 'string' && knownIds.has(id)) {
        hiddenSet.add(id);
      }
    }

    // Any known column genuinely missing from the saved order (a column
    // added to the registry in a later release, after this preference was
    // saved) is appended at its own registry-default position, and -
    // critically - inherits the registry's own defaultVisible posture
    // rather than ever silently becoming visible merely by appearing:
    // the saved payload could never have listed it as hidden (it didn't
    // exist yet), so its hidden-state must come from `DEFAULT_HIDDEN_COLUMN_IDS`
    // instead of the (necessarily absent) saved hidden list.
    for (const id of ALL_COLUMN_IDS) {
      if (!seenInRawOrder.has(id)) {
        columnOrder.push(id);
        if (DEFAULT_HIDDEN_COLUMN_IDS.includes(id)) {
          hiddenSet.add(id);
        }
      }
    }

    const hiddenColumnIds = columnOrder.filter((id) => hiddenSet.has(id));

    // Column safety (this slice's own explicit requirement): never allow
    // a saved state that hides every column - if every id in the
    // (already-sanitized) order is hidden, the whole preference is
    // untrustworthy/unusable and the full default is restored instead of
    // trying to guess which one to force back on.
    if (columnOrder.length === 0 || hiddenColumnIds.length >= columnOrder.length) {
      return defaultTablePreferences();
    }

    // Validates against both real values explicitly (never a catch-all on
    // one of them) - an invalid or missing density falls back to the
    // single source of truth in `defaultTablePreferences`, so this can
    // never drift from it if the default ever changes again.
    const density: TableDensity =
      obj.density === 'compact' || obj.density === 'comfortable' ? obj.density : defaultTablePreferences().density;

    return { columnOrder, hiddenColumnIds, density };
  } catch {
    return defaultTablePreferences();
  }
}

function readFromStorage(): TablePreferences {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return defaultTablePreferences();
    }
    return sanitizeTablePreferences(JSON.parse(raw));
  } catch {
    // Malformed JSON, or localStorage inaccessible (private mode,
    // disabled, quota) - fail safely to default rather than throwing
    // during render.
    return defaultTablePreferences();
  }
}

function writeToStorage(preferences: TablePreferences): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: SCHEMA_VERSION, ...preferences }),
    );
  } catch {
    // Persistence failing (quota, private mode) never breaks the current
    // session - the preference still applies via React state, it simply
    // won't survive a reload this time.
  }
}

export interface TablePreferencesHandle {
  preferences: TablePreferences;
  setColumnVisible: (id: ColumnId, visible: boolean) => void;
  moveColumn: (id: ColumnId, direction: 'up' | 'down') => void;
  /**
   * Pre-closure functional recovery (§20): drag-and-drop's own mutation -
   * moves `id` to sit at `targetIndex` in the CURRENT order (0-based,
   * measured against the order before this column is removed from it).
   * `moveColumn` (one-step up/down) remains the keyboard-accessible
   * fallback (mission §20's own priority list: drag-and-drop first,
   * keyboard-accessible fallback second) - this is additive, not a
   * replacement.
   */
  moveColumnToIndex: (id: ColumnId, targetIndex: number) => void;
  setDensity: (density: TableDensity) => void;
  reset: () => void;
}

/**
 * Owns table column/density preferences end to end: initial load
 * (sanitized), every mutation (always re-persisted immediately), and
 * {@link TablePreferencesHandle.reset}. Entirely independent of
 * `useSearchState` - no search request is ever built or fired from
 * anything in this file (this slice's own explicit "presentation-only
 * operation" requirement).
 */
export function useTablePreferences(): TablePreferencesHandle {
  const [preferences, setPreferences] = useState<TablePreferences>(readFromStorage);

  const commit = useCallback((next: TablePreferences) => {
    setPreferences(next);
    writeToStorage(next);
  }, []);

  const setColumnVisible = useCallback(
    (id: ColumnId, visible: boolean) => {
      setPreferences((prev) => {
        const isCurrentlyHidden = prev.hiddenColumnIds.includes(id);
        if (visible === !isCurrentlyHidden) {
          return prev; // no-op
        }
        if (visible) {
          const next = { ...prev, hiddenColumnIds: prev.hiddenColumnIds.filter((h) => h !== id) };
          writeToStorage(next);
          return next;
        }
        // Column safety: never allow the last visible data column to be hidden.
        const currentlyVisibleCount = prev.columnOrder.length - prev.hiddenColumnIds.length;
        if (currentlyVisibleCount <= 1) {
          return prev;
        }
        const next = { ...prev, hiddenColumnIds: [...prev.hiddenColumnIds, id] };
        writeToStorage(next);
        return next;
      });
    },
    [],
  );

  const moveColumn = useCallback((id: ColumnId, direction: 'up' | 'down') => {
    setPreferences((prev) => {
      const index = prev.columnOrder.indexOf(id);
      if (index < 0) {
        return prev;
      }
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.columnOrder.length) {
        return prev; // already at the boundary
      }
      const nextOrder = [...prev.columnOrder];
      [nextOrder[index], nextOrder[targetIndex]] = [nextOrder[targetIndex], nextOrder[index]];
      const next = { ...prev, columnOrder: nextOrder };
      writeToStorage(next);
      return next;
    });
  }, []);

  const moveColumnToIndex = useCallback((id: ColumnId, targetIndex: number) => {
    setPreferences((prev) => {
      const currentIndex = prev.columnOrder.indexOf(id);
      if (currentIndex < 0) {
        return prev;
      }
      const withoutId = prev.columnOrder.filter((c) => c !== id);
      const clampedIndex = Math.max(0, Math.min(targetIndex, withoutId.length));
      const nextOrder = [...withoutId.slice(0, clampedIndex), id, ...withoutId.slice(clampedIndex)];
      if (nextOrder.join('|') === prev.columnOrder.join('|')) {
        return prev; // no-op - dropped back onto its own position
      }
      const next = { ...prev, columnOrder: nextOrder };
      writeToStorage(next);
      return next;
    });
  }, []);

  const setDensity = useCallback((density: TableDensity) => {
    setPreferences((prev) => {
      if (prev.density === density) {
        return prev;
      }
      const next = { ...prev, density };
      writeToStorage(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    commit(defaultTablePreferences());
  }, [commit]);

  return { preferences, setColumnVisible, moveColumn, moveColumnToIndex, setDensity, reset };
}
