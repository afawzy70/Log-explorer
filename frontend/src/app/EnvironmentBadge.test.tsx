import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { EnvironmentBadge } from './EnvironmentBadge';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('EnvironmentBadge (UI Gap Closure Pass)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the real backend-reported label, uppercased, from /actuator/info - never a hardcoded value', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({ environment: { activeProfiles: ['dev'], label: 'dev' } }))));
    render(<EnvironmentBadge />);
    expect(await screen.findByText('DEV')).toBeInTheDocument();
  });

  it('joins multiple active profiles the server already joined, verbatim', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({ environment: { activeProfiles: ['dev', 'test'], label: 'dev,test' } }))),
    );
    render(<EnvironmentBadge />);
    expect(await screen.findByText('DEV,TEST')).toBeInTheDocument();
  });

  it('renders nothing while the fetch is still pending', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const { container } = render(<EnvironmentBadge />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the fetch fails - never a guessed fallback like "production"', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network error'))));
    const { container } = render(<EnvironmentBadge />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByText(/production|prod/i)).toBeNull();
  });

  it('renders nothing when the response has no environment.label field', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({}))));
    const { container } = render(<EnvironmentBadge />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('renders nothing when the label is an empty/whitespace-only string', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({ environment: { activeProfiles: [], label: '   ' } }))));
    const { container } = render(<EnvironmentBadge />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('renders the literal word "default" when no profile is active - never inferring "production"', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({ environment: { activeProfiles: [], label: 'default' } }))));
    render(<EnvironmentBadge />);
    expect(await screen.findByText('DEFAULT')).toBeInTheDocument();
  });

  it('exposes the raw (non-uppercased) label via the title attribute for a truthful tooltip', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({ environment: { activeProfiles: ['dev'], label: 'dev' } }))));
    render(<EnvironmentBadge />);
    const badge = await screen.findByText('DEV');
    expect(badge).toHaveAttribute('title', 'Active backend profile: dev');
  });
});
