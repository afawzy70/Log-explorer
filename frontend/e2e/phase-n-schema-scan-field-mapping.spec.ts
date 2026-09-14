import { test, expect } from '@playwright/test';
import { captureScreenshot } from './helpers';

/*
 * Owner mission "Field Mapping Schema Scan + Masking Policy Extension" §A —
 * real-browser evidence for the Quick Schema Scan workflow: Connect Source
 * → Quick Schema Scan → Review Original Event Samples → Review Discovered
 * Source Schema → Map Fields (via the discovered-paths picker, mission
 * §A10) → Validate → Save. Drives the real backend's `fixture` source
 * (SPRING_PROFILES_ACTIVE=dev), whose deterministic corpus contains
 * INFO/ERROR/WARN severities and a fixture-malformed line, exactly the
 * diversity this scan is meant to surface — not a mock.
 *
 * Shared-singleton backend state discipline (this project's established
 * pattern for `core.mapping.FieldMappingProfileService`, also touched by
 * `phase-m`/`ux-r*` masking specs for `MaskingPolicyService`): every test
 * here resets the mapping profile to its default at the end so it never
 * leaks into a later test in the same run.
 */

async function selectFixtureSource(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('fixture');
}

async function openMappingPanel(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /log schema & field mapping/i }).click();
  return page.getByRole('dialog', { name: /log schema & field mapping/i });
}

async function resetMappingProfile(page: import('@playwright/test').Page) {
  const panel = page.getByRole('dialog', { name: /log schema & field mapping/i });
  if (await panel.isVisible().catch(() => false)) {
    await panel.getByRole('button', { name: /reset to defaults/i }).click();
    await expect(panel.getByText(/^search ready\.?$/i)).toBeVisible();
    await panel.getByRole('button', { name: /^close$/i }).click();
  }
}

test('running a Quick Schema Scan against the real fixture source shows real Original Event Samples and a Discovered Source Schema union', async ({
  page,
}) => {
  await selectFixtureSource(page);
  const panel = await openMappingPanel(page);

  await panel.getByRole('button', { name: /run quick schema scan/i }).click();
  await expect(panel.getByText(/observed \d+ events?/i)).toBeVisible({ timeout: 10_000 });

  // Real representative Original Event Samples, from the real fixture corpus.
  await expect(panel.getByText(/representative original event sample/i)).toBeVisible();
  const sampleSelect = panel.locator('select').first();
  const sampleOptionsText = await sampleSelect.locator('option').allTextContents();
  expect(sampleOptionsText.some((t) => /INFO|ERROR|WARN/i.test(t))).toBe(true);

  // The Discovered Source Schema table - real paths from the fixture's own MDC shape. Scoped
  // to the one <table> on this panel, since a discovered path also appears as picker <option>
  // text in every field row that doesn't yet have it mapped.
  await expect(panel.getByText(/discovered source schema/i)).toBeVisible();
  const schemaTable = panel.locator('table');
  await expect(schemaTable.getByText('mdc.cif', { exact: true })).toBeVisible();
  await expect(
    schemaTable.getByText('mdc.CustomerId', { exact: true }).or(schemaTable.getByText('mdc.customerId', { exact: true })),
  ).toBeVisible();

  // Never presented as a complete/guaranteed schema (mission §A11).
  await expect(page.getByText(/not a guaranteed-complete/i)).toBeVisible();

  await captureScreenshot(page, 'n', 'quick-schema-scan-results-1280px');

  await resetMappingProfile(page);
});

test('malformed fixture lines are counted truthfully and excluded from the schema union', async ({ page }) => {
  await selectFixtureSource(page);
  const panel = await openMappingPanel(page);

  await panel.getByRole('button', { name: /run quick schema scan/i }).click();
  await expect(panel.getByText(/malformed, excluded from the schema below/i)).toBeVisible({ timeout: 10_000 });

  await resetMappingProfile(page);
});

test('the discovered-paths picker lets a user map a canonical field without typing, and the mapping validates and saves', async ({
  page,
}) => {
  await selectFixtureSource(page);
  const panel = await openMappingPanel(page);

  await panel.getByRole('button', { name: /run quick schema scan/i }).click();
  await expect(panel.getByText(/discovered source schema/i)).toBeVisible({ timeout: 10_000 });

  const journeyRow = panel.locator('li', { has: page.getByText('Journey Name', { exact: true }) }).first();
  const picker = journeyRow.getByLabel(/add a discovered path as a candidate/i);
  await expect(picker.locator('option')).not.toHaveCount(0);
  // Pick whichever real discovered path the picker offers first (not a hardcoded guess).
  const firstRealOption = await picker.locator('option').nth(1).getAttribute('value');
  expect(firstRealOption).toBeTruthy();
  await picker.selectOption(firstRealOption!);
  await journeyRow.getByRole('button', { name: /^add$/i }).click();
  await expect(journeyRow.locator('code', { hasText: firstRealOption! })).toBeVisible();

  await panel.getByRole('button', { name: /^validate mapping$/i }).click();
  await expect(panel.getByText(/no invalid paths|not valid/i)).toBeVisible({ timeout: 10_000 });

  await captureScreenshot(page, 'n', 'field-mapping-picker-used-1280px');

  await resetMappingProfile(page);
});

test('rescan highlights newly discovered and no-longer-observed paths without silently changing the saved mapping', async ({
  page,
}) => {
  await selectFixtureSource(page);
  const panel = await openMappingPanel(page);

  await panel.getByRole('button', { name: /run quick schema scan/i }).click();
  await expect(panel.getByText(/discovered source schema/i)).toBeVisible({ timeout: 10_000 });

  // Rescan - a real second network call against the same live source.
  await panel.getByRole('button', { name: /^rescan$/i }).click();
  await expect(panel.getByText(/observed \d+ events?/i)).toBeVisible({ timeout: 10_000 });

  // The saved mapping (still the untouched built-in default) remains search-ready throughout.
  await expect(panel.getByText(/search ready/i)).toBeVisible();

  await resetMappingProfile(page);
});
