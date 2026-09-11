import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { assertNoHorizontalOverflow, assertTableGeometry, captureScreenshot, setViewport, setZoom } from './helpers';

/*
 * UX-R6 - final polish, structural consistency and acceptance readiness.
 * Verified against the real rendered app (real backend `fixture` source,
 * real dev server) per LERUX-1, and doubling as the AFTER evidence
 * capture (§19).
 */

const PHASE = 'UX_R6_EVIDENCE';

async function search(page: Page) {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('fixture');
  await page.getByRole('button', { name: /^search$/i }).click();
  await expect(page.getByRole('table')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('tbody tr').first()).toBeVisible();
}

const rows = (page: Page) => page.locator('tbody tr[data-row-index]');
const inspector = (page: Page) => page.getByRole('dialog', { name: 'Event details' });

async function openInspectorAt(page: Page, index: number) {
  await rows(page).nth(index).click();
  await expect(inspector(page)).toBeVisible({ timeout: 10_000 });
}

/* ---------------------------------------------------------------- §3 */

test.describe('UX-R6 §3 - the Inspector is a bounded, viewport-height column', () => {
  test('B/C: it no longer stretches to the results height, so there is no empty void', async ({ page }) => {
    await setViewport(page, 1440, 900);
    await search(page);
    // The fixture's malformed line is the sparsest possible inspector.
    await rows(page).filter({ hasText: 'NOT-JSON' }).first().click();
    await expect(inspector(page)).toBeVisible();

    const { panelHeight, viewportHeight } = await page.evaluate(() => ({
      panelHeight: Math.round(
        document.querySelector('[role="dialog"][aria-label="Event details"]')!.getBoundingClientRect().height,
      ),
      viewportHeight: document.documentElement.clientHeight,
    }));
    // Measured before UX-R6: 9,224px for this same event - 8,150px of it
    // empty, because the panel took the *results column's* height.
    expect(panelHeight).toBeLessThanOrEqual(viewportHeight + 2);
    await captureScreenshot(page, PHASE, 'AFTER-C-inspector-bounded-sparse-event');
  });

  test('the Inspector stays readable while the investigator keeps scanning results', async ({ page }) => {
    await setViewport(page, 1440, 900);
    await search(page);
    await rows(page).filter({ hasText: 'ERROR' }).first().click();
    await expect(inspector(page)).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, 3000));
    await page.waitForTimeout(200);

    // Before UX-R6 the panel flowed with the page, so scrolling the
    // results scrolled the Inspector's content away and left only its
    // sticky header.
    await expect(inspector(page).locator('section[aria-label="Overview"]')).toBeInViewport();
    await expect(inspector(page).getByRole('button', { name: /show surrounding logs/i })).toBeInViewport();
    expect(await rows(page).filter({ hasNotText: '__never__' }).count()).toBeGreaterThan(0);
    await captureScreenshot(page, PHASE, 'AFTER-B-results-and-inspector-1440');
  });

  test('the Inspector has its own scroll, and it does not chain into the results', async ({ page }) => {
    await setViewport(page, 1440, 900);
    await search(page);
    await openInspectorAt(page, 3);

    const scrollable = await inspector(page).evaluate((panel) => {
      const body = Array.from(panel.querySelectorAll('div')).find(
        (el) => el.scrollHeight > el.clientHeight + 50 && getComputedStyle(el).overflowY === 'auto',
      ) as HTMLElement | undefined;
      return body
        ? { has: true, overscroll: getComputedStyle(body).overscrollBehaviorY }
        : { has: false, overscroll: '' };
    });
    expect(scrollable.has).toBe(true);
    expect(scrollable.overscroll).toBe('contain');
  });

  test('opening the Inspector does not move the row the investigator clicked', async ({ page }) => {
    await setViewport(page, 1440, 900);
    await search(page);
    await page.evaluate(() => window.scrollTo(0, 1500));
    await page.waitForTimeout(150);

    const target = await page.evaluate(() => {
      const vh = document.documentElement.clientHeight;
      const all = Array.from(document.querySelectorAll('tbody tr[data-row-index]')) as HTMLElement[];
      const r = all.find((el) => {
        const b = el.getBoundingClientRect();
        return b.top > vh * 0.3 && b.top < vh * 0.7;
      })!;
      return { index: r.dataset.rowIndex!, top: Math.round(r.getBoundingClientRect().top) };
    });

    await page.locator(`tbody tr[data-row-index="${target.index}"]`).click();
    await expect(inspector(page)).toBeVisible();

    const movedBy = await page.evaluate((idx) => {
      const el = document.querySelector(`tbody tr[data-row-index="${idx}"]`)!;
      return Math.round(el.getBoundingClientRect().top);
    }, target.index);
    expect(Math.abs(movedBy - target.top)).toBeLessThanOrEqual(2);
  });
});

/* --------------------------------------------------------------- §11 */

