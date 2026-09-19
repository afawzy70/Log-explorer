/**
 * Appearance preference (Modern Developer Console, Wave 1 Foundations,
 * `docs/ux-v2-modern-developer-console/DESIGN_SYSTEM.md` B1 "Instrument
 * Neutral" light + dark companion). Presentation-only, mirrors the shape
 * discipline of `features/results/tablePreferences.ts`: a tiny, closed
 * value, never trusted blindly from storage, never a log value or a
 * query (CLAUDE.md §2 rule 4: "localStorage holds only safe non-sensitive
 * UI preferences").
 */
export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'logexplorer.themePreference.v1';
const SCHEMA_VERSION = 1;

export function defaultThemePreference(): ThemePreference {
  return 'system';
}

interface PersistedShapeGuess {
  version?: unknown;
  preference?: unknown;
}

/**
 * Never throws. An unknown version, a malformed shape, or a value outside
 * the three allowed strings all fail safely back to the default
 * ({@link defaultThemePreference}) rather than applying an arbitrary
 * `data-theme` attribute.
 */
export function sanitizeThemePreference(raw: unknown): ThemePreference {
  try {
    if (raw === null || typeof raw !== 'object') {
      return defaultThemePreference();
    }
    const obj = raw as PersistedShapeGuess;
    if (obj.version !== SCHEMA_VERSION) {
      return defaultThemePreference();
    }
    if (obj.preference === 'light' || obj.preference === 'dark' || obj.preference === 'system') {
      return obj.preference;
    }
    return defaultThemePreference();
  } catch {
    return defaultThemePreference();
  }
}

export function readThemePreference(): ThemePreference {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return defaultThemePreference();
    }
    return sanitizeThemePreference(JSON.parse(raw));
  } catch {
    // Malformed JSON, or localStorage inaccessible (private mode,
    // disabled, quota) - fail safely to default rather than throwing
    // during render.
    return defaultThemePreference();
  }
}

export function writeThemePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: SCHEMA_VERSION, preference }));
  } catch {
    // Persistence failing (quota, private mode) never breaks the current
    // session - the preference still applies via React state, it simply
    // won't survive a reload this time.
  }
}
