import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { RequestFlowSection } from './RequestFlowSection';
import { fullEvent, sparseEvent } from './testEventFixture';
import { copyToClipboard } from '../../shared/browser/clipboard';

vi.mock('../../shared/browser/clipboard', () => ({
  copyToClipboard: vi.fn().mockResolvedValue(undefined),
}));

describe('RequestFlowSection', () => {
  it('an event with no request-flow IDs shows an honest empty note, not a blank section', () => {
    render(<RequestFlowSection event={sparseEvent()} onOpenJourney={vi.fn()} />);
    expect(screen.getByText(/no journey, correlation, trace, span, or event id/i)).toBeInTheDocument();
  });

  it('a full event lists all 5 identifiers with Copy and an investigation action for each, including spanId (owner mission "Mapping Verification and Investigation Workspace")', () => {
    render(<RequestFlowSection event={fullEvent()} onOpenJourney={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: /^copy$/i })).toHaveLength(5);
    expect(screen.getByRole('button', { name: /^find same journey$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^find same correlation$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^view trace$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^view span$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^find same event$/i })).toBeInTheDocument();
  });

  it('never renders a copy/find-this action for a sensitive field - only journey/correlation/trace/span/event appear', () => {
    render(<RequestFlowSection event={fullEvent()} onOpenJourney={vi.fn()} />);
    const text = document.body.textContent?.toLowerCase() ?? '';
    // The section's own labels are exactly the five non-sensitive IDs;
    // none of the five sensitive field names (CLAUDE.md §2 rule 1) appear.
    for (const sensitive of ['cif', 'username', 'customerid', 'deviceid', 'deviceip']) {
      expect(text).not.toContain(sensitive);
    }
  });

  it('Copy writes the real, non-sensitive identifier value to the clipboard', async () => {
    const user = userEvent.setup();
    render(<RequestFlowSection event={fullEvent()} onOpenJourney={vi.fn()} />);
    await user.click(screen.getAllByRole('button', { name: /^copy$/i })[0]);
    expect(copyToClipboard).toHaveBeenCalledWith('journey-000300');
  });

  it('"Find same Journey" calls onOpenJourney with the exact field, value, and this event as root', async () => {
    const user = userEvent.setup();
    const onOpenJourney = vi.fn();
    const event = fullEvent();
    render(<RequestFlowSection event={event} onOpenJourney={onOpenJourney} />);
    await user.click(screen.getByRole('button', { name: /^find same journey$/i }));
    expect(onOpenJourney).toHaveBeenCalledWith('journeyId', 'journey-000300', event);
  });

  it('"View Trace" calls onOpenJourney with traceId and this event as root', async () => {
    const user = userEvent.setup();
    const onOpenJourney = vi.fn();
    const event = fullEvent();
    render(<RequestFlowSection event={event} onOpenJourney={onOpenJourney} />);
    await user.click(screen.getByRole('button', { name: /^view trace$/i }));
    expect(onOpenJourney).toHaveBeenCalledWith('traceId', 'trace-000100', event);
  });

  it('"View Span" calls onOpenJourney with spanId and this event as root', async () => {
    const user = userEvent.setup();
    const onOpenJourney = vi.fn();
    const event = fullEvent();
    render(<RequestFlowSection event={event} onOpenJourney={onOpenJourney} />);
    await user.click(screen.getByRole('button', { name: /^view span$/i }));
    expect(onOpenJourney).toHaveBeenCalledWith('spanId', 'span-000200', event);
  });

  it('an event with only a span ID gets Copy and a "View Span" action for it', () => {
    render(<RequestFlowSection event={sparseEvent({ spanId: 'span-only' })} onOpenJourney={vi.fn()} />);
    expect(screen.getByRole('button', { name: /^copy$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^view span$/i })).toBeInTheDocument();
  });

  it('has no detectable accessibility violations, with or without identifiers', async () => {
    const { container, rerender } = render(
      <RequestFlowSection event={sparseEvent()} onOpenJourney={vi.fn()} />,
    );
    expect(await axe(container)).toHaveNoViolations();

    rerender(<RequestFlowSection event={fullEvent()} onOpenJourney={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
