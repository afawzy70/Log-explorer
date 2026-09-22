/*
 * B2 (Session 4) - Log-Explorer-specific E2E helper for the consolidated Settings entry point
 * (`frontend/src/app/Shell.tsx`, `frontend/src/features/settings/SettingsWorkspace.tsx`). Kept separate from
 * the app-agnostic `helpers.ts` (its own doc comment: "Deliberately has no dependency on any particular
 * app"), same reasoning as `inspector-helpers.ts`.
 *
 * Before Session 4, "Docker settings"/"Privacy & masking"/"OpenShift" were their own top-level Shell
 * buttons, each opening its own popover directly. Session 4 moved them behind ONE consolidated Settings
 * entry point first (COMPONENT_INVENTORY.md: "the three settings popover triggers become one Settings
 * entry"), reached via this helper's "open Settings first" step, but each panel was STILL its own
 * trigger-button popover underneath - this helper's second step used to click that inner trigger too.
 *
 * B6.2 (Session 7) - `DockerSettingsPanel`/`PrivacyMaskingSettingsPanel`/`OpenShiftSettingsPanel` are no
 * longer trigger-button popovers: they render persistently as soon as Settings itself is open (COMPONENT_
 * INVENTORY.md's own RECOMPOSE rows for all three). There is nothing left to click for them - only "Field
 * mapping" and "Classification rules" still navigate to their OWN separate takeover workspace via a real
 * button, unaffected by this recompose. This helper now clicks the named section's button only if one still
 * exists; for the three now-persistent panels it is a no-op, since their content is already visible the
 * moment Settings opens.
 */

import type { Page } from '@playwright/test';

/**
 * Opens the consolidated Settings workspace. If the named section is still reached via its own button
 * inside Settings (e.g. "Field mapping", "Classification rules" - each opens a separate takeover workspace),
 * clicks it. For a section that is now a persistent inline panel (Docker, Privacy & masking, OpenShift -
 * B6.2), there is no button to click and this is a no-op: the panel's content is already visible. Idempotent
 * about Settings itself: if the workspace is already open (e.g. a test opens two different sections in
 * sequence), it is not re-opened.
 */
export async function openSettingsSection(page: Page, sectionButtonName: string | RegExp): Promise<void> {
  const workspace = page.getByTestId('settings-workspace');
  if (!(await workspace.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /^settings$/i }).click();
    await workspace.waitFor({ state: 'visible' });
  }
  const button = workspace.getByRole('button', { name: sectionButtonName });
  if (await button.count()) {
    await button.first().click();
  }
}
