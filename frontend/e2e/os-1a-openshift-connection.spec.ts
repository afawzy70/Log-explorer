import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { assertNoHorizontalOverflow, captureScreenshot, setViewport } from './helpers';

/*
 * OS-1A - the OpenShift connection surface, verified against the REAL
 * rendered app and the REAL backend (LERUX-1: rendered-browser evidence
 * first; a passing unit test is never proof of a working UI).
 *
 * These specs drive the genuine connect endpoint against a real running
 * backend. They deliberately do NOT need a real cluster: every assertion
 * here is about the client-side security boundary, the failure taxonomy
 * and the responsive/accessible shape of the form. Real-cluster behaviour
 * is Layer 3 (`OpenShiftRealSandboxIT`), which skips without credentials.
 */

const PHASE = 'OS_1A_EVIDENCE';

async function openPanel(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'OpenShift' }).click();
  await expect(page.getByRole('dialog', { name: /openshift connection/i })).toBeVisible();
}

test.describe('OS-1A - the connection form', () => {
  test('A: disconnected state offers a Connect form and explains the token policy', async ({ page }) => {
    await setViewport(page, 1440, 900);
    await openPanel(page);

    await expect(page.getByText(/not connected/i)).toBeVisible();
    await expect(page.getByLabel(/paste your oc login command/i)).toBeVisible();
    // The promise the product makes about the credential must be on screen,
    // not merely in documentation.
    await expect(page.getByText(/read, never run/i)).toBeVisible();
    await expect(page.getByText(/never saved to disk/i)).toBeVisible();

    await captureScreenshot(page, PHASE, 'AFTER-A-openshift-disconnected');
  });

  test('the command field behaves like a secret', async ({ page }) => {
    await openPanel(page);
    const field = page.getByLabel(/paste your oc login command/i);

    await expect(field).toHaveAttribute('autocomplete', 'off');
    await expect(field).toHaveAttribute('spellcheck', 'false');
  });
});

test.describe('OS-1A §7/§8 - hostile input is refused in the real app', () => {
  const hostile = [
    {
      name: 'shell syntax',
      command: 'oc login --token=T0kenValue123456 --server=https://api.example.com:6443 ; rm -rf /',
      expect: /shell syntax/i,
    },
    {
      name: 'command substitution',
      command: 'oc login --token=$(cat /etc/passwd) --server=https://api.example.com:6443',
      expect: /shell syntax/i,
    },
    {
      name: 'unknown flag',
      command: 'oc login --token=T0kenValue123456 --server=https://api.example.com:6443 --namespace=payments',
      expect: /does not support/i,
    },
    {
      name: 'plain http server',
      command: 'oc login --token=T0kenValue123456 --server=http://api.example.com:6443',
      expect: /https/i,
    },
    {
      name: 'insecure TLS',
      command:
        'oc login --token=T0kenValue123456 --server=https://api.example.com:6443 --insecure-skip-tls-verify',
      expect: /will not disable TLS/i,
    },
    {
      name: 'not an oc login command',
      command: 'curl https://api.example.com',
      expect: /does not look like an oc login/i,
    },
  ];

  for (const scenario of hostile) {
    test(`refuses ${scenario.name}, with a specific reason and no echo of the input`, async ({ page }) => {
      await openPanel(page);
      await page.getByLabel(/paste your oc login command/i).fill(scenario.command);
      await page.getByRole('button', { name: /^connect$/i }).click();

      const alert = page.getByRole('alert');
      await expect(alert).toBeVisible({ timeout: 10_000 });
      await expect(alert).toContainText(scenario.expect);

      // The rejection must never echo the pasted command back at the user.
      const alertText = await alert.innerText();
      expect(alertText).not.toContain('T0kenValue123456');
      expect(alertText).not.toContain('/etc/passwd');
      expect(alertText).not.toContain('rm -rf');

      // ...and the field is cleared, so the token is not left sitting in the DOM.
      await expect(page.getByLabel(/paste your oc login command/i)).toHaveValue('');
    });
  }

  test('B: a refusal is shown as a specific, actionable message', async ({ page }) => {
    await setViewport(page, 1440, 900);
    await openPanel(page);
    await page
      .getByLabel(/paste your oc login command/i)
      .fill('oc login --token=T0kenValue123456 --server=https://api.example.com:6443 --insecure-skip-tls-verify');
    await page.getByRole('button', { name: /^connect$/i }).click();
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 10_000 });

    await captureScreenshot(page, PHASE, 'AFTER-B-openshift-refusal');
  });
});

