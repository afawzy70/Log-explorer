import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { assertNoHorizontalOverflow, assertTableGeometry, captureScreenshot, setViewport, setZoom } from './helpers';

/*
 * UX-R4 - the Results investigation workstation, verified against the real
 * rendered app (real backend `fixture` source, real dev server) rather than
 * from source, per the `log-explorer-professional-ux-reviewer` skill
 * (LERUX-1) and CLAUDE.md §6.
 *
 * This file is both the AFTER evidence capture (§28) and the functional
 * regression suite (§29): each screenshot is taken at the point where the
 * behaviour it evidences has just been asserted, so an evidence image can
 * never quietly outlive the behaviour it claims to show.
 */

const PHASE = 'UX_R4_EVIDENCE';

async function runRealSearch(page: Page) {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('fixture');
  await page.getByRole('button', { name: /^search$/i }).click();
  await expect(page.getByRole('table')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('tbody tr').first()).toBeVisible();
}

function rows(page: Page) {
  return page.locator('tbody tr[data-row-index]');
}

/** The message text of the row at `index`, used to prove the *right* event opened. */
async function messageOf(page: Page, index: number) {
  return (await rows(page).nth(index).locator('td').nth(3).innerText()).trim();
}

/**
 * The row's own rendered timestamp - a stronger identity anchor than the
 * message, because the fixture corpus deliberately contains an event with
 * an empty message (rendered as the display fallback "(empty message)",
 * which the inspector correctly shows as "—" instead). Timestamps are
 * unique per row here and are echoed verbatim by the inspector's "Local
 * time" field.
 */
async function timeOf(page: Page, index: number) {
  return (await rows(page).nth(index).locator('td').first().innerText()).trim();
}

