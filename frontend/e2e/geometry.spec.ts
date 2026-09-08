import { test, expect } from '@playwright/test';
import * as path from 'path';
import { assertTableGeometry, assertNoHorizontalOverflow, setViewport, setZoom } from './helpers';

/*
 * Proves the geometry helpers actually catch the regressions they exist to
 * catch, before Phase G is ever allowed to depend on them (see
 * IMPLEMENTATION_PLAN.md "Phase A2a" and PHASE_PROMPTS.md).
 *
 * An assertion that only ever runs against a passing page has never been
 * proven to fail correctly — this file proves both directions.
 *
 * Relocated here (Phase A2b) from tools/playwright-harness/, which was
 * A2a's standalone home for this before frontend/ existed - see
 * IMPLEMENTATION_PLAN.md "Phase A2b".
 */

const CORRECT_FIXTURE = `file://${path.join(import.meta.dirname, 'fixtures', 'table-correct.html')}`;
const BROKEN_FIXTURE = `file://${path.join(import.meta.dirname, 'fixtures', 'table-broken.html')}`;

test.describe('assertTableGeometry / assertNoHorizontalOverflow — meta-tests', () => {
  test('PASS: a correctly-built semantic table satisfies both assertions', async ({ page }) => {
    await page.goto(CORRECT_FIXTURE);
    await setViewport(page, 1280);
    // Must not throw.
    await assertTableGeometry(page, '#results', 2);
    await assertNoHorizontalOverflow(page);
  });

  test('PASS: the correct table still satisfies geometry at 200% zoom', async ({ page }) => {
    await page.goto(CORRECT_FIXTURE);
    await setViewport(page, 1280);
    await setZoom(page, 200);
    await assertTableGeometry(page, '#results', 2);
  });

  test('FAIL-detection: a table with mismatched header/body layout systems is caught', async ({ page }) => {
    await page.goto(BROKEN_FIXTURE);
    await setViewport(page, 1280);
    let thrown: Error | null = null;
    try {
      await assertTableGeometry(page, '#results', 2);
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown, 'assertTableGeometry must throw against the deliberately broken fixture').not.toBeNull();
    expect(thrown!.message).toContain('assertTableGeometry:');
  });

  test('FAIL-detection: an omitted body cell is caught even though the header/column count itself is fine', async ({ page }) => {
    await page.goto(BROKEN_FIXTURE);
    await setViewport(page, 1280);
    let thrown: Error | null = null;
    try {
      await assertTableGeometry(page, '#results', 2);
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown).not.toBeNull();
    // Row 1 (0-indexed) is the row missing a cell in the fixture.
    expect(thrown!.message).toContain('row 1');
  });

  test('FAIL-detection: page-level horizontal overflow is caught', async ({ page }) => {
    await page.goto(BROKEN_FIXTURE);
    await setViewport(page, 1280);
    let thrown: Error | null = null;
    try {
      await assertNoHorizontalOverflow(page);
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown, 'assertNoHorizontalOverflow must throw against the deliberately broken fixture').not.toBeNull();
    expect(thrown!.message).toContain('assertNoHorizontalOverflow:');
  });
});