test.describe('OS-1A §9 - the token never reaches browser storage or the URL', () => {
  test('nothing about a submitted command is persisted anywhere client-side', async ({ page }) => {
    await openPanel(page);
    const secret = 'sha256~e2e-secret-token-value-01234567';
    await page
      .getByLabel(/paste your oc login command/i)
      .fill(`oc login --token=${secret} --server=https://api.unreachable.invalid:6443`);
    await page.getByRole('button', { name: /^connect$/i }).click();

    // The attempt will fail (that host does not resolve) - which is fine:
    // what matters is what is left behind afterwards.
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 30_000 });

    const leaked = await page.evaluate((token) => {
      const inStorage = JSON.stringify(window.localStorage) + JSON.stringify(window.sessionStorage);
      return {
        storage: inStorage.includes(token),
        url: window.location.href.includes(token),
        dom: document.body.innerHTML.includes(token),
      };
    }, secret);

    expect(leaked.storage).toBe(false);
    expect(leaked.url).toBe(false);
    expect(leaked.dom).toBe(false);
  });
});

test.describe('OS-1A §21 - capability truthfulness in the rendered app', () => {
  /*
   * CORRECTED (OS-1C): this test originally asserted
   * `historicalSearch === false`, true for OS-1A/1B when nothing but
   * connect and project/workload/pod discovery existed. OS-1C adds a
   * real, bounded direct search (DirectPodLogProvider), so
   * `historicalSearch === true` is now the truthful value - see
   * `OpenShiftLogSource#capabilities()`'s own javadoc for why that flag's
   * real meaning ("bounded direct search over resolved pods," never
   * "indexed history") still satisfies this test's original intent: never
   * advertise a capability this source cannot actually deliver. Every
   * other capability is unchanged and still correctly `false` - OS-1D/1E
   * territory.
   */
  test('OpenShift appears as a source and advertises exactly the search capability it can deliver', async ({ page }) => {
    await page.goto('/');

    const sources = await page.evaluate(async () => {
      const response = await fetch('/api/v1/sources');
      return (await response.json()) as Array<{ id: string; displayName: string; capabilities: Record<string, boolean> }>;
    });

    const openshift = sources.find((s) => s.id === 'openshift');
    expect(openshift, 'the openshift source must be registered').toBeTruthy();
    expect(openshift!.displayName).toBe('OpenShift');
    // OS-1C: bounded direct search now exists.
    expect(openshift!.capabilities.historicalSearch).toBe(true);
    // Still out of scope: live tail, context view, raw LogQL, Compose-style scoping.
    expect(openshift!.capabilities.liveTail).toBe(false);
    expect(openshift!.capabilities.contextView).toBe(false);
    expect(openshift!.capabilities.rawLogQL).toBe(false);
    expect(openshift!.capabilities.composeProjectScoping).toBe(false);

    // And the pre-existing Loki source is untouched (OS-1A §22).
    const loki = sources.find((s) => s.id === 'openshift-loki');
    expect(loki, 'the existing openshift-loki source must remain').toBeTruthy();
    expect(loki!.capabilities.historicalSearch).toBe(true);
  });
});

test.describe('OS-1A §28/§29 - accessibility and responsive', () => {
  test('the form is fully keyboard operable', async ({ page }) => {
    await openPanel(page);

    // Every control has a real label, so it can be reached and named.
    const command = page.getByLabel(/paste your oc login command/i);
    await command.focus();
    await expect(command).toBeFocused();
    await page.keyboard.type('oc login --token=T0kenValue123456 --server=https://api.example.com:6443 --bad=x');

    await page.keyboard.press('Tab');
    const connect = page.getByRole('button', { name: /^connect$/i });
    await expect(connect).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page.getByRole('alert')).toBeVisible({ timeout: 10_000 });
  });

  test('Escape closes the panel and clears the pasted command', async ({ page }) => {
    await openPanel(page);
    await page.getByLabel(/paste your oc login command/i).fill('oc login --token=abcdefgh12345678 --server=https://a.example.com');

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: /openshift connection/i })).toHaveCount(0);

    // Reopening must not restore the previous command.
    await page.getByRole('button', { name: 'OpenShift' }).click();
    await expect(page.getByLabel(/paste your oc login command/i)).toHaveValue('');
  });

  for (const width of [1440, 1024, 768, 390]) {
    test(`C: usable at ${width}px with no page overflow`, async ({ page }) => {
      await setViewport(page, width, 900);
      await openPanel(page);

      await expect(page.getByLabel(/paste your oc login command/i)).toBeVisible();
      await expect(page.getByRole('button', { name: /^connect$/i })).toBeVisible();
      await assertNoHorizontalOverflow(page);

      if (width === 390 || width === 1440) {
        await captureScreenshot(page, PHASE, `AFTER-C-openshift-${width}px`);
      }
    });
  }
});
