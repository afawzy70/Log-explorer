import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

/*
 * Owner mission "Event Classification, Extraction, and Portable Rules" -
 * end-to-end acceptance flow against the real backend (SPRING_PROFILES_ACTIVE=dev)
 * and the deterministic Fixture source, whose corpus contains synthetic
 * middleware-like webhook events plus deliberately similar non-middleware
 * events. No external Docker instance is involved.
 *
 * Classification rules are shared backend state, so this file runs serially
 * and resets the rules through the real API before and after.
 */

test.describe.configure({ mode: 'serial' });

const RULES_API = '/api/v1/settings/classification-rules';

async function resetRules(page: Page) {
  const state = await (await page.request.get(RULES_API)).json();
  const response = await page.request.post(`${RULES_API}/import/apply`, {
    data: {
      packJson: JSON.stringify({ format: 'log-explorer-classification-pack', schemaVersion: 1, rules: [] }),
      mode: 'REPLACE_ALL',
      expectedRevision: state.revision,
      confirmReplaceAll: true,
    },
  });
  expect(response.ok()).toBeTruthy();
}

async function runSearch(page: Page, text = '') {
  const input = page.getByPlaceholder(/search messages/i);
  await input.fill(text);
  await page.getByRole('button', { name: /^search$/i }).click();
  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15_000 });
}

async function openFixtureSearch(page: Page, text = '') {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('fixture');
  await runSearch(page, text);
}

async function openInspectorOnRow(page: Page, messagePrefix: RegExp) {
  const row = page.locator('tbody tr').filter({ hasText: messagePrefix }).first();
  await expect(row).toBeVisible();
  const message = (await row.innerText()).replace(/\s+/g, ' ');
  await row.getByRole('button', { name: /actions for this event/i }).click();
  await page.getByRole('menuitem', { name: /view details/i }).click();
  const dialog = page.getByRole('dialog', { name: /event details/i });
  await expect(dialog).toBeVisible();
  return { dialog, message };
}

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await resetRules(page);
  await page.close();
});

