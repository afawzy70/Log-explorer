import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useOpenShiftScopeSummary } from './useOpenShiftScopeSummary';

const SCOPE = {
  selectedProject: 'payments-dev',
  discoveryApi: 'PROJECTS' as const,
  selectedWorkloadKind: null,
  selectedWorkloadName: null,
  selectedPod: null,
  selectedContainer: null,
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('useOpenShiftScopeSummary (OS-1F)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fetches the scope only while active, and reports it once resolved', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(SCOPE)));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useOpenShiftScopeSummary(true));

    expect(result.current.scope).toBeNull();
    await waitFor(() => expect(result.current.scope).toEqual(SCOPE));
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/sources/openshift/scope', expect.anything());
  });

  it('never fetches, and reports null, while inactive (another source is selected)', () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(SCOPE)));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useOpenShiftScopeSummary(false));

    expect(result.current.scope).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('clears to null the moment OpenShift stops being the active source - never a stale breadcrumb', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(SCOPE))));

    const { result, rerender } = renderHook(({ active }) => useOpenShiftScopeSummary(active), {
      initialProps: { active: true },
    });
    await waitFor(() => expect(result.current.scope).toEqual(SCOPE));

    rerender({ active: false });
    expect(result.current.scope).toBeNull();
  });

  it('re-fetches on demand via refresh() - the mechanism Settings-panel mutations use to keep the trail truthful', async () => {
    const UPDATED = { ...SCOPE, selectedPod: 'payment-api-abc123' };
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        call += 1;
        return Promise.resolve(jsonResponse(call === 1 ? SCOPE : UPDATED));
      }),
    );

    const { result } = renderHook(() => useOpenShiftScopeSummary(true));
    await waitFor(() => expect(result.current.scope).toEqual(SCOPE));

    result.current.refresh();
    await waitFor(() => expect(result.current.scope).toEqual(UPDATED));
  });

  it('reports null (not a thrown error) when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))));

    const { result } = renderHook(() => useOpenShiftScopeSummary(true));

    await waitFor(() => expect(result.current.scope).toBeNull());
  });
});
