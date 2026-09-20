import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openSettingsSection } from './settings-helpers';

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
  /*
   * The sample is the committed search itself (owner mission "Classification real search scope, assisted
   * extraction, and visual tagging"), so this search - narrowed to "Make webhook call to" - samples that
   * population rather than the newest 200 events of the whole source. Every sampled event is therefore similar,
   * which is exactly the property the reported defect lacked.
   */
  const detectedText = await detected.innerText();
  const sampled = Number(/Sampled:?\s*(\d+)/.exec(detectedText)?.[1] ?? '0');
  const similar = Number(/Similar:?\s*(\d+)/.exec(detectedText)?.[1] ?? '0');
  expect(sampled).toBeGreaterThan(10);
  expect(similar).toBeGreaterThan(sampled / 2);
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
  await openSettingsSection(page, /^manage classification rules$/i);
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
  await openSettingsSection(page, /^manage classification rules$/i);
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

/*
 * PR61_OWNER_MANUAL_USABILITY_AND_CLASSIFICATION_RECOVERY (E01-E08) - real owner manual testing found
 * assisted/confirmed extractions could reach Test structurally invalid, with no explanation beyond a raw
 * technical path once already there. The fix is the Extraction step's own "Preview values" button (distinct
 * from the wizard's generic "Next", which the test above uses and which never ran this check): it now
 * validates the draft server-side first and only advances once nothing in it is structurally invalid. This
 * test exercises THAT specific button, against the real backend and real fixture data - proving a normal,
 * unedited, suggestion-derived extraction set (url/responseCode/durationMs, single-capture, server-generated
 * named groups) needs no manual Capture group intervention to pass.
 */
