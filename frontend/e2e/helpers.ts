/*
 * H4a (Phase A2a) — app-agnostic Playwright helper library.
 *
 * Deliberately has no dependency on any particular app: it takes a `Page`
 * and a CSS selector, nothing else. Phase A2b relocates/imports this into
 * `frontend/e2e/` once the real frontend exists (see IMPLEMENTATION_PLAN.md
 * "Phase A2b"), and Phase G depends on assertTableGeometry being correct.
 */

import type { Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

export async function setViewport(page: Page, width: number, height = 900): Promise<void> {
  await page.setViewportSize({ width, height });
}

/**
 * Sets browser zoom via `document.documentElement.style.zoom`, per
 * IMPLEMENTATION_PLAN.md §4 ("Zoom emulation").
 */
export async function setZoom(page: Page, zoomPercent: number): Promise<void> {
  await page.evaluate((z) => {
    (document.documentElement.style as unknown as { zoom: string }).zoom = `${z}%`;
  }, zoomPercent);
}

/**
 * Waits for the page's own web fonts (`tokensV2.css`'s `@font-face`
 * `Inter Var`/`JetBrains Mono Var`) to finish loading before a test takes
 * a layout measurement.
 *
 * PR #65 CI regression fix (`pr65-custom-time-toolbar-geometry.spec.ts`):
 * a geometry snapshot taken immediately after `page.goto('/')` (or
 * immediately after `setZoom`) can land while these fonts are still
 * "loading" (`document.fonts.status`) - the browser lays out text with a
 * fallback font's metrics until the real one swaps in and forces a
 * relayout. Reproduced live against the exact CI Chromium build: at a
 * width/zoom where the toolbar's `flex-wrap` row is already close to
 * wrapping, that one relayout is sometimes enough to change how many
 * controls fit per row, moving the toolbar's own measured position - not
 * because anything in the app changed, but because the "before" snapshot
 * was taken mid-font-swap and the "after" one (taken following a couple
 * of `click()` round-trips, which cost enough real time for the fonts to
 * finish) was not. Awaiting `document.fonts.ready` first removes that
 * race so both snapshots measure the same, final, font-settled layout.
 */
export async function waitForFontsReady(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
}

/**
 * The `What happened` column's own message text, excluding the "More"/
 * "Less" expand toggle's own label (`MessageCell.tsx`'s `.toggle` button,
 * shown whenever a message is long enough to likely be clipped -
 * `LIKELY_TRUNCATED_THRESHOLD`, 80 characters).
 *
 * PR #65 CI regression fix (`phase-ui-gap-closure.spec.ts`): a test that
 * reads the whole `<td>`'s `innerText`/`textContent` picks up that
 * button's own label too - `innerText` even inserts a line break before
 * it (flex items each start a new "line" in `innerText`'s output), so a
 * cell holding e.g. `"...declined ***"` renders as
 * `"...declined ***\nMore"`. This wasn't reachable before this same PR's
 * own fixture-corpus growth (`FixtureLogSource.java`, 250 -> 640 events,
 * for the new 500-row page-size E2E coverage): whichever fixture event
 * this test's own row-selection logic now lands on is long enough to
 * cross that 80-character threshold, where the shorter corpus's
 * equivalent row wasn't. `MessageCell.tsx` always renders the message
 * text itself in the FIRST `<span>` inside the cell (the `.badge`/
 * `.toggle` that can follow it are also elements, but never precede it in
 * DOM order) - reading that one span's own text, not the whole cell's,
 * gets exactly the message CLAUDE.md §4 means by "`What happened` =
 * message only", regardless of whether the toggle happens to be present.
 */
export async function messageCellText(cell: import('@playwright/test').Locator): Promise<string> {
  return cell.locator('span').first().innerText();
}

interface GeometryMismatch {
  row: number;
  column: number;
  headerText: string;
  detail: string;
}

/**
 * Asserts every body row's cells share left/width geometry with the
 * corresponding header cell, within `tolerancePx` CSS pixels — the
 * handover's "table may not be described as fixed" invariant (CLAUDE.md
 * §4 "Results table", HANDOVER.md §15.9).
 *
 * Checks EVERY body row, not just the first — a row with an omitted cell
 * (shifting later columns) only shows up if every row is compared.
 *
 * Throws (does not return a boolean) so a broken table causes a hard test
 * failure rather than a silently-ignored return value.
 */
export async function assertTableGeometry(
  page: Page,
  tableSelector = 'table',
  tolerancePx = 2,
): Promise<void> {
  const mismatches: GeometryMismatch[] = await page.evaluate(
    ({ tableSelector, tolerancePx }) => {
      const table = document.querySelector(tableSelector);
      if (!table) {
        throw new Error(`assertTableGeometry: no element matches selector "${tableSelector}"`);
      }
      const headerCells = Array.from(table.querySelectorAll('thead th'));
      if (headerCells.length === 0) {
        throw new Error('assertTableGeometry: no <thead><th> cells found — is this a real semantic table?');
      }
      const bodyRows = Array.from(table.querySelectorAll('tbody tr'));
      if (bodyRows.length === 0) {
        throw new Error('assertTableGeometry: table has no tbody rows to compare against');
      }

      const results: GeometryMismatch[] = [];
      bodyRows.forEach((row, rowIndex) => {
        const bodyCells = Array.from(row.querySelectorAll('td'));
        if (bodyCells.length !== headerCells.length) {
          results.push({
            row: rowIndex,
            column: -1,
            headerText: '',
            detail: `row ${rowIndex} has ${bodyCells.length} <td> cells but header has ${headerCells.length} <th> cells (an omitted cell shifts every later column)`,
          });
          return;
        }
        headerCells.forEach((h, colIndex) => {
          const hr = (h as HTMLElement).getBoundingClientRect();
          const br = (bodyCells[colIndex] as HTMLElement).getBoundingClientRect();
          const leftDiff = Math.abs(hr.left - br.left);
          const widthDiff = Math.abs(hr.width - br.width);
          if (leftDiff > tolerancePx || widthDiff > tolerancePx) {
            results.push({
              row: rowIndex,
              column: colIndex,
              headerText: (h.textContent || '').trim(),
              detail: `left off by ${leftDiff.toFixed(1)}px, width off by ${widthDiff.toFixed(1)}px (tolerance ${tolerancePx}px)`,
            });
          }
        });
      });
      return results;
    },
    { tableSelector, tolerancePx },
  );

  if (mismatches.length > 0) {
    const detail = mismatches
      .map((m) => `row ${m.row}${m.column >= 0 ? `, column ${m.column} ("${m.headerText}")` : ''}: ${m.detail}`)
      .join('; ');
    throw new Error(`assertTableGeometry: header/body geometry mismatch beyond tolerance — ${detail}`);
  }
}

/**
 * Asserts the page itself never scrolls horizontally (CLAUDE.md §4:
 * "the page never overflows horizontally" — any horizontal scroll must be
 * contained by a wrapper around the table, not the page).
 */
export async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth - doc.clientWidth;
  });
  const SUBPIXEL_SLACK = 1;
  if (overflow > SUBPIXEL_SLACK) {
    throw new Error(`assertNoHorizontalOverflow: page overflows horizontally by ${overflow}px`);
  }
}

