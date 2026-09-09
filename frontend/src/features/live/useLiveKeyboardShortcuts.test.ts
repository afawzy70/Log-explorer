import { describe, expect, it, vi } from 'vitest';
import { fireEvent, renderHook } from '@testing-library/react';
import { useLiveKeyboardShortcuts } from './useLiveKeyboardShortcuts';
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

describe('useLiveKeyboardShortcuts (UI Gap Closure Pass)', () => {
  it('P pauses when live, resumes when paused', () => {
    const live = baseLive({ connectionState: 'live' });
    const { rerender } = renderHook(({ l, active }) => useLiveKeyboardShortcuts(l, active), {
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
    renderHook(() => useLiveKeyboardShortcuts(live, true));
    press('p');
    expect(live.pause).not.toHaveBeenCalled();
    expect(live.resume).not.toHaveBeenCalled();
  });

  it.each(['live', 'paused', 'connecting', 'reconnecting'] as const)('S stops from the active state "%s"', (state) => {
    const live = baseLive({ connectionState: state });
    renderHook(() => useLiveKeyboardShortcuts(live, true));
    press('s');
    expect(live.stop).toHaveBeenCalledTimes(1);
  });

  it('S does nothing when already idle', () => {
    const live = baseLive({ connectionState: 'idle' });
    renderHook(() => useLiveKeyboardShortcuts(live, true));
    press('S');
    expect(live.stop).not.toHaveBeenCalled();
  });

  it('C clears only when there are visible events', () => {
    const empty = baseLive({ visibleEvents: [] });
    renderHook(() => useLiveKeyboardShortcuts(empty, true));
    press('c');
    expect(empty.clear).not.toHaveBeenCalled();

    const withEvents = baseLive({
      visibleEvents: [{ message: 'x' } as never],
    });
    renderHook(() => useLiveKeyboardShortcuts(withEvents, true));
    press('C');
    expect(withEvents.clear).toHaveBeenCalledTimes(1);
  });

  it('F toggles followNewest, using its current value', () => {
    const live = baseLive({ followNewest: true });
    renderHook(() => useLiveKeyboardShortcuts(live, true));
    press('f');
    expect(live.setFollowNewest).toHaveBeenCalledWith(false);

    const live2 = baseLive({ followNewest: false });
    renderHook(() => useLiveKeyboardShortcuts(live2, true));
    press('F');
    expect(live2.setFollowNewest).toHaveBeenCalledWith(true);
  });

  it('does nothing at all when isActive is false - shortcuts never fire from the historical search screen', () => {
    const live = baseLive({ connectionState: 'live', visibleEvents: [{ message: 'x' } as never] });
    renderHook(() => useLiveKeyboardShortcuts(live, false));
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
    renderHook(() => useLiveKeyboardShortcuts(live, true));
    press('p', { ctrlKey: true });
    press('p', { metaKey: true });
    press('p', { altKey: true });
    expect(live.pause).not.toHaveBeenCalled();
  });

  it('never fires while focus is inside a text-entry control, so typing p/s/c/f is never hijacked', () => {
    const live = baseLive({ connectionState: 'live', visibleEvents: [{ message: 'x' } as never] });
    renderHook(() => useLiveKeyboardShortcuts(live, true));
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

  it('reads fresh live state at keypress time without re-registering the listener on every render (no duplicate/leaked global listener)', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const live = baseLive({ connectionState: 'live' });
    const { rerender } = renderHook(({ l }) => useLiveKeyboardShortcuts(l, true), { initialProps: { l: live } });

    const keydownAddCallsAfterMount = addSpy.mock.calls.filter((c) => c[0] === 'keydown').length;
    expect(keydownAddCallsAfterMount).toBe(1);

    // A fresh `live` object every render (same isActive) - the effect must
    // not depend on `live` itself, or this would tear down/re-add the
    // listener on every single render.
    rerender({ l: baseLive({ connectionState: 'paused' }) });
    const finalLive = baseLive({ connectionState: 'paused' });
    rerender({ l: finalLive });

    const keydownAddCallsAfterRerenders = addSpy.mock.calls.filter((c) => c[0] === 'keydown').length;
    expect(keydownAddCallsAfterRerenders).toBe(1); // still exactly one - never re-registered

    // ...yet the handler still reads the *latest* live state (paused -> P resumes).
    press('p');
    expect(finalLive.resume).toHaveBeenCalledTimes(1);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('removes the listener on unmount, and again when isActive flips to false', () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const live = baseLive({ connectionState: 'live' });
    const { rerender, unmount } = renderHook(({ active }) => useLiveKeyboardShortcuts(live, active), {
      initialProps: { active: true },
    });

    rerender({ active: false });
    expect(removeSpy.mock.calls.filter((c) => c[0] === 'keydown').length).toBeGreaterThanOrEqual(1);

    const before = removeSpy.mock.calls.filter((c) => c[0] === 'keydown').length;
    unmount();
    // No listener was left registered while inactive, so unmount adds no further removal.
    expect(removeSpy.mock.calls.filter((c) => c[0] === 'keydown').length).toBe(before);

    removeSpy.mockRestore();
  });
});
