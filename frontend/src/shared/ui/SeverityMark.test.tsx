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

  it('renders nothing for a null/unknown severity', () => {
    const { container } = render(<SeverityMark severity={null} />);
    expect(container.querySelector('[class*="sevMark"]')).toBeNull();
  });

  it('with a label, becomes the accessible name instead of being decorative', () => {
    const { getByRole } = render(<SeverityMark severity="ERROR" label="Error" />);
    const mark = getByRole('img', { name: 'Error' });
    expect(mark).not.toHaveAttribute('aria-hidden');
  });
});
