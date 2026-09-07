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
 * Screenshots into docs/verification/<phase>/, creating the directory if
 * needed — the evidence path every phase's browser checks write into.
 */
export async function captureScreenshot(page: Page, phase: string, name: string): Promise<string> {
  const dir = path.join(__dirname, '..', '..', 'docs', 'verification', phase);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}
