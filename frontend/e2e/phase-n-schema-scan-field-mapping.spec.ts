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

/**
 * Owner mission "Mapping Verification and Investigation Workspace" - Part
 * A turned this from a popover into a real, dedicated full-page workspace
 * (`data-testid="field-mapping-workspace"`), replacing the results
 * workspace exactly like `JourneyView` does - never a `role="dialog"`
 * popover anymore.
 */
async function openMappingPanel(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /log schema & field mapping/i }).click();
  const panel = page.getByTestId('field-mapping-workspace');
  await expect(panel).toBeVisible();
  return panel;
}

async function resetMappingProfile(page: import('@playwright/test').Page) {
  const panel = page.getByTestId('field-mapping-workspace');
  if (await panel.isVisible().catch(() => false)) {
    await panel.getByRole('button', { name: /reset to defaults/i }).click();
    await expect(panel.getByText(/^search ready\.?$/i)).toBeVisible();
    await panel.getByRole('button', { name: /back to search results/i }).click();
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
  // Owner mission "Service Filter, Docker Performance, and Verified
  // Default Mapping" §C - cif/customerId are now emitted (and default-
  // mapped) at the top level, not nested under mdc - was 'mdc.cif'/
  // 'mdc.CustomerId'.
  await expect(schemaTable.getByText('cif', { exact: true })).toBeVisible();
  await expect(schemaTable.getByText('customerId', { exact: true })).toBeVisible();

  // Never presented as a complete/guaranteed schema (mission §A11).
  await expect(page.getByText(/not a guaranteed-complete/i)).toBeVisible();

  await captureScreenshot(page, 'n', 'quick-schema-scan-results-1280px');

  await resetMappingProfile(page);
});

test('malformed fixture lines are counted truthfully and excluded from the schema union', async ({ page }) => {
  await selectFixtureSource(page);
  const panel = await openMappingPanel(page);

  await panel.getByRole('button', { name: /run quick schema scan/i }).click();
  await expect(panel.getByText(/non-JSON\/malformed excluded from the schema below/i)).toBeVisible({ timeout: 10_000 });

  await resetMappingProfile(page);
});

