// Augments vitest's Assertion interface with jest-axe's matcher. The
// leading `import 'vitest'` is required: without a top-level import/export
// of its own, this file would be treated as a global script, and `declare
// module 'vitest' { ... }` would REPLACE the real vitest module's types
// project-wide (losing describe/it/expect!) instead of augmenting them.
import 'vitest';

declare module 'vitest' {
  interface Assertion<T = unknown> {
    toHaveNoViolations(): T;
  }
}
