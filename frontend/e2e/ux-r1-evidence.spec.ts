import { test, expect } from '@playwright/test';
import { captureScreenshot, setViewport, assertNoHorizontalOverflow } from './helpers';

const PHASE = 'UX_R1_EVIDENCE';

async function gotoFixture(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('fixture');
}

test.describe('UX-R1 mandatory visual verification (§14) - real rendered app, real dev backend', () => {
  test('A: Search empty state', async ({ page }) => {
    await gotoFixture(page);
    await expect(page.getByRole('button', { name: /^search$/i })).toBeVisible();
    await captureScreenshot(page, PHASE, 'A-search-empty-state');
  });

  test('B-C-D-E-F: filters applied, chips, removal, Clear all', async ({ page }) => {
    await gotoFixture(page);

    // B/C: apply one advanced filter (traceId) via More filters - a single active chip.
    await page.getByRole('button', { name: /^more filters/i }).click();
    await page.getByLabel('Trace ID').fill('fixture-trace-000340');
    await page.getByRole('button', { name: /^apply$/i }).click();
    await expect(page.getByText('fixture-trace-000340')).toBeVisible();
    await captureScreenshot(page, PHASE, 'B-search-with-active-filters');
    await captureScreenshot(page, PHASE, 'C-one-active-chip');

    // D: a second, independent chip kind (severity, toggled off default) joins it - multiple active chips at once.
    await page.getByRole('button', { name: 'Warn' }).click(); // toggles a severity level off default
    await expect(page.getByText(/^severity:/i)).toBeVisible();
    await captureScreenshot(page, PHASE, 'D-multiple-active-chips');

    // E: remove one chip (traceId), the other (severity) remains.
    await page.getByRole('button', { name: /remove trace id filter/i }).click();
    await expect(page.getByText('fixture-trace-000340')).not.toBeVisible();
    await expect(page.getByText(/^severity:/i)).toBeVisible();
    await captureScreenshot(page, PHASE, 'E-chip-removed');

    // F: Clear all.
    await page.getByRole('button', { name: /^clear all$/i }).click();
    await expect(page.getByText(/^severity:/i)).not.toBeVisible();
    await captureScreenshot(page, PHASE, 'F-clear-all');
  });

  test('G-H: More Filters open, Advanced Query accessed through More Filters', async ({ page }) => {
    await gotoFixture(page);
    await page.getByRole('button', { name: /^more filters/i }).click();
    await expect(page.getByRole('heading', { name: 'More filters' })).toBeVisible();
    await captureScreenshot(page, PHASE, 'G-more-filters-open');

    await page.getByRole('button', { name: /^query/i }).click();
    await expect(page.getByRole('heading', { name: 'Query' })).toBeVisible();
    await captureScreenshot(page, PHASE, 'H-advanced-query-via-more-filters');
  });

  test('I: protected filter chip shows "Protected", never the raw value', async ({ page }) => {
    await gotoFixture(page);
    await page.getByRole('button', { name: /^more filters/i }).click();
    await page.getByLabel('Customer ID').fill('DEMO-CUST-200000');
    await page.getByRole('button', { name: /^apply$/i }).click();
    await expect(page.getByText('Protected')).toBeVisible();
    await expect(page.getByText('DEMO-CUST-200000')).not.toBeVisible();
    const html = await page.content();
    expect(html).not.toContain('DEMO-CUST-200000');
    await captureScreenshot(page, PHASE, 'I-protected-filter-chip');
  });

  test('J: narrow/mobile state (390px) - no horizontal overflow', async ({ page }) => {
    await gotoFixture(page);
    await setViewport(page, 390, 844);
    await assertNoHorizontalOverflow(page);
    await captureScreenshot(page, PHASE, 'J-narrow-mobile-state');
  });

  // UX-R1 §13 - responsive verification at every required width, with the
  // most structurally novel part of this slice open (chips + the More
  // Filters drawer, which now offsets itself below the header/toolbar
  // instead of overlapping it - the one real regression this slice found).
  for (const width of [1920, 1440, 1280, 1024, 768, 390]) {
    test(`responsive: More filters drawer + active chips at ${width}px - no horizontal overflow`, async ({ page }) => {
      await gotoFixture(page);
      await setViewport(page, width);
      await page.getByRole('button', { name: /^more filters/i }).click();
      await page.getByLabel('Trace ID').fill('fixture-trace-000340');
      await page.getByRole('button', { name: /^apply$/i }).click();
      await expect(page.getByText('fixture-trace-000340')).toBeVisible();
      await assertNoHorizontalOverflow(page);
      await captureScreenshot(page, PHASE, `responsive-${width}px`);
    });
  }
});