test('Preview values structurally validates a suggestion-derived rule and reaches Test without any manual Group edit', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await resetRules(page);

  // E01-E03: open Classification Rules from the normal navigation, start a rule from a selected event, detect.
  await openFixtureSearch(page, 'Make webhook call to');
  const { dialog: inspector } = await openInspectorOnRow(page, /Make webhook call to/);
  await inspector.getByRole('button', { name: 'Create tag rule from this event' }).click();
  await page.getByRole('button', { name: /^next$/i }).click();
  await page.getByRole('button', { name: /detect pattern/i }).click();
  await expect(page.getByLabel('Detected pattern')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Use this suggestion' }).click();
  await page.getByRole('button', { name: /^next$/i }).click();
  await page.getByLabel('Rule name').fill('Preview Values Recovery Check');
  await page.getByLabel('Tags (comma-separated, required)').fill('middleware');
  await page.getByRole('button', { name: /^next$/i }).click();

  // E04/E05: the server-generated suggestions are already the rule's extractions here (a real, unedited
  // acceptance - not a synthetic construction), each with its own "(confirmed)" now honestly meaning the
  // server already validated exactly this definition.
  await expect(page.getByRole('group', { name: /url \(confirmed\)/i })).toBeVisible();
  await expect(page.getByRole('group', { name: /response code \(confirmed\)/i })).toBeVisible();

  // E06/E07: "Preview values" - not "Next" - runs the new structural pre-check and advances on its own once
  // it passes, with no manual Capture group edit anywhere in this flow.
  await page.getByRole('button', { name: 'Preview values' }).click();
  await expect(page.getByRole('heading', { name: /Step \d of \d: Test/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('This rule is not valid yet:')).toHaveCount(0);
  await page.getByRole('button', { name: 'Test rule' }).click();
  const results = page.getByLabel('Test results');
  await expect(results).toBeVisible({ timeout: 30_000 });
  await expect(results).toContainText(/Matched:?\s*[1-9]\d*/);

  // E08: Save remains possible after a valid test.
  await page.getByRole('button', { name: /^next$/i }).click();
  await page.getByRole('button', { name: 'Save rule' }).click();
  await expect(page.getByText('Rule saved. Re-run Search to classify currently loaded results.')).toBeVisible();
});

/*
 * Owner mission "Classification real search scope, assisted extraction, and visual tagging" - the owner's own
 * reproduction, in this same serial file because classification rules are shared backend state and Playwright
 * runs spec FILES in parallel (`fullyParallel: true`): a second file resetting the rules would race this one.
 *
 * The reported defect: with a search narrowed to `API_LOGS` and a screen full of matching events, Detect pattern
 * found about one similar event and a hand-written `message STARTS_WITH "API_LOGS:"` rule reported "matched 1,
 * not matched 199", because the classification sample dropped the committed query and every advanced filter.
 */

const QUERY = 'API_LOGS';

/** The row of a real API_LOGS event - never the deliberately similar API_LOGS_SUMMARY line. */
function apiLogsRow(page: Page) {
  return page
    .locator('tbody tr')
    .filter({ hasText: /API_LOGS:/ })
    .filter({ hasNotText: 'API_LOGS_SUMMARY' })
    .first();
}

async function openInspectorOnApiLogsRow(page: Page) {
  const row = apiLogsRow(page);
  await expect(row).toBeVisible();
  const message = (await row.innerText()).replace(/\s+/g, ' ');
  await row.getByRole('button', { name: /actions for this event/i }).click();
  await page.getByRole('menuitem', { name: /view details/i }).click();
  const dialog = page.getByRole('dialog', { name: /event details/i });
  await expect(dialog).toBeVisible();
  return { dialog, message };
}

test('the owner reproduction: scoped detect and test, assisted extraction, visible coloured tags, add extraction from an event, export and re-import', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.goto('/');
  await resetRules(page);

  // 1-2. A search narrowed to API_LOGS shows many matching events.
  await openFixtureSearch(page, QUERY);
  const visibleApiLogs = await page.locator('tbody tr').filter({ hasText: /API_LOGS:/ }).count();
  expect(visibleApiLogs).toBeGreaterThan(10);

  // 3-4. Open one of them and create a tag rule from it.
  const { dialog: inspector } = await openInspectorOnApiLogsRow(page);
  await inspector.getByRole('button', { name: 'Create tag rule from this event' }).click();
  await expect(page.getByLabel(/^field$/i).first()).toHaveValue('message');

  // 5-6. Detect pattern samples the SAME search population - the defect was ~1 similar event here.
  await page.getByRole('button', { name: /^next$/i }).click();
  await page.getByRole('button', { name: /detect pattern/i }).click();
  const detected = page.getByLabel('Detected pattern');
  await expect(detected).toBeVisible({ timeout: 30_000 });
  await expect(detected).toContainText('API_LOGS');
  const similar = Number(/Similar:?\s*(\d+)/.exec(await detected.innerText())?.[1] ?? '0');
  expect(similar).toBeGreaterThan(5);
  await page.getByRole('button', { name: 'Use this suggestion' }).click();

  // 7. Classification: name, tag and an explicit colour, with a live preview chip.
  await page.getByRole('button', { name: /^next$/i }).click();
  await page.getByLabel('Rule name').fill('API middleware');
  await page.getByLabel('Tags (comma-separated, required)').fill('middleware');
  await page.getByRole('radio', { name: 'Blue' }).check();
  await expect(page.locator('[data-tag-color="BLUE"]').first()).toBeVisible();

  // 8-9. Assisted extraction. The detector's own suggestion already filled the rule, so the step opens with
  // confirmed values and honestly reports that nothing further can be inferred. Removing one and asking again
  // suggests exactly that value back, measured on the matching events, and it is adopted explicitly.
  await page.getByRole('button', { name: /^next$/i }).click();
  await expect(page.getByRole('group', { name: /\(confirmed\)$/ }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Already extracted by this rule:/)).toBeVisible();
  await expect(page.getByText(/Read from \d+ matching events in the current search/)).toBeVisible();

  const statusValue = page.getByRole('group', { name: 'Status (confirmed)' });
  await expect(statusValue).toBeVisible();
  await statusValue.getByRole('button', { name: /^Remove extraction/ }).click();
  await page.getByRole('button', { name: 'Detect extractable values again' }).click();

  const suggested = page.getByRole('list', { name: 'Suggested extractions' });
  await expect(suggested).toBeVisible({ timeout: 30_000 });
  await expect(suggested).toContainText(/Found in \d+ \/ \d+/);
  const addSelected = page.getByRole('button', { name: /^Add \d+ selected value/ });
  await expect(addSelected).toBeEnabled();
  await addSelected.click();
  await expect(page.getByRole('group', { name: 'Status (confirmed)' })).toBeVisible();

  // 10-11. Test: the match count reflects the API_LOGS population, not one stray event.
  await page.getByRole('button', { name: /^next$/i }).click();
  await page.getByRole('button', { name: 'Test rule' }).click();
  const results = page.getByLabel('Test results');
  await expect(results).toBeVisible({ timeout: 30_000 });
  const matched = Number(/Matched:?\s*(\d+)/.exec(await results.innerText())?.[1] ?? '0');
  expect(matched).toBeGreaterThan(5);
  await expect(results).toContainText('Review these matches for false positives');

  // 12. Explicit save, with truthful guidance about already-loaded results.
  await page.getByRole('button', { name: /^next$/i }).click();
  await page.getByRole('button', { name: 'Save rule' }).click();
  await expect(page.getByText('Rule saved. Re-run Search to classify currently loaded results.')).toBeVisible();

  // 13-15. Re-run search: the classification is visible in the table itself, in the chosen colour.
  await page.getByRole('button', { name: /back to search results/i }).click();
  await runSearch(page, QUERY);
  const taggedRow = apiLogsRow(page);
  await expect(taggedRow).toContainText('middleware');
  await expect(taggedRow.locator('[data-tag-color="BLUE"]').first()).toBeVisible();
  // The deliberately similar summary line stays untagged.
  const summaryRow = page.locator('tbody tr').filter({ hasText: 'API_LOGS_SUMMARY' }).first();
  await expect(summaryRow.locator('[data-tag-color]')).toHaveCount(0);

  // 16-18. The inspector shows the same identity and colour, plus the extracted values.
  const classified = await openInspectorOnApiLogsRow(page);
  const classification = classified.dialog.getByRole('region', { name: /classification/i });
  await expect(classification).toContainText('API middleware');
  await expect(classification.locator('[data-tag-color="BLUE"]').first()).toBeVisible();
  const status = /\[Status\]: (\d+)/.exec(classified.message)?.[1];
  expect(status).toBeTruthy();
  await expect(classification).toContainText(status!);

  // 19-22. "Add extraction from this event" extends the rule that matched it - never a new rule, never silently.
  await classified.dialog.getByRole('button', { name: 'Add extraction from this event' }).click();
  await expect(page.getByRole('heading', { name: /extraction/i }).first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Add extraction manually' }).click();
  // A value with no name yet is the only group still legended by position (naming it renames its legend), and
  // adding one manually opens its Advanced detail straight away - so the expression is filled first.
  const manual = page.getByRole('group', { name: /^Extraction \d+$/ });
  await manual.getByLabel('Expression').fill('==>RequestPath: (?P<requestPathManual>\\S+)');
  await manual.getByLabel('Name').fill('requestPathManual');
  await page.getByRole('button', { name: /^next$/i }).click();
  await page.getByRole('button', { name: 'Test rule' }).click();
  await expect(page.getByLabel('Test results')).toContainText(/requestPathManual|Request path manual/i, {
    timeout: 30_000,
  });
  await page.getByRole('button', { name: /^next$/i }).click();
  await page.getByRole('button', { name: 'Save rule' }).click();
  await expect(page.getByText('Rule saved. Re-run Search to classify currently loaded results.')).toBeVisible();

  // 23-24. Re-run search: the added value is extracted for real.
  await page.getByRole('button', { name: /back to search results/i }).click();
  await runSearch(page, QUERY);
  const extended = await openInspectorOnApiLogsRow(page);
  const path = /==>RequestPath: (\S+)/.exec(extended.message)?.[1];
  expect(path).toBeTruthy();
  await expect(extended.dialog.getByRole('region', { name: /classification/i })).toContainText(path!);
  await page.keyboard.press('Escape');

  // 25. Export: the pack carries the colour, and still no server-side or runtime data.
  await openSettingsSection(page, /^manage classification rules$/i);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export all' }).click();
  const download = await downloadPromise;
  const packPath = test.info().outputPath('api-logs-pack.json');
  await download.saveAs(packPath);
  const pack = JSON.parse(await readFile(packPath, 'utf8'));
  expect(pack.rules).toHaveLength(1);
  expect(pack.rules[0].displayColor).toBe('BLUE');
  expect(JSON.stringify(pack)).not.toMatch(/revision|createdAt|classification-rules\.json/);

  // 26. Delete the rule; the table stops showing the classification after a re-search.
  await page.getByRole('button', { name: 'Delete API middleware' }).click();
  await page.getByRole('button', { name: 'Delete rule' }).click();
  await expect(page.getByText('No classification rules yet.')).toBeVisible();
  await page.getByRole('button', { name: /back to search results/i }).click();
  await runSearch(page, QUERY);
  await expect(apiLogsRow(page).locator('[data-tag-color]')).toHaveCount(0);

  // 27-30. Import the same pack back: classification, colour and extraction all return.
  await openSettingsSection(page, /^manage classification rules$/i);
  await page.getByLabel('Import rules file').setInputFiles(packPath);
  await expect(page.getByLabel('Rules in this pack')).toBeVisible();
  await page.getByRole('button', { name: /apply/i }).click();
  await expect(page.getByText(/Added\s*1/)).toBeVisible();
  await page.getByRole('button', { name: /back to search results/i }).click();
  await runSearch(page, QUERY);
  await expect(apiLogsRow(page).locator('[data-tag-color="BLUE"]').first()).toBeVisible();
  const restored = await openInspectorOnApiLogsRow(page);
  const restoredPath = /==>RequestPath: (\S+)/.exec(restored.message)?.[1];
  await expect(restored.dialog.getByRole('region', { name: /classification/i })).toContainText(restoredPath!);
});