test('create a tag rule from an event, detect, test, save, classify, export, delete, import, and restore', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await resetRules(page);

  // 2-3: search synthetic logs and open a known middleware-like event.
  await openFixtureSearch(page, 'Make webhook call to');
  const { dialog: inspector } = await openInspectorOnRow(page, /Make webhook call to/);
  await expect(inspector.getByText(/^(Tag )?MIDDLEWARE$/)).toHaveCount(0);

  // 4-5: Create tag rule from this event; field defaults to message with the sample value shown.
  await inspector.getByRole('button', { name: 'Create tag rule from this event' }).click();
  await expect(page.getByLabel(/^field$/i).first()).toHaveValue('message');
  await expect(page.getByText(/Make webhook call to \/\S+ method=/).first()).toBeVisible();

  // 6-7: Detect pattern over a bounded real sample; similar events are found; use the suggestion.
  await page.getByRole('button', { name: /^next$/i }).click();
  await page.getByRole('button', { name: /detect pattern/i }).click();
  const detected = page.getByLabel('Detected pattern');
  await expect(detected).toBeVisible({ timeout: 30_000 });
  await expect(detected).toContainText(/Sampled:?\s*200/);
  await expect(detected).toContainText(/Similar:?\s*\d+/);
  await expect(detected).toContainText('Make webhook call to');
  await page.getByRole('button', { name: 'Use this suggestion' }).click();

  // 8: name and tag.
  await page.getByRole('button', { name: /^next$/i }).click();
  await page.getByLabel('Rule name').fill('Middleware HTTP Call');
  await page.getByLabel('Tags (comma-separated, required)').fill('middleware');

  // 9: suggested extractions include url, responseCode, durationMs.
  await page.getByRole('button', { name: /^next$/i }).click();
  const extractionNames = await page.locator('input').evaluateAll((inputs) =>
    inputs.map((input) => (input as HTMLInputElement).value));
  expect(extractionNames).toEqual(expect.arrayContaining(['url', 'responseCode', 'durationMs']));

  // 10-11: test against a bounded real sample.
  await page.getByRole('button', { name: /^next$/i }).click();
  await page.getByRole('button', { name: 'Test rule' }).click();
  const results = page.getByLabel('Test results');
  await expect(results).toBeVisible({ timeout: 30_000 });
  await expect(results).toContainText(/Matched:?\s*[1-9]\d*/);
  await expect(results).toContainText('Review these matches for false positives');
  await expect(results).toContainText(/responseCode|Response code/i);

  // 12: explicit save.
  await page.getByRole('button', { name: /^next$/i }).click();
  await page.getByRole('button', { name: 'Save rule' }).click();
  await expect(page.getByText('Rule saved. Re-run Search to classify currently loaded results.')).toBeVisible();

  // 13-15: re-run search; the matching event shows the tag and correct extracted values.
  await openFixtureSearch(page, '');
  const middleware = await openInspectorOnRow(page, /Make webhook call to/);
  await expect(middleware.dialog.getByText(/^(Tag )?MIDDLEWARE$/)).toBeVisible();
  await expect(middleware.dialog.getByText('Middleware HTTP Call')).toBeVisible();
  const responseCode = middleware.message.match(/responseCode=(\d+)/)?.[1];
  const durationMs = middleware.message.match(/duration=(\d+)ms/)?.[1];
  const url = middleware.message.match(/call to (\S+)/)?.[1];
  expect(responseCode && durationMs && url).toBeTruthy();
  const classification = middleware.dialog.getByRole('region', { name: /classification/i });
  await expect(classification).toContainText(responseCode!);
  await expect(classification).toContainText(durationMs!);
  await expect(classification).toContainText(url!);

  // 16-17: a deliberately similar non-match is not tagged.
  await page.keyboard.press('Escape');
  const nearMiss = await openInspectorOnRow(page, /Make webhook configuration reload/);
  await expect(nearMiss.dialog.getByText(/^(Tag )?MIDDLEWARE$/)).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Tag filter is enforced by the backend: only middleware events come back.
  await page.getByRole('button', { name: /more filters/i }).click();
  await page.getByRole('group', { name: 'Classification tags' }).getByLabel('middleware').check();
  await page.getByRole('button', { name: /^apply$/i }).click();
  await expect(page.getByText('Tag:')).toBeVisible();
  const taggedSearch = page.waitForResponse((response) =>
    response.url().includes('/api/v1/logs/search')
    && (response.request().postDataJSON()?.tags ?? []).includes('middleware'));
  await page.getByRole('button', { name: /^search$/i }).click();
  const taggedResponse = await taggedSearch;
  expect(taggedResponse.ok()).toBeTruthy();
  const taggedBody = await taggedResponse.json();
  expect(taggedBody.events.length).toBeGreaterThan(0);
  for (const event of taggedBody.events) {
    expect(event.tags).toContain('middleware');
  }
  await expect(page.locator('tbody tr').first()).toContainText('Make webhook call to', { timeout: 15_000 });
  const filteredMessages = await page.locator('tbody tr').allInnerTexts();
  expect(filteredMessages.length).toBeGreaterThan(0);
  for (const text of filteredMessages) {
    expect(text).toContain('Make webhook call to');
  }

  // 18: export the rule pack.
  await page.getByRole('button', { name: 'Classification rules' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export all' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('log-explorer-classification-pack.json');
  const packPath = test.info().outputPath('log-explorer-classification-pack.json');
  await download.saveAs(packPath);
  const pack = JSON.parse(await readFile(packPath, 'utf8'));
  expect(pack.format).toBe('log-explorer-classification-pack');
  expect(pack.rules).toHaveLength(1);
  expect(JSON.stringify(pack)).not.toMatch(/revision|createdAt|classification-rules\.json/);

  // 19: delete with confirmation.
  await page.getByRole('button', { name: 'Delete Middleware HTTP Call' }).click();
  await page.getByRole('button', { name: 'Delete rule' }).click();
  await expect(page.getByText('No classification rules yet.')).toBeVisible();

  // 20: classification disappears after re-search.
  await page.getByRole('button', { name: /back to search results/i }).click();
  // The tag filter is still active: with the rule gone no event carries the tag, so the backend truthfully returns none.
  const emptyTagged = page.waitForResponse((response) => response.url().includes('/api/v1/logs/search'));
  await page.getByRole('button', { name: /^search$/i }).click();
  expect((await (await emptyTagged).json()).events).toHaveLength(0);
  await page.getByRole('button', { name: /clear all/i }).click();
  await expect(page.getByText('Tag:')).toHaveCount(0);
  await runSearch(page, 'Make webhook call to');
  const afterDelete = await openInspectorOnRow(page, /Make webhook call to/);
  await expect(afterDelete.dialog.getByText(/^(Tag )?MIDDLEWARE$/)).toHaveCount(0);
  await page.keyboard.press('Escape');

  // 21-23: import the exported pack - preview, then explicit apply.
  await page.getByRole('button', { name: 'Classification rules' }).click();
  await page.getByLabel('Import rules file').setInputFiles(packPath);
  const preview = page.getByLabel('Rules in this pack');
  await expect(preview).toBeVisible();
  await expect(page.getByText(/New:?\s*1/)).toBeVisible();
  await page.getByRole('button', { name: /apply/i }).click();
  await expect(page.getByText(/Added\s*1/)).toBeVisible();

  // 24-25: re-run search; classification and extraction are restored.
  await page.getByRole('button', { name: /back to search results/i }).click();
  await runSearch(page, 'Make webhook call to');
  const restored = await openInspectorOnRow(page, /Make webhook call to/);
  await expect(restored.dialog.getByText(/^(Tag )?MIDDLEWARE$/)).toBeVisible();
  const restoredCode = restored.message.match(/responseCode=(\d+)/)?.[1];
  await expect(restored.dialog.getByRole('region', { name: /classification/i })).toContainText(restoredCode!);
});
