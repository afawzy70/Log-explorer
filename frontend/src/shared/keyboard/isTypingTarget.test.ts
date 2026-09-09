import { describe, expect, it } from 'vitest';
import { isTypingTarget } from './isTypingTarget';

describe('isTypingTarget', () => {
  it('is true for input/textarea/select', () => {
    expect(isTypingTarget(document.createElement('input'))).toBe(true);
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true);
    expect(isTypingTarget(document.createElement('select'))).toBe(true);
  });

  it('is true for a contenteditable element', () => {
    const div = document.createElement('div');
    div.contentEditable = 'true';
    document.body.appendChild(div);
    expect(isTypingTarget(div)).toBe(true);
    div.remove();
  });

  it('is false for a plain button/div/null/non-element target', () => {
    expect(isTypingTarget(document.createElement('button'))).toBe(false);
    expect(isTypingTarget(document.createElement('div'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget({} as EventTarget)).toBe(false);
  });
});
