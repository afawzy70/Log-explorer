import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

const SOURCE = {
  id: 'fixture',
  displayName: 'Fixture',
  capabilities: {
    historicalSearch: true,
    liveTail: false,
    rawLogQL: false,
    serviceDiscovery: true,
    queryStatistics: false,
    contextView: true,
    composeProjectScoping: false,
    originalSchemaSampling: true,
  },
};

const RULES_STATE = {
  revision: 1,
  updatedAt: null,
  status: 'OK',
  statusMessage: null,
  storageFile: '/data/classification-rules.json',
  rules: [],
  tags: [],
  limits: {},
  fields: [{ key: 'message', label: 'Message' }],
  runtime: { eventsEvaluated: 0, ruleMatches: 0, evaluationFailures: 0 },
};

describe('App - Classification rules workspace takeover', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.endsWith('/api/v1/sources')) {
          return jsonResponse([SOURCE]);
        }
        if (url.includes('/health')) {
          return jsonResponse({ status: 'UP', message: 'ok', checkedAt: '2026-01-01T00:00:00Z', warnings: [] });
        }
        if (url.includes('/services')) {
          return jsonResponse([]);
        }
        if (url.endsWith('/actuator/info')) {
          return jsonResponse({});
        }
        if (url.includes('/api/v1/settings/field-mapping')) {
          return jsonResponse({ sourceId: null, scopeLabel: null, fields: [], modifiedFromDefault: false, searchReady: true });
        }
        if (url.endsWith('/api/v1/settings/classification-rules')) {
          return jsonResponse(RULES_STATE);
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /*
   * B2 (Session 4) - "Classification rules" no longer has its own top-level Shell button
   * (COMPONENT_INVENTORY.md: "Replaced by Settings › Classification rules"); it is now reached via the
   * consolidated Settings entry point, one extra click, same destination and behaviour otherwise.
   */
  it('opens from Settings, replaces the results workspace, is mutually exclusive with field mapping, and closes back', async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByRole('combobox', { name: /source/i })).toHaveValue('fixture'));

    await user.click(screen.getByRole('button', { name: /^settings$/i }));
    await waitFor(() => expect(screen.getByTestId('settings-workspace')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Manage classification rules' }));
    await waitFor(() => expect(screen.getByTestId('classification-rules-workspace')).toBeInTheDocument());
    expect(await screen.findByText('No classification rules yet.')).toBeInTheDocument();
    expect(screen.queryByText(/run a search to see results/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('settings-workspace')).not.toBeInTheDocument();

    // DRIFT-016 remediation - the classification workspace now renders its own SettingsNav, whose "Field
    // mapping" nav item shares its accessible name with Shell's persistent top-level trigger; scope to the
    // page header (Shell's own <header>, an implicit "banner" landmark) to click that one specifically.
    await user.click(within(screen.getByRole('banner')).getByRole('button', { name: /^field mapping$/i }));
    await waitFor(() => expect(screen.getByTestId('field-mapping-workspace')).toBeInTheDocument());
    expect(screen.queryByTestId('classification-rules-workspace')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^settings$/i }));
    await waitFor(() => expect(screen.getByTestId('settings-workspace')).toBeInTheDocument());
    expect(screen.queryByTestId('field-mapping-workspace')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Manage classification rules' }));
    await waitFor(() => expect(screen.getByTestId('classification-rules-workspace')).toBeInTheDocument());
    expect(screen.queryByTestId('field-mapping-workspace')).not.toBeInTheDocument();
    expect(screen.queryByTestId('settings-workspace')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /back to search results/i }));
    await waitFor(() => expect(screen.queryByTestId('classification-rules-workspace')).not.toBeInTheDocument());
    expect(screen.getByText(/run a search to see results/i)).toBeInTheDocument();
  });
});
