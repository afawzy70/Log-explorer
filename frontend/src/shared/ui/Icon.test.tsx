import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Icon } from './Icon';

describe('Icon', () => {
  it('renders the named glyph at the default (md, 16px) size with the design stroke width', () => {
    const { container } = render(<Icon name="search" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('width', '16');
    expect(svg).toHaveAttribute('height', '16');
    expect(svg).toHaveAttribute('stroke-width', '1.75');
  });

  it('sm/lg map to 14px/20px', () => {
    const { container: sm } = render(<Icon name="check" size="sm" />);
    expect(sm.querySelector('svg')).toHaveAttribute('width', '14');
    const { container: lg } = render(<Icon name="check" size="lg" />);
    expect(lg.querySelector('svg')).toHaveAttribute('width', '20');
  });

  it('is decorative (aria-hidden) by default, matching the design prototype convention', () => {
    const { container } = render(<Icon name="x" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).not.toHaveAttribute('role');
  });

  it('becomes the accessible name only when an explicit label is passed', () => {
    render(<Icon name="x" label="Close" />);
    expect(screen.getByRole('img', { name: 'Close' })).toBeInTheDocument();
  });

  it('every icon used by the approved design package renders without throwing', () => {
    // Same 68-name list verified against every `I('<name>', ...)` call in
    // the design package's prototype scripts - a regression here means a
    // future slice would silently render nothing for a real design state.
    const names = [
      'activity', 'arrow-down', 'arrow-down-wide-narrow', 'arrow-left', 'arrow-right', 'arrow-up',
      'arrow-up-narrow-wide', 'ban', 'box', 'braces', 'check', 'chevron-down', 'chevron-left', 'chevron-right',
      'circle-alert', 'circle-check', 'circle-dashed', 'circle-plus', 'clock', 'columns-3', 'copy', 'crosshair',
      'database', 'download', 'ellipsis', 'eye-off', 'file-json', 'filter', 'flask-conical', 'git-branch', 'globe',
      'grip-vertical', 'history', 'info', 'keyboard', 'list-checks', 'loader-circle', 'lock', 'minus', 'pause',
      'pencil', 'pencil-line', 'play', 'plug', 'plus', 'radio', 'refresh-cw', 'rotate-ccw', 'rotate-cw',
      'scan-search', 'search', 'server', 'settings', 'shield', 'shield-alert', 'shield-check',
      'sliders-horizontal', 'split', 'square', 'tag', 'tags', 'timer', 'trash-2', 'triangle-alert', 'upload',
      'waypoints', 'wifi-off', 'x',
    ] as const;
    for (const name of names) {
      const { container, unmount } = render(<Icon name={name} />);
      expect(container.querySelector('svg')).not.toBeNull();
      unmount();
    }
  });
});
