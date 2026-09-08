import '@testing-library/jest-dom/vitest';
import { afterEach, expect } from 'vitest';
import { cleanup } from '@testing-library/react';
import { toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);

// Not using vitest `globals: true`, so @testing-library/react's automatic
// afterEach(cleanup) registration never triggers - without this, every
// render() from a previous test leaks into the next one's DOM.
afterEach(() => {
  cleanup();
});
