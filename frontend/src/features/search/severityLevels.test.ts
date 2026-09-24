import { describe, expect, it } from 'vitest';
import {
  ALL_SEVERITY_LEVEL_IDS,
  DEFAULT_SEVERITY_LEVELS,
  ERRORS_ONLY_LEVELS,
  SEVERITY_LEVELS,
  isAllLevelsSelected,
} from './severityLevels';

describe('severityLevels', () => {
  it('owner follow-up - "Unknown" (a well-formed event with no severity at all) is offered as its own selectable level', () => {
    expect(SEVERITY_LEVELS.map((l) => l.id)).toContain('UNKNOWN');
    expect(SEVERITY_LEVELS.find((l) => l.id === 'UNKNOWN')?.label).toBe('Unknown');
  });

  it('"Unknown" is part of "All" (and the fresh default) - it must never be excluded by the every-level-selected default', () => {
    expect(ALL_SEVERITY_LEVEL_IDS).toContain('UNKNOWN');
    expect(DEFAULT_SEVERITY_LEVELS).toContain('UNKNOWN');
    expect(isAllLevelsSelected(ALL_SEVERITY_LEVEL_IDS)).toBe(true);
  });

  it('"Errors only" never implicitly includes "Unknown" - it means real ERROR-severity events only', () => {
    expect(ERRORS_ONLY_LEVELS).not.toContain('UNKNOWN');
    expect(ERRORS_ONLY_LEVELS).toEqual(['ERROR']);
  });

  it('selecting only some real levels (not "Unknown") is not mistaken for "all levels selected"', () => {
    expect(isAllLevelsSelected(['INFO', 'WARN', 'ERROR'])).toBe(false);
  });
});
