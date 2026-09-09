/**
 * True when `target` is (or is inside) something the browser already
 * treats as a text-entry surface - an `<input>`, `<textarea>`,
 * `<select>`, or any `contenteditable` element. Every global shortcut in
 * this app (UI Parity Acceleration Pass §10 "keyboard productivity")
 * checks this first so a single-character shortcut like `/` or `?` never
 * hijacks a keystroke the user meant to type into a search box, an
 * Advanced Filters field, or the inspector's All Fields search input.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true;
  }
  // `isContentEditable` (the fully-computed, inheritance-aware boolean) is
  // preferred where a test environment implements it; `contentEditable`
  // (the plain reflected attribute string) is the fallback jsdom actually
  // supports, so this stays correct under both a real browser and Vitest.
  return target.isContentEditable === true || target.contentEditable === 'true';
}