test.describe('UX-R4 §6 - row click is the primary inspection path', () => {
  test('A/D: clicking a row opens THAT event and marks the row selected', async ({ page }) => {
    await runRealSearch(page);
    await captureScreenshot(page, PHASE, 'AFTER-A-results-default');

    const expected = await messageOf(page, 3);
    await rows(page).nth(3).click();

    const inspector = page.getByRole('dialog', { name: 'Event details' });
    await expect(inspector).toBeVisible();
    // The inspector shows the event the investigator actually clicked.
    await expect(inspector).toContainText(expected);
    await expect(rows(page).nth(3)).toHaveAttribute('aria-selected', 'true');

    await captureScreenshot(page, PHASE, 'AFTER-D-selected-row-inspector-open');
  });

  test('clicking the Actions trigger does not also open the inspector', async ({ page }) => {
    await runRealSearch(page);
    await page.getByRole('button', { name: 'Actions for this event' }).nth(2).click();

    await expect(page.getByRole('menu', { name: 'Event actions' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Event details' })).toHaveCount(0);
  });

  test('C: a row can be focused and opened from the keyboard alone', async ({ page }) => {
    await runRealSearch(page);
    const expected = await timeOf(page, 2);

    await rows(page).first().focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await captureScreenshot(page, PHASE, 'AFTER-C-keyboard-focused-row');

    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Event details' })).toContainText(expected);
    await expect(rows(page).nth(2)).toHaveAttribute('aria-selected', 'true');
  });
});

test.describe('UX-R4 §8 - hover, focus and selected are visually distinct', () => {
  test('B: hover paints a row background that did not exist before UX-R4', async ({ page }) => {
    await runRealSearch(page);
    const row = rows(page).nth(4);
    const before = await row.evaluate((el) => getComputedStyle(el).backgroundColor);
    await row.hover();
    const after = await row.evaluate((el) => getComputedStyle(el).backgroundColor);

    expect(after).not.toBe(before);
    await captureScreenshot(page, PHASE, 'AFTER-B-row-hover');
  });

  test('hover never erases the selected state', async ({ page }) => {
    await runRealSearch(page);
    const row = rows(page).nth(3);
    await row.click();
    const selected = await row.evaluate((el) => getComputedStyle(el).backgroundColor);

    await row.hover();
    const hoveredWhileSelected = await row.evaluate((el) => getComputedStyle(el).backgroundColor);

    expect(hoveredWhileSelected).toBe(selected);
    await expect(row).toHaveAttribute('aria-selected', 'true');
  });

  test('the three states are three different backgrounds', async ({ page }) => {
    await runRealSearch(page);
    const plain = await rows(page).nth(6).evaluate((el) => getComputedStyle(el).backgroundColor);
    await rows(page).nth(5).hover();
    const hovered = await rows(page).nth(5).evaluate((el) => getComputedStyle(el).backgroundColor);
    await rows(page).nth(4).click();
    const selectedRow = await rows(page).nth(4).evaluate((el) => getComputedStyle(el).backgroundColor);

    expect(new Set([plain, hovered, selectedRow]).size).toBe(3);
  });

  test('E: an ERROR row is marked at row level, and still says "ERROR" in text', async ({ page }) => {
    await runRealSearch(page);
    const errorRow = rows(page).filter({ hasText: 'ERROR' }).first();
    await errorRow.scrollIntoViewIfNeeded();
    await expect(errorRow).toContainText('ERROR');
    const shadow = await errorRow.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(shadow).not.toBe('none');
    await captureScreenshot(page, PHASE, 'AFTER-E-error-row');
  });
});

test.describe('UX-R4 §17/§18/§19 - row actions', () => {
  test('F: the menu leads with View details and Show surrounding logs', async ({ page }) => {
    await runRealSearch(page);
    await page.getByRole('button', { name: 'Actions for this event' }).nth(3).click();
    const menu = page.getByRole('menu', { name: 'Event actions' });

    await expect(menu.getByRole('menuitem', { name: /view details/i })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /show surrounding logs/i })).toBeVisible();
    await captureScreenshot(page, PHASE, 'AFTER-F-actions-menu');
  });

  test('"View details" opens the same event the row click would have opened (§18)', async ({ page }) => {
    await runRealSearch(page);
    const expected = await messageOf(page, 3);

    await page.getByRole('button', { name: 'Actions for this event' }).nth(3).click();
    await page.getByRole('menuitem', { name: /view details/i }).click();

    await expect(page.getByRole('dialog', { name: 'Event details' })).toContainText(expected);
    await expect(rows(page).nth(3)).toHaveAttribute('aria-selected', 'true');
  });

  test('I/J: "Show surrounding logs" runs the bounded context view, and returning restores the original results', async ({
    page,
  }) => {
    await runRealSearch(page);
    const originalFirstRow = await messageOf(page, 0);
    const originalCount = await rows(page).count();

    await page.getByRole('button', { name: 'Actions for this event' }).nth(3).click();
    await page.getByRole('menuitem', { name: /show surrounding logs/i }).click();

    await expect(page.getByRole('button', { name: /back to original search/i })).toBeVisible({ timeout: 15_000 });
    await captureScreenshot(page, PHASE, 'AFTER-I-context-from-row-actions');

    await page.getByRole('button', { name: /back to original search/i }).click();
    await expect(page.getByRole('table')).toBeVisible();
    // The original result set comes back as it was - not re-run, not mutated.
    expect(await messageOf(page, 0)).toBe(originalFirstRow);
    expect(await rows(page).count()).toBe(originalCount);
    await captureScreenshot(page, PHASE, 'AFTER-J-return-from-context');
  });
});

test.describe('UX-R4 §9/§10/§12 - truthful sorting', () => {
  test('G/H: Newest first and Oldest first are real, opposite orderings', async ({ page }) => {
    await runRealSearch(page);
    const sort = page.getByRole('combobox', { name: /sort/i });
    await expect(sort).toHaveValue('BACKWARD');
    await captureScreenshot(page, PHASE, 'AFTER-G-newest-first');

    const newestTop = await messageOf(page, 0);

    await sort.selectOption('FORWARD');
    await expect(page.getByRole('table')).toBeVisible();
    await expect(sort).toHaveValue('FORWARD');
    const oldestTop = await messageOf(page, 0);
    await captureScreenshot(page, PHASE, 'AFTER-H-oldest-first');

    expect(oldestTop).not.toBe(newestTop);
  });

  test('the rendered order really is chronological, in both directions', async ({ page }) => {
    await runRealSearch(page);

    const readTimes = async () =>
      (await rows(page).evaluateAll((els) =>
        els.map((el) => (el.querySelector('td')?.textContent ?? '').trim()).filter((t) => t && t !== '—'),
      )).map((t) => new Date(t).getTime());

    const descending = await readTimes();
    expect(descending).toEqual([...descending].sort((a, b) => b - a));

    await page.getByRole('combobox', { name: /sort/i }).selectOption('FORWARD');
    await expect(page.getByRole('table')).toBeVisible();
    const ascending = await readTimes();
    expect(ascending).toEqual([...ascending].sort((a, b) => a - b));
  });

  test('switching direction starts a fresh result set rather than appending to the old one', async ({ page }) => {
    await runRealSearch(page);
    await page.getByRole('button', { name: /load more/i }).click();
    await expect
      .poll(async () => rows(page).count(), { timeout: 15_000 })
      .toBeGreaterThan(200);
    const afterLoadMore = await rows(page).count();

    await page.getByRole('combobox', { name: /sort/i }).selectOption('FORWARD');
    await expect(page.getByRole('table')).toBeVisible();

    await expect.poll(async () => rows(page).count()).toBeLessThan(afterLoadMore);
  });

  test('pagination keeps the committed direction and never duplicates a row', async ({ page }) => {
    await runRealSearch(page);
    await page.getByRole('combobox', { name: /sort/i }).selectOption('FORWARD');
    await expect(page.getByRole('table')).toBeVisible();

    await page.getByRole('button', { name: /load more/i }).click();
    await expect.poll(async () => rows(page).count(), { timeout: 15_000 }).toBeGreaterThan(200);

    const times = (await rows(page).evaluateAll((els) =>
      els.map((el) => (el.querySelector('td')?.textContent ?? '').trim()).filter((t) => t && t !== '—'),
    )).map((t) => new Date(t).getTime());

    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  test('the sort control is not offered in a context view, which is always ascending', async ({ page }) => {
    await runRealSearch(page);
    await page.getByRole('button', { name: 'Actions for this event' }).nth(3).click();
    await page.getByRole('menuitem', { name: /show surrounding logs/i }).click();
    await expect(page.getByRole('button', { name: /back to original search/i })).toBeVisible({ timeout: 15_000 });

    await expect(page.getByRole('combobox', { name: /sort/i })).toHaveCount(0);
  });
});

test.describe('UX-R4 §22/§23/§24 - table preferences still work, and selection survives them', () => {
  test('K/L/M: column visibility, reorder and density all preserve the selected row', async ({ page }) => {
    await runRealSearch(page);
    await rows(page).nth(3).click();
    await expect(rows(page).nth(3)).toHaveAttribute('aria-selected', 'true');

    await page.getByRole('button', { name: /table settings|columns/i }).first().click();

    await page.getByRole('checkbox').first().click();
    await expect(rows(page).nth(3)).toHaveAttribute('aria-selected', 'true');
    await captureScreenshot(page, PHASE, 'AFTER-K-columns-customized');

    await page.getByRole('button', { name: /^move .* down$/i }).first().click();
    await expect(rows(page).nth(3)).toHaveAttribute('aria-selected', 'true');
    await captureScreenshot(page, PHASE, 'AFTER-L-columns-reordered');

    await page.getByRole('group', { name: 'Density' }).getByRole('button', { name: /compact/i }).click();
    await expect(rows(page).nth(3)).toHaveAttribute('aria-selected', 'true');
    await captureScreenshot(page, PHASE, 'AFTER-M-compact-density');

    // The geometry invariant must survive every one of those changes.
    await assertTableGeometry(page, 'table', 2);
    await assertNoHorizontalOverflow(page);
  });

  test('the selected row survives Load more', async ({ page }) => {
    await runRealSearch(page);
    await rows(page).nth(2).click();
    const expected = await messageOf(page, 2);

    await page.getByRole('button', { name: /load more/i }).click();
    await expect.poll(async () => rows(page).count(), { timeout: 15_000 }).toBeGreaterThan(200);

    await expect(rows(page).nth(2)).toHaveAttribute('aria-selected', 'true');
    expect(await messageOf(page, 2)).toBe(expected);
  });
});

test.describe('UX-R4 §25/§36 - responsive and zoom', () => {
  test('N: inspector beside the table at 1920, message column still readable', async ({ page }) => {
    await setViewport(page, 1920, 1080);
    await runRealSearch(page);
    await rows(page).nth(3).click();
    await expect(page.getByRole('dialog', { name: 'Event details' })).toBeVisible();

    const width = await page
      .locator('table thead th', { hasText: 'What happened' })
      .evaluate((el) => el.getBoundingClientRect().width);
    // The regression this guards: before UX-R4 opening the inspector
    // collapsed this column to roughly 140px.
    expect(width).toBeGreaterThan(400);

    await captureScreenshot(page, PHASE, 'AFTER-N-inspector-wide-1920');
  });

  for (const width of [1024, 768, 390]) {
    test(`O/P/Q: ${width}px - geometry holds and the page never overflows`, async ({ page }) => {
      await runRealSearch(page);
      await setViewport(page, width);
      await assertTableGeometry(page, 'table', 2);
      await assertNoHorizontalOverflow(page);
      await captureScreenshot(page, PHASE, `AFTER-${width}px`);
    });
  }

  test('R: 200% zoom', async ({ page }) => {
    await runRealSearch(page);
    await setViewport(page, 1280);
    await setZoom(page, 200);
    await assertTableGeometry(page, 'table', 2);
    await assertNoHorizontalOverflow(page);
    await captureScreenshot(page, PHASE, 'AFTER-R-zoom-200pct');
  });
});

test.describe('UX-R4 §33 - no security regression from the new entry points', () => {
  test('row click and the new actions never expose a raw protected value or write to storage', async ({ page }) => {
    await runRealSearch(page);
    await rows(page).nth(3).click();
    await expect(page.getByRole('dialog', { name: 'Event details' })).toBeVisible();

    await page.getByRole('button', { name: 'Actions for this event' }).nth(3).click();
    await page.getByRole('menuitem', { name: /show surrounding logs/i }).click();
    await expect(page.getByRole('button', { name: /back to original search/i })).toBeVisible({ timeout: 15_000 });

    // The fixture corpus's protected values are masked server-side; the
    // masked form is what must be on screen, and nothing about the event
    // may be persisted (CLAUDE.md §2 rules 1 and 4).
    const body = await page.locator('body').innerText();
    expect(body).toMatch(/\*\*\*/);

    const stored = await page.evaluate(() => ({
      local: JSON.stringify(window.localStorage),
      session: JSON.stringify(window.sessionStorage),
      url: window.location.href,
    }));
    expect(stored.local).not.toMatch(/uxr4|Payment authorization|fixture-trace/i);
    expect(stored.session).not.toMatch(/uxr4|Payment authorization|fixture-trace/i);
    expect(stored.url).not.toMatch(/Payment|trace|cif|customer/i);
  });
});
