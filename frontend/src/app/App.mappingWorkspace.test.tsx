import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

const MAPPING_PROFILE = {
  sourceId: null,
  scopeLabel: null,
  fields: [
    { field: 'cif', displayName: 'CIF', sensitive: true, candidatePaths: ['mdc.cif'], verificationStatus: 'UNVERIFIED' },
  ],
  modifiedFromDefault: false,
  searchReady: true,
};

/**
 * Owner mission "Mapping Verification and Investigation Workspace" - a
 * real `<App />` integration test (not just `Shell.test.tsx`/
 * `FieldMappingWorkspace.test.tsx` in isolation), proving the workspace is
 * genuinely a dedicated full-page overlay wired end to end through
 * `useSearchState`/`App.tsx`: it replaces the results workspace (not a
 * popover on top of it) and returns cleanly.
 */
describe('App - Mapping Verification workspace as a dedicated page', () => {
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
          return jsonResponse(MAPPING_PROFILE);
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens as a real full-page overlay (replacing the results workspace, not a popover on top of it) and closes back to it', async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(screen.getByRole('combobox', { name: /source/i })).toHaveValue('fixture'));
    expect(screen.getByText(/run a search to see results/i)).toBeInTheDocument();

    // B2 (Session 4) - the top-level Shell trigger's label shortened to "Field mapping" (Shell.tsx's own
    // comment has the full rationale); FieldMappingWorkspace's own heading is unchanged.
    await user.click(screen.getByRole('button', { name: /^field mapping$/i }));

    await waitFor(() => expect(screen.getByTestId('field-mapping-workspace')).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: /log schema & field mapping verification/i })).toBeInTheDocument();
    expect(screen.getByText('CIF')).toBeInTheDocument();
    // The results workspace is genuinely gone, not just covered.
    expect(screen.queryByText(/run a search to see results/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /back to search results/i }));

    await waitFor(() => expect(screen.queryByTestId('field-mapping-workspace')).not.toBeInTheDocument());
    expect(screen.getByText(/run a search to see results/i)).toBeInTheDocument();
  });
});