/**
 * Asserts two elements' bounding boxes do not overlap (CLAUDE.md §4: "The
 * editor must not overlap severity"). Throws with both rects' geometry so
 * a failure is diagnosable without re-running under a debugger.
 */
export async function assertNoOverlap(page: Page, selectorA: string, selectorB: string): Promise<void> {
  const rects = await page.evaluate(
    ({ selectorA, selectorB }) => {
      const a = document.querySelector(selectorA);
      const b = document.querySelector(selectorB);
      if (!a || !b) {
        throw new Error(`assertNoOverlap: could not find "${selectorA}" and/or "${selectorB}"`);
      }
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return {
        a: { left: ar.left, right: ar.right, top: ar.top, bottom: ar.bottom },
        b: { left: br.left, right: br.right, top: br.top, bottom: br.bottom },
      };
    },
    { selectorA, selectorB },
  );

  const overlaps =
    rects.a.left < rects.b.right &&
    rects.a.right > rects.b.left &&
    rects.a.top < rects.b.bottom &&
    rects.a.bottom > rects.b.top;

  if (overlaps) {
    throw new Error(
      `assertNoOverlap: "${selectorA}" (${JSON.stringify(rects.a)}) overlaps "${selectorB}" (${JSON.stringify(rects.b)})`,
    );
  }
}

/**
 * Screenshots into docs/verification/<phase>/, creating the directory if
 * needed — the evidence path every phase's browser checks write into.
 */
export async function captureScreenshot(page: Page, phase: string, name: string): Promise<string> {
  const dir = path.join(import.meta.dirname, '..', '..', 'docs', 'verification', phase);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}
