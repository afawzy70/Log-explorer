import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  defaultThemePreference,
  readThemePreference,
  sanitizeThemePreference,
  writeThemePreference,
} from './themePreference';

const STORAGE_KEY = 'logexplorer.themePreference.v1';

describe('themePreference', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('defaults to system', () => {
    expect(defaultThemePreference()).toBe('system');
  });

  describe('sanitizeThemePreference - never trusts stored shape blindly', () => {
    it('returns the default for null/non-object input', () => {
      expect(sanitizeThemePreference(null)).toBe('system');
      expect(sanitizeThemePreference('dark')).toBe('system');
      expect(sanitizeThemePreference(42)).toBe('system');
    });

    it('returns the default for a missing or wrong schema version', () => {
      expect(sanitizeThemePreference({ preference: 'dark' })).toBe('system');
      expect(sanitizeThemePreference({ version: 999, preference: 'dark' })).toBe('system');
    });

    it('accepts exactly the three known values', () => {
      expect(sanitizeThemePreference({ version: 1, preference: 'light' })).toBe('light');
      expect(sanitizeThemePreference({ version: 1, preference: 'dark' })).toBe('dark');
      expect(sanitizeThemePreference({ version: 1, preference: 'system' })).toBe('system');
    });

    it('falls back to the default for an unknown string, never applying an arbitrary value', () => {
      expect(sanitizeThemePreference({ version: 1, preference: 'nightmode' })).toBe('system');
      expect(sanitizeThemePreference({ version: 1, preference: 123 })).toBe('system');
      expect(sanitizeThemePreference({ version: 1 })).toBe('system');
    });

    it('never throws on malformed input', () => {
      expect(() => sanitizeThemePreference(undefined)).not.toThrow();
      expect(() => sanitizeThemePreference([1, 2, 3])).not.toThrow();
    });
  });

  describe('readThemePreference / writeThemePreference', () => {
    it('round-trips a written preference', () => {
      writeThemePreference('dark');
      expect(readThemePreference()).toBe('dark');
    });

    it('reads the default when nothing is stored', () => {
      expect(readThemePreference()).toBe('system');
    });

    it('reads the default when the stored value is malformed JSON', () => {
      localStorage.setItem(STORAGE_KEY, '{not json');
      expect(readThemePreference()).toBe('system');
    });

    it('persists under the versioned shape, not a bare string', () => {
      writeThemePreference('light');
      const raw = localStorage.getItem(STORAGE_KEY);
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw as string)).toEqual({ version: 1, preference: 'light' });
    });

    it('never stores a log value, query, or protected field - the shape has no field for one', () => {
      writeThemePreference('dark');
      const raw = localStorage.getItem(STORAGE_KEY) ?? '';
      expect(raw).not.toMatch(/cif|userName|customerId|deviceId|deviceIp/i);
    });
  });
});
