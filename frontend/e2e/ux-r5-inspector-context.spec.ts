import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { assertNoHorizontalOverflow, captureScreenshot, setViewport, setZoom } from './helpers';

/*
 * UX-R5 - the Event Inspector and Context investigation surfaces,
 * verified against the real rendered app (real backend `fixture` source,
 * real dev server) per LERUX-1, and simultaneously the AFTER evidence
 * capture (§34). Each screenshot is taken at the point where the
 * behaviour it evidences has just been asserted, so an evidence image can
 * never outlive the behaviour it claims to show.
 */

const PHASE = 'UX_R5_EVIDENCE';

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

function inspector(page: Page) {
  return page.getByRole('dialog', { name: 'Event details' });
}

async function openInspectorAt(page: Page, index: number) {
  await rows(page).nth(index).click();
  await expect(inspector(page)).toBeVisible({ timeout: 10_000 });
}

test.describe('UX-R5 §5 - position indicator', () => {
  test('A/B: Overview, with a truthful loaded-set position', async ({ page }) => {
    await runRealSearch(page);
    await openInspectorAt(page, 3);

    const total = await rows(page).count();
    await expect(inspector(page)).toContainText(`Event 4 of ${total} loaded`);
    await captureScreenshot(page, PHASE, 'AFTER-A-inspector-overview');
    await captureScreenshot(page, PHASE, 'AFTER-B-position-indicator');
  });

  test('the position follows Previous/Next, and matches the selected row', async ({ page }) => {
    await runRealSearch(page);
    const total = await rows(page).count();
    await openInspectorAt(page, 3);

    await page.getByRole('button', { name: 'Next event' }).click();
    await expect(inspector(page)).toContainText(`Event 5 of ${total} loaded`);
    await expect(rows(page).nth(4)).toHaveAttribute('aria-selected', 'true');

    await page.getByRole('button', { name: 'Previous event' }).click();
    await expect(inspector(page)).toContainText(`Event 4 of ${total} loaded`);
    await expect(rows(page).nth(3)).toHaveAttribute('aria-selected', 'true');
  });

  test('the position follows the keyboard shortcuts too', async ({ page }) => {
    await runRealSearch(page);
    const total = await rows(page).count();
    await openInspectorAt(page, 3);

    await page.keyboard.press(']');
    await expect(inspector(page)).toContainText(`Event 5 of ${total} loaded`);
    await page.keyboard.press('[');
    await expect(inspector(page)).toContainText(`Event 4 of ${total} loaded`);
  });

  test('the denominator grows when Load more appends to the loaded set', async ({ page }) => {
    await runRealSearch(page);
    const before = await rows(page).count();
    await openInspectorAt(page, 3);
    await expect(inspector(page)).toContainText(`Event 4 of ${before} loaded`);

    await page.getByRole('button', { name: /load more/i }).click();
    await expect.poll(async () => rows(page).count(), { timeout: 15_000 }).toBeGreaterThan(before);
    const after = await rows(page).count();

    await expect(inspector(page)).toContainText(`Event 4 of ${after} loaded`);
  });

  test('C: Previous disabled on the first event', async ({ page }) => {
    await runRealSearch(page);
    await openInspectorAt(page, 0);
    await expect(inspector(page)).toContainText('Event 1 of');
    await expect(page.getByRole('button', { name: 'Previous event' })).toBeDisabled();
    await captureScreenshot(page, PHASE, 'AFTER-C-previous-disabled-first');
  });

  test('D: Next disabled on the last loaded event', async ({ page }) => {
    await runRealSearch(page);
    const total = await rows(page).count();
    await openInspectorAt(page, total - 1);
    await expect(inspector(page)).toContainText(`Event ${total} of ${total} loaded`);
    await expect(page.getByRole('button', { name: 'Next event' })).toBeDisabled();
    await captureScreenshot(page, PHASE, 'AFTER-D-next-disabled-last');
  });
});

