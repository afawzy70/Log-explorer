import { test, expect } from '@playwright/test';
import { setViewport, assertNoHorizontalOverflow, captureScreenshot } from './helpers';
import { openSettingsSection } from './settings-helpers';

/*
 * PR61_OWNER_NAVIGATION_RECOVERY_2 - post-mission independent review found the original Classification-
 * return, Keyboard-shortcuts Settings presentation, and Back-affordance defects were still present after
 * PR61_OWNER_MANUAL_USABILITY_AND_CLASSIFICATION_RECOVERY. This file proves the fix against the real
 * rendered app: Back/breadcrumb are now origin-aware (Settings vs. Search/Inspector), Settings lands
 * deterministically on the requested section instead of always "Sources", Keyboard shortcuts renders real
 * inline content in Settings (not the compact header popover), and Appearance is reachable from the shared
 * SettingsNav. Mission's own N01-N28 test matrix, mapped inline per test.
 */

async function searchFixture(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('fixture');
  await page.getByRole('button', { name: /^search$/i }).click();
  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15_000 });
}

test.describe('PR61_OWNER_NAVIGATION_RECOVERY_2 - Classification Rules origin-aware Back (N02, N04, N21, N22)', () => {
  test('N02: Settings -> Classification -> Back -> Settings (not Search)', async ({ page }) => {
    await page.goto('/');
    await openSettingsSection(page, /privacy & masking/i);
    await page.getByRole('button', { name: 'Manage classification rules' }).click();
    await expect(page.getByTestId('classification-rules-workspace')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back to Settings' })).toBeVisible();

    await page.getByRole('button', { name: 'Back to Settings' }).click();
    await expect(page.getByTestId('classification-rules-workspace')).not.toBeVisible();
    await expect(page.getByTestId('settings-workspace')).toBeVisible();
  });

  test('N04/N22: Inspector -> Classification -> Back -> the same event\'s Inspector, not bare Search', async ({ page }) => {
    await searchFixture(page);
    const row = page.locator('tbody tr').nth(1);
    const rowText = (await row.innerText()).replace(/\s+/g, ' ');
    await row.getByRole('button', { name: /actions for this event/i }).click();
    await page.getByRole('menuitem', { name: /view details/i }).click();
    await expect(page.getByRole('dialog', { name: /event details/i })).toBeVisible();

    await page.getByRole('button', { name: 'Create tag rule from this event' }).click();
    await expect(page.getByTestId('classification-rules-workspace')).toBeVisible();
    // No breadcrumb at all for a search-origin visit - nothing to contradict a Back that already names the
    // one real ancestor truthfully.
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Back to Search results' })).toBeVisible();

    await page.getByRole('button', { name: 'Back to Search results' }).click();
    await expect(page.getByTestId('classification-rules-workspace')).not.toBeVisible();
    await expect(page.getByTestId('settings-workspace')).not.toBeVisible();
    const dialog = page.getByRole('dialog', { name: /event details/i });
    await expect(dialog).toBeVisible();
    expect((await dialog.innerText()).replace(/\s+/g, ' ')).toContain(rowText.split(' ')[0]);
  });

  test('N06/N21: Settings -> Classification -> New rule -> Cancel returns to the list (not Search); the outer Back still goes to Settings; Search state is untouched throughout', async ({ page }) => {
    await searchFixture(page);
    const rowCountBefore = await page.locator('tbody tr').count();

    await page.getByRole('button', { name: /^settings$/i }).click();
    await page.getByRole('button', { name: 'Manage classification rules' }).click();
    await expect(page.getByTestId('classification-rules-workspace')).toBeVisible();

    await page.getByRole('button', { name: 'New rule' }).click();
    await expect(page.getByRole('heading', { name: /Step 1 of \d: (Source|Detect)/ })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    // Cancel returns to the classification LIST - still inside the workspace, not out to Settings/Search.
    await expect(page.getByTestId('classification-rules-workspace')).toBeVisible();
    await expect(page.getByRole('button', { name: 'New rule' })).toBeVisible();

    await page.getByRole('button', { name: 'Back to Settings' }).click();
    await expect(page.getByTestId('settings-workspace')).toBeVisible();
    await page.getByRole('button', { name: 'Back to Search results' }).click();
    await expect(page.getByTestId('settings-workspace')).not.toBeVisible();
    // The original search results are exactly as they were - navigating through Settings/Classification and
    // back never re-ran or lost Search.
    await expect(page.locator('tbody tr')).toHaveCount(rowCountBefore);
  });
});

test.describe('PR61_OWNER_NAVIGATION_RECOVERY_2 - Field Mapping origin-aware Back (N03, N05)', () => {
  test('N03: Settings -> Field mapping -> Back -> Settings (not Search)', async ({ page }) => {
    await page.goto('/');
    await openSettingsSection(page, /privacy & masking/i);
    await page.getByRole('button', { name: 'Log schema & field mapping' }).click();
    await expect(page.getByTestId('field-mapping-workspace')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back to Settings' })).toBeVisible();

    await page.getByRole('button', { name: 'Back to Settings' }).click();
    await expect(page.getByTestId('field-mapping-workspace')).not.toBeVisible();
    await expect(page.getByTestId('settings-workspace')).toBeVisible();
  });

  test('N05: Shell\'s own header trigger -> Field mapping -> Back -> Search (not Settings)', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('banner').getByRole('button', { name: /^field mapping$/i }).click();
    await expect(page.getByTestId('field-mapping-workspace')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Back to Search results' })).toBeVisible();

    await page.getByRole('button', { name: 'Back to Search results' }).click();
    await expect(page.getByTestId('field-mapping-workspace')).not.toBeVisible();
    await expect(page.getByTestId('settings-workspace')).not.toBeVisible();
  });
});

test.describe('PR61_OWNER_NAVIGATION_RECOVERY_2 - Settings target-section determinism (N08-N13, N17)', () => {
  test('N08-N11: the Classification sidebar lands Settings deterministically on Sources/Privacy/Appearance/Keyboard shortcuts', async ({ page }) => {
    await page.goto('/');
    await openSettingsSection(page, /privacy & masking/i);
    await page.getByRole('button', { name: 'Manage classification rules' }).click();
    const nav = page.getByRole('navigation', { name: 'Settings sections' });

    for (const [label, sectionId] of [
      ['Sources & connections', 'settings-sources'],
      ['Privacy & masking', 'settings-masking'],
      ['Appearance', 'settings-appearance'],
      ['Keyboard shortcuts', 'settings-shortcuts'],
    ] as const) {
      await nav.getByRole('button', { name: label }).click();
      await expect(page.getByTestId('settings-workspace')).toBeVisible();
      await expect(nav.getByRole('button', { name: label })).toHaveAttribute('aria-current', 'page');
      // Scoped to this section's own outer heading specifically - PrivacyMaskingSettingsPanel nests its own
      // identically-worded <h2> one level inside (a real, PRE-EXISTING, unrelated defect - see this mission's
      // own governance record), which would otherwise make a bare heading-text query ambiguous.
      await expect(page.locator(`#${sectionId}-heading`)).toBeVisible();
      // Return to Classification for the next iteration - Settings' OWN SettingsNav "Classification rules"
      // item scrolls to Settings' own inline section (correct, unchanged, same-page behavior); its actual
      // "Manage classification rules" button is what navigates away, reachable regardless of scroll position.
      await page.getByRole('button', { name: 'Manage classification rules' }).click();
      await expect(page.getByTestId('classification-rules-workspace')).toBeVisible();
    }
  });

  test('N12-N13: the Field Mapping sidebar lands Settings deterministically on Appearance/Keyboard shortcuts', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('banner').getByRole('button', { name: /^field mapping$/i }).click();
    const nav = page.getByRole('navigation', { name: 'Settings sections' });

    await nav.getByRole('button', { name: 'Appearance' }).click();
    await expect(page.getByTestId('settings-workspace')).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Appearance' })).toHaveAttribute('aria-current', 'page');

    await page.getByRole('banner').getByRole('button', { name: /^field mapping$/i }).click();
    await nav.getByRole('button', { name: 'Keyboard shortcuts' }).click();
    await expect(page.getByTestId('settings-workspace')).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Keyboard shortcuts' })).toHaveAttribute('aria-current', 'page');
  });

  test('N17: Appearance is listed in the shared Settings nav', async ({ page }) => {
    await page.goto('/');
    await openSettingsSection(page, /privacy & masking/i);
    await expect(page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Appearance' })).toBeVisible();
  });
});

test.describe('PR61_OWNER_NAVIGATION_RECOVERY_2 - Keyboard shortcuts: real inline content (N14-N16)', () => {
  test('N14/N15: Settings shows the full shortcut reference inline - no popover trigger, no dialog', async ({ page }) => {
    await page.goto('/');
    await openSettingsSection(page, /keyboard shortcuts/i);
    const section = page.locator('#settings-shortcuts');
    await expect(section.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible();
    // Real registered content - at least one group and one key/description row - visible with no click.
    await expect(section.locator('dt').first()).toBeVisible();
    await expect(section.locator('dd').first()).toBeVisible();
    // The compact popover's own affordances are not what's rendered here.
    await expect(section.getByRole('dialog')).not.toBeVisible();
  });

  test('N16: the header\'s own compact popover still works unchanged', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('banner').getByRole('button', { name: 'Keyboard shortcuts' }).click();
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).not.toBeVisible();
  });
});

test.describe('PR61_OWNER_NAVIGATION_RECOVERY_2 - theme still works after Appearance moved into the shared nav (N18-N20)', () => {
  test('N18/N19: Dark and Light both still apply data-theme immediately from Settings', async ({ page }) => {
    await page.goto('/');
    await openSettingsSection(page, /appearance/i);
    await page.getByRole('radio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('radio', { name: 'Light' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByRole('radio', { name: 'Match system' }).click();
  });
});

test.describe('PR61_OWNER_NAVIGATION_RECOVERY_2 - no auto-search, truthful Back names (N23, N24)', () => {
  test('N23: no workspace-navigation transition ever triggers a new search request', async ({ page }) => {
    await searchFixture(page);
    let searchRequests = 0;
    page.on('request', (req) => {
      if (req.url().includes('/api/v1/logs/search')) {
        searchRequests++;
      }
    });

    await page.getByRole('button', { name: /^settings$/i }).click();
    await page.getByRole('button', { name: 'Manage classification rules' }).click();
    await page.getByRole('button', { name: 'Back to Settings' }).click();
    await page.getByRole('button', { name: 'Back to Search results' }).click();
    await page.waitForTimeout(300);
    expect(searchRequests).toBe(0);
  });

  test('N24: Back accessible names always describe the true destination, never a stale generic label', async ({ page }) => {
    await page.goto('/');
    // Settings-origin: both Classification and Field Mapping say "Back to Settings".
    await openSettingsSection(page, /privacy & masking/i);
    await page.getByRole('button', { name: 'Manage classification rules' }).click();
    await expect(page.getByRole('button', { name: 'Back to Settings' })).toBeVisible();
    await page.getByRole('button', { name: 'Back to Settings' }).click();
    await page.getByRole('button', { name: 'Log schema & field mapping' }).click();
    await expect(page.getByRole('button', { name: 'Back to Settings' })).toBeVisible();
    await page.getByRole('button', { name: 'Back to Settings' }).click();

    // Search-origin (Shell's own header trigger): Field Mapping says "Back to Search results" instead.
    await page.getByRole('button', { name: 'Back to Search results' }).click();
    await page.getByRole('banner').getByRole('button', { name: /^field mapping$/i }).click();
    await expect(page.getByRole('button', { name: 'Back to Search results' })).toBeVisible();
  });
});

test.describe('PR61_OWNER_NAVIGATION_RECOVERY_2 - responsive at 390px (N25-N27)', () => {
  test('N25: Settings navigation (including the new Keyboard shortcuts inline content) has no horizontal overflow', async ({ page }) => {
    await setViewport(page, 390);
    await page.goto('/');
    await openSettingsSection(page, /keyboard shortcuts/i);
    await expect(page.getByTestId('settings-workspace')).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });

  test('N26: Classification Back/navigation remains reachable at 390px', async ({ page }) => {
    await setViewport(page, 390);
    await page.goto('/');
    await openSettingsSection(page, /privacy & masking/i);
    await page.getByRole('button', { name: 'Manage classification rules' }).click();
    await expect(page.getByTestId('classification-rules-workspace')).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await expect(page.getByRole('button', { name: 'Back to Settings' })).toBeVisible();
    await page.getByRole('button', { name: 'Back to Settings' }).click();
    await expect(page.getByTestId('settings-workspace')).toBeVisible();
  });

  test('N27: Field Mapping Back/navigation remains reachable at 390px', async ({ page }) => {
    await setViewport(page, 390);
    await page.goto('/');
    await openSettingsSection(page, /privacy & masking/i);
    await page.getByRole('button', { name: 'Log schema & field mapping' }).click();
    await expect(page.getByTestId('field-mapping-workspace')).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await expect(page.getByRole('button', { name: 'Back to Settings' })).toBeVisible();
    await page.getByRole('button', { name: 'Back to Settings' }).click();
    await expect(page.getByTestId('settings-workspace')).toBeVisible();
  });
});

test.describe('PR61_OWNER_NAVIGATION_RECOVERY_2 - keyboard-only navigation (N28)', () => {
  test('keyboard alone can enter and leave Settings, Field Mapping, and Classification Rules', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('banner').getByRole('button', { name: /^settings$/i }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('settings-workspace')).toBeVisible();

    await page.getByRole('button', { name: 'Manage classification rules' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('classification-rules-workspace')).toBeVisible();

    await page.getByRole('button', { name: 'Back to Settings' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('settings-workspace')).toBeVisible();

    await page.getByRole('button', { name: 'Log schema & field mapping' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('field-mapping-workspace')).toBeVisible();

    await page.getByRole('button', { name: 'Back to Settings' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('settings-workspace')).toBeVisible();

    await page.getByRole('button', { name: 'Back to Search results' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('settings-workspace')).not.toBeVisible();
  });
});

// Minimal synthetic evidence only, per the mission's own explicit scope - not a broad visual re-audit.
test.describe('PR61_OWNER_NAVIGATION_RECOVERY_2 - visual evidence', () => {
  const EVIDENCE = 'PR61_NAV_RECOVERY_2_EVIDENCE';

  test('1. Settings / Keyboard shortcuts inline', async ({ page }) => {
    await page.goto('/');
    await openSettingsSection(page, /keyboard shortcuts/i);
    await captureScreenshot(page, EVIDENCE, '1-settings-keyboard-shortcuts-inline');
  });

  test('2. Settings / Appearance', async ({ page }) => {
    await page.goto('/');
    await openSettingsSection(page, /appearance/i);
    await captureScreenshot(page, EVIDENCE, '2-settings-appearance');
  });

  test('3. Classification entered from Settings - clear Back to Settings', async ({ page }) => {
    await page.goto('/');
    await openSettingsSection(page, /privacy & masking/i);
    await page.getByRole('button', { name: 'Manage classification rules' }).click();
    await expect(page.getByTestId('classification-rules-workspace')).toBeVisible();
    await captureScreenshot(page, EVIDENCE, '3-classification-from-settings-back-to-settings');
  });

  test('4. Classification entered from Search - clear Back to Search results', async ({ page }) => {
    await searchFixture(page);
    const row = page.locator('tbody tr').nth(1);
    await row.getByRole('button', { name: /actions for this event/i }).click();
    await page.getByRole('menuitem', { name: /view details/i }).click();
    await page.getByRole('button', { name: 'Create tag rule from this event' }).click();
    await expect(page.getByTestId('classification-rules-workspace')).toBeVisible();
    await captureScreenshot(page, EVIDENCE, '4-classification-from-search-back-to-search-results');
  });

  test('5. Field Mapping entered from Settings - clear Back to Settings', async ({ page }) => {
    await page.goto('/');
    await openSettingsSection(page, /privacy & masking/i);
    await page.getByRole('button', { name: 'Log schema & field mapping' }).click();
    await expect(page.getByTestId('field-mapping-workspace')).toBeVisible();
    await captureScreenshot(page, EVIDENCE, '5-field-mapping-from-settings-back-to-settings');
  });

  test('6. 390px Settings navigation', async ({ page }) => {
    await setViewport(page, 390);
    await page.goto('/');
    await openSettingsSection(page, /keyboard shortcuts/i);
    await captureScreenshot(page, EVIDENCE, '6-settings-navigation-390px');
  });

  test('7. 390px Classification navigation', async ({ page }) => {
    await setViewport(page, 390);
    await page.goto('/');
    await openSettingsSection(page, /privacy & masking/i);
    await page.getByRole('button', { name: 'Manage classification rules' }).click();
    await expect(page.getByTestId('classification-rules-workspace')).toBeVisible();
    await captureScreenshot(page, EVIDENCE, '7-classification-navigation-390px');
  });
});
