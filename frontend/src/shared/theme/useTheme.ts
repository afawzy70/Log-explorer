import { useCallback, useEffect, useState } from 'react';
import {
  defaultThemePreference,
  readThemePreference,
  writeThemePreference,
  type ThemePreference,
} from './themePreference';

/**
 * Resolves a {@link ThemePreference} to the concrete theme that should be
 * painted right now. `'system'` follows `prefers-color-scheme`; anything
 * else (or a browser with no `matchMedia`, e.g. a test environment) is
 * taken literally / defaults to light.
 */
function resolveTheme(preference: ThemePreference): 'light' | 'dark' {
  if (preference === 'light' || preference === 'dark') {
    return preference;
  }
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Applies `data-theme` on the document root so every B1 token block in
 * `tokensV2.css` (`:root[data-theme="light"|"dark"]`) can resolve. A plain
 * `useEffect` (used here, not `useLayoutEffect`) is not guaranteed to run
 * before the browser's first paint, so an explicit `dark` preference can
 * in principle show one frame of the light fallback first - accepted for
 * this pure-CSR app (no SSR/blocking script to set the attribute earlier).
 * In practice this has not been observed: `tokensV2.css`'s bare `:root`
 * selector already matches the design's own light values as the fallback,
 * so the common case (system/light) has no flash to begin with, and only
 * an explicit `dark` choice is even theoretically affected.
 */
export function useTheme(): {
  preference: ThemePreference;
  resolvedTheme: 'light' | 'dark';
  setPreference: (preference: ThemePreference) => void;
} {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => readThemePreference());
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() => resolveTheme(preference));

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  useEffect(() => {
    setResolvedTheme(resolveTheme(preference));
    if (preference !== 'system' || typeof window.matchMedia !== 'function') {
      return;
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setResolvedTheme(resolveTheme('system'));
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    writeThemePreference(next);
  }, []);

  return { preference, resolvedTheme, setPreference };
}

export { defaultThemePreference };
export type { ThemePreference };
