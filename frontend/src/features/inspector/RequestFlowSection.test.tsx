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
    render(<RequestFlowSection event={sparseEvent()} onOpenJourney={vi.fn()} onShowContext={vi.fn()} />);
    expect(screen.getByText(/no journey, correlation, trace, span, or event id/i)).toBeInTheDocument();
  });

  it('a full event lists all 5 identifiers with Copy, but "Find this X" only for the 4 IMPLEMENTATION_PLAN.md "Phase I" scope item 1 names - never spanId', () => {
    render(<RequestFlowSection event={fullEvent()} onOpenJourney={vi.fn()} onShowContext={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: /^copy$/i })).toHaveLength(5);
    expect(screen.getByRole('button', { name: /find this journey id/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /find this correlation id/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /find this trace id/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /find this event id/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /find this span id/i })).not.toBeInTheDocument();
  });

  it('never renders a copy/find-this action for a sensitive field - only journey/correlation/trace/span/event appear', () => {
    render(<RequestFlowSection event={fullEvent()} onOpenJourney={vi.fn()} onShowContext={vi.fn()} />);
    const text = document.body.textContent?.toLowerCase() ?? '';
    // The section's own labels are exactly the five non-sensitive IDs;
    // none of the five sensitive field names (CLAUDE.md §2 rule 1) appear.
    for (const sensitive of ['cif', 'username', 'customerid', 'deviceid', 'deviceip']) {
      expect(text).not.toContain(sensitive);
    }
  });

  it('Copy writes the real, non-sensitive identifier value to the clipboard', async () => {
    const user = userEvent.setup();
    render(<RequestFlowSection event={fullEvent()} onOpenJourney={vi.fn()} onShowContext={vi.fn()} />);
    await user.click(screen.getAllByRole('button', { name: /^copy$/i })[0]);
    expect(copyToClipboard).toHaveBeenCalledWith('journey-000300');
  });

  it('"Find this Journey ID" calls onOpenJourney with the exact field and value', async () => {
    const user = userEvent.setup();
    const onOpenJourney = vi.fn();
    render(<RequestFlowSection event={fullEvent()} onOpenJourney={onOpenJourney} onShowContext={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /find this journey id/i }));
    expect(onOpenJourney).toHaveBeenCalledWith('journeyId', 'journey-000300');
  });

  it('"Find this Trace ID" calls onOpenJourney with traceId', async () => {
    const user = userEvent.setup();
    const onOpenJourney = vi.fn();
    render(<RequestFlowSection event={fullEvent()} onOpenJourney={onOpenJourney} onShowContext={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /find this trace id/i }));
    expect(onOpenJourney).toHaveBeenCalledWith('traceId', 'trace-000100');
  });

  it('an event with only a span ID gets Copy but no "Find this" action for it', () => {
    render(
      <RequestFlowSection
        event={sparseEvent({ spanId: 'span-only' })}
        onOpenJourney={vi.fn()}
        onShowContext={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /^copy$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /find this/i })).not.toBeInTheDocument();
  });

  it('has no detectable accessibility violations, with or without identifiers', async () => {
    const { container, rerender } = render(
      <RequestFlowSection event={sparseEvent()} onOpenJourney={vi.fn()} onShowContext={vi.fn()} />,
    );
    expect(await axe(container)).toHaveNoViolations();

    rerender(<RequestFlowSection event={fullEvent()} onOpenJourney={vi.fn()} onShowContext={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