test.describe('UX-R6 §11 - empty / loading / error states', () => {
  test('G: the empty state explains itself and offers the next action', async ({ page }) => {
    await setViewport(page, 1440, 900);
    await page.goto('/');
    await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('fixture');
    await page.getByPlaceholder(/search messages/i).fill('zzz-no-such-event-zzz');
    await page.getByRole('button', { name: /^search$/i }).click();

    await expect(page.getByText(/no results for this range/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /search last 1 day/i })).toBeVisible();
    await captureScreenshot(page, PHASE, 'AFTER-G-empty-state');
  });

  test('H: a failed search says what failed and offers Retry', async ({ page }) => {
    await setViewport(page, 1440, 900);
    let calls = 0;
    await page.route('**/api/v1/logs/search', (route) => {
      calls += 1;
      route.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify({ title: 'Service Unavailable', status: 503, detail: 'source unreachable' }),
      });
    });
    await page.goto('/');
    await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('fixture');
    await page.getByRole('button', { name: /^search$/i }).click();

    const alert = page.getByRole('alert');
    await expect(alert).toContainText(/search failed/i);
    await expect(alert).toContainText(/source unreachable/i);
    const retry = page.getByRole('button', { name: /retry search/i });
    await expect(retry).toBeVisible();
    await captureScreenshot(page, PHASE, 'AFTER-H-error-state');

    const before = calls;
    await retry.click();
    await expect.poll(() => calls).toBeGreaterThan(before);
  });

  test('the error copy carries no search value, identifier or secret', async ({ page }) => {
    await page.route('**/api/v1/logs/search', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify({ title: 'Service Unavailable', status: 503, detail: 'source unreachable' }),
      }),
    );
    await page.goto('/');
    await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('fixture');
    await page.getByPlaceholder(/search messages/i).fill('super-secret-customer-12345');
    await page.getByRole('button', { name: /^search$/i }).click();

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    expect(await alert.innerText()).not.toMatch(/super-secret-customer-12345/);
  });
});

/* --------------------------------------------------------------- §13 */

test.describe('UX-R6 §13 - the core loop is operable by keyboard alone', () => {
  test('M: search, traverse, open, navigate, context, return - no mouse', async ({ page }) => {
    await setViewport(page, 1440, 900);
    await search(page);

    // Row traversal + open.
    await rows(page).first().focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await captureScreenshot(page, PHASE, 'AFTER-M-keyboard-focused-row');
    await page.keyboard.press('Enter');
    await expect(inspector(page)).toBeVisible();
    await expect(inspector(page)).toContainText('Event 3 of');

    // Previous/Next by keyboard shortcut.
    await page.keyboard.press(']');
    await expect(inspector(page)).toContainText('Event 4 of');
    await page.keyboard.press('[');
    await expect(inspector(page)).toContainText('Event 3 of');

    // Escape closes the top-most layer and restores focus to the row.
    await page.keyboard.press('Escape');
    await expect(inspector(page)).toHaveCount(0);
    await expect(rows(page).nth(2)).toBeFocused();
  });

  test('the results table is a single tab stop, not one per row', async ({ page }) => {
    await search(page);
    const tabbable = await rows(page).evaluateAll(
      (els) => els.filter((el) => el.getAttribute('tabindex') === '0').length,
    );
    expect(tabbable).toBe(1);
  });

  test('Escape closes only the top-most transient layer', async ({ page }) => {
    await search(page);
    await openInspectorAt(page, 3);
    await page.getByRole('button', { name: 'Actions for this event' }).nth(3).click();
    await expect(page.getByRole('menu', { name: 'Event actions' })).toBeVisible();

    await page.keyboard.press('Escape');
    // The menu closes; the inspector underneath must survive.
    await expect(page.getByRole('menu', { name: 'Event actions' })).toHaveCount(0);
    await expect(inspector(page)).toBeVisible();
  });
});

/* ----------------------------------------------------------- §9 / §12 */

