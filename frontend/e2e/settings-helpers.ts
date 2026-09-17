/*
 * B2 (Session 4) - Log-Explorer-specific E2E helper for the consolidated Settings entry point
 * (`frontend/src/app/Shell.tsx`, `frontend/src/features/settings/SettingsWorkspace.tsx`). Kept separate from
 * the app-agnostic `helpers.ts` (its own doc comment: "Deliberately has no dependency on any particular
 * app"), same reasoning as `inspector-helpers.ts`.
 *
 * Before this session, "Docker settings"/"Privacy & masking"/"OpenShift" were their own top-level Shell
 * buttons, each opening its own popover directly. They are unchanged themselves - same trigger text, same
 * popover, same behaviour - but are now reached via ONE consolidated Settings entry point first
 * (COMPONENT_INVENTORY.md: "the three settings popover triggers become one Settings entry"). This helper is
 * exactly that one extra step, so existing specs keep asserting the same underlying panel behaviour without
 * each duplicating the "open Settings first" click.
 */

import type { Page } from '@playwright/test';

/**
 * Opens the consolidated Settings workspace, then clicks the named section's own trigger button inside it
 * (e.g. "Docker settings", "Privacy & masking", "OpenShift"). Idempotent about Settings itself: if the
 * workspace is already open (e.g. a test opens two different sections in sequence), it is not re-opened.
 */
export async function openSettingsSection(page: Page, sectionButtonName: string | RegExp): Promise<void> {
  const workspace = page.getByTestId('settings-workspace');
  if (!(await workspace.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /^settings$/i }).click();
    await workspace.waitFor({ state: 'visible' });
  }
  await page.getByRole('button', { name: sectionButtonName }).click();
}
