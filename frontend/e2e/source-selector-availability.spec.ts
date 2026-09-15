import { test, expect } from '@playwright/test';

/*
 * Owner decision (PR #59 pre-merge): the user-facing source selector lists
 * Docker, OpenShift, OpenShift Loki in that order (by stable source id, never
 * API order), and OpenShift Loki is visible but not selectable. Real backend
 * (SPRING_PROFILES_ACTIVE=dev), which still registers the OpenShift Loki
 * adapter - only the UI availability changed.
 */
test('source selector: Docker, OpenShift, OpenShift Loki (not available); Loki is never requested as the active source', async ({ page }) => {
  const lokiRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/sources/openshift-loki')) {
      lokiRequests.push(request.url());
    }
  });

  await page.goto('/');
  const select = page.getByRole('combobox', { name: 'Source', exact: true });
  await expect(select.locator('option[value="openshift-loki"]')).toHaveCount(1);

  const values = await select.locator('option').evaluateAll((options) =>
    options.map((option) => (option as HTMLOptionElement).value));
  const production = values.filter((value) => ['local-docker', 'openshift', 'openshift-loki'].includes(value));
  expect(production).toEqual(['local-docker', 'openshift', 'openshift-loki']);

  const loki = select.locator('option[value="openshift-loki"]');
  await expect(loki).toBeDisabled();
  await expect(loki).toHaveText('OpenShift Loki — Not available');

  // The highest-priority selectable source is the default, never Loki.
  await expect(select).toHaveValue('local-docker');

  // Loki cannot be chosen: Playwright refuses a disabled option and the value stays unchanged.
  await expect(select.selectOption('openshift-loki', { timeout: 2_000 })).rejects.toThrow();
  await expect(select).toHaveValue('local-docker');

  // Docker, OpenShift, and the dev-only Fixture source remain selectable.
  await select.selectOption('openshift');
  await expect(select).toHaveValue('openshift');
  await select.selectOption('fixture');
  await expect(select).toHaveValue('fixture');
  await select.selectOption('local-docker');
  await expect(select).toHaveValue('local-docker');

  expect(lokiRequests).toEqual([]);
});
