import type { CSSProperties, ReactNode } from 'react';

const style: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

/** Screen-reader-only text, visually hidden but not `display: none` (CLAUDE.md §7 a11y). */
export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span style={style}>{children}</span>;
}
