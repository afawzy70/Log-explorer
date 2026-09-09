import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  defaultTablePreferences,
  sanitizeTablePreferences,
  useTablePreferences,
} from './tablePreferences';
import { ALL_COLUMN_IDS, DEFAULT_COLUMN_ORDER, DEFAULT_HIDDEN_COLUMN_IDS } from './columnRegistry';

const STORAGE_KEY = 'logexplorer.tablePreferences.v1';

describe('tablePreferences', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  describe('defaultTablePreferences', () => {
    it('is exactly the seven default-visible columns, in the registry default order (mission requirement 1 + 2)', () => {
      const prefs = defaultTablePreferences();
      const visible = prefs.columnOrder.filter((id) => !prefs.hiddenColumnIds.includes(id));
      expect(visible).toEqual(['time', 'level', 'service', 'whatHappened', 'userCustomer', 'correlationTrace']);
      expect(prefs.columnOrder).toEqual(DEFAULT_COLUMN_ORDER);
      expect(prefs.hiddenColumnIds).toEqual(DEFAULT_HIDDEN_COLUMN_IDS);
      expect(prefs.density).toBe('comfortable');
    });

    it('never includes any of the five protected fields as a column id', () => {
      const forbidden = ['cif', 'userName', 'customerId', 'deviceId', 'deviceIp'];
      for (const id of ALL_COLUMN_IDS) {
        expect(forbidden).not.toContain(id);
      }
    });
  });

  describe('sanitizeTablePreferences - fails safely (mission requirements 10 + 11)', () => {
    it('returns the default for null/non-object input', () => {
      expect(sanitizeTablePreferences(null)).toEqual(defaultTablePreferences());
      expect(sanitizeTablePreferences('not an object')).toEqual(defaultTablePreferences());
      expect(sanitizeTablePreferences(42)).toEqual(defaultTablePreferences());
    });

    it('returns the default for a missing or wrong schema version', () => {
      expect(sanitizeTablePreferences({ columnOrder: [], hiddenColumnIds: [], density: 'compact' })).toEqual(
        defaultTablePreferences(),
      );
      expect(sanitizeTablePreferences({ version: 999, columnOrder: [], hiddenColumnIds: [], density: 'compact' })).toEqual(
        defaultTablePreferences(),
      );
    });

    it('drops unknown column ids (a column removed in a later release)', () => {
      const result = sanitizeTablePreferences({
        version: 1,
        columnOrder: ['time', 'level', 'this-column-no-longer-exists', 'service'],
        hiddenColumnIds: [],
        density: 'comfortable',
      });
      expect(result.columnOrder).not.toContain('this-column-no-longer-exists');
      expect(result.columnOrder.slice(0, 3)).toEqual(['time', 'level', 'service']);
    });

    it('deduplicates repeated column ids, keeping only the first occurrence', () => {
      const result = sanitizeTablePreferences({
        version: 1,
        columnOrder: ['time', 'level', 'time', 'service', 'level'],
        hiddenColumnIds: [],
        density: 'comfortable',
      });
      expect(result.columnOrder.filter((id) => id === 'time')).toHaveLength(1);
      expect(result.columnOrder.filter((id) => id === 'level')).toHaveLength(1);
    });

    it('appends a known column missing from the saved order, inheriting the registry default-hidden posture (never silently visible)', () => {
      // A saved order that only ever knew about 'time' - every other
      // known column (including the other 5 defaults) is "missing" and
      // must be appended, with only genuinely defaultVisible ones visible.
      const result = sanitizeTablePreferences({
        version: 1,
        columnOrder: ['time'],
        hiddenColumnIds: [],
        density: 'comfortable',
      });
      expect(result.columnOrder).toHaveLength(ALL_COLUMN_IDS.length);
      const visible = result.columnOrder.filter((id) => !result.hiddenColumnIds.includes(id));
      expect(visible.sort()).toEqual(['correlationTrace', 'level', 'service', 'time', 'userCustomer', 'whatHappened'].sort());
      // every optional column must still be hidden, not silently promoted to visible
      expect(result.hiddenColumnIds).toEqual(expect.arrayContaining(DEFAULT_HIDDEN_COLUMN_IDS.filter((id) => id !== 'time')));
    });

    it('drops non-string entries in columnOrder/hiddenColumnIds', () => {
      // Supply every known column id (so the separate "missing column"
      // append logic - covered by its own test above - never kicks in),
      // interleaved with non-string junk that must simply be discarded.
      const rest = ALL_COLUMN_IDS.filter((id) => id !== 'time' && id !== 'level');
      const result = sanitizeTablePreferences({
        version: 1,
        columnOrder: ['time', 42, null, 'level', {}, ...rest],
        hiddenColumnIds: ['level', 7, null],
        density: 'comfortable',
      });
      expect(result.columnOrder).toEqual(ALL_COLUMN_IDS);
      expect(result.hiddenColumnIds).toEqual(['level']);
    });

    it('falls back to the full default when every column would end up hidden (never zero visible data columns)', () => {
      const result = sanitizeTablePreferences({
        version: 1,
        columnOrder: ALL_COLUMN_IDS,
        hiddenColumnIds: ALL_COLUMN_IDS,
        density: 'compact',
      });
      expect(result).toEqual(defaultTablePreferences());
    });

    it('falls back to "comfortable" for any invalid density value', () => {
      expect(
        sanitizeTablePreferences({ version: 1, columnOrder: [], hiddenColumnIds: [], density: 'ultra-dense' }).density,
      ).toBe('comfortable');
      expect(
        sanitizeTablePreferences({ version: 1, columnOrder: [], hiddenColumnIds: [], density: null }).density,
      ).toBe('comfortable');
    });

    it('accepts a valid "compact" density', () => {
      const result = sanitizeTablePreferences({
        version: 1,
        columnOrder: DEFAULT_COLUMN_ORDER,
        hiddenColumnIds: DEFAULT_HIDDEN_COLUMN_IDS,
        density: 'compact',
      });
      expect(result.density).toBe('compact');
    });

    it('never throws on malformed JSON.parse output (e.g. a bare string or array)', () => {
      expect(() => sanitizeTablePreferences('{"not":"valid but a string"}')).not.toThrow();
      expect(() => sanitizeTablePreferences([1, 2, 3])).not.toThrow();
      expect(sanitizeTablePreferences([1, 2, 3])).toEqual(defaultTablePreferences());
    });
  });

  describe('useTablePreferences hook', () => {
    it('starts from the default when localStorage is empty (fresh install / cleared storage)', () => {
      const { result } = renderHook(() => useTablePreferences());
      expect(result.current.preferences).toEqual(defaultTablePreferences());
    });

    it('hides an optional column, and it is reflected immediately', () => {
      const { result } = renderHook(() => useTablePreferences());
      act(() => result.current.setColumnVisible('time', false)); // 'time' starts visible
      expect(result.current.preferences.hiddenColumnIds).toContain('time');
    });

    it('shows a previously-hidden optional column, at its existing position', () => {
      const { result } = renderHook(() => useTablePreferences());
      const indexInOrder = result.current.preferences.columnOrder.indexOf('logger');
      act(() => result.current.setColumnVisible('logger', true));
      expect(result.current.preferences.hiddenColumnIds).not.toContain('logger');
      expect(result.current.preferences.columnOrder.indexOf('logger')).toBe(indexInOrder); // position unchanged by visibility toggle
    });

    it('refuses to hide the last visible data column', () => {
      const { result } = renderHook(() => useTablePreferences());
      // Hide five of the six default-visible columns, one at a time.
      for (const id of ['level', 'service', 'whatHappened', 'userCustomer', 'correlationTrace'] as const) {
        act(() => result.current.setColumnVisible(id, false));
      }
      const visibleBefore = result.current.preferences.columnOrder.filter(
        (id) => !result.current.preferences.hiddenColumnIds.includes(id),
      );
      expect(visibleBefore).toEqual(['time']);

      act(() => result.current.setColumnVisible('time', false)); // the only one left
      const visibleAfter = result.current.preferences.columnOrder.filter(
        (id) => !result.current.preferences.hiddenColumnIds.includes(id),
      );
      expect(visibleAfter).toEqual(['time']); // refused - still visible
    });

    it('reorders a column up and down deterministically', () => {
      const { result } = renderHook(() => useTablePreferences());
      const before = [...result.current.preferences.columnOrder];
      act(() => result.current.moveColumn('service', 'up'));
      const afterUp = result.current.preferences.columnOrder;
      expect(afterUp.indexOf('service')).toBe(before.indexOf('service') - 1);
      expect(afterUp.indexOf('level')).toBe(before.indexOf('level') + 1); // swapped neighbor

      act(() => result.current.moveColumn('service', 'down'));
      expect(result.current.preferences.columnOrder).toEqual(before); // back to the original order
    });

    it('moving the first column up, or the last column down, is a no-op (boundary safety)', () => {
      const { result } = renderHook(() => useTablePreferences());
      const before = result.current.preferences.columnOrder;
      act(() => result.current.moveColumn(before[0], 'up'));
      expect(result.current.preferences.columnOrder).toEqual(before);
      act(() => result.current.moveColumn(before[before.length - 1], 'down'));
      expect(result.current.preferences.columnOrder).toEqual(before);
    });

    it('changes density', () => {
      const { result } = renderHook(() => useTablePreferences());
      act(() => result.current.setDensity('compact'));
      expect(result.current.preferences.density).toBe('compact');
    });

    it('reset restores the exact seven-column default, discarding every customization', () => {
      const { result } = renderHook(() => useTablePreferences());
      act(() => {
        result.current.setColumnVisible('logger', true);
        result.current.setColumnVisible('time', false);
        result.current.moveColumn('service', 'up');
        result.current.setDensity('compact');
      });
      expect(result.current.preferences).not.toEqual(defaultTablePreferences());

      act(() => result.current.reset());
      expect(result.current.preferences).toEqual(defaultTablePreferences());
    });

    it('persists a change to localStorage, and a fresh hook instance reads it back (survives reload)', () => {
      const first = renderHook(() => useTablePreferences());
      act(() => {
        first.result.current.setColumnVisible('logger', true);
        first.result.current.setDensity('compact');
      });

      const second = renderHook(() => useTablePreferences());
      expect(second.result.current.preferences.hiddenColumnIds).not.toContain('logger');
      expect(second.result.current.preferences.density).toBe('compact');
    });

    it('a corrupted/invalid localStorage value on load fails safely back to the default (fresh hook instance)', () => {
      localStorage.setItem(STORAGE_KEY, '{not valid json');
      const { result } = renderHook(() => useTablePreferences());
      expect(result.current.preferences).toEqual(defaultTablePreferences());
    });

    it('never persists anything beyond column ids/order/hidden-state and density - no query, filter, result, or sensitive content', () => {
      const { result } = renderHook(() => useTablePreferences());
      act(() => {
        result.current.setColumnVisible('logger', true);
        result.current.setDensity('compact');
      });
      const raw = localStorage.getItem(STORAGE_KEY);
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!);
      expect(Object.keys(parsed).sort()).toEqual(['columnOrder', 'density', 'hiddenColumnIds', 'version']);
      // Every columnOrder/hiddenColumnIds entry must be a known, safe column id - never arbitrary text.
      const known = new Set(ALL_COLUMN_IDS);
      for (const id of parsed.columnOrder) {
        expect(known.has(id)).toBe(true);
      }
      for (const id of parsed.hiddenColumnIds) {
        expect(known.has(id)).toBe(true);
      }
    });
  });
});
