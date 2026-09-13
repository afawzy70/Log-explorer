import { describe, expect, it, vi } from 'vitest';
import { fireEvent, renderHook } from '@testing-library/react';
import { useLiveKeyboardShortcuts } from './useLiveKeyboardShortcuts';
import { ShortcutRegistryProvider } from '../../shared/keyboard/ShortcutRegistry';
import { NOMINAL_SOURCE_STATUS } from './liveTailTypes';
import type { LiveTailHandle } from './useLiveTail';

function baseLive(overrides: Partial<LiveTailHandle> = {}): LiveTailHandle {
  return {
    connectionState: 'live',
    visibleEvents: [],
    totalReceived: 0,
    bufferedCount: 0,
    clientDroppedCount: 0,
    serverDroppedCount: 0,
    errorMessage: null,
    reconnectAttempt: 0,
    reconnectCount: 0,
    followNewest: true,
    unseenCount: 0,
    sourceStatus: NOMINAL_SOURCE_STATUS,
    start: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    exit: vi.fn(),
    clear: vi.fn(),
    retry: vi.fn(),
    setFollowNewest: vi.fn(),
    ...overrides,
  };
}

function press(key: string, opts: Partial<KeyboardEventInit> = {}) {
  fireEvent.keyDown(document, { key, ...opts });
}

/** Every shortcut in this app now flows through the shared registry (Legacy Remediation Slice 8) - the provider must be an ancestor for useShortcut to register anything at all. */
const wrapper = ShortcutRegistryProvider;

