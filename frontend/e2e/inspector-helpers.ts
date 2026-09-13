/*
 * Pre-closure functional recovery (§1/PCFR-1) — Log-Explorer-specific E2E
 * helpers for the Event Inspector's new WAI-ARIA tabs pattern
 * (`frontend/src/features/inspector/InspectorTabs.tsx`). Kept separate
 * from the app-agnostic `helpers.ts` (its own doc comment: "Deliberately
 * has no dependency on any particular app"), since these are specific to
 * this component's own structure.
 *
 * Before this recovery, all five Inspector sections were stacked in one
 * long scrolling flow, so every section's heading/content was in the DOM
 * simultaneously. Now only the ACTIVE tab's content is in the DOM at all
 * (`InspectorTabs.tsx`'s own doc comment) — these helpers let existing
 * specs written against the old always-visible-flow assumption keep
 * checking the same underlying behavior without duplicating the
 * click-through-every-tab logic in every spec file.
 */

import type { Locator, Page } from '@playwright/test';

/** Strips a sortable column header's appended sort-state text (e.g. "Time↕, not sorted, activate to sort ascending") down to the plain column label — mirrors the identical fix in `ResultsTable.test.tsx`'s own `headerLabel` helper. */
export function headerLabel(text: string): string {
  return text.replace(/[↕▲▼].*$/, '').trim();
}

/** Clicks the Inspector tab whose visible label matches `name` (e.g. /request flow/i), waiting for it to become the active tab. */
export async function openInspectorTab(dialog: Locator, page: Page, name: RegExp): Promise<void> {
  const tab = dialog.getByRole('tab', { name });
  await tab.click();
  await page.waitForFunction(
    (args) => {
      const el = document.querySelector(`[role="tab"][aria-selected="true"]`);
      return el?.textContent?.match(new RegExp(args.pattern, args.flags)) != null;
    },
    { pattern: name.source, flags: name.flags },
  );
}

/**
 * Clicks through every tab currently offered in `dialog` (data-driven —
 * an event with no actor/client data, for example, may not even offer
 * that tab, per PCFR-1's "never display an empty meaningless tab") and
 * concatenates each tab's own rendered text. For an assertion that used
 * to read the whole (previously single-flow) panel at once — "this text
 * appears somewhere in the inspector" — this still holds without the
 * caller needing to know which specific tab now owns it.
 */
export async function inspectorAllTabsText(dialog: Locator): Promise<string> {
  const tabs = dialog.getByRole('tab');
  const count = await tabs.count();
  let combined = '';
  for (let i = 0; i < count; i++) {
    await tabs.nth(i).click();
    combined += '\n' + (await dialog.innerText());
  }
  return combined;
}
