import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openInspectorTab } from './inspector-helpers';
import { openSettingsSection } from './settings-helpers';

/*
 * PRE_CLOSURE_FUNCTIONAL_RECOVERY_2 - real, rendered-app verification for
 * both owner corrections:
 *
 *   Part A - the Event Inspector's five primary tabs are now structurally
 *   fixed (never conditionally removed for a sparse event) - see
 *   `EventInspector.tsx`'s own doc comment for the full rationale and the
 *   named conflict this supersedes (the first recovery's own "hide empty
 *   tabs" decision).
 *
 *   Part B - a user-configurable OpenShift/Loki proxy (System/Direct/
 *   Custom) is now reachable from the application itself, never requiring
 *   OS environment variables - see `OpenShiftProxyFieldset` in
 *   `OpenShiftSettingsPanel.tsx`.
 */

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

const PRIMARY_TAB_NAMES = [
  /^overview$/i,
  /actor & client/i,
  /request flow/i,
  /business \/ error/i,
  /technical.*all fields/i,
];

async function expectAllFivePrimaryTabs(page: Page) {
  const dialog = inspector(page);
  for (const name of PRIMARY_TAB_NAMES) {
    await expect(dialog.getByRole('tab', { name })).toBeVisible();
  }
}

test.describe('PCFR2 Part A - Inspector primary tabs are structurally fixed', () => {
  test('1. an event with complete data shows all five tabs', async ({ page }) => {
    await runRealSearch(page);
    // The ERROR row (payments-api "Payment authorization failed") is this
    // fixture's richest event - has an exception, protected fields, and
    // request-flow identifiers.
    await rows(page).filter({ hasText: 'Payment authorization failed' }).first().click();
    await expect(inspector(page)).toBeVisible();
    await expectAllFivePrimaryTabs(page);
  });

  test('2-4. a malformed/sparse event still shows all five tabs, with an honest empty state on the sparse ones', async ({ page }) => {
    await runRealSearch(page);
    await rows(page).filter({ hasText: 'NOT-JSON' }).first().click();
    await expect(inspector(page)).toBeVisible();
    await expectAllFivePrimaryTabs(page);

    await openInspectorTab(inspector(page), page, /actor & client/i);
    await expect(inspector(page).getByText(/no actor or client data/i)).toBeVisible();

    await openInspectorTab(inspector(page), page, /request flow/i);
    await expect(inspector(page).getByText(/no journey, correlation, trace, span, or event id/i)).toBeVisible();
  });

  test('5. the tab set never changes size across the first several loaded events, whatever their content', async ({ page }) => {
    await runRealSearch(page);
    const visibleRows = await rows(page).count();
    const sampleSize = Math.min(5, visibleRows);
    let tabCount: number | null = null;
    for (let i = 0; i < sampleSize; i++) {
      await rows(page).nth(i).click();
      await expect(inspector(page)).toBeVisible();
      const count = await inspector(page).getByRole('tab').count();
      if (tabCount === null) {
        tabCount = count;
      } else {
        expect(count).toBe(tabCount);
      }
      expect(count).toBe(5);
      await inspector(page).getByRole('button', { name: /close/i }).click();
    }
  });

  test('10-12. switching between events resets the active tab to Overview, and the tab set itself never changes', async ({ page }) => {
    await runRealSearch(page);
    await rows(page).nth(0).click();
    await expect(inspector(page)).toBeVisible();
    await openInspectorTab(inspector(page), page, /technical.*all fields/i);
    await expect(inspector(page).getByRole('tab', { name: /technical.*all fields/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // Next event via the inspector's own Next control.
    await inspector(page).getByRole('button', { name: /next event/i }).click();
    await expect(inspector(page).getByRole('tab', { name: /^overview$/i })).toHaveAttribute('aria-selected', 'true');
    await expectAllFivePrimaryTabs(page);
  });
});

test.describe('PCFR2 Part B - user-configurable OpenShift/Loki proxy', () => {
  // The real backend's OpenShiftProxyConfigService is a single, shared,
  // in-memory singleton (deliberately, per its own doc comment - see
  // OpenShiftProxyConfigService.java) - there is no per-test backend
  // instance to isolate against, unlike the mocked-fetch unit tests. Two
  // guards keep these tests deterministic against that shared state:
  // `serial` mode (so no two of these tests can mutate it concurrently
  // from different workers) and an explicit reset-to-SYSTEM before every
  // test (so an earlier test's leftover CUSTOM/DIRECT selection can never
  // leak into a later one - the exact same discipline the backend's own
  // `OpenShiftProxySettingsControllerIntegrationTest` applies via its own
  // `@AfterEach resetProxyConfig()`).
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ request }) => {
    await request.put('/api/v1/sources/openshift/proxy', {
      data: { mode: 'SYSTEM', host: null, port: null },
    });
  });

  async function openProxySettings(page: Page) {
    await page.goto('/');
    // B2 (Session 4) - "OpenShift" was its own top-level Shell button before that session's Settings-
    // consolidation; the panel itself is unchanged (same trigger text, same popover, same behaviour), only
    // reached one step further in now, via the consolidated Settings entry point - missed in that session's
    // own blast-radius scoping (only surfaced by the full CI E2E suite, not this project's own targeted specs).
    // B6.2 (Session 7) - the panel itself is no longer a trigger-button popover (COMPONENT_INVENTORY.md's own
    // RECOMPOSE row): `openSettingsSection` now opens Settings and is a no-op for this already-persistent
    // section.
    await openSettingsSection(page, /^openshift$/i);
    const panel = page.getByTestId('openshift-settings-panel');
    await expect(panel).toBeVisible();
    return panel;
  }

  /**
   * B6.2 (Session 7) - proves a value was genuinely committed server-side
   * (`GET /proxy`), not just held in this render's own state. Before this
   * session the equivalent was closing and reopening the OpenShift
   * popover itself; now that the panel is a persistent section, the
   * surviving mechanism is leaving Settings entirely (a full unmount) and
   * reopening it.
   */
  async function reopenPanel(page: Page) {
    await page.getByRole('button', { name: /back to search results/i }).click();
    return openProxySettings(page);
  }

  test('1-2. OpenShift settings opens with System selected by default', async ({ page }) => {
    const panel = await openProxySettings(page);
    await expect(panel.getByText('Proxy', { exact: true })).toBeVisible();
    await expect(panel.getByRole('radio', { name: /use system proxy/i })).toBeChecked();
    await expect(panel.getByLabel(/proxy server/i)).not.toBeVisible();
  });

  test('3-5. switching to Custom reveals host/port fields, both keyboard-reachable and correctly labeled', async ({ page }) => {
    const panel = await openProxySettings(page);
    const customRadio = panel.getByRole('radio', { name: /^custom proxy$/i });
    // SOURCE_EXPERIENCE_PARITY_TARGETED_RECOVERY_1 - this `.focus()` call was missing its `await` (a
    // pre-existing race, not a functional regression - the proxy fieldset itself is untouched by this
    // mission). It happened to resolve before the following keypress by coincidental timing before Settings'
    // own scope-editing UI was removed from above it in this same panel; that removal shifted render timing
    // enough to expose the race for real. Found via a genuine, reproducible E2E failure, not assumed.
    await customRadio.focus();
    await expect(customRadio).toHaveAttribute('type', 'radio');
    await page.keyboard.press(' ');
    await expect(customRadio).toBeChecked();

    const hostField = panel.getByLabel(/proxy server/i);
    const portField = panel.getByLabel(/proxy port/i);
    await expect(hostField).toBeVisible();
    await expect(portField).toBeVisible();
    await hostField.fill('proxy.company.local');
    await portField.fill('8080');
    await expect(hostField).toHaveValue('proxy.company.local');
    await expect(portField).toHaveValue('8080');
  });

  test('an invalid custom port is rejected before anything is applied - a clear, specific message, not a silent failure', async ({ page }) => {
    const panel = await openProxySettings(page);
    await panel.getByRole('radio', { name: /^custom proxy$/i }).click();
    await panel.getByLabel(/proxy server/i).fill('proxy.company.local');
    await panel.getByLabel(/proxy port/i).fill('not-a-number');
    await panel.getByRole('button', { name: /apply proxy/i }).click();
    await expect(panel.getByRole('alert')).toContainText(/must be a number/i);
  });

  test('6-7. Apply commits the custom proxy, and it is still selected (§7 - "confirm custom proxy path used") on reopening the panel', async ({ page }) => {
    const panel = await openProxySettings(page);
    await panel.getByRole('radio', { name: /^custom proxy$/i }).click();
    await panel.getByLabel(/proxy server/i).fill('proxy.company.local');
    await panel.getByLabel(/proxy port/i).fill('8080');
    await panel.getByRole('button', { name: /apply proxy/i }).click();
    await expect(panel.getByRole('radio', { name: /^custom proxy$/i })).toBeChecked();

    // Close and reopen - proves the value was actually committed
    // server-side (GET /proxy), not just held in this render's own state.
    const reopened = await reopenPanel(page);
    await expect(reopened.getByRole('radio', { name: /^custom proxy$/i })).toBeChecked();
    await expect(reopened.getByLabel(/proxy server/i)).toHaveValue('proxy.company.local');
    await expect(reopened.getByLabel(/proxy port/i)).toHaveValue('8080');
  });

  test('8-9. switching to Direct hides the custom fields and commits immediately (confirmed on reopen)', async ({ page }) => {
    const panel = await openProxySettings(page);
    // Start from a committed Custom value, to prove switching away really
    // does replace it (§B3 "stop using stale custom values").
    await panel.getByRole('radio', { name: /^custom proxy$/i }).click();
    await panel.getByLabel(/proxy server/i).fill('old-proxy.example.com');
    await panel.getByLabel(/proxy port/i).fill('3128');
    await panel.getByRole('button', { name: /apply proxy/i }).click();
    await expect(panel.getByRole('radio', { name: /^custom proxy$/i })).toBeChecked();

    await panel.getByRole('radio', { name: /^direct connection$/i }).click();
    await expect(panel.getByRole('radio', { name: /^direct connection$/i })).toBeChecked();
    await expect(panel.getByLabel(/proxy server/i)).not.toBeVisible();

    const reopened = await reopenPanel(page);
    await expect(reopened.getByRole('radio', { name: /^direct connection$/i })).toBeChecked();
  });

  test('10-11. switching back to System restores the environment-variable behavior (confirmed on reopen)', async ({ page }) => {
    const panel = await openProxySettings(page);
    await panel.getByRole('radio', { name: /^direct connection$/i }).click();
    await expect(panel.getByRole('radio', { name: /^direct connection$/i })).toBeChecked();

    await panel.getByRole('radio', { name: /use system proxy/i }).click();
    await expect(panel.getByRole('radio', { name: /use system proxy/i })).toBeChecked();

    const reopened = await reopenPanel(page);
    await expect(reopened.getByRole('radio', { name: /use system proxy/i })).toBeChecked();
  });

  test('the proxy settings response never carries a token, password, or bearer credential in the network payload', async ({ page }) => {
    let sawProxyResponse = false;
    page.on('response', async (response) => {
      if (response.url().endsWith('/api/v1/sources/openshift/proxy')) {
        sawProxyResponse = true;
        const text = await response.text().catch(() => '');
        expect(text.toLowerCase()).not.toMatch(/token|password|bearer/);
      }
    });
    await openProxySettings(page);
    expect(sawProxyResponse).toBe(true);
  });

  test('no proxy setting is ever written to localStorage', async ({ page }) => {
    const panel = await openProxySettings(page);
    await panel.getByRole('radio', { name: /^custom proxy$/i }).click();
    await panel.getByLabel(/proxy server/i).fill('proxy.company.local');
    await panel.getByLabel(/proxy port/i).fill('8080');
    await panel.getByRole('button', { name: /apply proxy/i }).click();
    await expect(panel.getByRole('radio', { name: /^custom proxy$/i })).toBeChecked();

    const storageDump = await page.evaluate(() => JSON.stringify(window.localStorage));
    expect(storageDump.toLowerCase()).not.toContain('proxy.company.local');
  });

  // §6/§B12 - "Test connection against a deterministic proxy fixture/mock
  // or controlled broken proxy". This dev environment has no real
  // OpenShift cluster credentials suitable for driving the actual
  // POST /connect round trip through a deliberately-broken CUSTOM proxy
  // from the browser UI, and no controllable proxy fixture is wired into
  // this E2E suite's own infrastructure. Per the mission's own explicit
  // instruction ("do not fabricate a successful real enterprise proxy
  // test... mark external real-network checks honestly as
  // BLOCKED/NOT_AVAILABLE"), this is recorded as NOT_AVAILABLE at the E2E
  // layer - the equivalent behavior IS deterministically proven at the
  // backend level instead: `OpenShiftApiClientTest.customModeRoutesThroughTheConfiguredProxyAndIgnoresNoProxy`
  // and `LokiWebClientFactoryTest.customModeRoutesThroughTheConfiguredProxyAndIgnoresNoProxy`
  // both exercise a real deliberately-broken CUSTOM proxy against a real
  // live server and assert `Kind.PROXY`/`Reason.PROXY` classification.
  test.skip('real Test-Connection-through-a-broken-CUSTOM-proxy (browser → real cluster) - NOT_AVAILABLE, see comment above', () => {});
});
