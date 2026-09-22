import '@testing-library/jest-dom/vitest';
import { afterEach, expect, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);

// jsdom does not implement Element.scrollIntoView at all (a well-known gap, not specific to any one
// component) - PR61_OWNER_NAVIGATION_RECOVERY_2 exposed it for the first time via SettingsWorkspace's own
// mount-time "scroll to the requested section" effect. A no-op stub here fixes it for every test, present and
// future, rather than each component defensively feature-detecting a real-browser API.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

// Not using vitest `globals: true`, so @testing-library/react's automatic
// afterEach(cleanup) registration never triggers - without this, every
// render() from a previous test leaks into the next one's DOM.
afterEach(() => {
  cleanup();
});
