import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTheme } from './useTheme';

function mockMatchMedia(matchesDark: boolean) {
  const listeners: Array<() => void> = [];
  const mql = {
    matches: matchesDark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: string, cb: () => void) => listeners.push(cb),
    removeEventListener: (_: string, cb: () => void) => {
      const i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    },
  };
  window.matchMedia = vi.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia;
  return { fire: () => listeners.forEach((cb) => cb()), setMatches: (v: boolean) => (mql.matches = v) };
}

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });
  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    vi.restoreAllMocks();
  });

  it('defaults to system, resolved via prefers-color-scheme, and sets data-theme on the root', () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe('system');
    expect(result.current.resolvedTheme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('an explicit light/dark preference is taken literally, ignoring the OS setting', () => {
    mockMatchMedia(true); // OS says dark
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setPreference('light'));
    expect(result.current.resolvedTheme).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('setPreference persists to localStorage so it survives a reload', () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setPreference('dark'));
    expect(JSON.parse(localStorage.getItem('logexplorer.themePreference.v1') as string)).toEqual({
      version: 1,
      preference: 'dark',
    });
    const { result: second } = renderHook(() => useTheme());
    expect(second.current.preference).toBe('dark');
    expect(second.current.resolvedTheme).toBe('dark');
  });

  it('system preference tracks a live OS appearance change', () => {
    const media = mockMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolvedTheme).toBe('light');
    act(() => {
      media.setMatches(true);
      media.fire();
    });
    expect(result.current.resolvedTheme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('falls back to light when matchMedia is unavailable (older/test environment)', () => {
    // @ts-expect-error - simulating an environment without matchMedia
    delete window.matchMedia;
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolvedTheme).toBe('light');
  });
});