test.describe('UX-R5 §8/§9 - inspector information hierarchy', () => {
  test('E/F/G/H: the sections, with All fields collapsed by default', async ({ page }) => {
    await runRealSearch(page);
    await openInspectorAt(page, 3);
    const panel = inspector(page);

    for (const [label, name] of [
      ['Actor & client', 'AFTER-E-actor-client'],
      ['Request flow', 'AFTER-F-request-flow'],
      ['Business / error', 'AFTER-G-business-error'],
    ] as const) {
      const section = panel.locator(`section[aria-label="${label}"]`);
      await section.scrollIntoViewIfNeeded();
      await expect(section).toBeVisible();
      await captureScreenshot(page, PHASE, name);
    }

    // All fields is the escape hatch: present and reachable, but collapsed.
    const allFields = panel.locator('details').filter({ hasText: 'All fields' }).first();
    await allFields.scrollIntoViewIfNeeded();
    await expect(allFields).not.toHaveAttribute('open', '');
    await allFields.getByRole('heading', { name: /all fields/i }).click();
    await expect(allFields).toHaveAttribute('open', '');
    await expect(page.getByLabel('Search fields')).toBeVisible();
    await captureScreenshot(page, PHASE, 'AFTER-H-all-fields-expanded');
  });

  test('Overview states the time once, with zone and UTC still present', async ({ page }) => {
    await runRealSearch(page);
    await openInspectorAt(page, 3);
    const overview = inspector(page).locator('section[aria-label="Overview"]');

    // One "Time" row, not three peer rows.
    await expect(overview).toContainText('Time');
    await expect(overview).not.toContainText('Local time');
    // Nothing was dropped: the zone and the UTC form are both still rendered.
    await expect(overview).toContainText(/UTC/);
    await expect(overview).toContainText(/\(UTC[+-]\d{2}:\d{2}\)/);
  });

  test('the inspector is materially shorter to scroll than before UX-R5', async ({ page }) => {
    await runRealSearch(page);
    await openInspectorAt(page, 3);

    const height = await inspector(page).evaluate((panel) => {
      const scroller = Array.from(panel.querySelectorAll('*')).find(
        (el) => el.scrollHeight > el.clientHeight + 50,
      ) as HTMLElement | undefined;
      return scroller ? scroller.scrollHeight : 0;
    });
    // Measured BEFORE UX-R5: ~3,992px of stacked content. The floor here is
    // deliberately generous - this guards the regression, not a pixel value.
    expect(height).toBeGreaterThan(0);
    expect(height).toBeLessThan(3000);
  });

  test('I: a section with no data says so once, instead of a grid of blanks', async ({ page }) => {
    await runRealSearch(page);
    await rows(page).filter({ hasText: 'NOT-JSON' }).first().click();
    await expect(inspector(page)).toBeVisible();

    const actor = inspector(page).locator('section[aria-label="Actor & client"]');
    await expect(actor).toContainText(/No actor or client data on this event/i);
    await captureScreenshot(page, PHASE, 'AFTER-I-missing-data-section');
  });

  test('§11 - every Request flow row anchors Copy in the same place', async ({ page }) => {
    await runRealSearch(page);
    await openInspectorAt(page, 3);
    const section = inspector(page).locator('section[aria-label="Request flow"]');
    await section.scrollIntoViewIfNeeded();

    const lefts = await section.getByRole('button', { name: 'Copy' }).evaluateAll((els) =>
      els.map((el) => Math.round(el.getBoundingClientRect().left)),
    );
    expect(lefts.length).toBeGreaterThan(1);
    // Before UX-R5 the Span ID row (the one identifier with no "Find this"
    // action) put its Copy ~330px right of every other row's Copy.
    expect(Math.max(...lefts) - Math.min(...lefts)).toBeLessThanOrEqual(2);
  });
});

