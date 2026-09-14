import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from './App';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

/**
 * Legacy Remediation Slice 8 §16 "network behavior" - startup must fire
 * exactly one request per endpoint (sources, `/actuator/info` for
 * `EnvironmentBadge`, services, health, and — since the Configurable Log
 * Field Mapping mission — the field-mapping readiness check, five total),
 * never an accidental duplicate. This is a regression test for the audit
 * finding in `docs/verification/SLICE_8_FRONTEND_PERFORMANCE_REPORT.md`:
 * nothing in Slice 8 (the shared shortcut registry, JourneyView/
 * LiveTailPanel code splitting) touches startup data-fetching, and this
 * proves it stayed that way. `DockerSettingsPanel`'s own connection-summary
 * fetch is intentionally excluded - it only fires on the settings
 * popover's own `open()`, never at mount (verified separately by that
 * component's own tests), so it must never appear in this count either.
 * `FieldMappingSettingsPanel`'s own sample-fetch is the same - only on
 * its own button click, never at mount. The field-mapping *readiness*
 * check (`GET /api/v1/settings/field-mapping`, read by `useSearchState`
 * directly, not by that panel) is the one field-mapping-related call that
 * genuinely does fire at startup - it gates the Search button globally,
 * so it must be known before the very first Search is possible.
 */
describe('startup network requests', () => {
  let calls: string[];

  beforeEach(() => {
    calls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        calls.push(url);
        if (url.endsWith('/api/v1/sources')) {
          return jsonResponse([
            {
              id: 'fixture',
              displayName: 'Fixture',
              capabilities: {
                historicalSearch: true,
                liveTail: false,
                rawLogQL: false,
                serviceDiscovery: true,
                queryStatistics: false,
                contextView: false,
              },
            },
          ]);
        }
        if (url.includes('/health')) {
          return jsonResponse({ status: 'UP', message: 'ok', checkedAt: '2026-01-01T00:00:00Z', warnings: [] });
        }
        if (url.includes('/services')) {
          return jsonResponse([{ name: 'gateway', runningCount: 1, totalCount: 1 }]);
        }
        if (url.endsWith('/actuator/info')) {
          return jsonResponse({});
        }
        if (url.endsWith('/api/v1/settings/field-mapping')) {
          return jsonResponse({ fields: [], modifiedFromDefault: false, searchReady: true });
        }
        throw new Error(`Unexpected fetch in startup-network test: ${url}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fires exactly one request each for sources, environment info, services, health, and field-mapping readiness - no accidental duplicates', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('fixture'));
    await waitFor(() => expect(calls.some((u) => u.includes('/services'))).toBe(true));
    await waitFor(() => expect(calls.some((u) => u.includes('/health'))).toBe(true));
    await waitFor(() => expect(calls.some((u) => u.endsWith('/actuator/info'))).toBe(true));
    await waitFor(() => expect(calls.some((u) => u.endsWith('/api/v1/settings/field-mapping'))).toBe(true));

    const sourcesCalls = calls.filter((u) => u.endsWith('/api/v1/sources'));
    const infoCalls = calls.filter((u) => u.endsWith('/actuator/info'));
    const servicesCalls = calls.filter((u) => u.includes('/services'));
    const healthCalls = calls.filter((u) => u.includes('/health'));
    const fieldMappingCalls = calls.filter((u) => u.endsWith('/api/v1/settings/field-mapping'));

    expect(sourcesCalls).toHaveLength(1);
    expect(infoCalls).toHaveLength(1);
    expect(servicesCalls).toHaveLength(1);
    expect(healthCalls).toHaveLength(1);
    expect(fieldMappingCalls).toHaveLength(1);
    expect(calls).toHaveLength(5); // nothing else fires at startup - in particular, no Docker connection-summary call, no field-mapping sample fetch
  });
});
