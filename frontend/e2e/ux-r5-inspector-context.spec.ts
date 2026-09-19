import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { assertNoHorizontalOverflow, captureScreenshot, setViewport, setZoom } from './helpers';
import { inspectorAllTabsText, openInspectorTab } from './inspector-helpers';
import { openSettingsSection } from './settings-helpers';

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

    // Pre-closure functional recovery (PCFR-1): each section now lives
    // behind its own tab - only the active tab's section is in the DOM.
    for (const [label, name] of [
      ['Actor & client', 'AFTER-E-actor-client'],
      ['Request flow', 'AFTER-F-request-flow'],
      ['Business / error', 'AFTER-G-business-error'],
    ] as const) {
      await openInspectorTab(panel, page, new RegExp(label.replace('/', '\\/'), 'i'));
      const section = panel.locator(`section[aria-label="${label}"]`);
      await expect(section).toBeVisible();
      await captureScreenshot(page, PHASE, name);
    }

    // All fields is the escape hatch: present and reachable, but collapsed
    // - now doubly so (PCFR-1's own "Technical / all fields" tab, plus
    // UX-R5's pre-existing collapsed <details> inside it).
    await openInspectorTab(panel, page, /technical.*all fields/i);
    const allFields = panel.locator('details').filter({ hasText: 'All fields' }).first();
    await expect(allFields).not.toHaveAttribute('open', '');
    await allFields.getByRole('heading', { name: /^all fields$/i }).click();
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

    // Pre-closure functional recovery (PCFR-1): with tabs, only the
    // active tab's content renders at all, so the panel's own total
    // rendered height (not "the tallest overflowing descendant", which
    // no longer necessarily exists when a single tab's content fits
    // without scrolling) is the honest, still-regression-guarding measure.
    const height = await inspector(page).evaluate((panel) => panel.scrollHeight);
    // Measured BEFORE UX-R5: ~3,992px of stacked content. The floor here is
    // deliberately generous - this guards the regression, not a pixel value.
    expect(height).toBeGreaterThan(0);
    expect(height).toBeLessThan(3000);
  });

  test('I: a section with no data stays offered as a tab, with an honest empty state - never hidden', async ({ page }) => {
    // Pre-closure functional recovery 2 (§A1-§A5) named conflict, per
    // CLAUDE.md §5, superseding the FIRST recovery's own decision here
    // (PCFR-1, "do not display empty meaningless tabs" - a tab with
    // nothing to show was removed entirely). The owner explicitly
    // rejected that once it shipped: the absence of data is itself
    // diagnostically meaningful - a user must be able to tell "this
    // category doesn't exist for this event" apart from "the UI hid
    // something." All five primary tabs are now a fixed, always-present
    // structural constant; only the CONTENT inside an empty one changes
    // (an honest note, same as UX-R5 originally had before PCFR-1).
    await runRealSearch(page);
    await rows(page).filter({ hasText: 'NOT-JSON' }).first().click();
    await expect(inspector(page)).toBeVisible();

    // Every primary tab remains offered, even for this sparsest possible event.
    await expect(inspector(page).getByRole('tab', { name: /^overview$/i })).toBeVisible();
    await expect(inspector(page).getByRole('tab', { name: /actor & client/i })).toBeVisible();
    await expect(inspector(page).getByRole('tab', { name: /request flow/i })).toBeVisible();
    await expect(inspector(page).getByRole('tab', { name: /business \/ error/i })).toBeVisible();
    await expect(inspector(page).getByRole('tab', { name: /technical.*all fields/i })).toBeVisible();

    await openInspectorTab(inspector(page), page, /actor & client/i);
    await expect(inspector(page).getByText(/no actor or client data on this event/i)).toBeVisible();
    await captureScreenshot(page, PHASE, 'AFTER-I-missing-data-section');
  });

  test('§11 - every Request flow row anchors Copy in the same place', async ({ page }) => {
    await runRealSearch(page);
    await openInspectorAt(page, 3);
    // Pre-closure functional recovery (PCFR-1): Request flow now lives
    // behind its own tab.
    await openInspectorTab(inspector(page), page, /request flow/i);
    const section = inspector(page).locator('section[aria-label="Request flow"]');
    await expect(section).toBeVisible();

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

    const contextButton = inspector(page).getByRole('button', { name: /show surroundings/i });
    await expect(contextButton).toBeVisible();

    // Pre-closure functional recovery (PCFR-1): "sections" are now tabs -
    // navigate to the LAST one (Technical / all fields, always present)
    // and scroll its own bounded tabpanel to the bottom; the context
    // action lives in the sticky header outside the tabpanel, so it must
    // stay visible regardless of which tab is open or how far scrolled.
    await openInspectorTab(inspector(page), page, /technical.*all fields/i);
    await inspector(page)
      .locator('[role="tabpanel"]')
      .evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect(contextButton).toBeInViewport();
    await captureScreenshot(page, PHASE, 'AFTER-J-context-action-visible-while-scrolled');
  });

  test('there is exactly ONE context action in the inspector, never one per section', async ({ page }) => {
    await runRealSearch(page);
    await openInspectorAt(page, 3);
    await expect(inspector(page).getByRole('button', { name: /show surroundings/i })).toHaveCount(1);
  });
});