describe('useLiveKeyboardShortcuts (UI Gap Closure Pass, migrated to the shared registry in Legacy Remediation Slice 8)', () => {
  it('P pauses when live, resumes when paused', () => {
    const live = baseLive({ connectionState: 'live' });
    const { rerender } = renderHook(({ l, active }) => useLiveKeyboardShortcuts(l, active), {
      wrapper,
      initialProps: { l: live, active: true },
    });
    press('p');
    expect(live.pause).toHaveBeenCalledTimes(1);
    expect(live.resume).not.toHaveBeenCalled();

    const paused = baseLive({ connectionState: 'paused' });
    rerender({ l: paused, active: true });
    press('P');
    expect(paused.resume).toHaveBeenCalledTimes(1);
    expect(paused.pause).not.toHaveBeenCalled();
  });

  it('P does nothing when idle or errored (no active session to pause/resume)', () => {
    const live = baseLive({ connectionState: 'idle' });
    renderHook(() => useLiveKeyboardShortcuts(live, true), { wrapper });
    press('p');
    expect(live.pause).not.toHaveBeenCalled();
    expect(live.resume).not.toHaveBeenCalled();
  });

  it.each(['live', 'paused', 'connecting', 'reconnecting'] as const)('S stops from the active state "%s"', (state) => {
    const live = baseLive({ connectionState: state });
    renderHook(() => useLiveKeyboardShortcuts(live, true), { wrapper });
    press('s');
    expect(live.stop).toHaveBeenCalledTimes(1);
  });

  it('S does nothing when already idle', () => {
    const live = baseLive({ connectionState: 'idle' });
    renderHook(() => useLiveKeyboardShortcuts(live, true), { wrapper });
    press('S');
    expect(live.stop).not.toHaveBeenCalled();
  });

  it('C clears only when there are visible events', () => {
    const empty = baseLive({ visibleEvents: [] });
    renderHook(() => useLiveKeyboardShortcuts(empty, true), { wrapper });
    press('c');
    expect(empty.clear).not.toHaveBeenCalled();

    const withEvents = baseLive({
      visibleEvents: [{ message: 'x' } as never],
    });
    renderHook(() => useLiveKeyboardShortcuts(withEvents, true), { wrapper });
    press('C');
    expect(withEvents.clear).toHaveBeenCalledTimes(1);
  });

  it('F toggles followNewest, using its current value', () => {
    const live = baseLive({ followNewest: true });
    renderHook(() => useLiveKeyboardShortcuts(live, true), { wrapper });
    press('f');
    expect(live.setFollowNewest).toHaveBeenCalledWith(false);

    const live2 = baseLive({ followNewest: false });
    renderHook(() => useLiveKeyboardShortcuts(live2, true), { wrapper });
    press('F');
    expect(live2.setFollowNewest).toHaveBeenCalledWith(true);
  });

  it('does nothing at all when isActive is false - shortcuts never fire from the historical search screen', () => {
    const live = baseLive({ connectionState: 'live', visibleEvents: [{ message: 'x' } as never] });
    renderHook(() => useLiveKeyboardShortcuts(live, false), { wrapper });
    press('p');
    press('s');
    press('c');
    press('f');
    expect(live.pause).not.toHaveBeenCalled();
    expect(live.stop).not.toHaveBeenCalled();
    expect(live.clear).not.toHaveBeenCalled();
    expect(live.setFollowNewest).not.toHaveBeenCalled();
  });

  it('never fires while a modifier key is held, so it never fights a browser/system shortcut', () => {
    const live = baseLive({ connectionState: 'live' });
    renderHook(() => useLiveKeyboardShortcuts(live, true), { wrapper });
    press('p', { ctrlKey: true });
    press('p', { metaKey: true });
    press('p', { altKey: true });
    expect(live.pause).not.toHaveBeenCalled();
  });

  it('never fires while focus is inside a text-entry control, so typing p/s/c/f is never hijacked', () => {
    const live = baseLive({ connectionState: 'live', visibleEvents: [{ message: 'x' } as never] });
    renderHook(() => useLiveKeyboardShortcuts(live, true), { wrapper });
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: 'p' });
    fireEvent.keyDown(input, { key: 's' });
    fireEvent.keyDown(input, { key: 'c' });
    fireEvent.keyDown(input, { key: 'f' });
    expect(live.pause).not.toHaveBeenCalled();
    expect(live.stop).not.toHaveBeenCalled();
    expect(live.clear).not.toHaveBeenCalled();
    expect(live.setFollowNewest).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it('reads fresh live state at keypress time without the registry ever re-adding its one document listener on a re-render', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const live = baseLive({ connectionState: 'live' });
    const { rerender } = renderHook(({ l }) => useLiveKeyboardShortcuts(l, true), {
      wrapper,
      initialProps: { l: live },
    });

    const keydownAddCallsAfterMount = addSpy.mock.calls.filter((c) => c[0] === 'keydown').length;
    expect(keydownAddCallsAfterMount).toBe(1); // exactly one - the shared registry's own single listener

    // A fresh `live` object every render (same isActive, same shortcut
    // ids) - the registry must not re-register (and therefore must not
    // touch document.addEventListener again) on every single render.
    rerender({ l: baseLive({ connectionState: 'paused' }) });
    const finalLive = baseLive({ connectionState: 'paused' });
    rerender({ l: finalLive });

    const keydownAddCallsAfterRerenders = addSpy.mock.calls.filter((c) => c[0] === 'keydown').length;
    expect(keydownAddCallsAfterRerenders).toBe(1); // still exactly one - never re-registered

    // ...yet the handler still reads the *latest* live state (paused -> P resumes).
    press('p');
    expect(finalLive.resume).toHaveBeenCalledTimes(1);

    addSpy.mockRestore();
  });

  it('unregisters on unmount - a keypress after unmount no longer does anything', () => {
    const live = baseLive({ connectionState: 'live' });
    const { unmount } = renderHook(() => useLiveKeyboardShortcuts(live, true), { wrapper });

    press('p');
    expect(live.pause).toHaveBeenCalledTimes(1);

    unmount();
    press('p'); // the provider itself unmounted too (it's the wrapper) - no listener left to fire at all
    expect(live.pause).toHaveBeenCalledTimes(1); // unchanged - still exactly the one call from before unmount
  });
});