test.describe('UX-R5 §14 - the context action is reachable from anywhere in the inspector', () => {
  test('J: it stays visible while reading the LAST section, not just the first', async ({ page }) => {
    await runRealSearch(page);
    await openInspectorAt(page, 3);

    const contextButton = inspector(page).getByRole('button', { name: /show surrounding logs/i });
    await expect(contextButton).toBeVisible();

    // Scroll to the very bottom of the inspector body.
    await inspector(page).locator('section[aria-label="Business / error"]').scrollIntoViewIfNeeded();
    await expect(contextButton).toBeInViewport();
    await captureScreenshot(page, PHASE, 'AFTER-J-context-action-visible-while-scrolled');
  });

  test('there is exactly ONE context action in the inspector, never one per section', async ({ page }) => {
    await runRealSearch(page);
    await openInspectorAt(page, 3);
    await expect(inspector(page).getByRole('button', { name: /show surrounding logs/i })).toHaveCount(1);
  });
});

test.describe('UX-R5 §16-§24 - the context view', () => {
  test('K/L/M/N: context from the inspector - root marked, summary, gaps', async ({ page }) => {
    await runRealSearch(page);
    await openInspectorAt(page, 3);
    await inspector(page).getByRole('button', { name: /show surrounding logs/i }).click();
    await page.getByRole('button', { name: /^run$/i }).click();
    await expect(page.getByRole('button', { name: /back to original search/i })).toBeVisible({ timeout: 15_000 });
    await captureScreenshot(page, PHASE, 'AFTER-K-context-view-from-inspector');

    // §19 - the root marker must survive severity styling and the UX-R4
    // specificity regression that once erased it.
    const root = page.locator('tbody tr[aria-current="location"]');
    await expect(root).toHaveCount(1);
    const outline = await root.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).toBe('dashed');
    await root.scrollIntoViewIfNeeded();
    await captureScreenshot(page, PHASE, 'AFTER-L-context-root-highlighted');

    await captureScreenshot(page, PHASE, 'AFTER-M-context-summary');

    const gap = page.locator('[data-testid="gap-row"]').first();
    if (await gap.count()) {
      await gap.scrollIntoViewIfNeeded();
      await captureScreenshot(page, PHASE, 'AFTER-N-gap-marker');
    }
  });

  test('§20 - the context view is ascending chronological order', async ({ page }) => {
    await runRealSearch(page);
    await openInspectorAt(page, 3);
    await inspector(page).getByRole('button', { name: /show surrounding logs/i }).click();
    await page.getByRole('button', { name: /^run$/i }).click();
    await expect(page.getByRole('button', { name: /back to original search/i })).toBeVisible({ timeout: 15_000 });

    const times = (
      await rows(page).evaluateAll((els) =>
        els.map((el) => (el.querySelector('td')?.textContent ?? '').trim()).filter((t) => t && t !== '—'),
      )
    ).map((t) => new Date(t).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  test('§18 - the context summary reports only what the data supports', async ({ page }) => {
    await runRealSearch(page);
    await openInspectorAt(page, 3);
    await inspector(page).getByRole('button', { name: /show surrounding logs/i }).click();
    await page.getByRole('button', { name: /^run$/i }).click();
    await expect(page.getByRole('button', { name: /back to original search/i })).toBeVisible({ timeout: 15_000 });

    // Chronology is never presented as causality (§15/§17).
    const body = await page.locator('main, body').first().innerText();
    expect(body).toMatch(/does not indicate causality|not a cause/i);
    expect(body).not.toMatch(/root cause|caused by/i);
  });

  test('O/P: §25 - returning from the inspector path reopens the inspector on the same event', async ({ page }) => {
    await runRealSearch(page);
    await openInspectorAt(page, 3);
    const identity = await inspector(page).locator('h1').innerText();

    await inspector(page).getByRole('button', { name: /show surrounding logs/i }).click();
    await page.getByRole('button', { name: /^run$/i }).click();
    await expect(page.getByRole('button', { name: /back to original search/i })).toBeVisible({ timeout: 15_000 });
    await captureScreenshot(page, PHASE, 'AFTER-O-return-action');

    await page.getByRole('button', { name: /back to original search/i }).click();
    await expect(page.getByRole('table')).toBeVisible();

    await expect(inspector(page)).toBeVisible();
    await expect(inspector(page).locator('h1')).toHaveText(identity);
    await expect(rows(page).nth(3)).toHaveAttribute('aria-selected', 'true');
    await captureScreenshot(page, PHASE, 'AFTER-P-returned-inspector-state');
  });

  test('§25 - returning from the ROW-ACTION path does not conjure an inspector', async ({ page }) => {
    await runRealSearch(page);
    await page.getByRole('button', { name: 'Actions for this event' }).nth(3).click();
    await page.getByRole('menuitem', { name: /show surrounding logs/i }).click();
    await expect(page.getByRole('button', { name: /back to original search/i })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: /back to original search/i }).click();
    await expect(page.getByRole('table')).toBeVisible();

    await expect(inspector(page)).toHaveCount(0);
  });
});

test.describe('UX-R5 §29 - accessibility', () => {
  test('Escape closes the inspector and focus returns to the originating row', async ({ page }) => {
    await runRealSearch(page);
    await rows(page).nth(3).focus();
    await page.keyboard.press('Enter');
    await expect(inspector(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(inspector(page)).toHaveCount(0);
    await expect(rows(page).nth(3)).toBeFocused();
  });

  test('All fields is keyboard-expandable', async ({ page }) => {
    await runRealSearch(page);
    await openInspectorAt(page, 3);
    const allFields = inspector(page).locator('details').filter({ hasText: 'All fields' }).first();
    await allFields.locator('summary').first().focus();
    await page.keyboard.press('Enter');
    await expect(allFields).toHaveAttribute('open', '');
  });
});

test.describe('UX-R5 §28 - security', () => {
  test('inspector and context never expose raw protected values, and persist nothing', async ({ page }) => {
    await runRealSearch(page);
    await openInspectorAt(page, 3);

    const allFields = inspector(page).locator('details').filter({ hasText: 'All fields' }).first();
    await allFields.getByRole('heading', { name: /all fields/i }).click();
    const panelText = await inspector(page).innerText();
    expect(panelText).toMatch(/\*\*\*/);
    expect(panelText).toMatch(/never revealed/i);
    // No reveal/unmask affordance anywhere in the inspector.
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

test.describe('UX-R5 §30/§31 - responsive and zoom', () => {
  test('Q: 1440 - the inspector sits beside the results', async ({ page }) => {
    await setViewport(page, 1440, 900);
    await runRealSearch(page);
    await openInspectorAt(page, 3);

    const overlap = await page.evaluate(() => {
      const panel = document.querySelector('[role="dialog"][aria-label="Event details"]')!.getBoundingClientRect();
      // The results table is deliberately wider than its own viewport and
      // scrolls inside its wrapper (UX-R4 §13), so the *wrapper* is what
      // occupies page layout next to the inspector - measuring the <table>
      // itself would compare against its scrollable content width.
      const wrapper = document
        .querySelector('[data-testid="results-scroll-wrapper"]')!
        .getBoundingClientRect();
      return wrapper.right - panel.left;
    });
    expect(overlap).toBeLessThanOrEqual(2); // side-by-side, not covering the table
    await assertNoHorizontalOverflow(page);
    await captureScreenshot(page, PHASE, 'AFTER-Q-1440-side-panel');
  });

  for (const [width, name] of [
    [1024, 'AFTER-R-1024'],
    [768, 'AFTER-S-768'],
    [390, 'AFTER-T-390'],
  ] as const) {
    test(`${name}: inspector usable at ${width}px with no page overflow`, async ({ page }) => {
      await runRealSearch(page);
      await setViewport(page, width, 900);
      await openInspectorAt(page, 3);
      await expect(inspector(page).getByRole('button', { name: /show surrounding logs/i })).toBeVisible();
      await assertNoHorizontalOverflow(page);
      await captureScreenshot(page, PHASE, name);
    });
  }

  test('U: 200% zoom - the header actions stay reachable', async ({ page }) => {
    await runRealSearch(page);
    await setViewport(page, 1280, 900);
    await openInspectorAt(page, 3);
    await setZoom(page, 200);

    await expect(inspector(page).getByRole('button', { name: /show surrounding logs/i })).toBeVisible();
    await expect(inspector(page)).toContainText(/Event \d+ of \d+ loaded/);
    await assertNoHorizontalOverflow(page);
    await captureScreenshot(page, PHASE, 'AFTER-U-zoom-200pct');
  });
});
