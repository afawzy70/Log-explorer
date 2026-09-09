import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/*
 * Legacy Remediation Slice 3 — DOCKER CONNECTION, SETTINGS, SECURITY &
 * COMPOSE PROJECT BOUNDARY. Browser checks required by the owner-approved
 * plan (docs/LEGACY_TO_NEW_REMEDIATION_PLAN.md §"Slice 3"), items 1-8 and
 * 13 (the Docker settings workspace itself) - deterministic/network-mocked
 * against the real dev-profile backend (Fixture source, for the
 * "current search results" preservation check), since the *real* Docker
 * connection this environment actually has is always LOCAL mode (no
 * REMOTE/TLS credentials to demonstrate) — mocking
 * /api/v1/sources/docker/connection and /api/v1/sources/docker/test-connection
 * exercises the app's real fetch/client code path end-to-end for the
 * REMOTE/TLS/failure shapes that can't otherwise be demonstrated live.
 *
 * Items 9-12 (Compose project hard boundary, overlapping service names,
 * self-exclusion) are verified for real against a genuine local Docker
 * daemon in docs/verification/LEGACY_REMEDIATION_SLICE_3_REPORT.md §
 * "Real Docker verification" (curl-based backend evidence, the same
 * methodology Legacy Remediation Slice 1 established) plus one real-browser
 * check in phase-legacy-slice3-docker-compose-real.spec.ts - not
 * duplicated here since this file is the network-mocked, always-green-in-CI
 * half.
 */

async function openDockerSettings(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /docker settings/i }).click();
  await expect(page.getByRole('dialog', { name: /docker connection/i })).toBeVisible();
}

test.describe('Legacy Remediation Slice 3 — Docker connection/settings workspace', () => {
  test('1. opening Docker settings after a search never loses the current results', async ({ page }) => {
    await page.goto('/');
    await page.selectOption('select', 'fixture');
    await page.getByRole('button', { name: /^search$/i }).click();
    await expect(page.getByRole('table')).toBeVisible({ timeout: 10_000 });
    const urlBefore = page.url();

    await page.getByRole('button', { name: /docker settings/i }).click();
    await expect(page.getByRole('dialog', { name: /docker connection/i })).toBeVisible();

    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.locator('tbody tr').first()).toBeVisible();
    expect(page.url()).toBe(urlBefore);
  });

  test('2. local configuration summary shows Mode: Local with no host/port', async ({ page }) => {
    await openDockerSettings(page);
    const summary = page.locator('dl');
    await expect(summary).toContainText('Local');
    await expect(page.getByText('Host', { exact: true })).not.toBeVisible();
  });

  test('3 + 4. a mocked remote host summary shows the configured host and a custom port, never a hardcoded 2375', async ({ page }) => {
    await page.route('**/api/v1/sources/docker/connection', (route) =>
      route.fulfill({
        json: {
          mode: 'REMOTE',
          host: '203.0.113.20',
          port: 9999,
          tlsEnabled: false,
          composeProjectFilter: null,
          runtimeMutationSupported: false,
          settingsNote: 'Permanent connection changes require deployment/runtime configuration and a restart.',
        },
      }),
    );
    await openDockerSettings(page);

    const summary = page.locator('dl');
    await expect(summary).toContainText('Remote');
    await expect(summary).toContainText('203.0.113.20');
    await expect(summary).toContainText('9999');
    await expect(summary).not.toContainText('2375');
  });

  test('5. TLS off is shown as Disabled', async ({ page }) => {
    await openDockerSettings(page);
    await expect(page.locator('dl')).toContainText('Disabled');
  });

  test('6. TLS on shows a safe certificate-profile representation (a filesystem path field), never certificate contents', async ({ page }) => {
    await page.route('**/api/v1/sources/docker/connection', (route) =>
      route.fulfill({
        json: {
          mode: 'REMOTE',
          host: '203.0.113.20',
          port: 2376,
          tlsEnabled: true,
          composeProjectFilter: null,
          runtimeMutationSupported: false,
          settingsNote: 'Permanent connection changes require deployment/runtime configuration and a restart.',
        },
      }),
    );
    await openDockerSettings(page);
    await expect(page.locator('dl')).toContainText('Enabled');

    // The Test Connection form's own TLS checkbox is prefilled from the
    // summary - toggling it reveals only a *path* field, never a
    // certificate-content textarea/upload.
    await expect(page.getByLabel(/use tls/i)).toBeChecked();
    await expect(page.getByLabel(/certificate directory path/i)).toBeVisible();
    await expect(page.getByLabel(/certificate directory path/i)).toHaveAttribute('type', 'text');
  });

  test('7. Test Connection success shows a reachable status through the real API contract', async ({ page }) => {
    let capturedBody: unknown = null;
    await page.route('**/api/v1/sources/docker/test-connection', (route) => {
      capturedBody = JSON.parse(route.request().postData() ?? '{}');
      route.fulfill({ json: { status: 'UP', message: 'Docker daemon reachable', checkedAt: new Date().toISOString() } });
    });
    await openDockerSettings(page);

    await page.getByRole('button', { name: /^test connection$/i }).click();
    await expect(page.getByText(/reachable: docker daemon reachable/i)).toBeVisible();
    expect(capturedBody).toMatchObject({ mode: 'LOCAL' });
  });

  test('8. Test Connection failure shows sanitized diagnostics, never a stack trace or raw exception text', async ({ page }) => {
    await page.route('**/api/v1/sources/docker/test-connection', (route) =>
      route.fulfill({
        json: {
          status: 'DOWN',
          message: 'Docker daemon unreachable - connection refused. Confirm the daemon is running and reachable at the configured host/port.',
          checkedAt: new Date().toISOString(),
        },
      }),
    );
    await openDockerSettings(page);
    await page.getByLabel('Mode').selectOption('REMOTE');
    await page.getByLabel('Host').fill('203.0.113.30');
    await page.getByRole('button', { name: /^test connection$/i }).click();

    const status = page.getByText(/unreachable: docker daemon unreachable/i);
    await expect(status).toBeVisible();
    const text = await status.textContent();
    expect(text).not.toContain('Exception');
    expect(text).not.toMatch(/\bat\s+[\w.$]+\(/); // no stack-frame shape
  });

  test('13. no connection credential material ever appears in the URL, localStorage, or sessionStorage', async ({ page }) => {
    await page.route('**/api/v1/sources/docker/test-connection', (route) =>
      route.fulfill({ json: { status: 'UP', message: 'ok', checkedAt: new Date().toISOString() } }),
    );
    await openDockerSettings(page);
    await page.getByLabel('Mode').selectOption('REMOTE');
    await page.getByLabel('Host').fill('sensitive-internal-host.example');
    await page.getByLabel(/use tls/i).check();
    await page.getByLabel(/certificate directory path/i).fill('/etc/log-explorer/secret-certs');
    await page.getByRole('button', { name: /^test connection$/i }).click();
    await expect(page.getByText(/reachable/i)).toBeVisible();

    expect(page.url()).not.toContain('sensitive-internal-host');
    expect(page.url()).not.toContain('secret-certs');
    const storageDump = await page.evaluate(() => ({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }));
    const serialized = JSON.stringify(storageDump);
    expect(serialized).not.toContain('sensitive-internal-host');
    expect(serialized).not.toContain('secret-certs');
  });
});
