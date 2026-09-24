import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { SeverityMark } from './SeverityMark';

describe('SeverityMark', () => {
  it('renders a shape-differentiated, decorative mark for every known level', () => {
    const shapeByLevel: Record<string, string> = {
      ERROR: 'sevMarkError',
      WARN: 'sevMarkWarn',
      INFO: 'sevMarkInfo',
      DEBUG: 'sevMarkDebug',
      TRACE: 'sevMarkTrace',
      // The severity dropdown's own "Unknown" level id - not a real
      // severity any event's own `severity()` can hold (see the test
      // below for that distinct, still-null-renders-nothing case).
      UNKNOWN: 'sevMarkUnknown',
    };
    for (const [severity, shapeClass] of Object.entries(shapeByLevel)) {
      const { container, unmount } = render(<SeverityMark severity={severity} />);
      const mark = container.querySelector('[class*="sevMark"]');
      expect(mark).not.toBeNull();
      expect(mark!.className).toMatch(new RegExp(shapeClass));
      expect(mark!.getAttribute('aria-hidden')).toBe('true');
      unmount();
    }
  });

  it('renders nothing for a null severity or any other unrecognized string - a REAL event never literally carries "UNKNOWN" as its own severity() value', () => {
    const { container: withNull } = render(<SeverityMark severity={null} />);
    expect(withNull.querySelector('[class*="sevMark"]')).toBeNull();

    const { container: withGarbage } = render(<SeverityMark severity="not-a-real-level" />);
    expect(withGarbage.querySelector('[class*="sevMark"]')).toBeNull();
  });

  it('with a label, becomes the accessible name instead of being decorative', () => {
    const { getByRole } = render(<SeverityMark severity="ERROR" label="Error" />);
    const mark = getByRole('img', { name: 'Error' });
    expect(mark).not.toHaveAttribute('aria-hidden');
  });
});