test.describe('UX-R5 §16-§24 - the context view', () => {
  test('K/L/M/N: context from the inspector - root marked, summary, gaps', async ({ page }) => {
    await runRealSearch(page);
    await openInspectorAt(page, 3);
    await inspector(page).getByRole('button', { name: /show surroundings/i }).click();
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
    await inspector(page).getByRole('button', { name: /show surroundings/i }).click();
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
    await inspector(page).getByRole('button', { name: /show surroundings/i }).click();
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

    await inspector(page).getByRole('button', { name: /show surroundings/i }).click();
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
    await page.getByRole('menuitem', { name: /show surroundings/i }).click();
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
    // Pre-closure functional recovery (PCFR-1): "All fields" now lives
    // behind its own "Technical / all fields" tab first.
    await openInspectorTab(inspector(page), page, /technical.*all fields/i);
    const allFields = inspector(page).locator('details').filter({ hasText: 'All fields' }).first();
    await allFields.locator('summary').first().focus();
    await page.keyboard.press('Enter');
    await expect(allFields).toHaveAttribute('open', '');
  });
});

test.describe('UX-R5 §28 - security', () => {
  test('inspector and context never expose raw protected values, and persist nothing', async ({ page }) => {
    // Mission "Field Mapping Schema Scan + Masking Policy Extension" §B:
    // the fresh/default masking state is now OFF - this test is
    // specifically about the MASKED-display guarantee, so it explicitly
    // enables masking for all five protected fields first (the real,
    // current owner-facing workflow). This MUST happen before the search
    // below: masking is applied server-side at fetch time, so an
    // already-loaded row's data stays whatever it was when it was
    // fetched - toggling the policy afterward never retroactively masks
    // rows already on screen. Reset at the end so this shared-singleton
    // backend policy never leaks into a later test.
    await page.goto('/');
    const protectedLabels = ['CIF', 'Username', 'Customer ID', 'Device ID', 'Device IP'];
    await openSettingsSection(page, /privacy & masking/i);
    const maskingDialog = page.getByTestId('privacy-masking-settings-panel');
    await expect(maskingDialog).toBeVisible();
    for (const label of protectedLabels) {
      if (!(await maskingDialog.getByLabel(label).isChecked())) {
        await maskingDialog.getByLabel(label).click();
      }
    }
    // B6.2 (Session 7) - Privacy & masking is no longer a popover with its own "Close" - only the
    // consolidated Settings workspace itself needs closing.
    await page.getByRole('button', { name: /back to search results/i }).click();

    await runRealSearch(page);
    await openInspectorAt(page, 3);

    // Pre-closure functional recovery (PCFR-1): "All fields" now lives
    // behind its own "Technical / all fields" tab first.
    await openInspectorTab(inspector(page), page, /technical.*all fields/i);
    const allFields = inspector(page).locator('details').filter({ hasText: 'All fields' }).first();
    await allFields.getByRole('heading', { name: /^all fields$/i }).click();
    const allFieldsPanelText = await inspector(page).innerText();
    expect(allFieldsPanelText).toMatch(/\*\*\*/);
    // "Protected / masked - never revealed" lives in the Actor & client
    // tab, not this one - check every tab's own text combined.
    const panelText = await inspectorAllTabsText(inspector(page));
    expect(panelText).toMatch(/never revealed/i);
    // No reveal/unmask affordance anywhere in the inspector.
    expect(await inspector(page).getByRole('button', { name: /reveal|unmask|show raw/i }).count()).toBe(0);

    await inspector(page).getByRole('button', { name: /show surroundings/i }).click();
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

    // Restore the fresh default (unmasked) so this shared-singleton
    // backend policy never leaks into a later test in the same run.
    await page.keyboard.press('Escape');
    await openSettingsSection(page, /privacy & masking/i);
    const cleanupDialog = page.getByTestId('privacy-masking-settings-panel');
    await expect(cleanupDialog).toBeVisible();
    for (const label of protectedLabels) {
      if (await cleanupDialog.getByLabel(label).isChecked()) {
        await cleanupDialog.getByLabel(label).click();
      }
    }
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
      await expect(inspector(page).getByRole('button', { name: /show surroundings/i })).toBeVisible();
      await assertNoHorizontalOverflow(page);
      await captureScreenshot(page, PHASE, name);
    });
  }

  test('U: 200% zoom - the header actions stay reachable', async ({ page }) => {
    await runRealSearch(page);
    await setViewport(page, 1280, 900);
    await openInspectorAt(page, 3);
    await setZoom(page, 200);

    await expect(inspector(page).getByRole('button', { name: /show surroundings/i })).toBeVisible();
    await expect(inspector(page)).toContainText(/Event \d+ of \d+ loaded/);
    await assertNoHorizontalOverflow(page);
    await captureScreenshot(page, PHASE, 'AFTER-U-zoom-200pct');
  });
});