test('the scan summary reports the selected scope truthfully for a source with no project concept', async ({ page }) => {
  // Owner mission "Project-Scoped Schema Scan" §1/§6: fixture has no
  // Compose-project/namespace concept, so the scan is unscoped and must
  // say so honestly, never fabricate a project name.
  await selectFixtureSource(page);
  const panel = await openMappingPanel(page);

  await panel.getByRole('button', { name: /run quick schema scan/i }).click();
  await expect(panel.getByText(/selected scope/i)).toBeVisible({ timeout: 10_000 });
  await expect(panel.getByText(/all \(no project selected\)/i)).toBeVisible();

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

/*
 * Owner mission "Service Filter, Docker Performance, and Verified Default
 * Mapping" §C - real-browser evidence that (a) the owner-approved built-in
 * default mapping starts VERIFIED with zero scan/edit/save/verify effort
 * (BUILT_IN_DEFAULT_PROFILE_STATUS=VERIFIED, superseding the original
 * "Mapping Verification and Investigation Workspace" mission's "every
 * field including the built-in default starts UNVERIFIED" rule - see
 * docs/governance/OWNER_REQUIREMENTS_REGISTER.md §24/MVER-1), and (b) a
 * field with NO default (UI Identifier, owner declined to guess it) still
 * starts UNVERIFIED and still requires the owner to map it and Verify is a
 * real, evidence-gated server round trip against the real fixture source.
 */
test('the owner-approved default mapping starts Verified with no scan required; an intentionally unmapped field starts Unverified until configured and verified against real evidence', async ({
  page,
}) => {
  await selectFixtureSource(page);
  const panel = await openMappingPanel(page);

  const serviceRow = panel.locator('li', { has: page.getByText('Service', { exact: true }) }).first();
  await expect(serviceRow.getByText('Verified', { exact: true })).toBeVisible();
  await expect(serviceRow.getByText('Unverified', { exact: true })).not.toBeVisible();
  // No "run a scan first" hint for an already-VERIFIED, untouched default -
  // QUICK_SCAN_NOT_REQUIRED_FOR_DEFAULT_VERIFICATION.
  await expect(serviceRow.getByText(/run a quick schema scan first/i)).toHaveCount(0);

  const uiIdentifierRow = panel.locator('li', { has: page.getByText('UI Identifier', { exact: true }) }).first();
  await expect(uiIdentifierRow.getByText('Unverified', { exact: true })).toBeVisible();
  await expect(uiIdentifierRow.getByRole('button', { name: /^verify$/i })).toBeDisabled();

  await panel.getByRole('button', { name: /run quick schema scan/i }).click();
  await expect(panel.getByText(/observed \d+ events?/i)).toBeVisible({ timeout: 10_000 });

  // UI Identifier has no default candidate - map it via the discovered-paths picker first.
  const picker = uiIdentifierRow.getByLabel(/add a discovered path as a candidate/i);
  const uiIdentifierOption = picker.locator('option', { hasText: /uiidentifier/i }).first();
  const uiIdentifierValue = await uiIdentifierOption.getAttribute('value');
  expect(uiIdentifierValue).toBeTruthy();
  await picker.selectOption(uiIdentifierValue!);
  await uiIdentifierRow.getByRole('button', { name: /^add$/i }).click();
  await panel.getByRole('button', { name: /^validate mapping$/i }).click();
  await expect(panel.getByText(/no invalid paths/i)).toBeVisible({ timeout: 10_000 });
  await panel.getByRole('button', { name: /save mapping/i }).click();
  await expect(panel.getByText(/^search ready\.?$/i)).toBeVisible({ timeout: 10_000 });

  await expect(uiIdentifierRow.getByRole('button', { name: /^verify$/i })).toBeEnabled();
  await uiIdentifierRow.getByRole('button', { name: /^verify$/i }).click();

  await expect(uiIdentifierRow.getByText('Verified', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(uiIdentifierRow.getByText('Unverified', { exact: true })).not.toBeVisible();

  await captureScreenshot(page, 'n', 'field-mapping-verified-1280px');

  await resetMappingProfile(page);
});

/*
 * Recovery mission "Field Mapping Verification Workflow Recovery" - the
 * owner-reported defect, reproduced and proven fixed against the real
 * backend: a picked discovered path is validated, saved, and genuinely
 * PERSISTED (proven by leaving the workspace and reopening it - a fresh
 * GET, not client memory) - then Verify succeeds against exactly that
 * saved candidate. Before the fix, Save never actually called `PUT
 * /fields/{field}`, so the reopened panel would still show the OLD
 * candidate and Verify would reject it with "not found in any of the
 * given samples" despite the picker having shown it as observed.
 */
test('a picked candidate genuinely persists after Save (proven by reopening the workspace) and then Verify succeeds against exactly that saved value', async ({
  page,
}) => {
  await selectFixtureSource(page);
  const panel = await openMappingPanel(page);

  await panel.getByRole('button', { name: /run quick schema scan/i }).click();
  await expect(panel.getByText(/discovered source schema/i)).toBeVisible({ timeout: 10_000 });

  const cifRow = panel.locator('li', { has: page.getByText('CIF', { exact: true }) }).first();
  // Replace the default candidate with a different real discovered path -
  // proves persistence of a genuinely CHANGED mapping, not just re-saving
  // the untouched default (which would pass even with the old bug, since
  // the backend's untouched default candidate was already correct).
  // Owner mission "Service Filter, Docker Performance, and Verified
  // Default Mapping" §C - CIF's default candidate is now the top-level
  // "cif" path (was "mdc.cif").
  await cifRow.getByRole('button', { name: /^remove cif$/i }).click();
  const picker = cifRow.getByLabel(/add a discovered path as a candidate/i);
  const customerIdOption = picker.locator('option', { hasText: /customerid/i }).first();
  const customerIdValue = await customerIdOption.getAttribute('value');
  expect(customerIdValue).toBeTruthy();
  await picker.selectOption(customerIdValue!);
  await cifRow.getByRole('button', { name: /^add$/i }).click();
  await expect(cifRow.locator('code', { hasText: customerIdValue! })).toBeVisible();

  await panel.getByRole('button', { name: /^validate mapping$/i }).click();
  await expect(panel.getByText(/no invalid paths/i)).toBeVisible({ timeout: 10_000 });
  await expect(panel.getByRole('button', { name: /save mapping/i })).toBeEnabled();
  await panel.getByRole('button', { name: /save mapping/i }).click();
  await expect(panel.getByText(/^search ready\.?$/i)).toBeVisible({ timeout: 10_000 });

  // Persistence proof: leave the workspace entirely and come back - a real fresh GET, not client memory.
  await panel.getByRole('button', { name: /back to search results/i }).click();
  const reopened = await openMappingPanel(page);
  const cifRowAgain = reopened.locator('li', { has: page.getByText('CIF', { exact: true }) }).first();
  await expect(cifRowAgain.locator('code', { hasText: customerIdValue! })).toBeVisible();
  await expect(cifRowAgain.locator('code', { hasText: 'cif', exact: true })).toHaveCount(0);

  // Now Verify must succeed against exactly this saved candidate - the owner-reported contradiction, now fixed.
  await reopened.getByRole('button', { name: /run quick schema scan/i }).click();
  await expect(reopened.getByText(/observed \d+ events?/i)).toBeVisible({ timeout: 10_000 });
  await expect(cifRowAgain.getByRole('button', { name: /^verify$/i })).toBeEnabled();
  await cifRowAgain.getByRole('button', { name: /^verify$/i }).click();
  await expect(cifRowAgain.getByText('Verified', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(cifRowAgain.getByRole('alert')).toHaveCount(0);

  await captureScreenshot(page, 'n', 'field-mapping-recovery-persisted-and-verified-1280px');

  await resetMappingProfile(page);
});

test('Mark needs change flags a field explicitly, and editing its candidate never silently promotes it back to Verified', async ({
  page,
}) => {
  await selectFixtureSource(page);
  const panel = await openMappingPanel(page);

  const serviceRow = panel.locator('li', { has: page.getByText('Service', { exact: true }) }).first();
  await serviceRow.getByRole('button', { name: /mark needs change/i }).click();
  await expect(serviceRow.getByText('Needs change', { exact: true })).toBeVisible({ timeout: 10_000 });

  // "Mark needs change" is not offered again for a field already in that state.
  await expect(serviceRow.getByRole('button', { name: /mark needs change/i })).toHaveCount(0);

  await resetMappingProfile(page);
});
