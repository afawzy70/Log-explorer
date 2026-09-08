import { describe, expect, it } from 'vitest';

/**
 * "No dangerouslySetInnerHTML anywhere (lint rule + test)"
 * (IMPLEMENTATION_PLAN.md "Phase H" automated tests). This project has no
 * ESLint configured (Phase A's audited baseline - see `package.json`: no
 * `eslint` dependency, no config file), so introducing a whole lint
 * toolchain just for one rule would be scope creep beyond this phase's
 * job. A repo-wide source scan, using Vite's own `import.meta.glob` (no
 * Node `fs` access needed - `src/` is browser-only code, deliberately
 * excluded from Node types by `tsconfig.app.json`), enforces the same
 * invariant just as reliably - CLAUDE.md §2 rule 3: "No
 * `dangerouslySetInnerHTML`. Log content renders as text, always."
 */
describe('no dangerouslySetInnerHTML anywhere in src/', () => {
  it('no source file uses dangerouslySetInnerHTML', () => {
    const modules = import.meta.glob('/src/**/*.{ts,tsx}', {
      eager: true,
      query: '?raw',
      import: 'default',
    }) as Record<string, string>;

    // Matches real JSX/prop usage (`dangerouslySetInnerHTML={...}` or
    // `dangerouslySetInnerHTML=`), not comments that merely reference the
    // rule by name (several inspector files document why they deliberately
    // avoid it).
    const usagePattern = /dangerouslySetInnerHTML\s*=/;
    const offenders = Object.entries(modules)
      .filter(([, content]) => usagePattern.test(content))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });
});