test.describe('UX-R6 §9/§12 - Live states and action language', () => {
  test('E: Live runs the full lifecycle without a refresh, with distinct labels', async ({ page }) => {
    await setViewport(page, 1440, 900);
    await search(page);

    await page.getByRole('button', { name: /^live$/i }).click();
    await expect(page.getByTestId('live-tail-panel')).toBeVisible({ timeout: 15_000 });
    await captureScreenshot(page, PHASE, 'AFTER-E-live-mode');

    await page.getByRole('button', { name: /^pause$/i }).click();
    await expect(page.getByRole('button', { name: /^resume$/i })).toBeVisible();
    await page.getByRole('button', { name: /^resume$/i }).click();
    await expect(page.getByRole('button', { name: /^pause$/i })).toBeVisible();
    await page.getByRole('button', { name: /^stop$/i }).click();

    await page.getByRole('button', { name: /back to search results/i }).click();
    await expect(page.getByRole('button', { name: /^search$/i })).toBeVisible();

    // Searching again after Live must work with no reload.
    await page.getByRole('button', { name: /^search$/i }).click();
    await expect(page.getByRole('table')).toBeVisible({ timeout: 15_000 });
    await expect(rows(page).first()).toBeVisible();
  });

  test('one canonical label per intent across Results and Inspector', async ({ page }) => {
    await search(page);

    // "Show surrounding logs" is the row-menu wording...
    await page.getByRole('button', { name: 'Actions for this event' }).nth(3).click();
    await expect(page.getByRole('menuitem', { name: /show surrounding logs/i })).toBeVisible();
    await page.keyboard.press('Escape');

    // ...and the inspector must use the same words, not "Show ±30 seconds".
    await openInspectorAt(page, 3);
    await expect(inspector(page).getByRole('button', { name: /show surrounding logs/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /±30 seconds/i })).toHaveCount(0);
  });
});

/* --------------------------------------------------------------- §15 */

test.describe('UX-R6 §15 - responsive matrix', () => {
  for (const width of [1920, 1440, 1280, 1024, 768, 390]) {
    test(`${width}px: geometry holds, no page overflow, primary actions reachable`, async ({ page }) => {
      await search(page);
      await setViewport(page, width, 900);
      await assertTableGeometry(page, 'table', 2);
      await assertNoHorizontalOverflow(page);
      await expect(page.getByRole('button', { name: /^search$/i })).toBeVisible();

      await openInspectorAt(page, 3);
      await expect(inspector(page).getByRole('button', { name: /show surrounding logs/i })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Close event inspector' })).toBeVisible();
      await assertNoHorizontalOverflow(page);

      if ([1024, 768, 390].includes(width)) {
        await captureScreenshot(page, PHASE, `AFTER-${width}px`);
      }
    });
  }

  test('L: 200% zoom stays usable', async ({ page }) => {
    await search(page);
    await setViewport(page, 1280, 800);
    await openInspectorAt(page, 3);
    await setZoom(page, 200);

    await expect(inspector(page)).toContainText(/Event \d+ of \d+ loaded/);
    await expect(inspector(page).getByRole('button', { name: /show surrounding logs/i })).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await captureScreenshot(page, PHASE, 'AFTER-L-zoom-200pct');
  });
});

/* --------------------------------------------------------------- §17 */

test.describe('UX-R6 §17 - security regression pass', () => {
  test('masking holds across Results, Inspector and Context, and nothing is persisted', async ({ page }) => {
    await search(page);
    await openInspectorAt(page, 3);
    await inspector(page).getByRole('heading', { name: /all fields/i }).click();

    const panelText = await inspector(page).innerText();
    expect(panelText).toMatch(/\*\*\*/);
    expect(panelText).toMatch(/never revealed/i);
    expect(await inspector(page).getByRole('button', { name: /reveal|unmask|show raw/i }).count()).toBe(0);

    await inspector(page).getByRole('button', { name: /show surrounding logs/i }).click();
    await page.getByRole('button', { name: /^run$/i }).click();
    await expect(page.getByRole('button', { name: /back to original search/i })).toBeVisible({ timeout: 15_000 });

    const stored = await page.evaluate(() => ({
      local: JSON.stringify(window.localStorage),
      session: JSON.stringify(window.sessionStorage),
      url: window.location.href,
    }));
    expect(stored.local).not.toMatch(/fixture-trace|fixture-corr|Payment authorization/i);
    expect(stored.session).not.toMatch(/fixture-trace|fixture-corr|Payment authorization/i);
    expect(stored.url).not.toMatch(/trace|cif|customer|payment/i);
  });
});

/* --------------------------------------------------------------- §19 */

test.describe('UX-R6 §19 - workspace evidence', () => {
  test('A: full search workspace', async ({ page }) => {
    await setViewport(page, 1440, 900);
    await search(page);
    await captureScreenshot(page, PHASE, 'AFTER-A-search-workspace');
  });

  test('D: context view', async ({ page }) => {
    await setViewport(page, 1440, 900);
    await search(page);
    await openInspectorAt(page, 3);
    await inspector(page).getByRole('button', { name: /show surrounding logs/i }).click();
    await page.getByRole('button', { name: /^run$/i }).click();
    await expect(page.getByRole('button', { name: /back to original search/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('tbody tr[aria-current="location"]')).toHaveCount(1);
    await captureScreenshot(page, PHASE, 'AFTER-D-context-view');
  });

  test('F: settings / compose', async ({ page }) => {
    await setViewport(page, 1440, 900);
    await page.goto('/');
    await page.getByRole('button', { name: /docker settings/i }).click();
    await expect(page.getByRole('dialog', { name: /docker connection/i })).toBeVisible();
    await captureScreenshot(page, PHASE, 'AFTER-F-settings');
  });
});
